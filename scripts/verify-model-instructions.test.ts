// Run: bun test scripts/verify-model-instructions.test.ts
// Requires OpenCode V2 and registry access. Uses isolated HOME/XDG directories
// and a local provider stub; never calls a real model or changes live config.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
mkdirSync(join(root, ".opencode", "runs"), { recursive: true })
const run = mkdtempSync(join(root, ".opencode", "runs", "models-md."))
const binary = Bun.which("opencode")
if (!binary) throw new Error("opencode is required")
console.info(`Records: ${run}`)
const env = {
  // Registry downloads need this sandbox's proxy, but model credentials and
  // OPENCODE_CONFIG_CONTENT must not leak into the isolated process.
  ...Object.fromEntries(
    ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
      "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]!]] : [],
    ),
  ),
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
  HOME: join(run, "home"),
  XDG_CONFIG_HOME: join(run, "config"),
  XDG_CACHE_HOME: process.env.MODELS_MD_TEST_CACHE ?? join(run, "cache"),
  XDG_DATA_HOME: join(run, "data"),
  XDG_STATE_HOME: join(run, "state"),
  SANDBOX_ID: process.env.SANDBOX_ID ?? "",
  TERM: "xterm",
  OPENCODE_LOG_LEVEL: "DEBUG",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  NODE_USE_ENV_PROXY: "1",
}
const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString()
writeFileSync(join(run, "workspace.patch"), git("diff"))
writeFileSync(join(run, "conditions.json"), JSON.stringify({
  entry: "bun test scripts/verify-model-instructions.test.ts",
  time: new Date().toISOString(),
  head: git("rev-parse", "HEAD").trim(),
  bun: Bun.version,
  opencode: Bun.spawnSync([binary, "--version"]).stdout.toString().trim(),
  env,
}, null, 2))

test("published models-md injects only the matching installed skill into real requests", async () => {
  mkdirSync(env.HOME, { recursive: true })
  // Package download uses the host's network setup; model requests below use a
  // sanitized environment and only the local mock provider.
  const installEnv = { ...process.env, ...env }
  delete installEnv.OPENCODE_CONFIG_CONTENT
  delete installEnv.OPENCODE_SESSION_ID
  const plugin = Bun.spawn([binary, "plugin", "add", "@acramsay/opencode-models-md"], {
    cwd: root, env: installEnv, stdout: "pipe", stderr: "pipe",
  })
  const pluginOutput = Promise.all([new Response(plugin.stdout).text(), new Response(plugin.stderr).text()])
  const installTimeout = setTimeout(() => plugin.kill(), 240_000)
  const installed = await plugin.exited
  clearTimeout(installTimeout)
  writeFileSync(join(run, "plugin-install.log"), (await pluginOutput).join("\n"))
  expect(installed, `Package install: see ${run}`).toBe(0)
  const install = Bun.spawnSync(["bash", join(root, "install.sh")], { cwd: root, env })
  writeFileSync(join(run, "install.log"), Buffer.concat([install.stdout, install.stderr]))
  expect(install.exitCode).toBe(0)

  const captured: unknown[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (!new URL(request.url).pathname.endsWith("/chat/completions")) {
        return new Response("not found", { status: 404 })
      }
      const body = await request.json()
      captured.push(body)
      writeFileSync(join(run, "requests.json"), JSON.stringify(captured, null, 2))
      const result = {
        id: "verification", object: "chat.completion", created: 0, model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
      if (!body.stream) return Response.json(result)
      const chunk = {
        ...result, object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }],
      }
      const finish = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  // Model instruction files are named after the model, not the rule they carry.
  const files = {
    "avoid-overengineering": "gpt-6",
    "calibrate-fable": "claude-fable-5-2",
    "constrain-opus": "claude-opus-5-5",
  } as const
  const headings = {
    "avoid-overengineering": "## 控制过度工程化",
    "calibrate-fable": "## 在当前授权内完成任务",
    "constrain-opus": "## 强制规则",
  } as const
  const skills = Object.keys(files) as (keyof typeof files)[]
  const cases = [
    ["gpt-6-luna", "avoid-overengineering"],
    ["claude-fable-5-2", "calibrate-fable"],
    ["anthropic/claude-opus-5-5-thinking", "constrain-opus"],
    ["claude-fable-5-3", undefined],
  ] as const
  const configPath = join(env.XDG_CONFIG_HOME, "opencode", "opencode.json")
  const config = await Bun.file(configPath).json()
  // Do not expose the installer's real providers to this test process.
  config.providers = {
    mock: {
      name: "Local verification",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: "test" },
      models: Object.fromEntries(cases.map(([id]) => [id, { name: id }])),
    },
  }
  for (const agent of Object.keys(config.agents)) config.agents[agent].model = "mock/gpt-6.1-sol"
  // Runtime checks only the published package, not unrelated local plugins.
  await Bun.file(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "adopt-catalog.ts")).delete()
  const localPlugin = join(env.XDG_CONFIG_HOME, "opencode", "plugins", "cap-context.ts")
  await Bun.file(localPlugin).delete()
  rmSync(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "orchestrator"), { recursive: true, force: true })
  rmSync(join(env.XDG_CONFIG_HOME, "opencode", "plugins", "deepseek-fallback"), { recursive: true, force: true })
  writeFileSync(configPath, JSON.stringify(config))
  const project = join(run, "project")
  mkdirSync(project)
  try {
    for (const [model, expected] of cases) {
      const start = captured.length
      const proc = Bun.spawn([binary, "run", "--standalone", "--auto", "-m", `mock/${model}`, "Reply ok"], {
        cwd: project, env, stdout: "pipe", stderr: "pipe",
      })
      const stdout = new Response(proc.stdout).text()
      const stderr = new Response(proc.stderr).text()
      const timeout = setTimeout(() => proc.kill(), 90_000)
      const code = await proc.exited
      clearTimeout(timeout)
      const label = model.replaceAll("/", "_")
      writeFileSync(join(run, `${label}.stdout.log`), await stdout)
      writeFileSync(join(run, `${label}.stderr.log`), await stderr)
      expect(code, `${model}: see ${run}`).toBe(0)
      type Captured = { model: string; messages: { role: string; content: unknown }[] }
      const requests = (captured.slice(start) as Captured[]).filter((item) => item.model === model)
      const systemOf = (item: Captured) =>
        JSON.stringify(item.messages.filter((message) => message.role === "system" || message.role === "developer"))
      // Title requests are also captured; the agent-loop request carries the most instructions.
      const request = requests.sort((a, b) => systemOf(b).length - systemOf(a).length)[0]
      expect(request, `No agent request for ${model}`).toBeDefined()
      const system = systemOf(request)
      for (const skill of skills) {
        expect(system.includes(headings[skill]), `${model}: ${skill}`).toBe(skill === expected)
      }
      expect(system).not.toContain("## 指挥者模式")
      if (expected) {
        const source = await Bun.file(join(root, "models-md", `${files[expected]}.md`)).text()
        expect(system).toContain(JSON.stringify(source.trim()).slice(1, -1))
      }
      console.info(`${model}: ${expected ?? "no model-specific skill"} PASS`)
    }
  } finally {
    server.stop(true)
  }
}, 600_000)
