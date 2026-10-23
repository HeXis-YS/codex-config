# codex-config

个人使用的 Codex 配置仓库。配置、全局 Agent 规则、个人技能和自定义模型目录都通过 Git 管理，便于持续迭代，并在新的环境中快速恢复相同的工作方式。

## 仓库内容

| 路径 | 作用 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 本仓库的项目级开发规则，用于约束可分发配置、规则和技能的编写与审查；不会被安装。 |
| [`config.toml`](config.toml) | 唯一的 Codex 全局配置：网页搜索开关、Memory、多 Agent 设置和模型目录指向；模型上下文窗口取自模型目录条目。`[model_providers.custom]` 是带占位符的 provider 模板，由 `install.sh` 按所选 profile 替换其中的 `name`、`base_url` 和 bearer token。 |
| [`AGENTS.global.md`](AGENTS.global.md) | 全局 Agent 规则的仓库源文件；安装时复制为 `~/.codex/AGENTS.md`。文件名带有 `.global`，使它不会在本仓库中作为项目级指令与 `AGENTS.md` 同时加载。 |
| [`docs/agent-rule-rationale.md`](docs/agent-rule-rationale.md) | 全局规则的设计依据、适用边界、取舍与复核场景，供维护规则时查阅；不会被安装。 |
| [`docs/write-docs-rationale.md`](docs/write-docs-rationale.md) | 中英文文档能力的设计依据、参考材料取舍和复核场景；不会被安装。 |
| [`models/`](models/) | 自定义模型目录。每个 JSON 文件都是一个 `{ "models": [...] }` 模型目录片段；安装时按所选 profile 把对应的一份安装为 `~/.codex/models.json`（默认 `deepseek.json`）；`openlux` 没有对应的文件，它的模型列表在安装时从 Codex CLI 现取。字段兼容性与验证方法见 [`models/README.md`](models/README.md)。 |
| [`install.sh`](install.sh) | 将配置、全局规则、个人技能和模型目录安装到当前用户环境，并清理本仓库不再分发的旧 skill。 |
| [`scripts/verify-rules-install.py`](scripts/verify-rules-install.py) | 全局规则与指定 skill 的隔离安装核对入口，比较安装副本并保留运行日志。 |
| [`skills/`](skills/) | 随仓库版本化的个人技能；安装脚本会安装其中的全部 skill。 |
| [`skills/eli5/`](skills/eli5/) | 随仓库安装的 ELI5 技能，收录自 [DreambigOu/ELI5 的 a766623 提交](https://github.com/DreambigOu/ELI5/tree/a766623b062331fdde53467001379b4ddf3acc2f)，保留上游正文和 MIT 许可证，并补充 Codex 元数据。 |
| [`.gitignore`](.gitignore) | 忽略本地认证文件 `auth.json`。 |

仓库会把 `custom` provider 的 bearer token 写进 `install.sh` 里各 profile 的 `experimental_bearer_token`（highgo 用的是占位值 `sbx-cs-highgo`），不再依赖环境变量；因此本仓库自身包含凭据，应作为私密仓库对待，不要公开分发或推送到公共远端。其余登录状态（`auth.json`）仍只保存在本机。

## 快速安装

在目标环境中先安装 Codex CLI 并完成认证，然后执行：

```bash
git clone <repository-url> codex-config
cd codex-config
./install.sh
```

之后用 `codex update` 刷新 CLI；本仓库不再分发 CLI 安装脚本。

仓库只维护一份配置。安装时 `install.sh` 把 `config.toml` 里 `[model_providers.custom]` 模板的 `name`、`base_url` 和 bearer token 替换为所选后端的取值，并安装对应 profile 的模型列表。`--profile <name>` 可选 `deepseek`（默认，指向 `https://api.deepseek.com/`）、`highgo`（指向 `http://host.docker.internal:8080/v1/`，token 为占位值 `sbx-cs-highgo`）、`openlux`（指向 `https://api.openlux.ai/v1/`）或 `cc-switch`（指向 `http://host.docker.internal:15721/v1/`，token 为占位值 `sbx-cs-cc-switch`）。四种情况下 provider id 都是 `custom`，既有的会话记录不会失效。

脚本使用当前用户的 `HOME`，安装结果位于：

```text
~/.codex/config.toml   <- config.toml（[model_providers.custom] 填入所选后端的 name、base_url 与 token）
~/.codex/AGENTS.md     <- AGENTS.global.md
~/.codex/models.json   <- models/<profile>.json 安装后的目录
~/.codex/skills/write-todo/
                         <- skills/write-todo/
~/.codex/skills/record-incident/
                         <- skills/record-incident/
~/.codex/skills/score-incident/
                         <- skills/score-incident/
~/.codex/skills/write-prompt/
                         <- skills/write-prompt/
~/.codex/skills/write-docs/
                         <- skills/write-docs/
~/.codex/skills/eli5    <- skills/eli5/
```

### 前置条件

- Bash、`cp`、`install`、`mktemp` 等常见类 Unix 工具。
- `codex` 命令已安装并位于 `PATH` 中（之后用 `codex update` 刷新；新装后若当前 shell 仍找不到 `codex`，先打开新 shell）。
- `git` 命令已安装并位于 `PATH` 中。
- `jq`。若缺少 `jq`，脚本会在检测到 `apt-get` 时尝试使用 root 或 `sudo` 自动安装；其他系统请先手动安装。

### 安装脚本的行为

制品准备成功后，脚本会在安装阶段设置当前用户的全局 Git 身份：

```text
git config --global user.email "40174982+HeXis-YS@users.noreply.github.com"
git config --global user.name "HeXis-YS"
```

这会覆盖已有的全局 Git 身份配置。

`install.sh` 按以下顺序执行：

1. 解析 profile，检查源文件、模板占位符、每个 skill 的正文及元数据，再检查依赖；缺少 `jq` 时按前置条件尝试安装。
2. 在 `~/.codex/` 下创建独立暂存目录。用 `sed` 替换配置模板中的 provider 名称、URL 和 token，并检查占位符残留。
3. 将所选 `models/<profile>.json` 复制到暂存目录并校验；`openlux` 在此阶段执行 `codex debug models --bundled`，现取 CLI 自带的官方目录。每次只准备一份模型目录，不进行合并。随后准备全局规则、代理辅助文件和全部本地 skill（包括 ELI5）。
4. 全部制品准备成功后，安装配置、模型和全局规则，迁移并安装技能，然后设置 Git 身份及 `~/.config/git/ignore`。
5. 清理本仓库已退役的 `analyze`、`write-code`、`use-git`、`write-lessons`、`write-report` 技能，以及旧的 `~/.codex/higress.config.toml`、`gateway.config.toml`、`models.gateway.json`、`models.higress.json` 和 `~/.local/bin/update-codex`。CLI 更新使用 `codex update`。
6. 重启本地 app-server daemon，使其读取新配置与模型目录；无法重启时只打印警告，安装仍视为成功。

准备阶段失败时，已有配置、模型、技能和 Git 用户配置保持原样；首次安装可能留下新建的 `~/.codex/` 空目录。暂存目录在成功、错误退出或收到 HUP、INT、TERM 信号时清理。配置和模型使用同一文件系统内的重命名完成单文件原子替换；安装阶段仍逐项写入，后续写入失败可能留下部分更新。

> 如果检测到旧的 `~/.agents/skills/`，脚本会将本仓库管理的技能和 ELI5 迁移到 `~/.codex/skills/`；其他未管理的技能不会被删除。

> **注意：** 当前脚本会用单行 `.codex` 覆盖整个 `~/.config/git/ignore`，不会保留其中原有的全局忽略规则。运行前请检查并备份该文件；如果依赖其他全局忽略项，请在安装后恢复或合并它们。

## 验证安装

```bash
test "$(git config --global user.email)" = "40174982+HeXis-YS@users.noreply.github.com"
test "$(git config --global user.name)" = "HeXis-YS"
test ! -e "$HOME/.local/bin/update-codex"
test -f "$HOME/.codex/config.toml"
grep -q '^model_provider = "custom"$' "$HOME/.codex/config.toml"
test "$(grep -c '^\[model_providers\.' "$HOME/.codex/config.toml")" = 1
test ! -e "$HOME/.codex/higress.config.toml"
test ! -e "$HOME/.codex/models.higress.json"
test -f "$HOME/.codex/AGENTS.md"
cmp AGENTS.global.md "$HOME/.codex/AGENTS.md"
test -f "$HOME/.codex/skills/write-todo/SKILL.md"
test -f "$HOME/.codex/skills/record-incident/SKILL.md"
test -f "$HOME/.codex/skills/score-incident/SKILL.md"
test -f "$HOME/.codex/skills/write-prompt/SKILL.md"
test -f "$HOME/.codex/skills/write-docs/SKILL.md"
test -f "$HOME/.codex/skills/eli5/SKILL.md"
test ! -e "$HOME/.codex/skills/analyze" && test ! -L "$HOME/.codex/skills/analyze"
test ! -e "$HOME/.codex/skills/write-code" && test ! -L "$HOME/.codex/skills/write-code"
test ! -e "$HOME/.codex/skills/use-git" && test ! -L "$HOME/.codex/skills/use-git"
test ! -e "$HOME/.codex/skills/write-lessons" && test ! -L "$HOME/.codex/skills/write-lessons"
test ! -e "$HOME/.codex/skills/write-report" && test ! -L "$HOME/.codex/skills/write-report"
test ! -e "$HOME/.agents/skills/write-report" && test ! -L "$HOME/.agents/skills/write-report"
jq -r '.models[].slug' "$HOME/.codex/models.json"
```

安装脚本分发的自定义模型：

| 模型列表 | 对应 profile 与端点 | 模型 |
| --- | --- | --- |
| `models/deepseek.json` | 默认（`custom` 指向 `https://api.deepseek.com/`） | `deepseek-flash` |
| `models/highgo.json` | `--profile highgo`（`custom` 指向 `http://host.docker.internal:8080/v1/`） | `deepseek-v4.1-flash`、`ccs-highgo/ZHIPU/GLM-5.3-Flash` |
| `openlux`（仓库中无文件，安装时生成） | `--profile openlux`（`custom` 指向 `https://api.openlux.ai/v1/`） | 安装时执行 `codex debug models --bundled`；当前 CLI 0.162.0 返回 11 个官方模型：`gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-daybreak-blue-latest`、`gpt-daybreak-red-latest`、`codex-auto-review` |
| `models/cc-switch.json` | `--profile cc-switch`（`custom` 指向 `http://host.docker.internal:15721/v1/`） | `gpt-6-luna`、`gpt-6.1-sol`、`gpt-6-astra`、`ccs-openlux-claude/claude-opus-5-5`、`ccs-openlux-claude/claude-fable-5-1`、`ccs-deepseek/deepseek-flash` |

配置里不写 `model` 与 `model_reasoning_effort`：默认模型随所装的模型列表变化，取其中 `priority` 最小的条目（`deepseek.json` → `deepseek-flash`，`highgo.json` → `deepseek-v4.1-flash`，`openlux.json` → `gpt-6.1-sol`，`cc-switch.json` → `gpt-6-luna`）。所以端点和模型列表必须成套更换，`--profile` 做的正是这件事。

该端点的 `/v1/models` 仍列出 4 个 slug，但字段由网关自行填充（`comp_hash` 取 `cc-switch` 等网关自有值），不能直接作为模型目录，`models/highgo.json` 因此手工维护：DeepSeek 条目取自 `models/deepseek.json` 的唯一条目（只改 `slug` 与 `display_name`，其余字段逐字段一致），GLM 条目按当前 CLI 模型目录的字段结构维护。GLM 的 slug 使用网关的聚合名 `ccs-<provider>/<model>`，前缀必须与 CC Switch 当前的 provider 命名一致。该端点本身不校验 Authorization 头，因此 `[model_providers.custom]` 不声明 `env_key`（声明后 Codex 会因缺少环境变量而拒绝启动），token 只登记占位值 `sbx-cs-highgo`，不代表真实权限；模型能否真正返回由 CC Switch 上游的配额与密钥状态决定。切到该后端：

```bash
./install.sh --profile highgo
```

`openlux` profile 在仓库里没有模型文件：每次安装都用 `codex debug models --bundled` 从当前 CLI 读取官方目录，所以不存在快照过期的问题，模型清单始终与安装的 CLI 版本一致。清单是 CLI 自带目录原样，不是 OpenLux 端点自报的模型；`https://api.openlux.ai/v1/models` 与 `/v1/responses` 在沙箱内用仓库里的 key 请求都返回 401（`Invalid token`），所以这个 profile 的端到端可用性还没有实测证据。

`cc-switch` profile 使用 `models/cc-switch.json` 中的 6 个聚合模型，安装命令为 `./install.sh --profile cc-switch`。2026-10-21 已在临时 `HOME` 与 `CODEX_HOME` 中通过真实请求验证默认模型 `gpt-6-luna`：`codex exec` 让 shell 执行了 `echo tool-ok` 并返回 `tool-ok`，没有把工具调用渲染成文本。该端点的 `/v1/models` 当时另列出 `ccs-deepseek/deepseek-v4-pro`，但仓库预设未包含该条目；其余非默认模型尚未逐一做端到端验证。

## 日常迭代与迁移

修改配置、规则、`skills/` 或 `models/*.json` 后提交 Git；在其他环境执行 `git pull` 后重新运行 `./install.sh` 即可同步。重新安装会覆盖上述 `~/.codex` 文件和 `skills/` 中同名的用户级 skill，并只安装所选 profile 的那一份模型列表。

### 任务恢复

任务记录按 [`AGENTS.global.md`](AGENTS.global.md) §6 的恢复需要启用：预计跨会话、交接、上下文压缩或需要高风险检查点时提前建立 `.codex/todo.md`；执行中出现影响后续工作的关键决策、失败路径、阻塞或未完成依赖且不易直接恢复时，立即补建。能从当前请求和文件状态直接恢复的短问答或局部修改，无需因调用多个工具而建档。

通过 `$write-todo` 记录可验证步骤和唯一下一动作，在状态变化后及时更新，并保留已完成记录。记录使用 Markdown task list：已完成项用 `- [x]`，待办和唯一下一步用 `- [ ]`。恢复时先定位活动任务与相关事故，出现证据缺口或矛盾再补读历史；以用户最新指令和可观察工作区为准，其次是 todo，最后才是 Memory。`.codex/` 仍是本地工作流目录，不提交到仓库。各项边界的原因见[设计依据](docs/agent-rule-rationale.md)。

### 文档与说明性文字

[`write-docs`](skills/write-docs/SKILL.md) 用于中英文技术文档、注释、报告、规则说明和面向用户文字的撰写、翻译与审校。它共用语义保真和审校流程，按需读取中文、英文及文体参考；普通任务不会仅因有文字输出就自动启用。可以直接调用 `$write-docs`，例如“用中文改写这份安装指南”或“Review this English README for clarity”。

技术报告统一使用 `write-docs`，例如“为这些提交编写阶段总结”。它按需读取[技术报告参考](skills/write-docs/references/technical-reports.md)，覆盖缺陷修复、性能变化和阶段总结的证据、数据条件及结论边界；默认在对话中输出 Markdown，指定文件时写入文件。提示词的行为设计由 `write-prompt` 负责。能力组织、参考来源和验收边界见[设计依据](docs/write-docs-rationale.md)。

### 模型与环境迁移

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

实际模型条目通常还需要完整的上下文窗口、推理等级、工具能力和服务端兼容性字段；可参考 [`models/deepseek.json`](models/deepseek.json)。每个 `slug` 应唯一；安装脚本按所选 profile 读取对应的 `models/<profile>.json`。字段兼容性约束与验证方法见 [`models/README.md`](models/README.md)。

迁移到新环境的最小流程是：安装 Codex CLI、完成认证、克隆本仓库、运行安装脚本。模型服务地址由 `--profile` 决定，端点数据在 [`install.sh`](install.sh)：默认指向 `https://api.deepseek.com/`，bearer token 写死在 deepseek 的 profile 字段；`--profile highgo` 指向 `http://host.docker.internal:8080/v1/`，该端点不鉴权，token 写占位值 `sbx-cs-highgo`；`--profile openlux` 指向 `https://api.openlux.ai/v1/`，bearer token 写在 openlux 的 profile 字段，模型清单在安装时从 CLI 现取；`--profile cc-switch` 指向 `http://host.docker.internal:15721/v1/`，token 写占位值 `sbx-cs-cc-switch`。目标环境必须能够访问所选端点的服务。技能安装到 `~/.codex/skills/`，由 Codex 从该目录发现。

## 配置要点与安全边界

当前配置有意开启了较高权限：

- `approval_policy = "never"`
- `sandbox_mode = "danger-full-access"`
- full-access 沙箱下使用默认的 live web search
- 显式启用 memories 和 multi-agent v2；goals 与 multi-agent 使用 Codex 默认值

这适合个人信任的开发容器或隔离环境，不适合直接用于不受信任的代码、生产主机或含敏感数据的工作区。若环境风险不同，应先调整 `config.toml`，再运行安装脚本。

`auth.json` 仅保留在本机，不要强制添加。`install.sh` 现在把 `custom` provider 的 bearer token 写死在四个 profile 的 `experimental_bearer_token` 并随仓库提交；其中 highgo 的 `sbx-cs-highgo` 与 cc-switch 的 `sbx-cs-cc-switch` 是占位值、不是可用凭据，真实凭据是 deepseek 与 openlux 两个，因此本仓库含有两个凭据，应按私密仓库处理，不要公开分发或推送到公共远端；token 轮换或泄露时更新对应字段。除此之外不要把其他 API 密钥写入模型 JSON 或 Git 历史。

## 故障排查

- `codex command was not found`：先按官方方式安装 Codex CLI，并在运行脚本的 shell 中确认 `command -v codex`（新装后可能需要新 shell 刷新 PATH）。
- `could not restart the app-server daemon`：CLI 与配置已安装完成，只是 daemon 未重启，可用 `codex app-server daemon version` 查看状态。`restart` 只重启现有守护进程（没有在运行的 daemon 时会安装并启动一个），不更换 daemon 已固定的包版本；需要换版本时用 `codex app-server daemon update --from-cli`。
- `jq is missing`：在没有 `apt-get` 或没有 root/`sudo` 的环境中，先手动安装 `jq`。
- `invalid model catalog fragment`：检查对应 JSON 是否合法，且顶层存在 `models` 数组，数组中每个条目都有非空字符串 `slug`。
- 安装后出现其他全局 Git 忽略规则丢失：从安装前的备份恢复 `~/.config/git/ignore`，并保留其中的 `.codex` 条目。

提交前可运行最小检查：

```bash
bash -n install.sh
jq -e '.models | type == "array" and all(.[]; (.slug | type) == "string" and (.slug | length) > 0)' models/*.json
git diff --check
```

## 隔离安装核对

修改全局规则或 skill 后，根据需要选择核对范围：

```bash
# 核对全局规则
python3 scripts/verify-rules-install.py
# 核对全局规则与指定 skill
python3 scripts/verify-rules-install.py --skill write-docs
# 同时验证已退役 skill 的清理
python3 scripts/verify-rules-install.py --skill write-docs --retired-skill write-report
# 核对四种 profile、安装产物、旧路径迁移和准备阶段故障
python3 scripts/verify-rules-install.py --installer
```

需要 Python 3、Bash、Git、jq 和 Codex。入口默认以仓库根目录运行 `install.sh --profile deepseek`，仅为安装子进程设置隔离的用户目录和 Git 全局配置，并拦截 daemon 重启；运行后清理临时安装。它记录工具版本、代码版本、工作区差异指纹和原始输出到 `.codex/runs/rules-install-*.log`，核对安装后的 `AGENTS.md` 与仓库源文件逐字节一致。`--skill <名称>` 还核对指定 skill 的文件清单和逐字节内容；`--retired-skill <名称>` 在隔离环境中预置旧包，检查当前与旧安装目录中的清理结果，以及无关技能是否保留。两个参数都可重复传入。该核对覆盖制品分发；模型对规则与 skill 的实际遵循情况需要另外验证。

`--installer` 扩大为四种 profile 的核对：检查配置、模型、规则、技能、文件权限和真实 CLI 对配置的接受情况，并验证旧路径迁移、准备失败时旧文件保留、临时目录清理及 daemon 重启失败仅警告。可附加 `--baseline <Git引用>`，以当前仓库制品为相同输入，对比指定版本安装器生成的配置、模型和全局规则。OpenLux 验证使用真实 CLI 现取的 bundled 目录作为固定输入，记录目录指纹，并检查安装器调用该命令。
