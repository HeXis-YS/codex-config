# Git 操作参考

按需要阅读对应部分。以下命令说明语义与用法，不构成执行授权；示例中的占位符须替换为已核实的对象。参数支持以本机 Git 版本为准。

提交参数统一使用已核实的完整 hash；下文的 `<commit-oid>`、`<before-oid>`、`<source-oid>` 等均表示完整 commit hash。可用 `git status --porcelain=v2 --branch` 获取当前提交 hash，用 `git show-ref` 或 `git reflog --format=%H` 查找候选，再按具体 hash 检查内容。引用查询用于确定对象，不将符号或相对引用直接带入后续提交操作。

## HEAD、index 与工作区

| 操作 | 改变的状态 |
| --- | --- |
| `git add -- <path>` | 把工作区对应内容写入 index；通常包含该路径全部当前修改 |
| `git commit` | 默认从整个 index 创建提交，并更新当前分支或 detached HEAD |
| `git restore --source=<commit-oid> --staged -- <path>` | 从明确提交恢复对应 index 内容，不改变工作区 |
| `git restore -- <path>` | 默认从 index 恢复工作区，覆盖对应未暂存修改 |
| `git restore --source=<commit-oid> --staged --worktree -- <path>` | 同时恢复 index 与工作区；源中没有的跟踪路径可被删除 |
| `git reset --soft <commit-oid>` | 移动当前分支或 detached HEAD，保留 index 和工作区 |
| `git reset --mixed <commit-oid>` | 移动引用并重置 index，保留工作区 |
| `git reset --hard <commit-oid>` | 移动引用并重置 index 和工作区，也可能覆盖妨碍写入的未跟踪内容 |
| `git revert <commit-oid>` | 通过新提交反转指定提交的效果；可能冲突，不保证后续代码语义正确 |

取消暂存虽不改变工作区，也可能丢掉“只存在于 index 的版本”或已有差异块选择；不能把它当作不改变用户状态的查询操作。

新仓库可能尚无 HEAD 提交，此时部分比较和恢复命令不可用；先识别 unborn branch，不把正常初始状态误当损坏。

## 破坏性操作的预检与备份

