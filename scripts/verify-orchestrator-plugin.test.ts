// Run: bun test scripts/verify-orchestrator-plugin.test.ts
// Uses isolated HOME/XDG directories, a standalone OpenCode V2 server, and a
// local provider stub; never calls a real model, registry, or live config.
import { expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { ORCHESTRATOR_PROMPT } from "../plugins/orchestrator/prompt"
import type { OrchestratorStatus } from "../plugins/orchestrator/rpc"

const root = resolve(import.meta.dir, "..")
mkdirSync(join(root, ".opencode", "runs"), { recursive: true })
const run = mkdtempSync(join(root, ".opencode", "runs", "orchestrator."))
const binary = Bun.which("opencode")
if (!binary) throw new Error("opencode is required")
console.info(`Records: ${run}`)

const env = {
  ...Object.fromEntries(
    [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "http_proxy",
      "https_proxy",
      "no_proxy",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
    ].flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])),
  ),
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  HOME: join(run, "home"),
  XDG_CONFIG_HOME: join(run, "config"),
  XDG_CACHE_HOME: join(run, "cache"),
  XDG_DATA_HOME: join(run, "data"),
  XDG_STATE_HOME: join(run, "state"),
  SANDBOX_ID: process.env.SANDBOX_ID ?? "verify-orchestrator",
  TERM: "xterm",
  OPENCODE_LOG_LEVEL: "DEBUG",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  NODE_USE_ENV_PROXY: "1",
}

const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString()
writeFileSync(join(run, "workspace.patch"), git("diff"))
writeFileSync(
  join(run, "conditions.json"),
  JSON.stringify(
    {
      entry: "bun test scripts/verify-orchestrator-plugin.test.ts",
      time: new Date().toISOString(),
      head: git("rev-parse", "HEAD").trim(),
      bun: Bun.version,
      opencode: Bun.spawnSync([binary, "--version"]).stdout.toString().trim(),
      env,
    },
    null,
    2,
  ),
)

async function pickFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address()
      const port = typeof address === "object" && address ? address.port : 0
      srv.close((err) => (err ? reject(err) : resolvePort(port)))
    })
  })
}

