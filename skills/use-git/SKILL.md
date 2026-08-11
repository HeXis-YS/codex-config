---
name: use-git
description: Git workflow for inspecting repository state and history, isolating and comparing changes, restoring or resetting local work, managing branches, tags, stash, merges, rebases and conflicts, and producing auditable commits while preserving unrelated work.
---

# 使用 Git

## 确认操作上下文

- 根据全局 Git 基本原则取得仓库根目录、当前分支、状态和相关差异，区分任务基线、用户已有改动和本任务改动。
- 工作期间出现的新变化视为外部工作。作出撤销或提交决定前重新检查状态和差异；与任务重叠时重新读取并在其基础上工作，只有无法安全继续且达到全局提问边界时才询问。

## 调查与比较

- 使用 `status`、`diff`、`log`、`show`、`blame` 等最小充分的只读命令回答当前问题；限制路径、提交范围和输出量，避免无目标遍历历史。
- 优先使用可重放的非交互命令。不要进入不熟悉的交互式控制台来完成可由明确参数表达的操作。

## 撤销与历史操作

- 未暂存的本任务内容使用 `git restore -- <paths>`；只需取消暂存时使用针对性 `git reset -- <paths>` 或 `git restore --staged -- <paths>`，不要同时丢弃工作树内容。
- 只有任务明确要求用新提交撤销既有提交时才使用 `git revert`。修改或重排既有历史前确认该历史不共享且操作已获授权。
- 只操作已确认的精确目标，不使用宽范围命令丢弃未确认工作。
- 不得为了获得干净工作区而擅自 stash、提交或撤销用户已有改动；只有当前任务明确需要并且归属已确定时才执行。

## 暂存与提交

- 全局规则要求提交时，不创建空提交，也不把多个无关任务合并为一个提交。
- 只暂存当前任务的文件和变更。提交前检查 staged diff 与文件列表，确保没有混入用户工作、生成物、凭据或范围外改动。
- 使用清晰、完整且范围准确的 commit message，说明变更内容，并让原因与影响能从提交或相关文档中理解。一次提交应形成自洽、可评审的交付单位。
- 提交后检查状态和提交摘要，确认任务改动已记录、无意文件未被纳入，并向用户报告提交标识和剩余的非任务工作区状态。