执行前置条件由 [SKILL.md](../SKILL.md#破坏性操作的执行前置条件) 定义；本节说明如何取得检查证据。

### 保存未提交改动

使用 `git status --short --untracked-files=all`、`git diff` 和 `git diff --cached` 检查工作区、暂存区和未跟踪内容；涉及其他 worktree 时在对应目录检查。记录保存前 HEAD 及原操作目标的 OID，再选择 stash 或临时提交：

- **stash**：为本次保存写明用途，记录新建 stash 的 OID 并检查内容。有未跟踪文件时使用 `-u`；需要保存忽略文件时先核对范围，再选择 `-a` 或另行保存这些文件。默认 stash 不包含未跟踪和忽略文件，`--keep-index` 也不会清空已有暂存修改，不能据此宣称所有改动已移走。
- **临时提交**：明确标为临时保存，检查暂存内容后提交，并记录提交 OID 与保留引用。需要恢复原暂存边界时另行记录 index 对应状态；普通提交只保存文件快照，不保留原来的已暂存与未暂存划分。临时提交不得混入正式交付或随业务分支意外推送。
- 保存后核对状态与保存内容。存在冲突而无法 stash 或正常提交时，停止并报告；不能先 reset、abort 或丢弃文件来让保存成功。子模块内的修改需要在子模块中处理，父仓库的 stash 或提交不能替代。
- 恢复时按记录的 OID 定位 stash 或临时提交，不依赖可能已变化的 `stash@{0}`。核对恢复内容及所需暂存状态；发生冲突时保留保存对象并处理冲突，不立即删除备份。

### 原生 dry-run 与等效检查

| 操作 | 预检方法 |
| --- | --- |
| `clean` | 使用原生 `-n`，保留计划中的路径、`-d`、`-x`/`-X` 和排除规则，例如 `git clean -nd -- <path>`；读取全部待删除路径 |
| 强制推送或远端引用删除 | 使用同一远端、refspec 和 lease 条件的 `git push --dry-run ...`，同时核对远端当前引用和将被替换的历史 |
| `reset` | 没有通用 `--dry-run`。按具体模式比较目标提交、当前 HEAD、index 与工作区，列出将移出分支的提交和受影响内容；路径形式还需限定 pathspec |
| 用于丢弃内容的 restore/checkout | 没有通用 dry-run；比较指定来源和实际恢复位置，区分仅 index、仅工作区或两者，检查源中缺失而将被删除的路径 |
| amend/rebase、引用或 worktree 删除 | 检查涉及的提交范围、引用可达性和工作区状态，列明将重写或删除的对象；仅查看目录名或最新提交不足以代替预检 |

检查 reset 时，可按目标使用 `git log <target-oid>..<before-oid>`、`git diff --cached <target-oid>`、`git diff <target-oid>` 及带路径限制的比较，但要根据具体模式解释结果：这些命令分别展示提交集合或内容差异，不是完整的 reset 模拟器。`--hard` 还可能覆盖阻碍目标文件写入的未跟踪内容，普通 diff 不覆盖此类文件；涉及忽略文件、子模块或冲突状态时须补充相应检查，无法确认则停止。

dry-run 不保证稍后的操作一定成功，也不锁住状态；例如推送的远端检查和 hooks 可能只在正式执行时完成。等效预检必须明确标为只读影响检查，不声称执行了不存在的 `reset --dry-run`。

### 新建并核对备份分支

给每次操作使用新的 `backup/<purpose>-<timestamp>` 名称，重名时另取名称，不覆盖旧备份。先解析并记录实际受影响端点的完整 OID，再创建和核对：

```bash
git branch <new-backup-branch> <before-oid>
git rev-parse --verify refs/heads/<new-backup-branch>
```

第二条命令的结果必须等于记录的 `<before-oid>`。创建备份分支不需要切换工作区。

- reset、amend、rebase 等当前历史操作通常用执行前当前提交的完整 hash 建立备份。
- 删除其他分支或替换远端历史时，备份应指向被删除或替换端点的完整 hash，不能仅备份当前提交。必要时先获取该提交对象；操作只影响文件时也按主体要求为当前提交新建备份分支。
- unborn branch 无法直接 stash 或创建备份分支。若采用已获授权的临时提交保存改动，可在该提交上新建备份分支；否则停止并说明尚无可备份的提交，不能伪称备份完成。
- stash 或临时提交未覆盖、但预检显示会丢失的内容，须另存到操作范围外。需要保留暂存状态时，同时保存 index 对应版本及恢复依据；只导出普通 `git diff` 不包含仅暂存版本、未跟踪或忽略文件的全部状态。
- 记录备份分支、OID 和额外备份位置，核对可读取且覆盖所需内容。恢复方法必须与备份内容对应；操作完成不自动删除备份。

## 精确暂存

- 在支持交互的环境中，可用 `git add -p -- <path>` 选择差异块。
- 非交互环境可基于当前 index 到工作区的实际 diff，准备仅含目标修改的补丁，先用 `git apply --cached --check <patch-file>` 检查，再用 `git apply --cached <patch-file>` 应用。补丁应使用合法的上下文和 hunk 计数，不盲填交互回答。
- 应用后仍检查 `git diff --cached`。补丁适用不证明归属正确，也不排除 index 中已有其他修改。
- 若 index 含他人内容，不使用普通 `git commit` 顺便提交。对互不重叠、且整文件都属于本任务的已跟踪路径，可在确认语义后使用 `git commit --only -- <paths>`：它取这些路径的工作区内容，而不是这些路径的部分暂存版本；其他已暂存路径保留。
- 同文件混合修改且 index 也有他人版本时，先确定可保留各版本的隔离提交方式；无法可靠分离就询问，不以清空 index、整文件提交或自动 stash 兜底。

暂存和提交之间若有其他写入者，检查结果可能失效。存在实际竞争时协调写入或使用独立 worktree，而不是假定 Git 的短时 index 锁能保护整个多步流程。

## 分支、worktree 与远端

### 工作区隔离与清理

- 局部无冲突的任务可原位完成；并行、共享文件冲突或独立验证需要隔离时使用 worktree。先识别已有隔离和宿主管理方式，避免重复创建。
- 创建前明确起点、目标分支，以及是否需要转移未提交修改；新 worktree 通常从提交建立，不会自动携带这些修改。
- 编辑、暂存和验证须指向目标工作区。shell 的 `cd` 不保证其他工具切换，必要时使用明确的工作目录或绝对路径。
- worktree 独立保存工作区、index 和 HEAD，但共享多数引用和默认配置。不强行解除其他工作区的分支占用；detached HEAD 可能由宿主有意创建。
- 清理前核对分支及 worktree 的创建归属、活跃使用、未提交与未跟踪内容、需保留的忽略文件，以及提交的保留引用或整合状态。目录名、年龄、PR 已创建或工作区干净都不能证明可删。
- 合并不自动授权清理。删除被拒绝时检查原因，不直接加 force；`worktree prune` 清理失效登记，不等于删除工作区内容。破坏性清理仍遵循主体的保存、预检与备份要求。

### 同步、整合与推送

- 整合前核对源、目标、提交范围及相关 worktree 的归属和未提交内容。不默认远端叫 `origin`、目标叫 `main`，也不把 upstream 当作功能分支的合并基线。
- 需要远端现状时获取相应引用；fetch 不代表整合或覆盖历史的授权。本地提交不固定附带 fetch/pull。
- 按用户和项目约定选择 fast-forward、merge、rebase 或 cherry-pick。需要获取远端更新时先 fetch，再核实取得的 commit hash 后整合；`pull` 将获取与整合合并，无法在两步之间核实提交，改用上述分步流程。
- 重写历史前核实提交、消费者与授权；冲突处理读取[进行中的操作与冲突](#进行中的操作与冲突)。整合后验证实际结果，整合前的测试不能直接证明组合后的树有效，按实际变化决定复测范围。
- 推送前检查远端地址、源提交、目标引用及全部将发布的可达提交，不仅检查最近一条。非 fast-forward 拒绝后先调查分叉，不自动升级为强推。
- 授权重写远端时审查被替换的历史，并绑定已审查目标 OID 使用 lease；lease 只保护状态一致性，不代表覆盖内容已获授权。

按问题使用相应查询：

```bash
git branch --show-current
git worktree list --porcelain
git remote -v
git branch -vv
git log --oneline <target-oid>..<source-oid>
git log --left-right --oneline <target-oid>...<source-oid>
git diff <target-oid>...<source-oid>
```

- `branch --show-current` 为空可能表示 detached HEAD，需结合 status 判断。
- `log A..B` 列出 B 可达而 A 不可达的提交；`log A...B` 是两侧独有提交。`diff A...B` 则比较共同祖先到 B 的内容，不能与 log 的三点语义混用。
- 分支引用和工作区是不同对象：删除 worktree 通常不删除分支，删除分支也不等于立即擦除所有提交对象。清理时分别核对保留要求。
- 未推送不等于未保存；已推送也不等于允许删掉工作区中的未提交或忽略文件。detached HEAD 的独有提交尤其需要先确认保留引用。

推送用已确认的远端和目标引用表达意图，例如：

```bash
git push <remote> <source-oid>:refs/heads/<target>
```

仅当已授权替换远端历史、并审查了远端当前提交 `<expected-oid>` 时，才考虑：

```bash
git push --force-with-lease=refs/heads/<target>:<expected-oid> <remote> <source-oid>:refs/heads/<target>
```

未显式指定预期值的 lease 依赖本地远端跟踪引用，后台 fetch 可改变该依据。显式 lease 失败说明状态已变，应重新调查，不自动更新预期值再试。

## 进行中的操作与冲突

先用 status 识别操作，再查看冲突路径：

```bash
git diff --name-only --diff-filter=U
git ls-files -u
```

需要理解单个冲突时，可检查 index 的 stage 1（共同祖先）、2（ours）、3（theirs）；添加/删除冲突可能缺少其中某个版本。

- merge 中通常将当前分支视为 ours、被合入分支视为 theirs。
- rebase 中 ours 通常是已重放到上游上的一侧，theirs 是正在重放的原分支提交。不要根据字面把 ours 当作“我的任务修改”。
- 理解两侧意图后解决冲突，不用全局 ours/theirs 选择代替语义判断。
- 解决后检查语义与冲突标记，再暂存目标路径并用对应操作的 `--continue`。
- `--skip` 会跳过提交，不是一般的冲突解决方式。abort 会改变中间状态，也可能失去已做的解决工作；决定终止前核对归属和需要保留的内容。
- 出错后保留实际状态并报告。不为恢复“干净”自动 abort、reset 或删除冲突文件；merge 开始前已有的未提交修改也未必能被 abort 完整重建。

## 撤销与恢复

先定位目标变更、保存位置和必须保留的后续修改，再选择动作：

| 目标 | 处理方式 |
| --- | --- |
| 撤销部分未提交修改 | 针对性反向编辑或补丁，保留同文件其他修改 |
| 取消暂存 | 只调整目标路径或差异块的 index，先保护需要保留的暂存版本 |
| 撤销已发布提交的效果 | 通常用 revert 新增反向提交，检查依赖、后续修改和冲突 |
| 改写本地历史或丢弃内容 | 核实引用、路径及丢失范围，选择 reset/restore 的具体模式 |
| 找回旧引用或丢失的提交 | 通过 reflog、现有引用等定位并核实对象，再建立恢复引用或提取内容 |

明确的“撤销刚才修改”按已有范围执行，有歧义且影响保留内容时再问，不扩大到整文件或整仓库。发生丢失或错误操作时保留现场、调查恢复来源，不继续清理或重写掩盖证据。破坏性动作执行前仍须完成主体规定的保存、预检和备份。

- `stash push` 会保存并移走部分当前状态，不是只读备份。参数覆盖范围见[保存未提交改动](#保存未提交改动)；限定路径时也要核对实际包含内容。
- `stash apply` 保留 stash 条目；`pop` 成功后会移除条目。恢复 index 的选择是额外语义，不能把“文件内容回来了”当作原暂存状态也已恢复。
- `clean` 用于删除未跟踪内容；`-x` 包含忽略文件，可能涉及配置、凭据和本地数据。预检和备份按[破坏性操作的预检与备份](#破坏性操作的预检与备份)执行。
- reflog 可以帮助定位旧的提交引用，但有过期和对象清理边界。查到对象后先检查内容，再建立保留引用或恢复所需文件；不是每个未提交版本都能从 reflog 找回。
- 恢复已发布历史的效果时，revert 通常比重写历史更符合保留历史的要求，但仍需检查后续依赖。revert merge 还需确定 mainline，并理解它会影响后续再次合并的结果。

## 提交边界与示例

判定原则见 [一件事的范围](../SKILL.md#一件事的范围)。以下示例用于区分必要配套和独立目的，不要求每项任务新增测试或文档。

| 变更组合 | 提交边界 |
| --- | --- |
| 修复空字段解析、对应回归用例、相关接口说明 | 同一目标的实现、验证和说明，合为一个提交 |
| 修复解析错误，同时调整无关日志级别 | 两个独立结果，拆分提交 |
| 内部函数改名并更新全部调用点 | 一次一致重构，不按文件拆分 |
| 提取可独立验证且保持行为的公共逻辑，再增加依赖它的新行为 | 可按依赖顺序拆为重构和功能两个提交 |
| 修改规则正文，同时同步执行入口和设计依据 | 同一契约的配套修改，合为一个提交 |

提交信息示例的标题摘要与正文均采用中文，type 和 scope 保持英文；实际语言依主体规范统一选择，验证描述须符合实际结果：

```text
fix(parser): 保留带引号输入中的空字段

修正带引号输入中空字段被跳过的问题，使解析结果保留原始字段位置。
普通非空字段的处理方式保持不变。

验证：相关解析用例通过。
```

## 来源与取舍

命令语义主要依据官方资料：

- [Pro Git：Reset Demystified](https://git-scm.com/book/en/v2/Git-Tools-Reset-Demystified)
- [git-add](https://git-scm.com/docs/git-add)、[git-commit](https://git-scm.com/docs/git-commit)、[git-apply](https://git-scm.com/docs/git-apply)
- [git-reset](https://git-scm.com/docs/git-reset)、[git-restore](https://git-scm.com/docs/git-restore)、[git-revert](https://git-scm.com/docs/git-revert)
- [git-worktree](https://git-scm.com/docs/git-worktree)、[git-push](https://git-scm.com/docs/git-push)
- [git-merge](https://git-scm.com/docs/git-merge)、[git-rebase](https://git-scm.com/docs/git-rebase)
- [git-stash](https://git-scm.com/docs/git-stash)、[git-clean](https://git-scm.com/docs/git-clean)、[git-reflog](https://git-scm.com/docs/git-reflog)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)

流程参考 [Superpowers](https://github.com/obra/superpowers/tree/main/skills)、[Codex 的既有改动保护提示词](https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_codex_prompt.md)和 [Aider Git integration](https://aider.chat/docs/git.html)。采用状态识别、改动分离和交付核对的思路；归属以实际证据判断，授权遵循当前任务和有效约定，不采用按目录名推定所有权、遇脏即停或默认提交既有修改的做法。

本 skill 是决策与操作指导，不提供强制权限隔离。MCP 的参数校验、宿主权限控制及沙箱属于执行层，须按实际实现核对。
