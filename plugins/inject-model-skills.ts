import { Plugin } from "@opencode/plugin"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export default Plugin.define({
  id: "inject-model-skills",
  async setup(ctx) {
    // 定义模型到 skill 的映射
    const modelSkills = [
      {
        patterns: ["claude-fable-5-2", "claude-fable-5.2"],
        skillName: "calibrate-fable",
        marker: "Claude Fable 5.2 补充约束",
      },
      {
        patterns: ["claude-opus-5-5", "claude-opus-5.5"],
        skillName: "constrain-opus",
        marker: "约束 Opus 5.5 的执行与报告",
      },
      {
        patterns: ["gpt-"],
        skillName: "avoid-overengineering",
        marker: "控制过度工程化",
        caseSensitive: false,
      },
    ]

    // 预加载所有 skill 内容
    const skillContents = new Map<string, string>()
    for (const { skillName } of modelSkills) {
      const skillPath = join(ctx.paths.config, "skills", skillName, "SKILL.md")
      try {
        const content = await readFile(skillPath, "utf-8")
        skillContents.set(skillName, content)
      } catch (err) {
        ctx.logger.warn(`${skillName} skill not found, skipping`)
      }
    }

    await ctx.agent.transform((editor) => {
      for (const agent of editor.list()) {
        const agentID = typeof agent === "string" ? agent : agent.id
        const agentInfo = typeof agent === "string" ? editor.get(agent) : agent
        if (!agentInfo) continue

        const model = agentInfo.model
        if (!model) continue

        const modelName = typeof model === "string" ? model : (model.id || model.modelID || "")

        // 检查每个模型匹配规则
        for (const { patterns, skillName, marker, caseSensitive = true } of modelSkills) {
          const skillContent = skillContents.get(skillName)
          if (!skillContent) continue

          const testName = caseSensitive ? modelName : modelName.toLowerCase()
          const matched = patterns.some(pattern => {
            const testPattern = caseSensitive ? pattern : pattern.toLowerCase()
            return testName.includes(testPattern)
          })

          if (!matched) continue

          editor.update(agentID, (item) => {
            const existing = item.instructions ?? []
            const alreadyInjected = existing.some(
              (instr) => typeof instr === "string" && instr.includes(marker)
            )

            if (!alreadyInjected) {
              item.instructions = [...existing, skillContent]
            }
          })

          // 只注入一个 skill
          break
        }
      }
    })
  },
})
