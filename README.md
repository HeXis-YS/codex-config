# OpenCode 配置

个人使用的 OpenCode 配置仓库，提供一套运行配置、全局规则、技能和插件。适用于本人信任的开发环境。

## 安装

宿主机需要 Bash 和常用文件工具；容器内还需要 Git 和 `findmnt`（util-linux）。容器中没有 OpenCode 2 CLI 时，安装脚本会用 `curl` 下载安装，需要网络访问。容器安装前检查[配置模板](templates/opencode.json)中的服务地址与凭据。

在宿主机或容器内均运行同一个[安装脚本](install.sh)，脚本自动识别环境：

- 宿主机：只安装技能到 `~/.local/state/sandboxes/sandboxes/agent-skills`，供新容器只读挂载。
- 容器：独立管理配置、规则、插件和模型专用约束；技能目录只读时保持不变，没有只读挂载的旧容器仍安装本地技能。容器无法清理只读共享技能中的旧副本，发现时会提示在宿主机重新运行安装脚本。

安装会覆盖同名文件；容器内会用[配置模板](templates/opencode.json)直接覆盖 `opencode.json`，将全局 Git 身份设为脚本中的个人配置，并向全局 Git 忽略文件追加 `.opencode` 和 `.codex`。已配置 `core.excludesFile` 时使用该文件，否则使用 `$XDG_CONFIG_HOME/git/ignore`；已有条目不会重复添加。执行前请核对设置并备份需要保留的内容。

```bash
./install.sh
```

容器默认安装到 `~/.config/opencode/`；若设置了 `XDG_CONFIG_HOME`，则安装到 `$XDG_CONFIG_HOME/opencode/`。

## 内容

- [配置模板](templates/opencode.json)：模型服务与会话整理配置。
- [全局规则](AGENTS.global.md)：安装为用户级 `AGENTS.md`，约定 Agent 的协作与工程行为。
- [技能](skills/)：按任务选用的能力包，用法见各目录的 `SKILL.md`；例如 [Git 操作](skills/git/SKILL.md)、[技术写作](skills/write-docs/SKILL.md)和[独立事故审查](skills/review-incident/SKILL.md)。
- [模型专用约束](models-md/)：按 models-md 的文件名约定组织，安装器原样复制到配置目录；不作为技能注册。
- [cap-context 插件](plugins/cap-context.ts)：限制部分模型的上下文与输入上限。
- [models-md 插件](https://github.com/acramsay/opencode-models-md)：每次模型请求前注入匹配的约束正文：`gpt-6` 注入 [`gpt-6.md`](models-md/gpt-6.md)，`claude-fable-5-2` 注入 [`claude-fable-5-2.md`](models-md/claude-fable-5-2.md)，`claude-opus-5-5` 注入 [`claude-opus-5-5.md`](models-md/claude-opus-5-5.md)（均包含 `-*` 连字符后缀变体及跨 provider 路由）。文件名按连字符边界匹配，`gpt-6.1-sol` 这类点号版本不会匹配 `gpt-6.md`。安装器把 `models-md/` 复制到配置目录；修改后重新安装。这些约束不能通过技能工具显式调用。
- [备份脚本](backup.sh)：备份和恢复 OpenCode 用户数据与状态，用于容器间迁移。

## 备份与迁移

在容器之间迁移 OpenCode 会话数据时，直接打包 `XDG_DATA_HOME/opencode`（默认 `~/.local/share/opencode`）和 `XDG_STATE_HOME/opencode`（默认 `~/.local/state/opencode`）：

```bash
# 源容器
./backup.sh backup /path/to/opencode-backup.tar.gz

# 复制到目标容器
./backup.sh restore /path/to/opencode-backup.tar.gz
```

脚本会在备份和恢复前自动停止 OpenCode 服务。归档包含数据目录中的会话数据库、凭据、shell 快照和工具输出，以及状态目录中的模型选择、提示历史和终端状态等；配置和技能由 `install.sh` 单独安装。归档含敏感数据，请妥善保管。

## 维护

维护约定见仓库级 [AGENTS.md](AGENTS.md)，全局规则的设计依据见[设计说明](docs/agent-rule-rationale.md)。

验证入口：安装行为用 `./scripts/verify-opencode-install.sh`（需要 Linux、bubblewrap 和免密码 `sudo`，使用隔离 HOME 与真实只读挂载），事故取证脚本用 `./scripts/verify-incident-export.sh`。这些检查不验证实际模型或 API 服务的可用性。

模型规则注入用 `bun test scripts/verify-model-instructions.test.ts`（需要 Bun、OpenCode V2 和 npm registry 网络访问）。它使用隔离 HOME、本地接口替身和发布版插件，捕获真实出站请求；输出保存在 `.opencode/runs/models-md.*/`，不调用真实模型。可用 `MODELS_MD_TEST_CACHE=/absolute/path` 复用一次验证的包缓存，避免重复下载依赖。
