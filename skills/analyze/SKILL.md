---
name: analyze
description: Perform fast, read-only analysis and deliver an evidence-based answer without modifying the target. Use when the user asks to analyze, inspect, understand, explain, investigate, assess, compare, review, or diagnose a repository, subsystem, code, files, logs, history, build or test results, or other workspace artifacts and wants analysis rather than implementation. For broad requests such as "分析这个项目", produce a rapid breadth-first overview before any deep dive. Do not use when the requested outcome includes editing, fixing, generating, migrating, or other target changes, unless the user explicitly separates a read-only analysis phase.
---

# 快速只读分析

## 守住分析边界

- 将交付物定义为有证据的回答或报告，不修改被分析对象。为读取或验证而安装环境依赖、生成本地未跟踪运行记录不改变只读边界。
- 若任务同时要求实现、修复或其他写入，仅把本 skill 用于用户明确分离出的只读分析阶段。分析时偶然发现的缺陷只报告，不顺手修复。
- 区分观察事实、基于证据的推断和仍未知的信息；不以未执行的命令或不可复现的异常结果支撑结论。

## 选择分析深度

- 用户已指定对象或问题时，直接聚焦该范围，不先做无关的全局扫描。
- 用户只笼统要求分析时，先做快速、广度优先的概览，目标是在数分钟内提供足以选择下一步的全貌，而不是完成精细审计。
- 将“全面”解释为覆盖主要维度，而不是读取每个文件或运行每项测试。按预期信息增益与时间成本选择动作；跳过耗时明显高于新增信息价值的步骤，并在报告中标明未执行项。

## 完成第一轮概览

1. **快速定界**：优先读取适用指令以及材料自带的摘要、元数据、索引和顶层结构；分析仓库时再补充 README、清单、工作区状态和简短历史摘要。复用并行读取，避免串行浏览大量文件。
2. **建立地图**：按组件、主题、阶段或时间等自然边界划分主要区域，对每个区域抽样读取最能说明其职责、特征和关系的代表证据，不遍历全部内容。分析仓库时同时定位入口、语言与依赖、构建和测试配置。
3. **勾勒关系**：追踪足以解释关键结构、依赖、控制流、数据流、时间线或因果联系的最短证据路径，达到概览粒度后停止。
4. **控制运行成本**：识别材料已有的查询、验证或执行入口，默认只运行便宜且信息量高的代表性检查。不得为笼统概览运行完整测试集、耗时构建、全量处理或穷举实验；若选中的检查缺少依赖，安装后重试原入口。
5. **立即交付**：给出紧凑概览、关键证据、风险与未知项，并列出最值得继续深挖的方向。不要在用户选择前自行进入某个分支做精细分析。

第一轮概览不得新增受跟踪脚本、测试或分析框架。若后续聚焦分析确实需要重复流程，遵循全局可复现工作流规则。

## 逐步缩小范围

- 收到用户选择的方向后复用第一轮证据，不重新扫描整个目标。
- 将该方向转化为具体问题，只读取相关实现、测试、配置和路径级历史。
- 优先运行最小的既有检查；逐层增加细节，直到问题得到充分回答或出现有证据的阻塞，然后停止。

## 组织输出

- 第一段直接回答用户目标；对笼统请求，随后概述对象与状态、主要区域、关键关系、代表证据、风险与未知项。分析仓库时再覆盖技术栈与依赖、入口、构建测试面和历史信号。
- 只为关键结论引用代表性的文件、符号、提交或命令结果，不用大量逐文件笔记淹没概览。
- 结尾提供少量按价值排序的深挖方向，供用户选择下一轮范围。
