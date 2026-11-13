# OpenCode 配置

个人使用的 OpenCode 配置仓库，提供一套运行配置、全局规则、技能和插件。适用于本人信任的开发环境。

## 安装

需要 Bash、OpenCode 2 CLI、Git 和 `jq`。安装会更新用户配置中的同名键，并覆盖同名规则、技能和插件文件；还会将全局 Git 姓名和邮箱设为 `HeXis-YS` / `40174982+HeXis-YS@users.noreply.github.com`，将全局忽略文件 `${XDG_CONFIG_HOME:-$HOME/.config}/git/ignore` 覆盖为 `.opencode`。请先检查并备份需要保留的内容。

```bash
./install.sh
```

默认安装到 `~/.config/opencode/`；若设置了 `XDG_CONFIG_HOME`，则安装到 `$XDG_CONFIG_HOME/opencode/`。安装器不会修改 Codex 配置。

## 内容

- [OpenCode 配置模板](templates/opencode.json)：管理 OpenLux、DeepSeek 及会话整理所用模型的配置；安装时合并进现有 `opencode.json`，未涉及的键（如 `$schema`、`mcp`）保持不变。不安装任务管理包；升级时移除此前管理的 `opencode-orchestrator` 配置项，保留其他插件条目。模板中的 key 字段为直接写入的值；使用前请按目标服务核对其实际用途和可用性。
- [全局规则](AGENTS.global.md)：安装为用户级 `AGENTS.md`；计划、进度与交接依据统一保存在项目的 `.opencode/todo.md`，通过精确补丁维护。仓库根目录的 [AGENTS.md](AGENTS.md) 只用于维护本项目。
- [技能](skills/)：安装到用户级 `skills/`，由 OpenCode 按需发现和加载。事故审查统一使用 [review-incident](skills/review-incident/SKILL.md)；升级时移除原 `record-incident`、`score-incident` 的 `SKILL.md` 入口，保留目录内其他文件。
- [cap-context 插件](plugins/cap-context.ts)：安装到用户级 `plugins/`，限制部分模型的上下文与输入上限。
- [inject-model-skills 插件](plugins/inject-model-skills.ts)：根据模型自动注入对应的 skill：Fable 5.2 注入 [calibrate-fable](skills/calibrate-fable/)，Opus 5.5 注入 [constrain-opus](skills/constrain-opus/)，GPT 注入 [avoid-overengineering](skills/avoid-overengineering/)。

安装成功只说明文件已复制，不代表模型或 MCP 服务可用。维护时可运行 `bash -n install.sh`、`./scripts/verify-opencode-install.sh` 和 `git diff --check`；需要确认服务是否可用时，再用实际请求验证。

## 独立事故审查

在独立于当事 Agent 的会话中调用，例如：

```text
$review-incident 审查 ses_目标会话的完整对话，记录事故并提出评分。
$review-incident 核对本项目的 INC-YYYYMMDD-NNN 并评分。
```

流程为：API 取证 → 顺序审查 → 核对事实与缺口 → 记录并提出双轴评分 → 用户确认 → 写回评分及状态。原风险/影响分档与 60%/40% 权重沿用；事实记录、评分标准和取证脚本随同一个技能安装。

取证脚本需要 OpenCode 2 CLI、Bash 和 `jq`，在事故记录所在项目执行：

```bash
bash "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills/review-incident/scripts/export-session.sh" ses_目标会话
```

输出位于新建的 `.opencode/runs/incident-<sessionID>-<时间>/`，包含完整 API 导出、消息索引、按模型分组的宿主用量和版本信息；详细参数见脚本 `--help`。脚本汇总的数据供审查核对，费用不直接等同于事故损失。事故及原始证据保存在本地，不默认提交 Git。

维护取证脚本时运行 `./scripts/verify-incident-export.sh`：用合成 API 响应检查原始证据保留、消息顺序、按执行模型汇总、缺失用量及失败处理，输入、脚本版本与结果保存在 `.opencode/runs/verify-incident-export.*/`。实际 API 连通性由取证入口对目标会话的运行结果单独验证。
