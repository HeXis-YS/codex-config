import { Plugin } from "@opencode/plugin"
import { ORCHESTRATOR_PROMPT } from "./prompt"
import { OrchestratorRpc, type OrchestratorStatus } from "./rpc"

const DEFAULT_GENERAL_TIMEOUT_SEC = 180
const MAX_TIMEOUT_SEC = 3600
const MAX_SOFT_TIMEOUT_WAKES = 5
const RECENT_TOOLS_LIMIT = 6
const TEXT_SNIPPET_LIMIT = 400
const WRAPPED_SUBAGENT = Symbol("orchestrator.wrappedSubagent")

const SUBAGENT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    agent: {
      type: "string",
      description:
        "The type of specialized agent to use for this task. If the user asks for a subagent by a name that is not one of the available subagents, they most likely mean a model: pick a suitable agent and pass the name through the model parameter instead.",
    },
    description: {
      type: "string",
      description: "A short 3-5 word label for the task, displayed to the user",
    },
    model: {
      type: "string",
      description:
        'NEVER set this unless the user explicitly asks for a particular model or variant. It must be a chat model; image and decision models can\'t run subagents. The value is written as "providerID/modelID", or "providerID/modelID#variant" to include a variant. Do not guess the ID: look the model up with the models tool, filtering to your own provider first.',
    },
    prompt: {
      type: "string",
      description: "The task for the subagent to perform",
    },
    sessionID: {
      type: "string",
      pattern: "^ses",
      description: "Send a follow-up to an existing subagent, running or finished. Omit to start a new one.",
    },
    timeoutSec: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: MAX_TIMEOUT_SEC,
      description:
        "Optional soft timeout in seconds for a `general` subagent (ignored for other agents such as `explore`). When reached while still running, sends a progress snapshot to the orchestrator without killing the child. Defaults to 180s in orchestrator mode; passing it on a follow-up resets the timer.",
    },
  },
  required: ["agent", "description", "prompt"],
  additionalProperties: false,
} as const

type ToolRecord = {
  id: string
  name: string
  status: "running" | "success" | "failed"
  startedAt: number
  endedAt?: number
  error?: string
}

type WatchEntry = {
  childID: string
  parentID: string
  description: string
  timeoutMs: number
  startedAt: number
  watchStartedAt: number
  lastActivityAt: number
  executionSeen: boolean
  steps: number
  retries: number
  wakeCount: number
  recentTools: ToolRecord[]
  timer: ReturnType<typeof setTimeout> | null
  active: boolean
}

type WrappedExecute = ((input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>) & {
  [WRAPPED_SUBAGENT]?: boolean
}

function truncateText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem === 0 ? `${min}m` : `${min}m${rem}s`
}

function parseTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return Math.max(100, Math.round(Math.min(value, MAX_TIMEOUT_SEC) * 1000))
}

function extractErrorText(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === "string") return truncateText(value, 160)
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.message === "string") return truncateText(record.message, 160)
    if (typeof record.error === "string") return truncateText(record.error, 160)
  }
  return undefined
}

function extractLatestSnippet(messages: readonly unknown[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined
    if (!msg || msg.type !== "assistant") continue
    const content = msg.content
    if (Array.isArray(content)) {
      const texts: string[] = []
      for (const part of content) {
        if (!part || typeof part !== "object") continue
        const p = part as Record<string, unknown>
        if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
          texts.push(p.text.trim())
        }
      }
      if (texts.length > 0) return truncateText(texts.join(" "), TEXT_SNIPPET_LIMIT)
    }
  }
  return undefined
}

function isLatestMessageIdleAfter(messages: readonly unknown[], sinceMs: number, executionSeen: boolean): boolean {
  const last = messages.at(-1) as { type?: string; time?: { created?: number } } | undefined
  if (!last || last.type !== "idle") return false
  if (executionSeen) return true
  const created = last.time?.created
  return typeof created === "number" && created >= sinceMs - 50
}

