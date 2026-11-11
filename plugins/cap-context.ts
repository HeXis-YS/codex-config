import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "cap-context",
  async setup(ctx) {
    await ctx.model.transform((editor) => {
      // GPT 上游对上下文超过 272000 的请求额外收费，因此只下调超限值，保留更小的原有值。
      // 其他模型没有该限制，仅补缺失的 input 上限以保证注意力质量，不覆盖已有值。
      const cap = 272000
      for (const model of editor.list()) {
        const isGpt = [model.id, model.modelID].some((id) => {
          const name = typeof id === "string" ? id.split("/").at(-1) : undefined
          return name?.startsWith("gpt-") === true
        })
        editor.update(model.providerID, model.id, (item) => {
          if (item.limit.input === undefined) item.limit.input = cap
          if (isGpt && (item.limit.context ?? 0) > cap) item.limit.context = cap
        })
      }
    })
  },
})
