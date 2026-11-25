// Run: bun test scripts/verify-adopt-catalog.test.ts
// Uses isolated HOME/XDG directories, a standalone OpenCode V2 server, and a
// local multi-protocol provider stub; never calls a real model or live config.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
mkdirSync(join(root, ".opencode", "runs"), { recursive: true })
const run = mkdtempSync(join(root, ".opencode", "runs", "adopt-catalog."))
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
  SANDBOX_ID: process.env.SANDBOX_ID ?? "verify-adopt-catalog",
  TERM: "xterm",
  OPENCODE_LOG_LEVEL: "DEBUG",
  OPENCODE_DISABLE_FREE_MODELS: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  NODE_USE_ENV_PROXY: "1",
}

const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString()
writeFileSync(join(run, "workspace.patch"), git("diff"))
writeFileSync(
  join(run, "conditions.json"),
  JSON.stringify(
    {
      entry: "bun test scripts/verify-adopt-catalog.test.ts",
      time: new Date().toISOString(),
      head: git("log", "-n", "1", "--format=%H").trim(),
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

test("adopt-catalog inherits native catalog definitions for vti while preserving cap-context, overrides, and isolation", async () => {
  const source = readFileSync(join(root, "plugins", "adopt-catalog.ts"), "utf8")
  const scanned = new Bun.Transpiler({ loader: "ts", target: "bun" }).scan(source)
  expect(scanned.imports.map((item) => item.path)).toEqual(["@opencode/plugin"])

  mkdirSync(env.HOME, { recursive: true })
  const install = Bun.spawnSync(["bash", join(root, "install.sh")], { cwd: root, env })
  writeFileSync(join(run, "install.log"), Buffer.concat([install.stdout, install.stderr]))
  expect(install.exitCode).toBe(0)

  type CapturedHit = {
    path: string
    headers: Record<string, string>
    body: Record<string, unknown>
  }
  const hits: CapturedHit[] = []
  const providerServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const headers = Object.fromEntries(request.headers.entries())
      hits.push({ path: url.pathname, headers, body })
      writeFileSync(join(run, "requests.json"), JSON.stringify(hits, null, 2))

      if (url.pathname.endsWith("/v1/messages")) {
        const msgStart = {
          type: "message_start",
          message: {
            id: "msg_stub",
            type: "message",
            role: "assistant",
            model: body.model ?? "claude-stub",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        }
        const blockStart = { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }
        const blockDelta = { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }
        const blockStop = { type: "content_block_stop", index: 0 }
        const msgDelta = {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 1 },
        }
        const msgStop = { type: "message_stop" }
        const sse = [msgStart, blockStart, blockDelta, blockStop, msgDelta, msgStop]
          .map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
          .join("")
        return new Response(sse, { headers: { "content-type": "text/event-stream" } })
      }

      if (url.pathname.includes("/v1beta/models/")) {
        const chunk = {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "ok" }] },
              finishReason: "STOP",
              index: 0,
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }
        if (url.pathname.endsWith(":streamGenerateContent")) {
          return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
            headers: { "content-type": "text/event-stream" },
          })
        }
        return Response.json(chunk)
      }

      if (url.pathname.endsWith("/v1/responses")) {
        const reqTools = Array.isArray(body.tools) ? (body.tools as Record<string, unknown>[]) : []
        if (reqTools.some((tool) => tool.type !== "function")) {
          return Response.json(
            { error: { code: 400, message: "此接口仅支持 function 工具", type: "invalid_request_error" } },
            { status: 400 },
          )
        }
        const itemId = "msg_resp_1"
        const respId = "resp_stub_1"
        const created = {
          type: "response.created",
          response: { id: respId, object: "response", created_at: 0, status: "in_progress", model: body.model, output: [] },
        }
        const added = {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: itemId, type: "message", status: "in_progress", role: "assistant", content: [] },
        }
        const partAdded = {
          type: "response.content_part.added",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        }
        const delta = {
          type: "response.output_text.delta",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          delta: "ok",
        }
        const partDone = {
          type: "response.content_part.done",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "ok", annotations: [] },
        }
        const itemDone = {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            id: itemId,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "ok", annotations: [] }],
          },
        }
        const completed = {
          type: "response.completed",
          response: {
            id: respId,
            object: "response",
            created_at: 0,
            status: "completed",
            model: body.model,
            output: [itemDone.item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        }
        const sse = [created, added, partAdded, delta, partDone, itemDone, completed]
          .map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
          .join("")
        return new Response(sse, { headers: { "content-type": "text/event-stream" } })
      }

      if (url.pathname.endsWith("/chat/completions")) {
        const result = {
          id: "chat_stub",
          object: "chat.completion",
          created: 0,
          model: body.model ?? "stub",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }
        if (!body.stream) return Response.json(result)
        const chunk = {
          ...result,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
        }
        const finish = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        })
      }

      return new Response("not found", { status: 404 })
    },
  })

  const configPath = join(env.XDG_CONFIG_HOME, "opencode", "opencode.json")
  const config = await Bun.file(configPath).json()
  // Verify template models exist before pointing endpoints to the local stub.
  expect(Object.keys(config.providers.vti.models)).toEqual([
    "claude-fable-5-2",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-opus-4-6",
    "gemini-4-neon",
    "gemini-4-hydrogen",
    "gpt-6-luna",
  ])
  for (const entry of Object.values(config.providers.vti.models)) {
    expect(entry).toEqual({})
  }
  expect(config.providers["vti-chat"]?.canonical).toBe("openai")
  expect(config.providers["vti-chat"]?.package).toBe("@opencode/ai/providers/openai/chat")
  expect(Object.keys(config.providers["vti-chat"]?.models ?? {})).toEqual(["gpt-6-luna"])
  expect(config.agents.title?.model).toBe("vti-chat/gpt-6-luna#max")
  expect(config.agents.compaction?.model).toBe("vti-chat/gpt-6-luna#max")
  expect(config.agents.summary?.model).toBe("vti-chat/gpt-6-luna#max")
  expect(config.agents.general?.model).toBe("vti/gpt-6-luna#max")
  expect(config.agents.explore?.model).toBe("vti/gpt-6-luna#max")

  delete config.plugins
  rmSync(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "commander"), { recursive: true, force: true })
  rmSync(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "deepseek-fallback"), { recursive: true, force: true })

  config.providers = {
    openai: { settings: { baseURL: `http://127.0.0.1:${providerServer.port}/openlux/v1`, apiKey: "openlux-key" }, env: [] },
    anthropic: { settings: { baseURL: `http://127.0.0.1:${providerServer.port}/openlux/v1`, apiKey: "openlux-key" }, env: [] },
    google: { settings: { baseURL: `http://127.0.0.1:${providerServer.port}/openlux/v1beta`, apiKey: "openlux-key" }, env: [] },
    vti: {
      ...config.providers.vti,
      settings: {
        baseURL: `http://127.0.0.1:${providerServer.port}/connector/ai/v1`,
        apiKey: "sbx-cs-vti",
      },
      models: {
        ...config.providers.vti.models,
        "gemini-4-carbon": { modelID: "vti-carbon-alias", headers: { "X-Custom": "yes" } },
        "claude-opus-4-6": { disabled: true },
        "custom-qwen": {},
      },
    },
    "vti-chat": {
      ...config.providers["vti-chat"],
      settings: {
        baseURL: `http://127.0.0.1:${providerServer.port}/connector/ai/v1`,
        apiKey: "sbx-cs-vti",
      },
    },
    mock: {
      name: "Mock OpenAI-Compatible",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `http://127.0.0.1:${providerServer.port}/mock/v1`, apiKey: "mock-key" },
      models: {
        "gpt-6-luna": { name: "Mock Luna" },
        "title-model": { name: "Title" },
      },
    },
  }
  config.agents = {
    title: { model: "mock/title-model" },
    compaction: { model: "mock/title-model" },
    summary: { model: "mock/title-model" },
    general: { model: "mock/title-model" },
    explore: { model: "mock/title-model" },
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  mkdirSync("/tmp/opencode", { recursive: true })
  const project = mkdtempSync("/tmp/opencode/adopt-catalog-project.")
  const port = await pickFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const serverProc = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: project,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const serverStderr = new Response(serverProc.stderr).text()
  const reader = serverProc.stdout.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  let password = ""
  while (!password) {
    const { value, done } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split("\n")
    buffered = lines.pop() ?? ""
    for (const line of lines) {
      const match = line.match(/^server password (\S+)$/)
      if (match) password = match[1]!
    }
  }
  void (async () => {
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  })()
  expect(password.length, `Missing server password; see ${run}`).toBeGreaterThan(0)
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`

  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = {
      authorization: authHeader,
      "x-opencode-directory": project,
    }
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

  try {
    await api("GET", "/api/info")
    type PluginList = { data: { id: string; state: { status: string } }[] }
    for (let i = 0; i < 100; i++) {
      const plugins = await api<PluginList>("GET", `/api/plugin?location[directory]=${encodeURIComponent(project)}`)
      const targetPlugins = plugins.data.filter((item) => item.id === "adopt-catalog" || item.id === "cap-context")
      if (targetPlugins.length === 2 && targetPlugins.every((item) => item.state.status === "active")) break
      await Bun.sleep(100)
    }

    type ModelEntry = {
      id: string
      modelID: string
      providerID: string
      name: string
      family?: string
      package: string
      headers?: Record<string, string>
      settings: Record<string, unknown>
      capabilities: Record<string, unknown>
      limit: { context: number; input?: number; output: number }
      variants: { id: string }[]
    }
    const modelsRaw = await api<{ data?: ModelEntry[] } | ModelEntry[]>("GET", "/api/model")
    const models = Array.isArray(modelsRaw) ? modelsRaw : (modelsRaw.data ?? [])
    writeFileSync(join(run, "models.json"), JSON.stringify(models, null, 2))

    const findModel = (providerID: string, id: string) =>
      models.find((item) => item.providerID === providerID && item.id === id)

    // 1. Catalog parity across Anthropic, Google, and OpenAI + cap-context integration.
    for (const id of ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
      const vtiModel = findModel("vti", id)!
      const upstream = findModel("anthropic", id)!
      expect(vtiModel).toBeDefined()
      expect(vtiModel.name).toBe(upstream.name)
      expect(vtiModel.family).toBe(upstream.family)
      expect(vtiModel.package).toBe("@opencode/ai/providers/anthropic")
      expect(vtiModel.capabilities).toEqual(upstream.capabilities)
      expect(vtiModel.limit).toEqual(upstream.limit)
      expect(vtiModel.limit.input).toBe(272000)
      expect(vtiModel.variants).toEqual(upstream.variants)
    }

    const vtiHydrogen = findModel("vti", "gemini-4-hydrogen")!
    const googleHydrogen = findModel("google", "gemini-4-hydrogen")!
    expect(vtiHydrogen.name).toBe(googleHydrogen.name)
    expect(vtiHydrogen.package).toBe("@opencode/ai/providers/google")
    expect(vtiHydrogen.settings.baseURL).toBe(`http://127.0.0.1:${providerServer.port}/connector/ai/v1beta`)
    expect(vtiHydrogen.capabilities).toEqual(googleHydrogen.capabilities)
    expect(vtiHydrogen.limit).toEqual(googleHydrogen.limit)
    expect(vtiHydrogen.limit.input).toBe(272000)
    expect(vtiHydrogen.variants).toEqual(googleHydrogen.variants)

    // Embedded snapshot in v2.3.2 predates gemini-4-neon; assert parity when present in snapshot.
    const googleNeon = findModel("google", "gemini-4-neon")
    if (googleNeon) {
      const vtiNeon = findModel("vti", "gemini-4-neon")!
      expect(vtiNeon.package).toBe("@opencode/ai/providers/google")
      expect(vtiNeon.settings.baseURL).toBe(`http://127.0.0.1:${providerServer.port}/connector/ai/v1beta`)
      expect(vtiNeon.variants).toEqual(googleNeon.variants)
    }

    const vtiLuna = findModel("vti", "gpt-6-luna")!
    const openaiLuna = findModel("openai", "gpt-6-luna")!
    const { freeform: _openaiFreeform, ...expectedLunaCapabilities } = openaiLuna.capabilities
    expect(_openaiFreeform).toBeDefined()
    expect(vtiLuna.name).toBe(openaiLuna.name)
    expect(vtiLuna.package).toBe("@opencode/ai/providers/openai/responses")
    expect(vtiLuna.capabilities).toEqual(expectedLunaCapabilities)
    expect(vtiLuna.capabilities.freeform).toBeUndefined()
    expect(vtiLuna.limit).toEqual({ context: 272000, input: 922000, output: 128000 })
    expect(vtiLuna.variants).toEqual(openaiLuna.variants)

    // 2. Explicit opencode.json overrides still win over inherited catalog fields.
    const vtiCarbon = findModel("vti", "gemini-4-carbon")!
    expect(vtiCarbon.package).toBe("@opencode/ai/providers/google")
    expect(vtiCarbon.modelID).toBe("vti-carbon-alias")
    expect(vtiCarbon.headers).toEqual({ "X-Custom": "yes" })
    expect(findModel("vti", "claude-opus-4-6")).toBeUndefined()

    // 3. Non-catalog models under vti keep openai-compatible fallback; other providers stay isolated.
    expect(findModel("vti", "custom-qwen")?.package).toBe("@opencode/ai/providers/openai-compatible")
    expect(findModel("mock", "gpt-6-luna")?.package).toBe("@opencode/ai/providers/openai-compatible")
    expect(findModel("mock", "gpt-6-luna")?.name).toBe("Mock Luna")

    const vtiChatModels = models.filter((item) => item.providerID === "vti-chat")
    expect(vtiChatModels.map((item) => item.id)).toEqual(["gpt-6-luna"])
    const vtiChatLuna = findModel("vti-chat", "gpt-6-luna")!
    expect(vtiChatLuna).toBeDefined()
    expect(vtiChatLuna.name).toBe(openaiLuna.name)
    expect(vtiChatLuna.package).toBe("@opencode/ai/providers/openai/chat")
    expect(vtiChatLuna.limit).toEqual({ context: 1050000, input: 922000, output: 128000 })
    expect(vtiChatLuna.capabilities.input).toEqual(["text", "image"])
    expect(vtiChatLuna.capabilities.freeform).toEqual([])
    expect(vtiChatLuna.variants.map((v) => v.id)).toEqual(openaiLuna.variants.map((v) => v.id))

    // 4. End-to-end outbound protocol dispatch across Anthropic, Gemini (with modelID override), OpenAI Responses, Chat Completions, fallback, and mock.
    const promptWithModel = async (providerID: string, model: string, variant?: string) => {
      const created = await api<{ data: { id: string } }>("POST", "/api/session", {
        location: { directory: project },
        model: variant ? { providerID, id: model, variant } : { providerID, id: model },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      })
      const sessionID = created.data.id
      const before = hits.length
      await api("POST", `/api/session/${encodeURIComponent(sessionID)}/prompt`, { text: "ping" })
      await api("POST", `/api/experimental/session/${encodeURIComponent(sessionID)}/wait`)
      return hits.slice(before)
    }

    const anthropicHits = await promptWithModel("vti", "claude-fable-5-2")
    const msgHit = anthropicHits.find((h) => h.path === "/connector/ai/v1/messages")
    expect(msgHit).toBeDefined()
    expect(msgHit?.headers["x-api-key"]).toBe("sbx-cs-vti")
    expect(msgHit?.body.model).toBe("claude-fable-5-2")

    const geminiHits = await promptWithModel("vti", "gemini-4-carbon")
    const gemHit = geminiHits.find((h) => h.path.startsWith("/connector/ai/v1beta/models/vti-carbon-alias:"))
    expect(gemHit).toBeDefined()
    expect(gemHit?.headers["x-goog-api-key"]).toBe("sbx-cs-vti")
    expect(gemHit?.headers["x-custom"]).toBe("yes")

    const openaiHits = await promptWithModel("vti", "gpt-6-luna")
    const respHit = openaiHits.find((h) => h.path === "/connector/ai/v1/responses")
    expect(respHit).toBeDefined()
    expect(respHit?.headers.authorization).toBe("Bearer sbx-cs-vti")
    expect(respHit?.body.model).toBe("gpt-6-luna")
    const respTools = (respHit?.body.tools ?? []) as { type: string; name: string }[]
    expect(respTools.length).toBeGreaterThan(0)
    expect(respTools.every((tool) => tool.type === "function")).toBe(true)
    expect(respTools.some((tool) => tool.name === "execute")).toBe(true)

    const vtiChatHits = await promptWithModel("vti-chat", "gpt-6-luna", "max")
    const vtiChatHit = vtiChatHits.find((h) => h.path === "/connector/ai/v1/chat/completions")
    expect(vtiChatHit).toBeDefined()
    expect(vtiChatHit?.headers.authorization).toBe("Bearer sbx-cs-vti")
    expect(vtiChatHit?.body.model).toBe("gpt-6-luna")
    expect(vtiChatHit?.body.reasoning_effort).toBe("max")
    expect(typeof vtiChatHit?.body.prompt_cache_key).toBe("string")
    expect(vtiChatHit?.body.include).toBeUndefined()
    expect(vtiChatHit?.body.reasoning_summary).toBeUndefined()

    const fallbackHits = await promptWithModel("vti", "custom-qwen")
    const chatHit = fallbackHits.find((h) => h.path === "/connector/ai/v1/chat/completions")
    expect(chatHit).toBeDefined()
    expect(chatHit?.headers.authorization).toBe("Bearer sbx-cs-vti")

    const mockHits = await promptWithModel("mock", "gpt-6-luna")
    expect(mockHits.some((h) => h.path === "/mock/v1/chat/completions")).toBe(true)
  } finally {
    serverProc.kill()
    await serverProc.exited
    writeFileSync(join(run, "server.stderr.log"), await serverStderr)
    providerServer.stop(true)
    rmSync(project, { recursive: true, force: true })
  }
}, 120_000)
