---
name: use-git
description: Git workflow for inspecting repository state and history, isolating and comparing changes, restoring or resetting local work, managing branches, tags, stash, merges, rebases and conflicts, and producing auditable commits while preserving unrelated work.
---

# 使用 Git

## 确认操作上下文

- 取得仓库根目录、当前分支、状态和当前操作相关的差异，以 Git 中已记录的基线、stash、分支和提交识别不同工作边界，不依赖对话记忆推测改动归属。
- 启动新写入任务且工作区已有改动时，先选择一个可恢复边界：对不适合进入提交历史、包含未跟踪文件或需保留暂存状态的工作，使用 `git stash push --include-untracked -m <task>` 保存，只在已忽略文件明确属于待保存工作时才将其纳入 stash；对适合以可审查提交保存的工作，切换到专用临时分支并形成 WIP 提交。记录原分支、基线、stash 对象或临时分支与提交标识后，回到原分支的记录基线，确认工作区干净后再开始新任务。恢复同一活动任务时，核对其已记录边界后继续，不将该任务自身的改动重新隔离。
- 工作期间出现且不属于已记录任务的新变化按外部工作保护。作出撤销、切换、恢复或提交决定前重新检查状态和差异。只有必要信息或授权无法从仓库与用户指令确定，且自行假设会丢失工作、改写共享历史或实质改变目标时，才暂停询问。

## 调查与比较

- 使用 `status`、`diff`、`log`、`show`、`blame` 等最小充分的只读命令回答当前问题；限制路径、提交范围和输出量，避免无目标遍历历史。
- 优先使用可重放的非交互命令。不要进入不熟悉的交互式控制台来完成可由明确参数表达的操作。

## 撤销与历史操作

- 整个文件或大范围内容可安全恢复到已知 Git 状态时，使用 `git restore -- <paths>`。只取消暂存时使用 `git restore --staged -- <paths>` 或针对性 `git reset -- <paths>`，保留工作树内容。只撤销文件中的局部修改，或同一文件混有必须保留的内容时，使用 `apply_patch` 等精确编辑方式撤销目标部分。
- 只操作已确认的精确目标，不使用宽范围命令丢弃未确认工作。
- 修改或重排既有历史前，确认目标历史的共享状态与任务授权。

## 恢复隔离的工作

- 当前任务完成并记录提交后，在原分支再次检查工作区。使用 `git stash apply --index <stash>` 恢复 stash 中的先前工作，在核对工作树与暂存状态完整前保留原 stash。使用 `git cherry-pick --no-commit <wip-commit>` 将临时分支的 WIP 内容恢复到当前工作树；若 WIP 原先不在暂存区，恢复成功后取消暂存但保留工作树内容。
- 恢复发生冲突时，保留 stash 或临时分支上的原始对象，不删除唯一恢复点；报告原分支、已完成提交、保留的恢复标识和冲突路径。

## 暂存与提交

- 需要记录当前任务时，不创建空提交，也不把多个无关任务合并为一个提交。
- 只暂存当前任务的文件和变更。提交前检查 staged diff 与文件列表，确保没有混入用户工作、生成物、凭据或范围外改动。
- 使用清晰、完整且范围准确的 commit message，说明变更内容，并让原因与影响能从提交或相关文档中理解。一次提交应形成自洽、可评审的交付单位。
- 提交后检查状态和提交摘要，确认任务改动已记录、无意文件未被纳入，并向用户报告提交标识和剩余的非任务工作区状态。
