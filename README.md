# OpenCode 配置

个人使用的 OpenCode 配置仓库，提供一套运行配置、全局规则、技能和插件。适用于本人信任的开发环境。

## 安装

宿主机需要 Bash 和常用文件工具；容器内还需要 OpenCode 2 CLI、Git、`jq` 和 `findmnt`（util-linux）。容器安装前检查[配置模板](templates/opencode.json)中的服务地址与凭据。

在宿主机或容器内均运行同一个[安装脚本](install.sh)，脚本自动识别环境：

- 宿主机：只安装技能到 `~/.local/state/sandboxes/sandboxes/agent-skills`，供新容器只读挂载。
- 容器：独立管理配置、规则和插件；技能目录只读时保持不变，没有只读挂载的旧容器仍安装本地技能。

安装会覆盖同名文件；容器内还会合并配置，将全局 Git 身份设为脚本中的个人配置，将全局 Git 忽略文件覆盖为仅含 `.opencode` 的内容。执行前请核对设置并备份需要保留的内容。

```bash
./install.sh
```

容器默认安装到 `~/.config/opencode/`；若设置了 `XDG_CONFIG_HOME`，则安装到 `$XDG_CONFIG_HOME/opencode/`。

## 内容

- [配置模板](templates/opencode.json)：模型服务与会话整理配置。
- [全局规则](AGENTS.global.md)：安装为用户级 `AGENTS.md`，约定 Agent 的协作与工程行为。
- [技能](skills/)：按任务选用的能力包，用法见各目录的 `SKILL.md`；例如[技术写作](skills/write-docs/SKILL.md)和[独立事故审查](skills/review-incident/SKILL.md)。
- [cap-context 插件](plugins/cap-context.ts)：限制部分模型的上下文与输入上限。
- [备份脚本](backup.sh)：备份和恢复 OpenCode 用户数据，用于容器间迁移。

## 备份与迁移

在容器之间迁移 OpenCode 会话数据时，直接打包 `XDG_DATA_HOME/opencode`（默认 `~/.local/share/opencode`）：

```bash
# 源容器
./backup.sh backup /path/to/opencode-backup.tar.gz

# 复制到目标容器
./backup.sh restore /path/to/opencode-backup.tar.gz
```

脚本会在备份和恢复前自动停止 OpenCode 服务。归档包含会话数据库、凭据、shell 快照和工具输出；配置和技能由 `install.sh` 单独安装。归档含敏感数据，请妥善保管。

## 维护

维护约定见仓库级 [AGENTS.md](AGENTS.md)，全局规则的设计依据见[设计说明](docs/agent-rule-rationale.md)。

验证入口：安装行为用 `./scripts/verify-opencode-install.sh`（需要 Linux、bubblewrap 和免密码 `sudo`，使用隔离 HOME 与真实只读挂载），事故取证脚本用 `./scripts/verify-incident-export.sh`。这些检查不验证实际模型或 API 服务的可用性。
