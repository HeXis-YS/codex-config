# codex-config

个人使用的 Codex 配置仓库。配置、全局 Agent 规则、个人技能和自定义模型目录都通过 Git 管理，便于持续迭代，并在新的环境中快速恢复相同的工作方式。

## 仓库内容

| 路径 | 作用 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 本仓库的项目级开发规则，用于约束可分发配置、规则和技能的编写与审查；不会被安装。 |
| [`config.toml`](config.toml) | 唯一的 Codex 全局配置：网页搜索开关、Memory、长上下文和多 Agent 设置。provider 一节留了 `# __CUSTOM_PROVIDER__` 占位符，由 `install.sh` 按所选 profile 填入整段 `[model_providers.custom]`。 |
| [`AGENTS.global.md`](AGENTS.global.md) | 全局 Agent 规则的仓库源文件；安装时复制为 `~/.codex/AGENTS.md`。文件名带有 `.global`，使它不会在本仓库中作为项目级指令与 `AGENTS.md` 同时加载。 |
| [`models/`](models/) | 自定义模型目录。每个 JSON 文件都是一个 `{ "models": [...] }` 模型目录片段；安装时按所选 profile 把对应的一份安装为 `~/.codex/models.json`（默认 `deepseek.json`）。`glm.json` 不单独安装，只作为 `higress.json` 中 GLM 条目的来源。 |
| [`install.sh`](install.sh) | 将配置、全局规则、个人技能和模型目录安装到当前用户环境，并清理本仓库不再分发的旧 skill。 |
| [`install-codex.sh`](install-codex.sh) | 以非交互方式安装 Codex CLI；是 `install.sh` 的前置步骤，不安装本仓库的配置。若 `PATH` 上已有 npm 安装的 `codex`，先执行 `npm uninstall --global @openai/codex` 再安装 standalone 版。 |
| [`skills/`](skills/) | 随仓库版本化的个人技能；安装脚本会安装其中的全部 skill。 |
| ELI5 | 外部 Codex 技能；安装脚本会从 GitHub 克隆并安装到 `~/.codex/skills/eli5`。 |
| [`.gitignore`](.gitignore) | 忽略本地认证文件 `auth.json`。 |

仓库会把 `custom` provider 的 bearer token 写进 `install.sh` 里 deepseek 那一段的 `experimental_bearer_token`，不再依赖环境变量；因此本仓库自身包含一个凭据，应作为私密仓库对待，不要公开分发或推送到公共远端。其余登录状态（`auth.json`）仍只保存在本机。

## 快速安装

在目标环境中先安装 Codex CLI 并完成认证，然后执行：

```bash
git clone <repository-url> codex-config
cd codex-config
./install-codex.sh   # 非交互安装 Codex CLI（会先卸载 PATH 上 npm 安装的 codex）；也可按官方方式安装
./install.sh
```

仓库只维护一份配置。安装时 `install.sh` 把 `config.toml` 里 `# __CUSTOM_PROVIDER__` 占位符替换为所选后端的整段 `[model_providers.custom]`，并安装对应 profile 的模型列表。`--profile <name>` 可选 `deepseek`（默认，指向 `https://api.deepseek.com/`）或 `higress`（指向 `http://host.docker.internal:8080/v1/`，无 bearer token）。两种情况下 provider id 都是 `custom`，既有的会话记录不会失效。

脚本使用当前用户的 `HOME`，安装结果位于：

```text
~/.codex/config.toml   <- config.toml（占位符替换为所选后端的 [model_providers.custom]）
~/.codex/AGENTS.md     <- AGENTS.global.md
~/.codex/models.json   <- models/<profile>.json 安装后的目录
~/.codex/skills/write-todo/
                         <- skills/write-todo/
~/.codex/skills/write-lessons/
                         <- skills/write-lessons/
~/.codex/skills/write-report/
                         <- skills/write-report/
~/.codex/skills/write-prompt/
                         <- skills/write-prompt/
~/.codex/skills/eli5    <- ELI5 仓库 skills/eli5
```

### 前置条件

- Bash、`cp`、`install`、`mktemp` 等常见类 Unix 工具。
- `codex` 命令已安装并位于 `PATH` 中（可用 `./install-codex.sh` 非交互安装；安装后若当前 shell 仍找不到 `codex`，先打开新 shell）。
- `git` 命令已安装并位于 `PATH` 中。
- `jq`。若缺少 `jq`，脚本会在检测到 `apt-get` 时尝试使用 root 或 `sudo` 自动安装；其他系统请先手动安装。

