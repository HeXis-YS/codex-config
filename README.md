# codex-config

个人使用的 Codex 配置仓库，用 Git 管理运行配置、全局 Agent 规则、模型目录和技能。通过同一个安装脚本，可在不同开发环境中恢复配置，或切换模型服务后端。

本仓库面向个人信任的开发容器或隔离沙箱。配置与安装脚本包含特定的权限、网络和 Git 设置；首次使用前请先阅读下节。

## 安装前确认

当前 [config.toml](config.toml) 设置 `approval_policy = "never"` 和 `sandbox_mode = "danger-full-access"`。应由外层容器或沙箱提供所需隔离，不宜直接用于生产主机、不受信任的代码或含敏感数据的工作区。环境不同，应先调整配置。

**安装会覆盖以下用户配置：**

- `~/.codex/config.toml`、`AGENTS.md`、`models.json`，以及仓库技能中同名的安装文件。
- 全局 Git 身份：`user.name = HeXis-YS`、`user.email = 40174982+HeXis-YS@users.noreply.github.com`。
- 整个 `~/.config/git/ignore`，内容替换为单行 `.codex`。已有忽略项不会保留，请先备份，安装后按需合并。

四个后端在 [install.sh](install.sh) 中都使用 `sbx-cs-*` 占位 token；搜索 MCP 的 `DEEPSEEK_API_KEY` 也是占位值。它们不代表有效凭据，不能据此认为官方端点可直接使用。使用前按实际后端配置认证，且不要将真实密钥提交到 Git。`auth.json` 已被仓库 [.gitignore](.gitignore) 忽略；占位值也不能证明 Git 历史中从未包含凭据。

## 安装与切换后端

### 前置条件

安装脚本需要 Bash、Git、Codex CLI、`jq`，以及 `cp`、`install`、`mktemp` 等常见类 Unix 工具。

