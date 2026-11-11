# OpenCode 配置

个人使用的 OpenCode 配置仓库，提供一套运行配置、全局规则、技能和插件。适用于本人信任的开发环境。

## 安装

需要 Bash、OpenCode 2 CLI 和 `jq`；orchestrator 上游声明需要 Node.js >=24，首次加载需要联网下载插件。安装会更新用户配置中的同名键，并覆盖同名规则、技能和插件文件；请先检查并备份需要保留的内容。

```bash
./install.sh
```

默认安装到 `~/.config/opencode/`；若设置了 `XDG_CONFIG_HOME`，则安装到 `$XDG_CONFIG_HOME/opencode/`。安装器不会修改 Codex 配置或全局 Git 设置。

## 内容

- [OpenCode 配置模板](templates/opencode.json)：管理 OpenLux、DeepSeek、会话整理所用模型及 orchestrator 的配置；安装时合并进现有 `opencode.json`，未涉及的键（如 `$schema`、`mcp`）保持不变。插件列表只替换 orchestrator 的 npm 配置项，保留其他条目，重复安装不追加副本。模板中的 key 字段为直接写入的值；使用前请按目标服务核对其实际用途和可用性。
- [全局规则](AGENTS.global.md)：安装为用户级 `AGENTS.md`；仓库根目录的 [AGENTS.md](AGENTS.md) 只用于维护本项目。
- [技能](skills/)：安装到用户级 `skills/`，由 OpenCode 按需发现和加载。
- [cap-context 插件](plugins/cap-context.ts)：安装到用户级 `plugins/`，限制部分模型的上下文与输入上限。
- [opencode-orchestrator](https://github.com/agnusdei1207/opencode-orchestrator)：由 OpenCode 下载并加载，提供持久任务进度、`update_todo` 及 `/task`、`/stop` 等 mission 命令。

安装成功只说明文件已复制，不代表模型或 MCP 服务可用。维护时可运行 `bash -n install.sh`、`./scripts/verify-opencode-install.sh` 和 `git diff --check`；需要确认服务是否可用时，再用实际请求验证。
