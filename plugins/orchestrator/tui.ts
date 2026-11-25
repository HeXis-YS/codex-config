import { Plugin } from "@opencode/plugin/tui"
import { OrchestratorRpc, type OrchestratorStatus } from "./rpc"

type Action = "toggle" | "on" | "off" | "status"

function parseAction(input?: string): Action | undefined {
  const value = input?.trim().toLowerCase() ?? ""
  if (value === "" || value === "toggle") return "toggle"
  if (value === "on" || value === "enable" || value === "true" || value === "1") return "on"
  if (value === "off" || value === "disable" || value === "false" || value === "0") return "off"
  if (value === "status") return "status"
  return undefined
}

export default Plugin.define({
  id: "orchestrator",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "orchestrator.toggle",
          title: "切换指挥者模式",
          description: "开启或关闭当前会话的指挥者模式（支持 /orchestrator [on|off|status]）",
          group: "Session",
          palette: true,
          slash: {
            name: "orchestrator",
            arguments: true,
          },
          run: async (input) => {
            const action = parseAction(input)
            if (!action) {
              context.ui.toast.show({
                title: "指挥者模式",
                message: "用法：/orchestrator [on|off|status]",
                variant: "warning",
              })
              return
            }

            try {
              const rpc = context.client.rpc(OrchestratorRpc)
              const route = context.ui.router.current()

              if (route.type !== "session") {
                if (action === "status") {
                  context.ui.toast.show({
                    title: "指挥者模式",
                    message: "当前未进入会话（新会话默认关闭）",
                    variant: "info",
                  })
                  return
                }
                if (action === "off") {
                  context.ui.toast.show({
                    title: "指挥者模式",
                    message: "新会话默认关闭指挥者模式",
                    variant: "info",
                  })
                  return
                }
                const location = context.location ?? context.data.location.default()
                const selected = context.ui.model.current()
                const created = await context.client.session.create({
                  location: { directory: location.directory },
                  model: selected
                    ? { providerID: selected.providerID, id: selected.modelID, variant: selected.variant }
                    : undefined,
                })
                await rpc.set(
                  { sessionID: created.id, enabled: true },
                  { location: { directory: created.location.directory } },
                )
                context.data.session.invalidate(created.id)
                if (!context.ui.tabs.focus(created.id)) {
                  context.ui.router.navigate({ type: "session", sessionID: created.id })
                }
                context.ui.toast.show({
                  title: "指挥者模式",
                  message: "已新建会话并开启指挥者模式",
                  variant: "success",
                })
                return
              }

              const rootID = context.data.session.root(route.sessionID)
              const session = context.data.session.get(rootID) ?? context.data.session.get(route.sessionID)
              const location = session?.location ?? context.location ?? context.data.location.default()
              const rpcLocation = { directory: location.directory }

              if (action === "status") {
                const status = (await rpc.status({ sessionID: rootID }, { location: rpcLocation })) as OrchestratorStatus
                context.ui.toast.show({
                  title: "指挥者模式",
                  message: status.enabled ? "当前会话：已开启" : "当前会话：已关闭",
                  variant: "info",
                })
                return
              }

              const status = (
                action === "toggle"
                  ? await rpc.toggle({ sessionID: rootID }, { location: rpcLocation })
                  : await rpc.set({ sessionID: rootID, enabled: action === "on" }, { location: rpcLocation })
              ) as OrchestratorStatus
              context.data.session.invalidate(status.sessionID)
              context.ui.toast.show({
                title: "指挥者模式",
                message: status.enabled ? "当前会话已开启指挥者模式" : "当前会话已关闭指挥者模式",
                variant: status.enabled ? "success" : "info",
              })
            } catch (err) {
              context.ui.toast.show({
                title: "指挥者模式切换失败",
                message: err instanceof Error ? err.message : String(err),
                variant: "error",
              })
            }
          },
        },
      ],
      bindings: ["orchestrator.toggle"],
    }))
  },
})
