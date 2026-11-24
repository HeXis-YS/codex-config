// Run: bun test scripts/verify-deepseek-fallback.test.ts
// Uses isolated HOME/XDG directories, a standalone OpenCode V2 server, and
// local provider stubs; never calls a real model, registry, or live config.
import { expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
mkdirSync(join(root, ".opencode", "runs"), { recursive: true })
const run = mkdtempSync(join(root, ".opencode", "runs", "deepseek-fallback."))
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
      "TZ",
    ].flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])),
  ),
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  HOME: join(run, "home"),
  XDG_CONFIG_HOME: join(run, "config"),
  XDG_CACHE_HOME: join(run, "cache"),
  XDG_DATA_HOME: join(run, "data"),
  XDG_STATE_HOME: join(run, "state"),
  SANDBOX_ID: process.env.SANDBOX_ID ?? "verify-deepseek-fallback",
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
      entry: "bun test scripts/verify-deepseek-fallback.test.ts",
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

function chatTextResponse(model: string, content: string, stream?: boolean): Response {
  const result = {
    id: `chatcmpl-${ crypto.randomUUID() }`,
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
  if (!stream) return Response.json(result)
  const chunk = {
    ...result,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  }
  const finish = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  })
}

function chatToolCallResponse(model: string, name: string, args: Record<string, unknown>, stream?: boolean): Response {
  const callID = `call_${crypto.randomUUID().slice(0, 8)}`
  const serialized = JSON.stringify(args)
  const result = {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: callID, type: "function", function: { name, arguments: serialized } }],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }
  if (!stream) return Response.json(result)
  const chunk = {
    ...result,
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          tool_calls: [{ index: 0, id: callID, type: "function", function: { name, arguments: serialized } }],
        },
        finish_reason: null,
      },
    ],
  }
  const finish = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  })
}

test("classifier distinguishes quota/rate-limit errors and extracts reset metadata", async () => {
  const serverSource = readFileSync(join(root, "plugins", "deepseek-fallback", "server.ts"), "utf8")
  const serverScanned = new Bun.Transpiler({ loader: "ts", target: "bun" }).scan(serverSource)
  expect(serverScanned.imports.map((item) => item.path)).toEqual(["@opencode/plugin", "./rpc"])

  mock.module("@opencode/plugin", () => ({
    Plugin: { define: <T>(def: T) => def },
  }))
  const { formatQuotaReason, isQuotaOrRateLimitError } = await import("../plugins/deepseek-fallback/server")

  expect(
    isQuotaOrRateLimitError({
      type: "provider.free-limit",
      message: "Unrecognized message",
    }),
  ).toBe(true)
  expect(
    isQuotaOrRateLimitError({
      type: "QuotaExceeded",
      message: "Daily free usage limit reached",
      status: 429,
    }),
  ).toBe(true)
  expect(
    isQuotaOrRateLimitError({
      type: "InvalidRequest",
      message: "This model's maximum context length is 128000 tokens",
      status: 400,
    }),
  ).toBe(false)
  expect(
    isQuotaOrRateLimitError({
      type: "context_overflow",
      message: "rate limit word inside context_length_exceeded",
      status: 400,
    }),
  ).toBe(false)
  expect(
    isQuotaOrRateLimitError({
      type: "ProviderInternal",
      message: "Upstream gateway timeout",
      status: 502,
    }),
  ).toBe(false)

  const liveNow = Date.parse("2026-11-23T09:45:10.656Z")
  const livePayload = {
    type: "provider.free-limit",
    message:
      "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.",
    status: 429,
    response: {
      body: JSON.stringify({
        type: "error",
        error: {
          type: "FreeUsageLimitError",
          message:
            "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go",
        },
      }),
    },
    retryAfterMs: 53_628_000,
  }
  expect(formatQuotaReason(livePayload, { now: liveNow, tz: "CST-8" })).toBe(
    "Free usage limit reached. | 预计 14小时54分 后重置（明日 08:38）",
  )
  expect(formatQuotaReason(livePayload, { now: liveNow, tz: "Asia/Shanghai" })).toBe(
    "Free usage limit reached. | 预计 14小时54分 后重置（明日 08:38）",
  )
  expect(formatQuotaReason(livePayload, { now: liveNow, tz: "UTC" })).toBe(
    "Free usage limit reached. | 预计 14小时54分 后重置（明日 00:38 UTC）",
  )

  expect(
    formatQuotaReason(
      { type: "RateLimit", message: "Rate limit exceeded", status: 429, retryAfterMs: 7_500_000 },
      { now: Date.parse("2026-11-23T02:00:00Z"), tz: "CST-8" },
    ),
  ).toBe("Rate limit exceeded | 预计 2小时5分 后重置（12:05）")

  expect(
    formatQuotaReason(
      { type: "RateLimit", message: "Too many requests", status: 429, retryAfterMs: 15_000 },
      { now: liveNow, tz: "CST-8" },
    ),
  ).toBe("Too many requests | 预计 15秒 后可重试")

  const reason = formatQuotaReason({
    type: "QuotaExceeded",
    message:
      "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.",
    status: 429,
    response: {
      body: JSON.stringify({
        error: {
          code: "FreeUsageLimitError",
          message: "Daily free quota exceeded for deepseek-v4.1-flash-free",
          resetAt: "2026-11-24T00:00:00Z",
        },
      }),
    },
  })
  expect(reason).toContain("Daily free quota exceeded for deepseek-v4.1-flash-free")
  expect(reason).toContain("resetAt: 2026-11-24T00:00:00Z")
  expect(reason).not.toContain("subscribe to OpenCode Go")
})