- `codex` 和 `git` 必须在 `PATH` 中。脚本不安装或更新 Codex CLI。
- 缺少 `jq` 时，脚本尝试通过 `apt-get` 安装，使用 root 或 `sudo` 权限；不具备这些条件时，需先手动安装。
- 目标环境必须能够访问所选后端，并具备该后端要求的认证。
- 若保留默认搜索 MCP，还需满足[搜索与代理](#搜索与代理)中的运行条件；安装脚本不安装这些依赖。

### 执行安装

```bash
git clone <repository-url> codex-config
cd codex-config
./install.sh
```

默认使用 `deepseek`。切换后端时重新运行安装脚本：

```bash
./install.sh --profile highgo
./install.sh --profile openlux
./install.sh --profile cc-switch
```

每次安装将后端地址、认证值与模型目录成套替换；所有后端的 provider ID 均为 `custom`。脚本按当前 `HOME` 确定安装位置，不根据 `CODEX_HOME` 改变目标目录。

| Profile | 服务地址 | 模型目录来源 |
| --- | --- | --- |
| `deepseek`（默认） | `https://api.deepseek.com/` | [models/deepseek.json](models/deepseek.json)：`deepseek-flash` |
| `highgo` | `http://host.docker.internal:8080/v1/` | [models/highgo.json](models/highgo.json)：`deepseek-v4.1-flash`、`ccs-highgo/ZHIPU/GLM-5.3-Flash` |
| `openlux` | `https://api.openlux.ai/v1/` | 每次安装执行 `codex debug models --bundled`，读取当前 CLI 自带的目录 |
| `cc-switch` | `http://host.docker.internal:15721/v1/` | [models/cc-switch.json](models/cc-switch.json)：GPT、Claude 和 DeepSeek 的六个预设条目 |

配置不固定 `model` 或 `model_reasoning_effort`，默认模型按目录中较小的 `priority` 值选择。三个仓库目录的首选模型分别是 `deepseek-flash`、`deepseek-v4.1-flash` 和 `gpt-6-luna`；OpenLux 随所安装 CLI 的目录变化。

OpenLux 不在仓库保存模型快照，也不从服务端的 `/v1/models` 生成目录。CLI 自带清单不证明相应后端支持其中全部模型。HighGo 的网关模型名需要与实际 provider 命名一致；其 DeepSeek 条目的提示词字段与默认 DeepSeek 目录不同，不能视为仅改名的副本。

**安装成功只证明文件已分发，不证明后端能够返回结果或正确执行工具。** 已有后端兼容问题及历史验证范围见 [models/README.md](models/README.md)。其中 CC Switch 默认模型有 2026-10-21 的工具调用验证记录，其他模型未全部验证；OpenLux 仅有历史请求返回 401 的记录。这些记录不能作为后端当前可用性的保证。

### 安装结果

| 仓库来源 | 安装位置 |
| --- | --- |
| `config.toml`，按 profile 填入 provider 参数 | `~/.codex/config.toml` |
| `AGENTS.global.md` | `~/.codex/AGENTS.md` |
| 所选模型目录 | `~/.codex/models.json` |
| `skills/<name>/` 中的全部文件 | `~/.codex/skills/<name>/` |
| `proxy-setup.cjs`（源文件存在时） | `~/.codex/proxy-setup.cjs` |

根目录 `AGENTS.md` 是本仓库的开发规则，不会安装。`README.md`、`docs/` 和维护脚本也不随安装器分发。

脚本先检查输入与依赖，再在 `~/.codex/` 下暂存全部制品。准备成功后依次安装文件与技能、设置 Git 配置、清理旧文件，最后执行 `codex app-server daemon restart`。重启失败只打印警告，不将已完成的文件安装判为失败。

准备阶段失败时，已有配置、模型、技能和 Git 用户配置保持原样；首次安装可能留下新建的空目录。暂存目录在成功、错误退出或收到 HUP、INT、TERM 时清理。配置、模型和全局规则逐文件原子替换，整个安装不是一次原子操作；安装阶段失败可能留下部分更新。

### 旧安装迁移

仓库管理的技能从 `~/.agents/skills/` 迁移到 `~/.codex/skills/`。若新位置已有同名技能，旧位置的副本会被删除，再安装仓库文件；未管理的其他技能不会因此删除。技能安装采用复制覆盖，同名文件会更新，目标目录中额外存在的文件不会统一清空。

安装器从新旧技能目录清理已退役的 `analyze`、`write-code`、`use-git`、`write-lessons`、`write-report` 和 `deliver-thoroughly`，并移除以下旧文件：

- `~/.codex/higress.config.toml`、`gateway.config.toml`。
- `~/.codex/models.gateway.json`、`models.higress.json`。
- `~/.local/bin/update-codex`。CLI 更新改用 `codex update`。

## 配置与技能

### 全局规则与工作记录

[AGENTS.global.md](AGENTS.global.md) 定义协作、实施、验证、工作区保护和交付边界；规则动机与取舍见[设计依据](docs/agent-rule-rationale.md)。安装后的 `~/.codex/AGENTS.md` 是全局生效副本，仓库根目录 [AGENTS.md](AGENTS.md) 只约束本仓库维护。

通用规则要求减少无意义、重复的提问，同时将未确定的需求、取舍和授权交给用户决定。文档对行为或实现约定的描述与代码冲突时，以代码为准，并逐项报告发现的不匹配。

配置显式启用 `memories`、`multi_agent_v2` 和 `tools.update_plan.enabled`。会话计划用于协调当前工作；`.codex/todo.md` 用于跨会话交接及需要持久保存恢复依据的检查点，不逐步复制计划。当前会话能否调用 `update_plan`，仍以实际工具列表为准。

事故记录按明确请求处理，不作为日常启动或恢复输入，也不自动生成项目规则。`.codex/` 存放本地工作记录与验证输出，默认不提交。模型专用模块的更严格要求按其适用范围执行。

### 可用技能

安装器分发 [skills/](skills/) 下的全部技能。每个包包含 `SKILL.md`、`agents/openai.yaml` 和必要资源。

| 技能 | 用途与调用方式 |
| --- | --- |
| [write-docs](skills/write-docs/SKILL.md) | 撰写、改写、翻译与审校中英文文档、注释、报告和说明。可显式调用 `$write-docs`；不因普通任务包含文字输出就自动启用。 |
| [write-prompt](skills/write-prompt/SKILL.md) | 编写、评审、重写或调试模型与 Agent 提示词，处理示例、结构和输出要求。 |
| [eli5](skills/eli5/SKILL.md) | 按指定读者的理解水平解释概念、代码或错误。 |
| [write-todo](skills/write-todo/SKILL.md) | 创建或更新交接笔记，保存目标、授权、状态、下一动作及恢复依据。 |
| [correct-course](skills/correct-course/SKILL.md) | 仅显式调用 `$correct-course`：暂停推进与写入、保留现场、核对目标和事实，确认方向后恢复。 |
| [record-incident](skills/record-incident/SKILL.md) | 仅显式调用：记录客观事故事实，区分记录者与造成事故的 Agent；各 Agent 的会话 ID 和模型写在同一行。 |
| [score-incident](skills/score-incident/SKILL.md) | 仅显式调用：按风险与影响评分，记录评分者身份和模型；确认并写入评分后，将事故改为“已评分”。 |
| [avoid-overengineering](skills/avoid-overengineering/SKILL.md) | 要求 GPT 始终加载：防止移除功能后追加永久禁令或测试，并约束无依据的新增测试。 |
| [constrain-opus](skills/constrain-opus/SKILL.md) | 仅要求 Opus 5.5 始终加载：约束文件编辑、审批、问题处理、任务记录、验证和报告；强制条款优先于既定全局规则。 |

模型专用模块对其他模型仅在明确选用时加载。加载要求属于提示词约束，不能保证实际加载或遵循，也不能覆盖系统与 harness 的强制限制；未进行模型行为效果实测。Opus 模块替代原先面向所有 Claude 的 `deliver-thoroughly`，Fable 不再自动加载。当前使用评价仍只推荐 Opus 5.5 用于头脑风暴、文档和代码审计，详见[模型使用反馈](docs/model-usage-feedback.md)。

技术报告统一由 `write-docs` 处理，包括缺陷修复、性能变化和阶段总结；中英文共用语义审查流程，按需读取语言和文体参考。设计来源见[文档能力依据](docs/write-docs-rationale.md)和[提示词技能来源](docs/write-prompt-sources.md)。

ELI5 收录自 [DreambigOu/ELI5 的 a766623 提交](https://github.com/DreambigOu/ELI5/tree/a766623b062331fdde53467001379b4ddf3acc2f)，保留上游正文与 [MIT 许可证](skills/eli5/LICENSE)，并补充 Codex 元数据。

### 搜索与代理

`config.toml` 声明 provider 支持独立网页搜索，并配置 `ds-websearch-mcp`，由 `npx -y ds-websearch-mcp` 启动。后者需要 Node.js、`npx`、可用的服务认证，以及能被预加载脚本解析到的 `undici` 模块。

MCP 的 `NODE_OPTIONS` 当前写为 `--require /home/agent/.codex/proxy-setup.cjs`。安装器实际复制到 `$HOME/.codex/proxy-setup.cjs`；在其他用户目录下使用时，需先调整模板中的绝对路径。

[proxy-setup.cjs](proxy-setup.cjs) 在 `HTTP_PROXY` 和 `HTTPS_PROXY` 均未设置时，默认使用 `http://gateway.docker.internal:3128`，并设置本地地址的 `NO_PROXY`。存在代理配置时，脚本通过 `undici.EnvHttpProxyAgent` 设置全局 dispatcher。目标环境需要能够访问该代理，或预先配置适用的代理设置；不使用该 MCP 时可从配置模板中移除相应段落。

## 日常维护

修改仓库文件后检查差异并提交。在其他环境拉取后重新安装，并显式选择所需 profile：

```bash
git pull
./install.sh --profile cc-switch
```

不带 `--profile` 会重新使用默认 DeepSeek，不会沿用上一次选择。

更新 CLI 使用 `codex update`。安装器的 daemon 重启用于加载配置；需要把当前 CLI 包用于 daemon 时，使用 `codex app-server daemon update --from-cli`，这可能中断运行中的工作。查看 CLI 与 daemon 版本可运行 `codex app-server daemon version`。

模型目录的顶层结构为 `{ "models": [...] }`，条目使用唯一的非空 `slug`。实际可用条目还需要上下文窗口、推理等级、工具能力和服务端兼容字段；以现有目录及 [models/README.md](models/README.md) 为维护依据。安装器只校验基础结构，不能保证服务端兼容性，也不会自动合并多个目录。

### 核对安装结果

实际安装后，可检查全局规则副本和已安装模型：

```bash
cmp AGENTS.global.md "$HOME/.codex/AGENTS.md"
jq -r '.models[].slug' "$HOME/.codex/models.json"
```

维护制品时使用仓库内的隔离验证入口，不必反复覆盖当前用户环境：

```bash
# 全局规则与工具配置
python3 scripts/verify-rules-install.py

# 同时核对指定技能；--skill 可重复
python3 scripts/verify-rules-install.py --skill record-incident --skill score-incident

# 核对新技能及旧包清理；--retired-skill 可重复
python3 scripts/verify-rules-install.py --skill constrain-opus --retired-skill deliver-thoroughly

# 四种 profile、安装产物、迁移和失败处理
python3 scripts/verify-rules-install.py --installer

# 计划工具的配置开关与一次实际工具执行
python3 scripts/verify-plan-tool.py
```

`verify-rules-install.py` 需要 Python 3.11+、Bash、Git、`jq` 和 Codex。它在隔离用户目录中运行 `install.sh`、拦截 daemon 重启，核对全局规则及指定技能的文件内容，结束后清理临时安装。日志包含工具版本、代码版本、工作区差异指纹及原始输出，保存在 `.codex/runs/rules-install-*.log`。

`--installer` 还核对真实 CLI 是否接受配置、文件权限、旧路径迁移、准备失败时旧文件保留，以及 daemon 重启失败仅警告。可加 `--baseline <Git引用>`，以当前制品为相同输入比较指定版本安装器的配置、模型与全局规则输出。OpenLux 使用真实 CLI 当次提供的 bundled 目录作为验证输入。

`verify-plan-tool.py` 需要 Python 3.11+ 和 Codex，使用本地 API 响应核对工具开关及执行，日志保存在 `.codex/runs/plan-tool-*.log`。它不调用模型服务，也不验证规划质量或上下文压缩后的恢复能力。安装验证同样不能代替模型端到端验证。

提交前按改动运行必要检查；安装器或模型目录变化时可使用：

```bash
bash -n install.sh
jq -e '.models | type == "array" and all(.[]; (.slug | type) == "string" and (.slug | length) > 0)' models/*.json
git diff --check
```

## 故障排查

| 现象 | 检查与处理 |
| --- | --- |
| 找不到 `codex` 或 `git` | 安装相应工具，确认命令位于 `PATH`；新安装后可重新打开 shell。 |
| `jq is missing` | 确认有 `apt-get` 和 root 或 `sudo` 权限，否则手动安装 `jq`。 |
| `invalid model catalog fragment` | 检查模型 JSON 顶层及条目结构；OpenLux 还需确认 CLI 能输出 bundled 目录。 |
| daemon 重启警告 | 文件安装已完成。检查 `codex app-server daemon version` 与 daemon 状态，处理后再重启。 |
| 后端返回 401，或工具调用变成普通文本 | 先核对认证及后端模型支持，再参照 [models/README.md](models/README.md) 检查工具兼容字段；安装退出码为 0 不能证明工具调用成功。 |
| MCP 提示预加载文件或 `undici` 不存在 | 核对 `NODE_OPTIONS` 的绝对路径、脚本是否安装，以及 Node.js 能否解析 `undici`。 |
| 全局 Git 身份或忽略规则被覆盖 | 按安装前的备份恢复所需设置；忽略文件中按需保留 `.codex`。 |

## 仓库维护资料

- [AGENTS.md](AGENTS.md)：本仓库的开发与制品维护规则。
- [全局规则设计依据](docs/agent-rule-rationale.md)：来源、适用边界、历史取舍和复核场景。
- [模型使用反馈](docs/model-usage-feedback.md)：实际使用评价、转述及证据限制。
- [Opus 5.5 事故摘要](docs/opus-5.5-security-incident.md)：脱敏事实、影响及未知项。
