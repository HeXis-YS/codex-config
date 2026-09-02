# codex-config

个人使用的 Codex 配置仓库。配置、全局 Agent 规则、个人技能和自定义模型目录都通过 Git 管理，便于持续迭代，并在新的环境中快速恢复相同的工作方式。

## 仓库内容

| 路径 | 作用 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 本仓库的项目级开发规则，用于约束可分发配置、规则和技能的编写与审查；不会被安装。 |
| [`config.toml`](config.toml) | Codex 全局配置：自定义模型服务、网页搜索开关、Memory、长上下文和多 Agent 设置。 |
| [`AGENTS.global.md`](AGENTS.global.md) | 全局 Agent 规则的仓库源文件；安装时复制为 `~/.codex/AGENTS.md`。文件名带有 `.global`，使它不会在本仓库中作为项目级指令与 `AGENTS.md` 同时加载。 |
| [`models/`](models/) | 自定义模型目录。每个 JSON 文件都是一个 `{ "models": [...] }` 模型目录片段。 |
| [`install.sh`](install.sh) | 将配置、全局规则、个人技能和模型目录安装到当前用户环境，并清理本仓库不再分发的旧 skill。 |
| [`skills/`](skills/) | 随仓库版本化的个人技能；安装脚本会安装其中的全部 skill。 |
| [`.gitignore`](.gitignore) | 忽略本地认证文件 `auth.json`。 |

仓库不保存 API 密钥、登录状态或其他运行时凭据。认证应在目标环境中单独完成。

## 快速安装

在目标环境中先安装 Codex CLI，并按 CLI 的方式完成认证，然后执行：

```bash
git clone <repository-url> codex-config
cd codex-config
./install.sh
```

脚本使用当前用户的 `HOME`，安装结果位于：

```text
~/.codex/config.toml   <- config.toml
~/.codex/AGENTS.md     <- AGENTS.global.md
~/.codex/models.json   <- 官方模型目录与 models/*.json 合并后的目录
~/.agents/skills/write-todo/
                         <- skills/write-todo/
~/.agents/skills/write-lessons/
                         <- skills/write-lessons/
```

### 前置条件

- Bash、`cp`、`install`、`mktemp` 等常见类 Unix 工具。
- `codex` 命令已安装并位于 `PATH` 中。
- `jq`。若缺少 `jq`，脚本会在检测到 `apt-get` 时尝试使用 root 或 `sudo` 自动安装；其他系统请先手动安装。
- 能够执行 `codex debug models --bundled`，以读取当前 Codex 版本自带的模型目录。

### 安装脚本的行为

`install.sh` 会先校验依赖，然后：

1. 创建 `~/.codex`、`~/.config/git` 和技能安装目录。
2. 安装 `config.toml`、全局规则和 `skills/` 下的全部 skill，并删除本仓库先前安装的 `analyze`、`write-code`、`use-git` skill 目录；其他 skill 不受影响。
3. 读取 Codex 自带模型目录，校验仓库中的模型片段，并按 `slug` 合并；仓库模型与官方模型同名时，以仓库版本覆盖。
4. 将合并结果写入 `~/.codex/models.json`，使用临时文件替换目标文件，避免中断时留下不完整目录。
5. 将 `.codex` 写入 `~/.config/git/ignore`。

> **注意：** 当前脚本会用单行 `.codex` 覆盖整个 `~/.config/git/ignore`，不会保留其中原有的全局忽略规则。运行前请检查并备份该文件；如果依赖其他全局忽略项，请在安装后恢复或合并它们。

## 验证安装

