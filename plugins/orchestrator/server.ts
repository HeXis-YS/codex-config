import { Plugin } from "@opencode/plugin"
import { ORCHESTRATOR_PROMPT } from "./prompt"
import { OrchestratorRpc, type OrchestratorStatus } from "./rpc"

export default Plugin.define({
  id: "orchestrator",
  async setup(ctx) {
    const locks = new Map<string, Promise<unknown>>()
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
          const status: OrchestratorStatus = { sessionID: root.id, enabled }
          await registration.events.emit("updated", status)
          return status
        })
      },
    })

    await ctx.session.hook("context", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID })
      // 子代理运行在带 parentID 的子会话中，保持 worker 职责，不继承主会话的指挥者模式。
      if (session.parentID || session.metadata?.orchestrator !== true) return
      if (event.system.some((part) => part.type === "text" && part.text === ORCHESTRATOR_PROMPT)) return
      event.system.push({ type: "text", text: ORCHESTRATOR_PROMPT })
    })
  },
})
