# AGENTS.md - 规则与 Skill 维护规范

本文件的作用域是 `codex-config` 仓库的维护。`AGENTS.global.md` 和 `skills/*` 是本仓库产出的可分发制品，根目录 `AGENTS.md` 是项目级开发规则。

## 制品契约

- `AGENTS.global.md` 是完整的通用默认规则，安装后作为用户级 `AGENTS.md` 独立生效。
- 每个 `skills/<name>/` 是可单独安装的能力包，由自身元数据、正文和包内资源构成完整契约。
- `AGENTS.global.md` 与各 skill 是并列制品，分别完整表达自己的行为契约。
- `install.sh` 的分发范围是 `AGENTS.global.md` 和 `skills/*`，根目录 `AGENTS.md` 保持项目级作用域。

## 规则归属

- 以 Agent 最早必须知道一条规则的时点作为存放位置的判定标准。
- 在能力选择之前就必须生效，或不论使用何种能力都成立的通用契约，写入 `AGENTS.global.md`。
- 选中某项能力后才需要的领域知识、执行流程、分支条件和交付方法，写入对应 skill。
- Skill 的发现由 name 和 description 完成；`AGENTS.global.md` 专注于表达通用契约。

## Skill 编写

- `name` 使用简短、稳定且动作导向的名称。
- `description` 仅描述 skill 能完成的工作，包括处理对象、主要动作和有意义的能力边界。Agent 应能仅凭 name 和 description 识别该能力。
- `SKILL.md` 正文假定该能力已被选中，完整描述执行所需的流程、判定条件、安全边界、验证和交付标准。
- Skill 的执行依赖由用户任务、作用对象、可观察状态和包内资源完整表达，使其在其他合理的全局规则下仍能独立执行。
- Skill 只包含完成该能力所需的程序性知识、领域知识和可复用资源。
- `agents/openai.yaml` 的 display name、short description 和 default prompt 与 `SKILL.md` 的当前能力保持一致。

## 表达与维护

- 规则优先正向定义应执行的行为、触发条件和预期结果。禁止和例外只用于表达必要边界。
- 每条规则对应可观察的行为，并使用可验收的对象、条件和动作表达。
- 新证据优先用于修订、合并或替换已有规则。新条款只用于已有结构无法表达的独立契约。
- 项目规则只保留稳定、可复用的制品维护契约。一次性背景、实施过程和过往问题记录到 Git 历史或任务笔记。
- 修改全局行为时同步递增 `AGENTS.global.md` 的版本号。

## 变更审查

- 新增或移动规则时，用最早生效时点验证其存放位置。
- 拆分或重写时对照原契约的作用域、触发条件、默认行为、例外和停止条件，确认每项语义均被明确保留、修订或删除。
- 修改 skill 时同步检查 `SKILL.md`、包内资源和 `agents/openai.yaml`，并使用当前可用的 skill validator。
- 分别验证 `AGENTS.global.md` 的独立完整性，以及每个 skill 在其他合理全局规则下的可发现性与可执行性。
- 修改可分发制品后运行 `install.sh` 并核对安装副本；修改项目规则时核对安装范围。
- 完成前运行 `git diff --check`；安装器变化时同时运行 `bash -n install.sh`。