test("orchestrator plugin toggles per-session prompt injection while isolating other sessions and subagents", async () => {
  // Verify TUI plugin source transpiles cleanly and imports only host-provided or local modules.
  const tuiSource = readFileSync(join(root, "plugins", "orchestrator", "tui.ts"), "utf8")
  const scanned = new Bun.Transpiler({ loader: "ts", target: "bun" }).scan(tuiSource)
  expect(scanned.imports.map((item) => item.path)).toEqual(["@opencode/plugin/tui", "./rpc"])

  mkdirSync(env.HOME, { recursive: true })
  const install = Bun.spawnSync(["bash", join(root, "install.sh")], { cwd: root, env })
  writeFileSync(join(run, "install.log"), Buffer.concat([install.stdout, install.stderr]))
  expect(install.exitCode).toBe(0)

  type ToolDecl = {
    type?: string
    function?: { name?: string; parameters?: { properties?: Record<string, unknown> } }
    name?: string
    parameters?: { properties?: Record<string, unknown> }
  }
  type Captured = {
    model: string
    messages: { role: string; content: unknown }[]
    tools?: ToolDecl[]
  }
  const captured: Captured[] = []
  let unrelatedSessionID = ""
  let slowGeneralAborted = false

  const respondChoice = (
    model: string,
    choice: {
      index: number
      message: {
        role: "assistant"
        content: string | null
        tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]
      }
      finish_reason: string
    },
    stream?: boolean,
  ) => {
    const result = {
      id: "verification",
      object: "chat.completion",
      created: 0,
      model,
      choices: [choice],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }
    if (!stream) return Response.json(result)
    const delta = choice.message.tool_calls
      ? {
          role: "assistant",
          tool_calls: choice.message.tool_calls.map((tc, index) => ({ index, ...tc })),
        }
      : { role: "assistant", content: choice.message.content ?? "" }
    const chunk = {
      ...result,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta, finish_reason: null }],
    }
    const finish = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`, {
      headers: { "content-type": "text/event-stream" },
    })
  }

  const providerServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (!new URL(request.url).pathname.endsWith("/chat/completions")) {
        return new Response("not found", { status: 404 })
      }
      const body = (await request.json()) as Captured & { stream?: boolean }
      captured.push({ model: body.model, messages: body.messages, tools: body.tools })
      writeFileSync(join(run, "requests.json"), JSON.stringify(captured, null, 2))

      if (body.model === "title-model") {
        return respondChoice(
          body.model,
          { index: 0, message: { role: "assistant", content: "Title" }, finish_reason: "stop" },
          body.stream,
        )
      }

      const serialized = JSON.stringify(body.messages)
      const toolResults = body.messages.filter((m) => m.role === "tool")
      const isChildSession = !serialized.includes("LAUNCH_")

      // Child subagent behaviors
      if (isChildSession && serialized.includes("CHILD_FAST_GENERAL")) {
        return respondChoice(
          body.model,
          { index: 0, message: { role: "assistant", content: "FAST_GENERAL_DONE" }, finish_reason: "stop" },
          body.stream,
        )
      }
      if (isChildSession && serialized.includes("CHILD_SLOW_EXPLORE")) {
        await Bun.sleep(1500)
        return respondChoice(
          body.model,
          { index: 0, message: { role: "assistant", content: "SLOW_EXPLORE_DONE" }, finish_reason: "stop" },
          body.stream,
        )
      }
      if (isChildSession && serialized.includes("CHILD_STUCK_GENERAL")) {
        await new Promise<void>((resolveWait) => {
          const timer = setTimeout(resolveWait, 10_000)
          request.signal.addEventListener(
            "abort",
            () => {
              slowGeneralAborted = true
              clearTimeout(timer)
              resolveWait()
            },
            { once: true },
          )
        })
        if (request.signal.aborted) {
          return new Response("aborted", { status: 499 })
        }
        return respondChoice(
          body.model,
          { index: 0, message: { role: "assistant", content: "STUCK_GENERAL_UNEXPECTED_FINISH" }, finish_reason: "stop" },
          body.stream,
        )
      }

      // Parent orchestrator test scenarios
      if (serialized.includes("LAUNCH_FAST_GENERAL") && toolResults.length === 0) {
        return respondChoice(
          body.model,
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_fast_gen",
                  type: "function",
                  function: {
                    name: "subagent",
                    arguments: JSON.stringify({
                      agent: "general",
                      description: "fast general worker",
                      prompt: "CHILD_FAST_GENERAL",
                      timeoutSec: 1.5,
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
          body.stream,
        )
      }

      if (serialized.includes("LAUNCH_SLOW_EXPLORE") && toolResults.length === 0) {
        return respondChoice(
          body.model,
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_slow_exp",
                  type: "function",
                  function: {
                    name: "subagent",
                    arguments: JSON.stringify({
                      agent: "explore",
                      description: "slow explore worker",
                      prompt: "CHILD_SLOW_EXPLORE",
                      timeoutSec: 0.4,
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
          body.stream,
        )
      }

      if (serialized.includes("LAUNCH_STUCK_GENERAL")) {
        const timeoutMatch = serialized.match(/<orchestrator-timeout sessionID=\\"(ses_[^\\"]+)\\"/)
        if (!timeoutMatch && toolResults.length === 0) {
          return respondChoice(
            body.model,
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_stuck_gen",
                    type: "function",
                    function: {
                      name: "subagent",
                      arguments: JSON.stringify({
                        agent: "general",
                        description: "stuck general worker",
                        prompt: "CHILD_STUCK_GENERAL",
                        timeoutSec: 0.7,
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
            body.stream,
          )
        }
        if (timeoutMatch && toolResults.length === 1) {
          // On soft-timeout wake-up: first attempt interrupting an unrelated session (must be rejected).
          return respondChoice(
            body.model,
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_interrupt_unrelated",
                    type: "function",
                    function: {
                      name: "orchestrator_interrupt",
                      arguments: JSON.stringify({
                        sessionID: unrelatedSessionID,
                        reason: "cross-session probe",
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
            body.stream,
          )
        }
        if (timeoutMatch && toolResults.length === 2) {
          // Then interrupt the real stuck child session.
          return respondChoice(
            body.model,
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_interrupt_child",
                    type: "function",
                    function: {
                      name: "orchestrator_interrupt",
                      arguments: JSON.stringify({
                        sessionID: timeoutMatch[1],
                        reason: "worker stuck on task",
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
            body.stream,
          )
        }
        if (timeoutMatch && toolResults.length >= 3) {
          return respondChoice(
            body.model,
            { index: 0, message: { role: "assistant", content: "ORCHESTRATOR_HANDLED_TIMEOUT" }, finish_reason: "stop" },
            body.stream,
          )
        }
      }

      return respondChoice(
        body.model,
        { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        body.stream,
      )
    },
  })

  const configPath = join(env.XDG_CONFIG_HOME, "opencode", "opencode.json")
  const config = await Bun.file(configPath).json()
  // Test only the local orchestrator plugin without network calls to npm for models-md.
  delete config.plugins
  config.providers = {
    mock: {
      name: "Local verification",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `http://127.0.0.1:${providerServer.port}/v1`, apiKey: "test" },
      models: {
        "claude-fable-5-2": { name: "claude-fable-5-2" },
        "title-model": { name: "title-model" },
      },
    },
  }
  config.agents = {
    title: { model: "mock/title-model" },
    compaction: { model: "mock/title-model" },
    summary: { model: "mock/title-model" },
    general: { model: "mock/claude-fable-5-2" },
    explore: { model: "mock/claude-fable-5-2" },
  }
  await Bun.file(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "adopt-catalog.ts")).delete()
  await Bun.file(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "cap-context.ts")).delete()
  rmSync(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "deepseek-fallback"), { recursive: true, force: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  mkdirSync("/tmp/opencode", { recursive: true })
  const project = mkdtempSync("/tmp/opencode/orchestrator-project.")
  const port = await pickFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const serverProc = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: project,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const serverStderr = new Response(serverProc.stderr).text()
  const stdoutLines: string[] = []
  let password = ""
  const reader = serverProc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  while (!password) {
    const { value, done } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split("\n")
    buffered = lines.pop() ?? ""
    for (const line of lines) {
      stdoutLines.push(line)
      const match = line.match(/^server password (\S+)$/)
      if (match) password = match[1]!
    }
  }
  const restStdout = (async () => {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      stdoutLines.push(decoder.decode(value, { stream: true }))
    }
    return stdoutLines.join("\n")
  })()
  expect(password.length, `Missing server password; see ${run}`).toBeGreaterThan(0)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`

  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { authorization: authHeader }
    if (body !== undefined) headers["content-type"] = "application/json"
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${text}`)
    return (text ? JSON.parse(text) : undefined) as T
  }

  const rpc = async <T>(method: "status" | "set" | "toggle", input: Record<string, unknown>) => {
    const res = await api<{ output: T }>(
      "POST",
      `/api/rpc/orchestrator/${method}?location[directory]=${encodeURIComponent(project)}`,
      { input },
    )
    return res.output
  }

  const createSession = async (body: Record<string, unknown>) =>
    (await api<{ data: { id: string } }>("POST", "/api/session", body)).data

  const runTurn = async (sessionID: string, text: string) => {
    const start = captured.length
    await api("POST", `/api/session/${encodeURIComponent(sessionID)}/prompt`, { text })
    await api("POST", `/api/experimental/session/${encodeURIComponent(sessionID)}/wait`)
    const turns = captured.slice(start)
    const primary = turns.filter((item) => item.model === "claude-fable-5-2")
    const titles = turns.filter((item) => item.model === "title-model")
    expect(primary.length).toBeGreaterThan(0)
    const systemOf = (item: Captured) =>
      JSON.stringify(item.messages.filter((m) => m.role === "system" || m.role === "developer"))
    const mainReq = primary.sort((a, b) => systemOf(b).length - systemOf(a).length)[0]!
    const toolName = (t: ToolDecl) => t.function?.name ?? t.name
    const toolProps = (t: ToolDecl) => t.function?.parameters?.properties ?? t.parameters?.properties ?? {}
    const subagentDecl = (mainReq.tools ?? []).find((t) => toolName(t) === "subagent")
    return {
      primarySystem: systemOf(mainReq),
      titleSystems: titles.map(systemOf),
      toolNames: (mainReq.tools ?? []).map(toolName).filter((n): n is string => Boolean(n)),
      subagentHasTimeoutSec: Boolean(subagentDecl && "timeoutSec" in toolProps(subagentDecl)),
    }
  }

  try {
    await api("GET", "/api/info")
    type PluginList = {
      data: { id: string; features: Record<string, boolean>; state: { status: string; error?: unknown } }[]
    }
    let orchestratorPlugin: PluginList["data"][number] | undefined
    for (let i = 0; i < 100; i++) {
      const plugins = await api<PluginList>("GET", `/api/plugin?location[directory]=${encodeURIComponent(project)}`)
      writeFileSync(join(run, "plugins.json"), JSON.stringify(plugins, null, 2))
      orchestratorPlugin = plugins.data.find((item) => item.id === "orchestrator")
      if (orchestratorPlugin && orchestratorPlugin.state.status !== "loading") break
      await Bun.sleep(100)
    }
    expect(orchestratorPlugin, `orchestrator plugin not discovered; see ${run}/plugins.json`).toBeDefined()
    expect(orchestratorPlugin?.state.status).toBe("active")
    expect(orchestratorPlugin?.features).toMatchObject({ server: true, tui: true })

    const sessionA = await createSession({
      location: { directory: project },
      model: { providerID: "mock", id: "claude-fable-5-2" },
    })
    const sessionB = await createSession({
      location: { directory: project },
      model: { providerID: "mock", id: "claude-fable-5-2" },
    })
    unrelatedSessionID = sessionB.id

    // 1. Default OFF on all new sessions (including claude-fable-5-2): neither orchestrator prompt nor orchestrator tools are exposed.
    const initialA = await rpc<OrchestratorStatus>("status", { sessionID: sessionA.id })
    expect(initialA).toEqual({ sessionID: sessionA.id, enabled: false })
    const turn1 = await runTurn(sessionA.id, "Turn 1 default off")
    expect(turn1.primarySystem).not.toContain("## 指挥者模式")
    expect(turn1.primarySystem).not.toContain("glm-5.3-flash")
    expect(turn1.toolNames).not.toContain("orchestrator_interrupt")
    expect(turn1.subagentHasTimeoutSec).toBe(false)

    // 2. Manual ON via toggle on sessionA: injects exact ORCHESTRATOR_PROMPT and exposes timeoutSec + orchestrator_interrupt.
    const toggledOn = await rpc<OrchestratorStatus>("toggle", { sessionID: sessionA.id })
    expect(toggledOn).toEqual({ sessionID: sessionA.id, enabled: true })
    const sessionC = await createSession({
      location: { directory: project },
      model: { providerID: "mock", id: "claude-fable-5-2" },
    })
    await rpc<OrchestratorStatus>("set", { sessionID: sessionC.id, enabled: true })
    const turnC = await runTurn(sessionC.id, "First turn with orchestrator enabled")
    expect(turnC.primarySystem).toContain(JSON.stringify(ORCHESTRATOR_PROMPT).slice(1, -1))
    expect(turnC.toolNames).toContain("orchestrator_interrupt")
    expect(turnC.subagentHasTimeoutSec).toBe(true)
    for (const titleSys of turnC.titleSystems) {
      expect(titleSys).not.toContain("## 指挥者模式")
    }

    const turn2 = await runTurn(sessionA.id, "Turn 2 orchestrator enabled")
    expect(turn2.primarySystem).toContain(JSON.stringify(ORCHESTRATOR_PROMPT).slice(1, -1))
    expect(turn2.toolNames).toContain("orchestrator_interrupt")
    expect(turn2.subagentHasTimeoutSec).toBe(true)

    // 3. Per-session isolation: sessionB remains OFF.
    const statusB = await rpc<OrchestratorStatus>("status", { sessionID: sessionB.id })
    expect(statusB).toEqual({ sessionID: sessionB.id, enabled: false })
    const turnB = await runTurn(sessionB.id, "Session B stays off")
    expect(turnB.primarySystem).not.toContain("## 指挥者模式")
    expect(turnB.toolNames).not.toContain("orchestrator_interrupt")
    expect(turnB.subagentHasTimeoutSec).toBe(false)

    // 4. Child subagent isolation: child of enabled sessionA does NOT receive orchestrator prompt or tools,
    // and querying status on child resolves to root sessionA.
    const childA = await createSession({
      parentID: sessionA.id,
      agent: "general",
      location: { directory: project },
      model: { providerID: "mock", id: "claude-fable-5-2" },
    })
    const childStatus = await rpc<OrchestratorStatus>("status", { sessionID: childA.id })
    expect(childStatus).toEqual({ sessionID: sessionA.id, enabled: true })
    const turnChild = await runTurn(childA.id, "Subagent worker task")
    expect(turnChild.primarySystem).not.toContain("## 指挥者模式")
    expect(turnChild.primarySystem).not.toContain("glm-5.3-flash")
    expect(turnChild.toolNames).not.toContain("orchestrator_interrupt")
    expect(turnChild.subagentHasTimeoutSec).toBe(false)

    // 5. Manual OFF mid-session on sessionA: next turn immediately drops orchestrator prompt and tools.
    const toggledOff = await rpc<OrchestratorStatus>("toggle", { sessionID: sessionA.id })
    expect(toggledOff).toEqual({ sessionID: sessionA.id, enabled: false })
    const turn3 = await runTurn(sessionA.id, "Turn 3 orchestrator disabled again")
    expect(turn3.primarySystem).not.toContain("## 指挥者模式")
    expect(turn3.toolNames).not.toContain("orchestrator_interrupt")
    expect(turn3.subagentHasTimeoutSec).toBe(false)

    // 6. TUI entrypoint command layer wired to the live server RPC and session APIs.
    mock.module("@opencode/plugin/tui", () => ({
      Plugin: { define: <T>(def: T) => def },
    }))
    const { default: tuiPlugin } = await import("../plugins/orchestrator/tui")
    type LayerDef = { commands: { id: string; slash?: { name: string }; run: (input?: string) => Promise<void> }[] }
    let registeredLayer: (() => LayerDef) | undefined
    const toasts: { title?: string; message: string; variant?: string }[] = []
    let currentRoute: { type: "home" } | { type: "session"; sessionID: string } = { type: "home" }
    const knownSessions = new Map<string, { id: string; parentID?: string; location: { directory: string } }>([
      [sessionA.id, { id: sessionA.id, location: { directory: project } }],
      [childA.id, { id: childA.id, parentID: sessionA.id, location: { directory: project } }],
    ])

    await tuiPlugin.setup({
      location: { directory: project, workspaceID: "ws-ignored" },
      keymap: {
        layer: (factory: () => LayerDef) => {
          registeredLayer = factory
        },
      },
      ui: {
        toast: { show: (toast: { title?: string; message: string; variant?: string }) => toasts.push(toast) },
        router: {
          current: () => currentRoute,
          navigate: (dest: { type: "home" } | { type: "session"; sessionID: string }) => {
            currentRoute = dest
          },
        },
        tabs: { focus: () => false },
        model: { current: () => ({ providerID: "mock", modelID: "claude-fable-5-2" }) },
      },
      data: {
        location: { default: () => ({ directory: project }) },
        session: {
          root: (id: string) => knownSessions.get(id)?.parentID ?? id,
          get: (id: string) => knownSessions.get(id),
          invalidate: () => {},
        },
      },
      client: {
        session: {
          create: async (input: Record<string, unknown>) => {
            const created = await createSession(input)
            const entry = { id: created.id, location: { directory: project } }
            knownSessions.set(created.id, entry)
            return entry
          },
        },
        rpc: () => ({
          status: (input: Record<string, unknown>, opts?: { location?: { directory: string } }) =>
            api<{ output: OrchestratorStatus }>(
              "POST",
              `/api/rpc/orchestrator/status?location[directory]=${encodeURIComponent(opts?.location?.directory ?? project)}`,
              { input },
            ).then((r) => r.output),
          set: (input: Record<string, unknown>, opts?: { location?: { directory: string } }) =>
            api<{ output: OrchestratorStatus }>(
              "POST",
              `/api/rpc/orchestrator/set?location[directory]=${encodeURIComponent(opts?.location?.directory ?? project)}`,
              { input },
            ).then((r) => r.output),
          toggle: (input: Record<string, unknown>, opts?: { location?: { directory: string } }) =>
            api<{ output: OrchestratorStatus }>(
              "POST",
              `/api/rpc/orchestrator/toggle?location[directory]=${encodeURIComponent(opts?.location?.directory ?? project)}`,
              { input },
            ).then((r) => r.output),
        }),
      },
    } as never)

    const cmd = registeredLayer?.().commands.find((item) => item.id === "orchestrator.toggle")
    expect(cmd?.slash?.name).toBe("orchestrator")

    // On home route: "/orchestrator" creates a new session with orchestrator ON and navigates to it.
    await cmd!.run("")
    expect(currentRoute.type).toBe("session")
    const homeCreatedID = (currentRoute as { type: "session"; sessionID: string }).sessionID
    const turnHomeCreated = await runTurn(homeCreatedID, "Created from home with orchestrator on")
    expect(turnHomeCreated.primarySystem).toContain(JSON.stringify(ORCHESTRATOR_PROMPT).slice(1, -1))

    // Invalid argument warning, status check, and "/orchestrator off" on that session.
    await cmd!.run("invalid-arg")
    expect(toasts.at(-1)?.variant).toBe("warning")
    await cmd!.run("status")
    expect(toasts.at(-1)?.message).toContain("已开启")
    await cmd!.run("off")
    expect(toasts.at(-1)?.message).toContain("已关闭")
    const turnHomeOff = await runTurn(homeCreatedID, "Disabled via TUI slash command")
    expect(turnHomeOff.primarySystem).not.toContain("## 指挥者模式")

    // 7. Fast general subagent completes before timeoutSec and never fires a stale soft-timeout notice.
    const fastParent = await createSession({
      location: { directory: project },
      model: { providerID: "mock", id: "claude-fable-5-2" },
    })
    await rpc<OrchestratorStatus>("set", { sessionID: fastParent.id, enabled: true })
    await api("POST", `/api/session/${encodeURIComponent(fastParent.id)}/prompt`, { text: "LAUNCH_FAST_GENERAL" })
    let fastMessagesText = ""
    for (let i = 0; i < 80; i++) {
      await api("POST", `/api/experimental/session/${encodeURIComponent(fastParent.id)}/wait`).catch(() => {})
      fastMessagesText = JSON.stringify(await api<unknown>("GET", `/api/session/${encodeURIComponent(fastParent.id)}/message`))
      if (fastMessagesText.includes("FAST_GENERAL_DONE")) break
      await Bun.sleep(100)
    }
    expect(fastMessagesText).toContain("FAST_GENERAL_DONE")
    await Bun.sleep(1800)
    fastMessagesText = JSON.stringify(await api<unknown>("GET", `/api/session/${encodeURIComponent(fastParent.id)}/message`))
    expect(fastMessagesText).not.toContain("<orchestrator-timeout")

    // 8. Slow explore subagent does NOT trigger soft timeout even when timeoutSec is passed.
    const exploreParent = await createSession({
      location: { directory: project },
      model: { providerID: "mock", id: "claude-fable-5-2" },
    })
    await rpc<OrchestratorStatus>("set", { sessionID: exploreParent.id, enabled: true })
    await api("POST", `/api/session/${encodeURIComponent(exploreParent.id)}/prompt`, { text: "LAUNCH_SLOW_EXPLORE" })
    let exploreMessagesText = ""
    for (let i = 0; i < 100; i++) {
      await api("POST", `/api/experimental/session/${encodeURIComponent(exploreParent.id)}/wait`).catch(() => {})
      exploreMessagesText = JSON.stringify(
        await api<unknown>("GET", `/api/session/${encodeURIComponent(exploreParent.id)}/message`),
      )
      if (exploreMessagesText.includes("SLOW_EXPLORE_DONE")) break
      await Bun.sleep(100)
    }
    expect(exploreMessagesText).toContain("SLOW_EXPLORE_DONE")
    expect(exploreMessagesText).not.toContain("<orchestrator-timeout")

    // 9. Stuck general subagent triggers soft timeout without auto-killing, rejects cross-session interrupt,
    // and cleanly interrupts its own child while suppressing subsequent timeouts.
    const stuckParent = await createSession({
      location: { directory: project },
      model: { providerID: "mock", id: "claude-fable-5-2" },
    })
    await rpc<OrchestratorStatus>("set", { sessionID: stuckParent.id, enabled: true })
    await api("POST", `/api/session/${encodeURIComponent(stuckParent.id)}/prompt`, { text: "LAUNCH_STUCK_GENERAL" })
    let stuckMessagesText = ""
    for (let i = 0; i < 120; i++) {
      await api("POST", `/api/experimental/session/${encodeURIComponent(stuckParent.id)}/wait`).catch(() => {})
      stuckMessagesText = JSON.stringify(
        await api<unknown>("GET", `/api/session/${encodeURIComponent(stuckParent.id)}/message`),
      )
      if (stuckMessagesText.includes("ORCHESTRATOR_HANDLED_TIMEOUT")) break
      await Bun.sleep(100)
    }
    writeFileSync(join(run, "stuck-parent-messages.json"), stuckMessagesText)
    expect(stuckMessagesText).toContain("<orchestrator-timeout")
    expect(stuckMessagesText).toContain("not a child session of orchestrator session")
    expect(stuckMessagesText).toContain("已中止子会话")
    expect(stuckMessagesText).toContain("git status")
    expect(stuckMessagesText).toContain("ORCHESTRATOR_HANDLED_TIMEOUT")
    expect(slowGeneralAborted).toBe(true)

    const timeoutCountBefore = (stuckMessagesText.match(/<orchestrator-timeout/g) ?? []).length
    await Bun.sleep(1200)
    const stuckMessagesAfter = JSON.stringify(
      await api<unknown>("GET", `/api/session/${encodeURIComponent(stuckParent.id)}/message`),
    )
    expect((stuckMessagesAfter.match(/<orchestrator-timeout/g) ?? []).length).toBe(timeoutCountBefore)
  } finally {
    serverProc.kill()
    await serverProc.exited
    writeFileSync(join(run, "server.stdout.log"), await restStdout)
    writeFileSync(join(run, "server.stderr.log"), await serverStderr)
    providerServer.stop(true)
    rmSync(project, { recursive: true, force: true })
  }
}, 120_000)