function formatRecentTools(tools: readonly ToolRecord[], now: number): string[] {
  if (tools.length === 0) return ["- 最近工具调用：暂无"]
  return [
    "- 最近工具调用：",
    ...tools.map((tool) => {
      const elapsed = formatDuration((tool.endedAt ?? now) - tool.startedAt)
      const errSuffix = tool.error ? ` — ${tool.error}` : ""
      return `  - ${tool.name} [${tool.status}, ${elapsed}]${errSuffix}`
    }),
  ]
}

export default Plugin.define({
  id: "orchestrator",
  async setup(ctx) {
    const locks = new Map<string, Promise<unknown>>()
    const watches = new Map<string, WatchEntry>()
    const lastTimeouts = new Map<string, number>()

    const withLock = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      const prev = locks.get(key) ?? Promise.resolve()
      const next = prev.catch(() => {}).then(fn)
      locks.set(key, next)
      return next.finally(() => {
        if (locks.get(key) === next) locks.delete(key)
      })
    }

    const resolveRoot = async (sessionID: string) => {
      let current = await ctx.session.get({ sessionID })
      const seen = new Set<string>([current.id])
      while (current.parentID && !seen.has(current.parentID)) {
        seen.add(current.parentID)
        current = await ctx.session.get({ sessionID: current.parentID })
      }
      return current
    }

    const isDescendantOf = async (targetID: string, ancestorID: string): Promise<boolean> => {
      if (targetID === ancestorID) return false
      let current = await ctx.session.get({ sessionID: targetID })
      const seen = new Set<string>([current.id])
      while (current.parentID && !seen.has(current.parentID)) {
        if (current.parentID === ancestorID) return true
        seen.add(current.parentID)
        current = await ctx.session.get({ sessionID: current.parentID })
      }
      return false
    }

    const stopWatch = (childID: string, dropSavedTimeout = false): WatchEntry | undefined => {
      const entry = watches.get(childID)
      if (entry) {
        entry.active = false
        if (entry.timer) {
          clearTimeout(entry.timer)
          entry.timer = null
        }
        watches.delete(childID)
      }
      if (dropSavedTimeout) lastTimeouts.delete(childID)
      return entry
    }

    const scheduleTimer = (entry: WatchEntry) => {
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        void onSoftTimeout(entry).catch((err) => {
          console.error("[orchestrator] soft timeout handler failed:", err)
        })
      }, entry.timeoutMs)
    }

    const onSoftTimeout = async (entry: WatchEntry) => {
      entry.timer = null
      if (!entry.active || watches.get(entry.childID) !== entry) return

      let parent: Awaited<ReturnType<typeof ctx.session.get>>
      try {
        parent = await ctx.session.get({ sessionID: entry.parentID })
      } catch {
        stopWatch(entry.childID, true)
        return
      }
      if (parent.parentID || parent.metadata?.orchestrator !== true) {
        stopWatch(entry.childID)
        return
      }

      let messages: readonly unknown[] = []
      try {
        messages = await ctx.session.context({ sessionID: entry.childID })
      } catch {
        stopWatch(entry.childID, true)
        return
      }
      if (isLatestMessageIdleAfter(messages, entry.watchStartedAt, entry.executionSeen)) {
        stopWatch(entry.childID)
        return
      }

      entry.wakeCount += 1
      const now = Date.now()
      const totalElapsed = formatDuration(now - entry.startedAt)
      const idleElapsed = formatDuration(now - entry.lastActivityAt)
      const timeoutLabel = formatDuration(entry.timeoutMs)
      const latestSnippet = extractLatestSnippet(messages)
      const finalCheck = entry.wakeCount >= MAX_SOFT_TIMEOUT_WAKES

      const lines = [
        `<orchestrator-timeout sessionID="${entry.childID}" description="${entry.description.replaceAll('"', "'")}" check="${entry.wakeCount}/${MAX_SOFT_TIMEOUT_WAKES}">`,
        `子代理 \`general\`（${entry.childID}，任务：${entry.description}）已达到软超时（${timeoutLabel}），当前仍在运行（未自动中止）。`,
        `- 已运行时长：${totalElapsed}；距最近活动：${idleElapsed}；已执行步数：${entry.steps}；重试次数：${entry.retries}`,
        ...formatRecentTools(entry.recentTools, now),
        ...(latestSnippet ? [`- 最新输出摘录：${latestSnippet}`] : []),
        finalCheck
          ? "- 说明：已达本次自动软超时巡检上限，后续不再自动提醒；请明确决定继续等待、通过 `subagent` 发送跟进提示（会重置计时），或调用 `orchestrator_interrupt` 中止。"
          : `- 下一步建议：若仍在正常推进可继续等待（约 ${timeoutLabel} 后再次巡检）；若发现跑偏或受阻，可用 \`subagent(sessionID="${entry.childID}")\` 给予提示并按需更新 \`timeoutSec\`；若确认难以完成或陷入循环，可调用 \`orchestrator_interrupt(sessionID="${entry.childID}")\` 中止后检查 \`git status\`/\`git diff\`，再拆分任务重派或由自己完成。`,
        "</orchestrator-timeout>",
      ]

      await ctx.session.synthetic({
        sessionID: entry.parentID,
        description: `子代理软超时巡检：${entry.description}`,
        text: lines.join("\n"),
        resume: true,
      })

      if (entry.active && watches.get(entry.childID) === entry && !finalCheck) {
        scheduleTimer(entry)
      }
    }

    const startOrResetWatch = (input: {
      childID: string
      parentID: string
      description: string
      timeoutMs: number
    }) => {
      const now = Date.now()
      const existing = watches.get(input.childID)
      if (existing?.timer) clearTimeout(existing.timer)

      const entry: WatchEntry = existing
        ? {
            ...existing,
            parentID: input.parentID,
            description: input.description || existing.description,
            timeoutMs: input.timeoutMs,
            watchStartedAt: now,
            lastActivityAt: now,
            executionSeen: false,
            wakeCount: 0,
            timer: null,
            active: true,
          }
        : {
            childID: input.childID,
            parentID: input.parentID,
            description: input.description || input.childID,
            timeoutMs: input.timeoutMs,
            startedAt: now,
            watchStartedAt: now,
            lastActivityAt: now,
            executionSeen: false,
            steps: 0,
            retries: 0,
            wakeCount: 0,
            recentTools: [],
            timer: null,
            active: true,
          }

      lastTimeouts.set(input.childID, input.timeoutMs)
      watches.set(input.childID, entry)
      scheduleTimer(entry)
    }

    const eventController = new AbortController()
    void (async () => {
      const watchedTypes = [
        "session.execution.started",
        "session.execution.succeeded",
        "session.execution.failed",
        "session.execution.interrupted",
        "session.idle",
        "session.deleted",
        "session.step.started",
        "session.step.first-token",
        "session.step.ended",
        "session.tool.input.started",
        "session.tool.called",
        "session.tool.progress",
        "session.tool.success",
        "session.tool.failed",
        "session.retry.scheduled",
        "session.text.delta",
        "session.reasoning.delta",
      ] as const
      try {
        for await (const ev of ctx.event.subscribe({
          types: [...watchedTypes] as never,
          signal: eventController.signal,
        })) {
          const data = (ev as { data?: Record<string, unknown> }).data
          const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined
          if (!sessionID) continue

          if (ev.type === "session.deleted") {
            stopWatch(sessionID, true)
            continue
          }

          const entry = watches.get(sessionID)
          if (!entry) continue
          const now = Date.now()

          switch (ev.type) {
            case "session.execution.started":
              entry.active = true
              entry.executionSeen = true
              entry.lastActivityAt = now
              break
            case "session.execution.succeeded":
            case "session.execution.failed":
            case "session.execution.interrupted":
            case "session.idle":
              stopWatch(sessionID)
              break
            case "session.step.started":
              entry.steps += 1
              entry.lastActivityAt = now
              break
            case "session.retry.scheduled":
              entry.retries += 1
              entry.lastActivityAt = now
              break
            case "session.tool.input.started": {
              const id = typeof data?.id === "string" ? data.id : `tool_${now}`
              const name = typeof data?.name === "string" ? data.name : "tool"
              entry.recentTools.push({ id, name, status: "running", startedAt: now })
              if (entry.recentTools.length > RECENT_TOOLS_LIMIT) {
                entry.recentTools.splice(0, entry.recentTools.length - RECENT_TOOLS_LIMIT)
              }
              entry.lastActivityAt = now
              break
            }
            case "session.tool.success": {
              const id = typeof data?.id === "string" ? data.id : undefined
              const record = id ? entry.recentTools.findLast((item) => item.id === id) : undefined
              if (record) {
                record.status = "success"
                record.endedAt = now
              }
              entry.lastActivityAt = now
              break
            }
            case "session.tool.failed": {
              const id = typeof data?.id === "string" ? data.id : undefined
              const record = id ? entry.recentTools.findLast((item) => item.id === id) : undefined
              if (record) {
                record.status = "failed"
                record.endedAt = now
                record.error = extractErrorText(data?.error ?? data?.message)
              }
              entry.lastActivityAt = now
              break
            }
            default:
              entry.lastActivityAt = now
              break
          }
        }
      } catch (err) {
        if (!eventController.signal.aborted) {
          console.error("[orchestrator] event stream error:", err)
        }
      }
    })()

    const registration = await ctx.rpc.register(OrchestratorRpc, {
      status: async (input) => {
        const root = await resolveRoot((input as { sessionID: string }).sessionID)
        return {
          sessionID: root.id,
          enabled: root.metadata?.orchestrator === true,
        } satisfies OrchestratorStatus
      },
      set: async (input) => {
        const { sessionID, enabled } = input as { sessionID: string; enabled: boolean }
        const initial = await resolveRoot(sessionID)
        return withLock(initial.id, async () => {
          const root = await ctx.session.get({ sessionID: initial.id })
          await ctx.session.update({
            sessionID: root.id,
            metadata: { ...root.metadata, orchestrator: enabled },
          })
          if (!enabled) {
            for (const [childID, entry] of watches) {
              if (entry.parentID === root.id) stopWatch(childID)
            }
          }
          const status: OrchestratorStatus = { sessionID: root.id, enabled }
          await registration.events.emit("updated", status)
          return status
        })
      },
      toggle: async (input) => {
        const { sessionID } = input as { sessionID: string }
        const initial = await resolveRoot(sessionID)
        return withLock(initial.id, async () => {
          const root = await ctx.session.get({ sessionID: initial.id })
          const enabled = root.metadata?.orchestrator !== true
          await ctx.session.update({
            sessionID: root.id,
            metadata: { ...root.metadata, orchestrator: enabled },
          })
          if (!enabled) {
            for (const [childID, entry] of watches) {
              if (entry.parentID === root.id) stopWatch(childID)
            }
          }
          const status: OrchestratorStatus = { sessionID: root.id, enabled }
          await registration.events.emit("updated", status)
          return status
        })
      },
    })

    await ctx.tool.transform((editor) => {
      if (editor.get("subagent")) {
        editor.update("subagent", (tool) => {
          const mutable = tool as unknown as { input: unknown; execute?: WrappedExecute }
          mutable.input = SUBAGENT_INPUT_SCHEMA
          const origExec = mutable.execute
          if (typeof origExec === "function" && !origExec[WRAPPED_SUBAGENT]) {
            const wrapped: WrappedExecute = async (input, context) => {
              const rawInput = (input ?? {}) as Record<string, unknown>
              const { timeoutSec, ...rest } = rawInput
              const result = await origExec(rest, context)

              const agent = typeof rest.agent === "string" ? rest.agent : undefined
              const parentID = typeof context?.sessionID === "string" ? context.sessionID : undefined
              if (agent !== "general" || !parentID) return result

              const meta = (result as { metadata?: Record<string, unknown>; output?: Record<string, unknown> } | null)
              const childID =
                typeof meta?.metadata?.sessionID === "string"
                  ? meta.metadata.sessionID
                  : typeof meta?.output?.sessionID === "string"
                    ? meta.output.sessionID
                    : typeof rest.sessionID === "string"
                      ? rest.sessionID
                      : undefined
              if (!childID) return result

              try {
                const parent = await ctx.session.get({ sessionID: parentID })
                if (parent.parentID || parent.metadata?.orchestrator !== true) return result
                const explicitMs = parseTimeoutMs(timeoutSec)
                const timeoutMs =
                  explicitMs ?? lastTimeouts.get(childID) ?? DEFAULT_GENERAL_TIMEOUT_SEC * 1000
                const description =
                  typeof rest.description === "string" && rest.description.trim()
                    ? rest.description.trim()
                    : childID
                startOrResetWatch({ childID, parentID, description, timeoutMs })
              } catch (err) {
                console.error("[orchestrator] failed to attach soft timeout watch:", err)
              }
              return result
            }
            wrapped[WRAPPED_SUBAGENT] = true
            mutable.execute = wrapped
          }
        })
      }

      editor.add({
        name: "orchestrator_interrupt",
        description:
          "Interrupt a running child subagent session belonging to the current orchestrator session while preserving its transcript. Does not roll back files already modified on disk; inspect git status/diff afterwards.",
        options: { codemode: false },
        input: {
          type: "object",
          properties: {
            sessionID: {
              type: "string",
              pattern: "^ses",
              description: "Child subagent sessionID to interrupt.",
            },
            reason: {
              type: "string",
              description: "Optional brief reason for interrupting the subagent.",
            },
          },
          required: ["sessionID"],
          additionalProperties: false,
        },
        execute: async (rawInput, context) => {
          const { sessionID: targetID, reason } = rawInput as { sessionID: string; reason?: string }
          const callerID = context.sessionID
          const caller = await ctx.session.get({ sessionID: callerID })
          if (caller.parentID || caller.metadata?.orchestrator !== true) {
            throw new Error("orchestrator_interrupt is only available in an orchestrator-enabled root session.")
          }
          const ownsTarget = await isDescendantOf(targetID, callerID).catch(() => false)
          if (!ownsTarget) {
            throw new Error(`Session ${targetID} is not a child session of orchestrator session ${callerID}.`)
          }

          const snapshot = stopWatch(targetID)
          const outcome = await ctx.session.interrupt({ sessionID: targetID, resume: false })
          let latestSnippet: string | undefined
          try {
            const messages = await ctx.session.context({ sessionID: targetID })
            latestSnippet = extractLatestSnippet(messages)
          } catch {
            // Keep interrupt response even if transcript read fails.
          }

          const now = Date.now()
          const lines = [
            outcome.interrupted
              ? `已中止子会话 ${targetID}（历史记录已保留）。`
              : `子会话 ${targetID} 当前未在运行（interrupted=false，历史记录已保留）。`,
            ...(reason ? [`- 中止原因：${reason}`] : []),
            ...(snapshot
              ? [
                  `- 截至中止：已运行 ${formatDuration(now - snapshot.startedAt)}，步数 ${snapshot.steps}，重试 ${snapshot.retries}`,
                  ...formatRecentTools(snapshot.recentTools, now),
                ]
              : []),
            ...(latestSnippet ? [`- 最新输出摘录：${latestSnippet}`] : []),
            "- 注意：中止不会回滚该子代理已写入工作区的文件改动，请检查 `git status` / `git diff` 后再决定拆分重派或亲自完成。",
          ]
          return {
            content: lines.join("\n"),
            metadata: { sessionID: targetID, interrupted: outcome.interrupted },
          }
        },
      } as never)
    })

    await ctx.session.hook("context", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID })
      const isOrchestratorRoot = !session.parentID && session.metadata?.orchestrator === true

      if (!isOrchestratorRoot) {
        delete event.tools.orchestrator_interrupt
        const subagentTool = event.tools.subagent
        if (subagentTool?.input && typeof subagentTool.input === "object") {
          const input = subagentTool.input as Record<string, unknown>
          const props = input.properties as Record<string, unknown> | undefined
          if (props && "timeoutSec" in props) {
            const { timeoutSec: _omitted, ...restProps } = props
            event.tools.subagent = {
              ...subagentTool,
              input: {
                ...input,
                properties: restProps,
              },
            }
          }
        }
        return
      }

      // 子代理运行在带 parentID 的子会话中，保持 worker 职责，不继承主会话的指挥者模式。
      if (event.system.some((part) => part.type === "text" && part.text === ORCHESTRATOR_PROMPT)) return
      event.system.push({ type: "text", text: ORCHESTRATOR_PROMPT })
    })

    return () => {
      eventController.abort()
      for (const childID of [...watches.keys()]) {
        stopWatch(childID, true)
      }
      lastTimeouts.clear()
    }
  },
})
