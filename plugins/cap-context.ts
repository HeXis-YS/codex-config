import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "cap-context",
  async setup(ctx) {
    await ctx.model.transform((editor) => {
      const cap = 272000
      for (const model of editor.list()) {
        const isGpt = [model.id, model.modelID].some((id) => {
          const name = typeof id === "string" ? id.split("/").at(-1) : undefined
          return name?.startsWith("gpt-") === true
        })
        editor.update(model.providerID, model.id, (item) => {
          if ((item.limit.input ?? 0) > cap) item.limit.input = cap
          if (isGpt && (item.limit.context ?? 0) > cap) item.limit.context = cap
        })
      }
    })
  },
})
