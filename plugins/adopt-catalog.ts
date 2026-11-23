import { Plugin } from "@opencode/plugin"

const PROVIDER_ID = "vti"
const CATALOG_SOURCES = ["anthropic", "google", "openai"] as const

// 文件名保持字典序早于 cap-context.ts，使目录继承先执行，再由 cap-context 统一收口上下文与输入上限，
// 最后由内置 opencode.config.provider 叠加 opencode.json 中的模型级覆盖（如 modelID、disabled、headers）。
export default Plugin.define({
  id: "adopt-catalog",
  async setup(ctx) {
    await ctx.model.transform((editor) => {
      const vti = editor.provider.get(PROVIDER_ID)?.provider
      if (!vti) return

      const sources = CATALOG_SOURCES.map((id) => editor.provider.get(id)).filter(
        (item): item is NonNullable<typeof item> => item !== undefined,
      )
      const rawBase = vti.settings?.baseURL
      const baseOrigin = typeof rawBase === "string" ? rawBase.replace(/\/v1(?:beta)?\/?$/, "") : ""

      for (const model of editor.list(PROVIDER_ID)) {
        const lookup = [model.id, model.modelID].find((key) =>
          typeof key === "string" ? sources.some((src) => src.models.has(key)) : false,
        )
        if (!lookup) continue
        const matched = sources.find((src) => src.models.has(lookup))
        const catalog = matched?.models.get(lookup)
        if (!matched || !catalog) continue

        const isGoogle = matched.provider.id === "google"
        const { apiKey: _apiKey, baseURL: _baseURL, ...catalogSettings } = catalog.settings ?? {}
        const inherited = structuredClone(catalog)
        // VTI 的 /v1/responses 网关仅接受 type="function" 工具；剔除 freeform 后，
        // OpenCode 自动将 patch 与 execute 编码为标准 JSON Schema function 工具。
        delete inherited.capabilities.freeform

        editor.update(PROVIDER_ID, model.id, (draft) => {
          Object.assign(draft, inherited, {
            id: model.id,
            modelID: model.modelID || model.id,
            providerID: PROVIDER_ID,
            enabled: model.enabled,
            package: catalog.package ?? matched.provider.package,
            settings: {
              ...catalogSettings,
              ...vti.settings,
              ...(isGoogle && baseOrigin ? { baseURL: `${baseOrigin}/v1beta` } : {}),
              ...model.settings,
            },
          })
        })
      }
    })
  },
})