```bash
test -f "$HOME/.codex/config.toml"
test -f "$HOME/.codex/AGENTS.md"
cmp AGENTS.global.md "$HOME/.codex/AGENTS.md"
test -f "$HOME/.agents/skills/write-todo/SKILL.md"
test -f "$HOME/.agents/skills/write-lessons/SKILL.md"
test ! -e "$HOME/.agents/skills/analyze" && test ! -L "$HOME/.agents/skills/analyze"
test ! -e "$HOME/.agents/skills/write-code" && test ! -L "$HOME/.agents/skills/write-code"
test ! -e "$HOME/.agents/skills/use-git" && test ! -L "$HOME/.agents/skills/use-git"
jq -r '.models[].slug' "$HOME/.codex/models.json"
```

当前仓库提供的自定义模型包括：

- `deepseek-v4-flash`
- `deepseek-v4-pro`

## 日常迭代与迁移

修改配置、规则、`skills/` 或 `models/*.json` 后提交 Git；在其他环境执行 `git pull` 后重新运行 `./install.sh` 即可同步。重新安装会覆盖上述 `~/.codex` 文件和 `skills/` 中同名的用户级 skill，并重新获取官方模型目录。

### 任务恢复

非简单任务同时使用内置 Plan 清单和 `.codex/todo.md`：Plan 在每个步骤完成时立即更新，todo 通过 `$write-todo` 在关键状态、证据、阻塞或下一动作变化时维护持久笔记，并保留已完成记录供追溯。新任务记录使用 Markdown task list：已完成项用 `- [x]`，待办和唯一下一步用 `- [ ]`。`memories` 已启用，但只作为跨会话背景补充；恢复时以用户最新指令和可观察工作区为准，其次是 todo，最后才是 Memory。`.codex/` 仍是本地工作流目录，不提交到仓库。

新增模型时，保持文件结构为：

```json
{
  "models": [
    {
      "slug": "example-model"
    }
  ]
}
```

实际模型条目通常还需要完整的上下文窗口、推理等级、工具能力和服务端兼容性字段；可参考 [`models/deepseek.json`](models/deepseek.json)。每个 `slug` 应唯一，重复 `slug` 会按“仓库条目覆盖官方条目”的规则处理。

迁移到新环境的最小流程是：安装 Codex CLI、完成认证、克隆本仓库、运行安装脚本。模型服务地址和 API 兼容性由 [`config.toml`](config.toml) 中的 `model_providers.custom` 决定；目标环境必须能够访问该服务。技能安装到 `~/.agents/skills/`，由 Codex 从该目录发现。

## 配置要点与安全边界

当前配置有意开启了较高权限：

- `approval_policy = "never"`
- `sandbox_mode = "danger-full-access"`
- `web_search = "live"`
- 启用 memories、goals 和 multi-agent，最多 8 个并发线程

这适合个人信任的开发容器或隔离环境，不适合直接用于不受信任的代码、生产主机或含敏感数据的工作区。若环境风险不同，应先调整 `config.toml`，再运行安装脚本。

认证文件仅保留在本机。不要强制添加 `auth.json`，也不要把 API 密钥写入 `config.toml`、模型 JSON 或 Git 历史；如果密钥曾经被提交或泄露，应立即撤销并重新生成。

## 故障排查

- `codex command was not found`：确认 Codex CLI 已安装，并在运行脚本的 shell 中可由 `command -v codex` 找到。
- `jq is missing`：在没有 `apt-get` 或没有 root/`sudo` 的环境中，先手动安装 `jq`。
- `failed to fetch the bundled Codex model list`：检查 Codex CLI 版本、认证状态和网络，确认 `codex debug models --bundled` 可以单独成功执行。
- `invalid model catalog fragment`：检查对应 JSON 是否合法，且顶层存在 `models` 数组，数组中每个条目都有非空字符串 `slug`。
- 安装后出现其他全局 Git 忽略规则丢失：从安装前的备份恢复 `~/.config/git/ignore`，并保留其中的 `.codex` 条目。

提交前可运行最小检查：

```bash
bash -n install.sh
jq -e '.models | type == "array" and all(.[]; (.slug | type) == "string" and (.slug | length) > 0)' models/*.json
git diff --check
```