### 安装脚本的行为

脚本会在安装前设置当前用户的全局 Git 身份：

```text
git config --global user.email "40174982+HeXis-YS@users.noreply.github.com"
git config --global user.name "HeXis-YS"
```

这会覆盖已有的全局 Git 身份配置。

`install.sh` 会先校验依赖，然后：

1. 创建 `~/.codex`、`~/.config/git` 和技能安装目录。
2. 安装 `config.toml`、全局规则和 `skills/` 下的全部 skill，并删除本仓库先前安装的 `analyze`、`write-code`、`use-git` skill 目录；其他 skill 不受影响。
3. 校验 `models/<profile>.json` 并写入 `~/.codex/models.json`；不读取 Codex 自带或 Z.ai 模型目录，也不进行合并。
4. 克隆 ELI5 仓库并将 `skills/eli5` 安装到 `~/.codex/skills/eli5`。
5. 使用临时文件替换目标文件，避免中断时留下不完整目录。
6. 将 `.codex` 写入 `~/.config/git/ignore`。
7. 用所选后端的整段 `[model_providers.custom]` 替换安装后 `config.toml` 中的 `# __CUSTOM_PROVIDER__` 占位符，并在安装前校验 `<name>` 属于 `deepseek`、`higress`，其他取值或源文件缺少占位符时直接报错。脚本同时删除早期版本安装的 `~/.codex/higress.config.toml`、`~/.codex/gateway.config.toml`、`~/.codex/models.gateway.json` 和 `~/.codex/models.higress.json`。

> 如果检测到旧的 `~/.agents/skills/`，脚本会将本仓库管理的技能和 ELI5 迁移到 `~/.codex/skills/`；其他未管理的技能不会被删除。

> **注意：** 当前脚本会用单行 `.codex` 覆盖整个 `~/.config/git/ignore`，不会保留其中原有的全局忽略规则。运行前请检查并备份该文件；如果依赖其他全局忽略项，请在安装后恢复或合并它们。

## 验证安装

```bash
test "$(git config --global user.email)" = "40174982+HeXis-YS@users.noreply.github.com"
test "$(git config --global user.name)" = "HeXis-YS"
test -f "$HOME/.codex/config.toml"
grep -q '^model_provider = "custom"$' "$HOME/.codex/config.toml"
test "$(grep -c '^\[model_providers\.' "$HOME/.codex/config.toml")" = 1
test ! -e "$HOME/.codex/higress.config.toml"
test ! -e "$HOME/.codex/models.higress.json"
test -f "$HOME/.codex/AGENTS.md"
cmp AGENTS.global.md "$HOME/.codex/AGENTS.md"
test -f "$HOME/.codex/skills/write-todo/SKILL.md"
test -f "$HOME/.codex/skills/write-lessons/SKILL.md"
test -f "$HOME/.codex/skills/write-report/SKILL.md"
test -f "$HOME/.codex/skills/write-prompt/SKILL.md"
test -f "$HOME/.codex/skills/eli5/SKILL.md"
test ! -e "$HOME/.codex/skills/analyze" && test ! -L "$HOME/.codex/skills/analyze"
test ! -e "$HOME/.codex/skills/write-code" && test ! -L "$HOME/.codex/skills/write-code"
test ! -e "$HOME/.codex/skills/use-git" && test ! -L "$HOME/.codex/skills/use-git"
jq -r '.models[].slug' "$HOME/.codex/models.json"
```

安装脚本分发的自定义模型：

| 模型列表 | 对应 profile 与端点 | 模型 |
| --- | --- | --- |
| `models/deepseek.json` | 默认（`custom` 指向 `https://api.deepseek.com/`） | `deepseek-flash`、`deepseek-v4-pro` |
| `models/higress.json` | `--profile higress`（`custom` 指向 `http://host.docker.internal:8080/v1/`） | `deepseek-v4.1-flash`、`deepseek-v4-pro`、`ccs-higress/ZHIPU/GLM-5.3-Flash`、`ccs-higress/glm-5.3` |

配置里不写 `model` 与 `model_reasoning_effort`：默认模型随所装的模型列表变化，取其中 `priority` 最小的条目（`deepseek.json` → `deepseek-flash`，`higress.json` → `deepseek-v4.1-flash`）。所以端点和模型列表必须成套更换，`--profile` 做的正是这件事。

