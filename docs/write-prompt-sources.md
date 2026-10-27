# 来源与采用边界

本文记录 `write-prompt` 的参考来源与采用边界，供仓库维护时核对依据。来源清单保留自创建提交 `e92f502a7f406a3e72de492b10bafed3c2210aaa`，共 13 项；技能的执行契约由 [SKILL.md](../skills/write-prompt/SKILL.md) 与包内参考资料定义，安装后不依赖本文。

## 官方指南

| 来源 | 采用内容与适用边界 |
| --- | --- |
| [OpenAI：提示词工程基础建议](https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-the-openai-api) | 清楚表达目标、分隔资料、用示例说明输出、描述预期行为。其零样本到微调的建议和参数示例是启发式起点，不作为所有任务的固定路线或默认值。 |
| [OpenAI：API 提示词工程](https://developers.openai.com/api/docs/guides/prompt-engineering) | 消息角色、上下文、示例、提示词版本与评测；具体调用方式以目标 API 为准。 |
| [OpenAI：GPT-4.1 提示词指南](https://cookbook.openai.com/examples/gpt4-1_prompting_guide) | 具体指令、长上下文布局、工具定义和失败驱动的调整。它针对 GPT-4.1，不能把其中的思维链、规划提醒或首尾指令布局推广为所有模型的要求。 |
| [OpenAI：GPT-5 提示词指南](https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide) | 用范围、停止条件和交互要求调节代理行为；排查指令冲突。示例中的调用预算、流程与参数属于对应场景，不能直接当作用户的授权或验收标准。 |
| [Anthropic：Claude 提示词最佳实践](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | 直接指令、约束动机、示例、XML、长资料、工具和自主性。页面中的具体模型能力与参数随版本变化；相反行为的示例用于展示可选设计，不应同时写入一个提示词。 |
| [Anthropic：提示词工程概览](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview) | 先明确成功标准和验证方式；识别哪些问题应由提示词以外的机制解决。 |
| [Anthropic：交互式教程](https://github.com/anthropics/prompt-eng-interactive-tutorial) | 从样例观察指令、数据、输出格式和示例的作用。教程基于 Claude 3，预填充等能力需核对当前目标版本。 |
| [Google：Gemini 提示设计策略](https://ai.google.dev/gemini-api/docs/prompting-strategies) | 输入类型、输出模式、示例一致性、上下文与迭代；长资料布局等建议按对应模型和任务验证，不与其他指南机械合并。 |
| [Microsoft：Azure OpenAI 提示词工程技巧](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/prompt-engineering) | 指令、主要内容、示例、输出起始提示与辅助上下文的区分。页面明确其技巧不面向推理模型，旧模型实验不能作为当前模型效果的保证。 |

## 研究与索引

- [DAIR.AI：Prompt Engineering Guide](https://www.promptingguide.ai/) 与[对应仓库](https://github.com/dair-ai/Prompt-Engineering-Guide)：用于定位方法、论文和示例，不将技术目录变成每个任务都要执行的流程。
- [Lilian Weng：Prompt Engineering](https://lilianweng.github.io/posts/2023-03-15-prompt-engineering/)：用于理解少样本、思维链、自洽性、检索和工具增强的研究背景。采用某项实验结论时进一步核对原论文的模型、任务、评价方式和成本。
- [Google：Prompt Engineering 白皮书入口](https://www.kaggle.com/whitepaper-prompt-engineering)：创建时及本次重写核对均只取得网页外壳，未取得白皮书正文，不作为本技能的规则依据。

## 维护时如何使用来源

来源核对日期：2026-10-27。OpenAI 帮助中心页面此次在线访问返回 403，基础内容通过本地副本 `.codex/6654000-best-practices-for-prompt-engineering-with-the-openai-api.html` 核对；当前 API 行为以官方开发者文档为准。本地副本是维护证据，不是技能的安装依赖。

出现建议差异时，先检查目标模型、版本、任务、输入长度和运行方式是否相同。提示词布局、示例数量、推理投入与采样属于待验证的设计选择；接口是否支持某个字段或消息类型则需要查文档。分别处理这两类问题，不用一张厂商速查表替代核对。

这里只保留会改变设计判断的依据。新增方法时说明它解决的具体问题与代价，修订受影响的执行指导；不因官方示例出现了某个步骤，就把它增加为技能的默认要求。