test("deepseek-fallback switches free DeepSeek in-place without parent error notifications and emits TUI toast", async () => {
  const tuiSource = readFileSync(join(root, "plugins", "deepseek-fallback", "tui.ts"), "utf8")
  const scanned = new Bun.Transpiler({ loader: "ts", target: "bun" }).scan(tuiSource)
  expect(scanned.imports.map((item) => item.path)).toEqual(["@opencode/plugin/tui", "./rpc"])

  mkdirSync(env.HOME, { recursive: true })
  const install = Bun.spawnSync(["bash", join(root, "install.sh")], { cwd: root, env })
  writeFileSync(join(run, "install.log"), Buffer.concat([install.stdout, install.stderr]))
  expect(install.exitCode).toBe(0)

  type Captured = {
    provider: string
    model: string
    messages: { role: string; content?: unknown; tool_calls?: unknown }[]
  }
  const captured: Captured[] = []
  let transient500Count = 0
  let glmRateLimitCount = 0

  const providerServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const match = url.pathname.match(/^\/(opencode|openrouter|mock)\/v1\/chat\/completions$/)
      if (!match) return new Response("not found", { status: 404 })
      const provider = match[1]!
      const body = (await request.json()) as {
        model: string
        stream?: boolean
        messages: Captured["messages"]
      }
      captured.push({ provider, model: body.model, messages: body.messages })
      writeFileSync(join(run, "requests.json"), JSON.stringify(captured, null, 2))

      const serializedMessages = JSON.stringify(body.messages)
      const lastUserMessage = JSON.stringify(body.messages.filter((m) => m.role === "user").at(-1) ?? "")

      if (provider === "mock") {
        if (body.model === "title-model") {
          return chatTextResponse(body.model, "Title", body.stream)
        }
        if (
          serializedMessages.includes("<subagent ") ||
          serializedMessages.includes('kind=\\"subagent\\" sessionID=')
        ) {
          return chatTextResponse(body.model, "PARENT_OBSERVED_SUBAGENT", body.stream)
        }
        const hasToolResult = body.messages.some((m) => m.role === "tool")
        if (!hasToolResult && serializedMessages.includes("DELEGATE_DEFAULT_SUBAGENT")) {
          return chatToolCallResponse(
            body.model,
            "subagent",
            {
              agent: "general",
              description: "default general task",
              prompt: "SUBAGENT_FREE_QUOTA_TASK",
            },
            body.stream,
          )
        }
        if (!hasToolResult && serializedMessages.includes("DELEGATE_GLM_AUDIT")) {
          return chatToolCallResponse(
            body.model,
            "subagent",
            {
              agent: "general",
              description: "audit task",
              model: "openrouter/z-ai/glm-5.3-flash",
              prompt: "SUBAGENT_GLM_AUDIT_TASK",
            },
            body.stream,
          )
        }
        return chatTextResponse(body.model, "PARENT_WAITING_FOR_SUBAGENT", body.stream)
      }

      if (provider === "opencode" && body.model === "deepseek-v4.1-flash-free") {
        if (lastUserMessage.includes("TRANSIENT_500_TASK")) {
          transient500Count += 1
          if (transient500Count === 1) {
            return new Response(JSON.stringify({ error: { message: "Upstream gateway glitch" } }), {
              status: 500,
              headers: { "content-type": "application/json", "retry-after-ms": "40" },
            })
          }
          return chatTextResponse(body.model, "RECOVERED_ON_PRIMARY_AFTER_500", body.stream)
        }

        if (lastUserMessage.includes("MAIN_QUOTA_402_TASK")) {
          return new Response(
            JSON.stringify({
              error: {
                code: "insufficient_quota",
                message: "Free credit balance exhausted",
                reset_at: "2026-11-24T08:00:00Z",
              },
            }),
            { status: 402, headers: { "content-type": "application/json" } },
          )
        }

        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "FreeUsageLimitError",
              message:
                "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go",
            },
          }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "53628" },
          },
        )
      }

      if (provider === "openrouter") {
        if (body.model === "z-ai/glm-5.3-flash") {
          glmRateLimitCount += 1
          if (glmRateLimitCount === 1) {
            return new Response(JSON.stringify({ error: { message: "Rate limit reached for glm-5.3-flash" } }), {
              status: 429,
              headers: { "content-type": "application/json", "retry-after-ms": "40" },
            })
          }
          return chatTextResponse(body.model, "GLM_AUDIT_COMPLETED", body.stream)
        }
        if (body.model === "deepseek/deepseek-v4.1-flash-1017") {
          return chatTextResponse(body.model, "RECOVERED_ON_OPENROUTER_DEEPSEEK", body.stream)
        }
      }

      return new Response(`unexpected model ${provider}/${body.model}`, { status: 400 })
    },
  })

  const configPath = join(env.XDG_CONFIG_HOME, "opencode", "opencode.json")
  const config = await Bun.file(configPath).json()

  delete config.plugins
  config.providers = {
    opencode: {
      name: "Mock OpenCode",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `http://127.0.0.1:${providerServer.port}/opencode/v1`, apiKey: "test-oc" },
      env: [],
      models: {
        "deepseek-v4.1-flash-free": { name: "DeepSeek V4.1 Flash Free" },
      },
    },
    openrouter: {
      name: "Mock OpenRouter",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `http://127.0.0.1:${providerServer.port}/openrouter/v1`, apiKey: "test-or" },
      env: [],
      models: {
        "deepseek/deepseek-v4.1-flash-1017": { name: "DeepSeek V4.1 Flash 1017" },
        "z-ai/glm-5.3-flash": { name: "GLM 5.3 Flash" },
      },
    },
    mock: {
      name: "Mock Main",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `http://127.0.0.1:${providerServer.port}/mock/v1`, apiKey: "test-mock" },
      env: [],
      models: {
        "parent-model": { name: "parent-model" },
        "title-model": { name: "title-model" },
      },
    },
  }
  config.agents.title = { model: "mock/title-model" }
  config.agents.compaction = { model: "mock/title-model" }
  config.agents.summary = { model: "mock/title-model" }
  config.agents.general = { model: "opencode/deepseek-v4.1-flash-free" }
  config.agents.explore = { model: "opencode/deepseek-v4.1-flash-free" }
  await Bun.file(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "adopt-catalog.ts")).delete()
  await Bun.file(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "cap-context.ts")).delete()
  rmSync(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "commander"), { recursive: true, force: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  mkdirSync("/tmp/opencode", { recursive: true })
  const project = mkdtempSync("/tmp/opencode/deepseek-fallback-project.")
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

  // Wire live SSE events into the TUI plugin entrypoint.
  mock.module("@opencode/plugin/tui", () => ({
    Plugin: { define: <T>(def: T) => def },
  }))
  const { default: tuiPlugin } = await import("../plugins/deepseek-fallback/tui")
  type Listener = (event: { details: Record<string, unknown> }) => void
  const listeners = new Set<Listener>()
  const invalidatedSessions: string[] = []
  const toasts: { title?: string; message: string; variant?: string; sessionID?: string }[] = []

  const disposeTui = await tuiPlugin.setup({
    location: { directory: project },
    data: {
      location: { default: () => ({ directory: project }) },
      listen: (fn: Listener) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      session: {
        invalidate: (id: string) => invalidatedSessions.push(id),
      },
    },
    ui: {
      toast: {
        show: (toast: { title?: string; message: string; variant?: string; sessionID?: string }) => toasts.push(toast),
      },
    },
  } as never)

  const sseAbort = new AbortController()
  const sseEvents: Record<string, unknown>[] = []
  const sseTask = (async () => {
    const res = await fetch(`${baseUrl}/api/event`, {
      headers: { authorization: authHeader, accept: "text/event-stream" },
      signal: sseAbort.signal,
    })
    if (!res.body) return
    const sseReader = res.body.getReader()
    const sseDecoder = new TextDecoder()
    let sseBuf = ""
    while (true) {
      const { value, done } = await sseReader.read()
      if (done) break
      sseBuf += sseDecoder.decode(value, { stream: true })
      const chunks = sseBuf.split("\n\n")
      sseBuf = chunks.pop() ?? ""
      for (const chunk of chunks) {
        const dataLines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
        if (dataLines.length === 0) continue
        try {
          const parsed = JSON.parse(dataLines.join("\n")) as Record<string, unknown>
          sseEvents.push(parsed)
          writeFileSync(join(run, "events.json"), JSON.stringify(sseEvents, null, 2))
          for (const fn of listeners) fn({ details: parsed })
        } catch {
          // Ignore non-JSON keepalives.
        }
      }
    }
  })().catch(() => {})

  try {
    await api("GET", "/api/info")
    type PluginList = {
      data: { id: string; features: Record<string, boolean>; state: { status: string; error?: unknown } }[]
    }
    let fallbackPlugin: PluginList["data"][number] | undefined
    for (let i = 0; i < 100; i++) {
      const plugins = await api<PluginList>("GET", `/api/plugin?location[directory]=${encodeURIComponent(project)}`)
      writeFileSync(join(run, "plugins.json"), JSON.stringify(plugins, null, 2))
      fallbackPlugin = plugins.data.find((item) => item.id === "deepseek-fallback")
      if (fallbackPlugin && fallbackPlugin.state.status !== "loading") break
      await Bun.sleep(100)
    }
    expect(fallbackPlugin, `deepseek-fallback plugin not discovered; see ${run}/plugins.json`).toBeDefined()
    expect(fallbackPlugin?.state.status).toBe("active")
    expect(fallbackPlugin?.features).toMatchObject({ server: true, tui: true })

    // Give SSE connection a moment to attach before emitting events.
    await Bun.sleep(150)

    // 1. Background general subagent (using default opencode/deepseek-v4.1-flash-free) hits 429 FreeUsageLimitError
    //    and switches in-place to openrouter/deepseek/deepseek-v4.1-flash-1017 without parent error notification.
    const parent1 = (
      await api<{ data: { id: string } }>("POST", "/api/session", {
        location: { directory: project },
        model: { providerID: "mock", id: "parent-model" },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
    ).data

    await api("POST", `/api/session/${encodeURIComponent(parent1.id)}/prompt`, {
      text: "DELEGATE_DEFAULT_SUBAGENT",
    })

    // Poll until parent receives the background subagent wake-up and finishes its final turn.
    let parent1MessagesText = ""
    for (let i = 0; i < 150; i++) {
      await api("POST", `/api/experimental/session/${encodeURIComponent(parent1.id)}/wait`).catch(() => {})
      const msgs = await api<unknown>("GET", `/api/session/${encodeURIComponent(parent1.id)}/message`)
      parent1MessagesText = JSON.stringify(msgs)
      if (parent1MessagesText.includes("PARENT_OBSERVED_SUBAGENT")) break
      await Bun.sleep(100)
    }
    writeFileSync(join(run, "parent1-messages.json"), parent1MessagesText)

    expect(parent1MessagesText).toContain("PARENT_OBSERVED_SUBAGENT")
    expect(parent1MessagesText).toContain("RECOVERED_ON_OPENROUTER_DEEPSEEK")
    expect(parent1MessagesText).toContain('state=\\"completed\\"')
    expect(parent1MessagesText).not.toContain('state=\\"error\\"')

    const subagentPrimaryCalls = captured.filter(
      (item) =>
        JSON.stringify(item.messages).includes("SUBAGENT_FREE_QUOTA_TASK") &&
        item.provider !== "mock",
    )
    expect(subagentPrimaryCalls.map((item) => `${item.provider}/${item.model}`)).toEqual([
      "opencode/deepseek-v4.1-flash-free",
      "openrouter/deepseek/deepseek-v4.1-flash-1017",
    ])

    // Wait briefly for SSE delivery to TUI listener.
    for (let i = 0; i < 30 && toasts.length === 0; i++) await Bun.sleep(50)
    expect(toasts.length).toBe(1)
    expect(toasts[0]?.variant).toBe("warning")
    expect(toasts[0]?.title).toBe("免费额度不足，已切换备用模型")
    expect(toasts[0]?.message).toContain(
      "opencode/deepseek-v4.1-flash-free → openrouter/deepseek/deepseek-v4.1-flash-1017",
    )
    expect(toasts[0]?.message).toContain("Free usage limit reached.")
    expect(toasts[0]?.message).toContain("预计 14小时54分 后重置（")
    expect(toasts[0]?.message).not.toContain("subscribe to OpenCode Go")
    expect(toasts[0]?.message).not.toContain("retryAfterMs")
    expect(invalidatedSessions.length).toBe(1)

    const childSessionID = invalidatedSessions[0]!
    const childSession = (
      await api<{ data: { id: string; parentID?: string; model?: { providerID: string; id: string } } }>(
        "GET",
        `/api/session/${encodeURIComponent(childSessionID)}`,
      )
    ).data
    expect(childSession.parentID).toBe(parent1.id)
    expect(childSession.model).toMatchObject({
      providerID: "openrouter",
      id: "deepseek/deepseek-v4.1-flash-1017",
    })

    // 2. Audit subagent explicitly requesting openrouter/z-ai/glm-5.3-flash hits 429 rate-limit:
    //    must NOT switch to deepseek-v4.1-flash-1017 or emit fallback toast.
    const parent2 = (
      await api<{ data: { id: string } }>("POST", "/api/session", {
        location: { directory: project },
        model: { providerID: "mock", id: "parent-model" },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
    ).data
    const beforeAuditToastCount = toasts.length
    await api("POST", `/api/session/${encodeURIComponent(parent2.id)}/prompt`, {
      text: "DELEGATE_GLM_AUDIT",
    })
    let parent2MessagesText = ""
    for (let i = 0; i < 150; i++) {
      await api("POST", `/api/experimental/session/${encodeURIComponent(parent2.id)}/wait`).catch(() => {})
      const msgs = await api<unknown>("GET", `/api/session/${encodeURIComponent(parent2.id)}/message`)
      parent2MessagesText = JSON.stringify(msgs)
      if (parent2MessagesText.includes("PARENT_OBSERVED_SUBAGENT")) break
      await Bun.sleep(100)
    }
    expect(parent2MessagesText).toContain("GLM_AUDIT_COMPLETED")
    const auditCalls = captured.filter(
      (item) => JSON.stringify(item.messages).includes("SUBAGENT_GLM_AUDIT_TASK") && item.provider !== "mock",
    )
    expect(auditCalls.map((item) => `${item.provider}/${item.model}`)).toEqual([
      "openrouter/z-ai/glm-5.3-flash",
      "openrouter/z-ai/glm-5.3-flash",
    ])
    expect(toasts.length).toBe(beforeAuditToastCount)

    // 3. Transient 500 on opencode/deepseek-v4.1-flash-free must retry natively on primary without switching.
    const mainSession = (
      await api<{ data: { id: string } }>("POST", "/api/session", {
        location: { directory: project },
        model: { providerID: "opencode", id: "deepseek-v4.1-flash-free" },
      })
    ).data
    const start500 = captured.length
    await api("POST", `/api/session/${encodeURIComponent(mainSession.id)}/prompt`, {
      text: "TRANSIENT_500_TASK",
    })
    await api("POST", `/api/experimental/session/${encodeURIComponent(mainSession.id)}/wait`)
    const calls500 = captured
      .slice(start500)
      .filter((item) => JSON.stringify(item.messages).includes("TRANSIENT_500_TASK") && item.provider !== "mock")
    expect(calls500.map((item) => `${item.provider}/${item.model}`)).toEqual([
      "opencode/deepseek-v4.1-flash-free",
      "opencode/deepseek-v4.1-flash-free",
    ])
    expect(toasts.length).toBe(beforeAuditToastCount)

    // 4. Main session HTTP 402 quota exhaustion switches to OpenRouter, and manual switch-back can fallback again.
    const start402 = captured.length
    await api("POST", `/api/session/${encodeURIComponent(mainSession.id)}/prompt`, {
      text: "MAIN_QUOTA_402_TASK",
    })
    await api("POST", `/api/experimental/session/${encodeURIComponent(mainSession.id)}/wait`)
    const calls402 = captured
      .slice(start402)
      .filter((item) => JSON.stringify(item.messages).includes("MAIN_QUOTA_402_TASK") && item.provider !== "mock")
    expect(calls402.map((item) => `${item.provider}/${item.model}`)).toEqual([
      "opencode/deepseek-v4.1-flash-free",
      "openrouter/deepseek/deepseek-v4.1-flash-1017",
    ])
    for (let i = 0; i < 30 && toasts.length < 2; i++) await Bun.sleep(50)
    expect(toasts.length).toBe(2)
    expect(toasts[1]?.message).toContain("Free credit balance exhausted")
    expect(toasts[1]?.message).toContain("reset_at: 2026-11-24T08:00:00Z")

    // Manual switch back to primary free model, then hit 429 quota again.
    await api("POST", `/api/session/${encodeURIComponent(mainSession.id)}/model`, {
      model: { providerID: "opencode", id: "deepseek-v4.1-flash-free" },
    })
    const startSecondDay = captured.length
    await api("POST", `/api/session/${encodeURIComponent(mainSession.id)}/prompt`, {
      text: "SECOND_DAY_QUOTA_TASK",
    })
    await api("POST", `/api/experimental/session/${encodeURIComponent(mainSession.id)}/wait`)
    const callsSecondDay = captured
      .slice(startSecondDay)
      .filter((item) => JSON.stringify(item.messages).includes("SECOND_DAY_QUOTA_TASK") && item.provider !== "mock")
    expect(callsSecondDay.map((item) => `${item.provider}/${item.model}`)).toEqual([
      "opencode/deepseek-v4.1-flash-free",
      "openrouter/deepseek/deepseek-v4.1-flash-1017",
    ])
    for (let i = 0; i < 30 && toasts.length < 3; i++) await Bun.sleep(50)
    expect(toasts.length).toBe(3)

    // 5. Events from another project directory are ignored by this TUI instance.
    for (const fn of listeners) {
      fn({
        details: {
          type: "rpc.deepseek-fallback.switched",
          location: { directory: "/other/project" },
          data: {
            sessionID: mainSession.id,
            from: "opencode/deepseek-v4.1-flash-free",
            to: "openrouter/deepseek/deepseek-v4.1-flash-1017",
            reason: "other project",
          },
        },
      })
    }
    expect(toasts.length).toBe(3)
  } finally {
    if (typeof disposeTui === "function") disposeTui()
    sseAbort.abort()
    await sseTask
    serverProc.kill()
    await serverProc.exited
    writeFileSync(join(run, "server.stdout.log"), await restStdout)
    writeFileSync(join(run, "server.stderr.log"), await serverStderr)
    providerServer.stop(true)
    rmSync(project, { recursive: true, force: true })
  }
}, 120_000)