该端点的 `/v1/models` 返回 4 个 slug，但其中大量字段由网关自行填充，不能直接作为模型目录。`models/higress.json` 因此由仓库中的 `models/deepseek.json` 与 `models/glm.json` 组合而成：只把 slug 改成网关实际接受的名字（`deepseek-flash`→`deepseek-v4.1-flash`、`glm-5.3-flash`→`ccs-higress/ZHIPU/GLM-5.3-Flash`、`glm-5.3`→`ccs-higress/glm-5.3`），并把 `priority` 重排为 1–4，其余字段与源文件逐字段一致。四个 slug 在 `/v1/responses` 上均返回 200；`deepseek-flash` 与 `glm-5.3-flash` 直连该端点会 404，GLM 必须带 `ccs-higress/` 前缀（`ZHIPU/GLM-5.3-Flash` 会 400）。该端点不校验鉴权，无 `Authorization` 头也返回 200，因此改写后的 `[model_providers.custom]` 不声明 `env_key`（声明后 Codex 会因缺少环境变量而拒绝启动）。切到该后端：

```bash
./install.sh --profile higress
```

`models/glm.json` 仍保留在仓库中，但安装脚本不会安装其中的 Z.ai 模型；也不会安装 Codex 自带的 OpenAI 模型。

## 日常迭代与迁移

修改配置、规则、`skills/` 或 `models/*.json` 后提交 Git；在其他环境执行 `git pull` 后重新运行 `./install.sh` 即可同步。重新安装会覆盖上述 `~/.codex` 文件和 `skills/` 中同名的用户级 skill，并只安装所选 profile 的那一份模型列表。

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

实际模型条目通常还需要完整的上下文窗口、推理等级、工具能力和服务端兼容性字段；可参考 [`models/deepseek.json`](models/deepseek.json)。每个 `slug` 应唯一；安装脚本读取 `catalog_sources` 中列出的模型文件。

迁移到新环境的最小流程是：安装 Codex CLI、完成认证、克隆本仓库、运行安装脚本。模型服务地址由 `--profile` 决定，端点数据在 [`install.sh`](install.sh)：默认指向 `https://api.deepseek.com/`，bearer token 写死在 deepseek 段落里；`--profile higress` 指向 `http://host.docker.internal:8080/v1/`，该端点不鉴权、无需任何密钥。目标环境必须能够访问所选端点的服务。技能安装到 `~/.codex/skills/`，由 Codex 从该目录发现。

## 配置要点与安全边界

当前配置有意开启了较高权限：

- `approval_policy = "never"`
- `sandbox_mode = "danger-full-access"`
- `web_search = "live"`
- 启用 memories、goals 和 multi-agent，最多 8 个并发线程

这适合个人信任的开发容器或隔离环境，不适合直接用于不受信任的代码、生产主机或含敏感数据的工作区。若环境风险不同，应先调整 `config.toml`，再运行安装脚本。

`auth.json` 仅保留在本机，不要强制添加。`install.sh` 现在把 `custom` provider 的 bearer token 写死在 `experimental_bearer_token` 并随仓库提交，因此本仓库含有一个凭据，应按私密仓库处理，不要公开分发或推送到公共远端；token 轮换或泄露时更新该字段。除此之外不要把其他 API 密钥写入模型 JSON 或 Git 历史。

## 故障排查

- `codex command was not found`：先运行 `./install-codex.sh` 或按官方方式安装 Codex CLI，并在运行脚本的 shell 中确认 `command -v codex`（新装后可能需要新 shell 刷新 PATH）。
- `jq is missing`：在没有 `apt-get` 或没有 root/`sudo` 的环境中，先手动安装 `jq`。
- `invalid model catalog fragment`：检查对应 JSON 是否合法，且顶层存在 `models` 数组，数组中每个条目都有非空字符串 `slug`。
- 安装后出现其他全局 Git 忽略规则丢失：从安装前的备份恢复 `~/.config/git/ignore`，并保留其中的 `.codex` 条目。

提交前可运行最小检查：

```bash
bash -n install.sh
bash -n install-codex.sh
jq -e '.models | type == "array" and all(.[]; (.slug | type) == "string" and (.slug | length) > 0)' models/*.json
git diff --check
```
