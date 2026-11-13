# OpenCode 配置

个人使用的 OpenCode 配置仓库，提供一套运行配置、全局规则、技能和插件。适用于本人信任的开发环境。

## 安装

需要 Bash、OpenCode 2 CLI、Git 和 `jq`。使用前检查[配置模板](templates/opencode.json)中的服务地址与凭据。

[安装脚本](install.sh)会合并配置，覆盖同名规则、技能和插件文件，并将全局 Git 身份设为脚本中的个人配置，将全局 Git 忽略文件覆盖为仅含 `.opencode` 的内容。执行前请核对这些设置并备份需要保留的内容。

```bash
./install.sh
```

默认安装到 `~/.config/opencode/`；若设置了 `XDG_CONFIG_HOME`，则安装到 `$XDG_CONFIG_HOME/opencode/`。

## 内容

- [配置模板](templates/opencode.json)：模型服务与会话整理配置。
- [全局规则](AGENTS.global.md)：安装为用户级 `AGENTS.md`，约定 Agent 的协作与工程行为。
- [技能](skills/)：按任务选用的能力包，用法见各目录的 `SKILL.md`；例如[技术写作](skills/write-docs/SKILL.md)和[独立事故审查](skills/review-incident/SKILL.md)。
- [cap-context 插件](plugins/cap-context.ts)：限制部分模型的上下文与输入上限。
- [inject-model-skills 插件](plugins/inject-model-skills.ts)：按模型自动注入对应技能。

## 维护

维护约定见仓库级 [AGENTS.md](AGENTS.md)，全局规则的设计依据见[设计说明](docs/agent-rule-rationale.md)。

验证入口：安装行为用 `./scripts/verify-opencode-install.sh`，事故取证脚本用 `./scripts/verify-incident-export.sh`。这些检查不验证实际模型或 API 服务的可用性。
