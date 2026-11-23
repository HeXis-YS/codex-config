import { Plugin } from "@opencode/plugin/tui"
import { DeepseekFallbackRpc, type FallbackSwitchedEvent } from "./rpc"

const SWITCHED_EVENT_TYPE = `rpc.${DeepseekFallbackRpc.id}.switched` as const

export default Plugin.define({
  id: "deepseek-fallback",
  setup(context) {
    const stop = context.data.listen(({ details }) => {
      if (details.type !== SWITCHED_EVENT_TYPE) return
      const activeLocation = context.location ?? context.data.location.default()
      if (details.location?.directory !== activeLocation.directory) return

      const data = details.data as FallbackSwitchedEvent
      context.data.session.invalidate(data.sessionID)
      const reasonLine = data.reason ? `\n${data.reason}` : ""
      context.ui.toast.show({
        title: "免费额度不足，已切换备用模型",
        message: `${data.from} → ${data.to}${reasonLine}`,
        variant: "warning",
        duration: 8000,
        sessionID: data.sessionID,
      })
    })
    return () => stop()
  },
})
