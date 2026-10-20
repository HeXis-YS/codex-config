# 模型目录维护

`models/*.json` 是仓库分发的模型目录片段，`install.sh` 按 `--profile` 把其中一份安装为 `~/.codex/models.json`。文件按 Codex CLI 的模型目录字段结构维护；本文件记录自定义后端特有的兼容约束和验证方法，避免重复踩坑。

## 与自定义后端相关的字段

| 字段 | 当前取值 | 约束与失败表现 |
| --- | --- | --- |
| `tool_mode` | `direct` | `code_mode_only` 只适用于 OpenAI 兼容 API。DeepSeek 端点不接受它，模型只剩 `apply_patch` 可用，`exec` 等工具无法调用；cc-switch 网关会掩盖上游拒绝，只有运行时才暴露。 |
| `use_responses_lite` | `false` | 置为 `true` 时 DeepSeek 把工具调用按文本返回（DSML 形态），客户端不执行工具，退出码仍是 0。 |
| `include_skills_usage_instructions`、`include_plugin_usage_instructions`、`include_apps_usage_instructions` | `true` | 非 GPT 模型没有针对 Codex 环境调优，开启后才会收到技能、插件与应用的用法说明。 |

`tool_mode: direct` 与 `use_responses_lite: false` 必须同时成立，任一不满足都会让 DeepSeek 的工具调用失效，因此两者分成两个提交以便按因果回滚：`d725553`（`tool_mode`）与 `3abd9cb`（`use_responses_lite`，2026-10-20）。

## 验证方法

安装级别的检查只证明文件被正确分发：`install.sh` 的退出码、安装副本与源文件 `cmp` 一致都属于这一层。字段是否对后端生效必须用真实请求确认；`codex debug models --bundled` 只渲染 CLI 自带的官方目录，不包含 `~/.codex/models.json` 的自定义条目，不能用它判断自定义字段。

在临时环境安装，并请求模型执行一次命令：

```bash
t_home="$(mktemp -d)"
env HOME="$t_home" CODEX_HOME="$t_home/.codex" ./install.sh
env HOME="$t_home" CODEX_HOME="$t_home/.codex" codex exec --skip-git-repo-check -m deepseek-flash \
    'Run the shell command `echo tool-ok` and reply with exactly its output.'
```

通过判据是输出里出现执行结果 `tool-ok`。输出里出现工具调用文本（如 DSML 标签）或只有模型自然语言回答都算失败，退出码 0 不代表工具执行过。调整这类开关时按取值各跑两次，排除单次波动。环境里若已预设 `CODEX_HOME`，必须显式覆盖它，否则安装脚本里的 daemon 重启会作用到真实环境并中断正在运行的会话。

## 已知未验证项

- `models/highgo.json` 的两个条目目前只有字段一致性维护，没有端到端证据：`--profile highgo` 安装正常，但 `codex exec` 在 `use_responses_lite` 开或关时都失败，cc-switch 对 `deepseek-v4.1-flash` 的 `/responses` 返回 404。
- GLM 条目此前记录到 cc-switch 400 与上游 401/403，同样没有可用证据；端点恢复后需要重跑上面的验证。
