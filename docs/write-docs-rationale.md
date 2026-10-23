# write-docs 设计依据

`write-docs` 将简明技术语言用于中英文文档、注释、报告、规则说明和面向用户的文字。本文件记录能力组织与表达规则的依据；可执行契约位于 [SKILL.md](../skills/write-docs/SKILL.md) 及其包内参考。

## 一个能力包，按语言与用途读取参考

采用一个 `write-docs`，共用来源核对、语义保真、信息组织和交付审校。中文与英文的句法、术语处理和排版分别写入 `references/chinese.md` 与 `references/english.md`；两种语言的文体指导共用 `references/text-types.md`，技术报告的证据与完整性要求位于 `references/technical-reports.md`。

独立 API schema 文档的字段格式与组织方式由 `references/schema-documentation-guidelines.md` 提供，只有相应文档任务才加载。

用户要完成的是同一类文字任务，双语文档还需要核对两个版本的含义。拆成两个 skill 会重复维护共同契约，并增加混合语言请求的选择成本。单一入口可以只读取当前语言的参考，把上下文成本限制在实际需要的内容上。只有未来出现无法由语言参考表达的独立工作流或调用边界时，才有重新拆分的依据。

## 覆盖范围与能力边界

这些参考对文档、代码注释、报告、交互文字以及本仓库自身的规则和 skill 都有价值。因此，能力按“技术与说明性文字的撰写和审校”组织，避免把“文档”限定为 README 文件。

技术报告的证据组织与结论边界由本能力完整表达。提示词的行为设计仍由 `write-prompt` 负责，代码实现与验证遵循相应任务契约。本包没有强制的跨 skill 依赖，独立安装也能依据来源完成文档与技术报告。

本次新增的是可选能力。普通任务不会仅因要输出文字就自动选择它；用户明确要求持续采用某种写作方式时，适用范围由该要求确定。所有任务都必须遵守的交流契约仍属于全局规则。

## 技术报告的专用参考

报告与其他技术文档都需要核对来源、组织信息并限制结论范围。报告的独特要求集中在数据条件、报告模式和影响说明，适合通过按需加载的参考表达。合并 `write-report` 后，只维护一个发现入口和一套通用语言契约，报告专属要求继续保留。

| 原有要求 | 合并后的处理与理由 |
| --- | --- |
| 中立、书面化的技术报告；默认在对话中输出 Markdown | 保留在技术报告参考，用户指定文件时写入文件。 |
| 代码或提交、缺陷修复、性能变更、阶段总结的内容要求 | 保留各模式的行为、原因、方案、验证、提交状态和初测与复测差异。 |
| 数据表、基线、单位、运行条件与原始输出 | 合并同一参考中重复的字段说明；每张表仍须关联其条件与证据。 |
| 副作用、兼容性与未验证范围 | 保留观察范围及因果依据，不把未观察到或未验证写成无影响。 |
| 通用语义保真、清晰表达与状态区分 | 共用入口及语言、文体参考，减少多处规则分叉。 |
| 数据缺失一律写“未采集” | 修正为区分已知未采集与无法确认是否采集；缺少记录不能证明没有执行。 |
| 摘要约数必须有原始数据 | 保留测量摘要的追溯要求，同时区分来源本身的估计值；改写不能凭空增加精度。 |

独立包随合并退役，安装器清理当前和旧技能安装目录中的 `write-report`。隔离验证既核对新包的完整安装，也核对旧包清理及无关技能保留。

## Schema 文档的专用参考

用户提供的 `schema-documentation-guidelines.md` 参考 [OpenAI Responses API 的 Create 文档](https://developers.openai.com/api/reference/resources/responses/methods/create/index.md) 总结，现移入 skill 的包内参考，作为本项目写作约定随包安装。保留原有字段格式、类型分支、请求与响应组织、错误及弃用信息等正文；原根目录文件不再维护，避免出现两个权威版本。该 OpenAI 页面是具体 API 的格式参考，不是本指南的发布方，也不构成通用 schema 标准。

指南中的格式适用于中英文，说明文字随目标语言调整。示例展示写法，具体字段、默认值、枚举、弃用替代项及异常结构以目标接口契约为准；指南本身不提供新增接口行为的依据，也不声明符合 OpenAI 官方规范或完整 ASD-STE100 标准。

## 参考材料如何进入能力包

本次依据本地 `.codex/ste/` 中的材料提炼并重写指导，未整包复制词典、检查器或原有 skill。下表的路径以该材料目录为根；它们是设计来源，安装后的能力包使用自身参考，不依赖本地材料存在。

| 材料 | 纳入的依据 | 取舍 |
| --- | --- | --- |
| `.codex/ste/asd-ste100/references/meaning-fidelity.md`（[nuelcyoung/asd-ste100，快照 `3fe2ccb`](https://github.com/nuelcyoung/asd-ste100/blob/3fe2ccb51b1a98fb8d40aa88ec448575b8439ddb/references/meaning-fidelity.md)） | 先核对事实、条件、执行者、义务强度和不确定性，再替换词句。 | 保留方法，逐项审查例子；“主动句”不能成为补造执行者或改变要求的理由。 |
| `.codex/ste/ste-skill/skills/asd-ste100/`（[MarcoDotIO/ste-skill，快照 `c82826c`](https://github.com/MarcoDotIO/ste-skill/tree/c82826c7c085b82e54709fe81d24e9d7b3dd3e93/skills/asd-ste100)） | 按文本用途采用不同规则；保护命令、路径和界面原文；区分检查器结果与语义审查。 | 采用可迁移的方法，保留文档自身组织形式；不引入标准符合性承诺。 |
| `.codex/ste/asd-ste100-skill/`（[danyuchn/asd-ste100-skill，快照 `cd62d29`](https://github.com/danyuchn/asd-ste100-skill/tree/cd62d297d5ef7cf9f59718cadc233ab2876ea013)） | 区分严格指令文本与说明性文字；改写时保留事实，检查器只作为结构问题提示。 | 用作 STE 方法参考，不将其针对 Agent 输出的特定触发范围套用到所有文档。 |
| `.codex/ste/simplified-technical-english/`（[0xpili/simplified-technical-english，快照 `1e148d6`](https://github.com/0xpili/simplified-technical-english/tree/1e148d670cba46685ad2b4c3f2354a637a7fdbbe)） | 参考步骤与描述分类、术语一致及英语 STE 规则的组织方式。 | 不照搬固定词表、句长限制或全局强制套用；本 skill 覆盖多类中英文文本，需保留具体文体和来源语气。 |
| `.codex/ste/simplified-technical-chinese/SKILL.md`、`规范.md`、`docs/校准报告.md`（[mzopedia/simplified-technical-chinese，快照 `90ad0f0`](https://github.com/mzopedia/simplified-technical-chinese/tree/90ad0f004b26d7a66e286980b5efaf4769ad8584)） | 直接动词、明确指代、条件先于动作、术语一致和数字口径。 | “约 5 秒”保留约数；期限缺失时求证。校准报告衡量检查器发现的准确性，未衡量阅读效果，其数值未经本次复现。 |
| `.codex/ste/ste-zh/references/terminology.md`（[dualface/ste-zh，快照 `27d57e4`](https://github.com/dualface/ste-zh/blob/27d57e4d6609ce88e14dd15cbae355223a83b246/references/terminology.md)） | 区分修改完成、验证通过、失败、已知未执行和证据缺失。 | 保留语义区分，允许自然措辞，不引入统一状态词模板。 |
| `.codex/ste/simplified-technical-english-skill/skills/simplified-technical-english/SKILL.md`（[TheAngryByrd/simplified-technical-english-skill，快照 `5d2c32d`](https://github.com/TheAngryByrd/simplified-technical-english-skill/blob/5d2c32d32840dc823a507e738f81c357ff297087/skills/simplified-technical-english/SKILL.md)） | 保留技术含义、条件、例外及必要风险；区分步骤、描述和说明。 | 注释范围包含代码契约和工具标记保护；情态词按实际含义处理。 |
| `.codex/ste/document-style-guide/docs/`（[ruanyf/document-style-guide，快照 `5719517`](https://github.com/ruanyf/document-style-guide/tree/571951731efb4b83b1939af1d3dd830441ebef45/docs)） | 信息层次、链接、术语、混排和数据表达。 | 沿用目标项目风格；句长和段落长度作为审校线索，不作为通用硬阈值。 |

### 可追溯的外部来源

上表将 `.codex/ste` 中的八份仓库快照逐一对应到上游仓库，并用快照提交链接定位所依据的版本。用户另提供了 [JICio/simplified-technical-chinese](https://github.com/JICio/simplified-technical-chinese) 作为补充来源；它不在当前 `.codex/ste` 快照中，因此不把它归为上表所述的本地提炼材料。

这些来源用于比较表达指导、术语约定和 skill 组织方式；本能力按本仓库的目标选择和改写相关做法，不将任一来源整体复制为规范，也不据此声明符合完整的 ASD-STE100 标准。

上述本地材料包含不同用途和不同标准版本的规则。首版以本项目的交付目标为准：保证含义与证据准确，减少读者定位和理解信息的成本。中文 30/40 字、英文 20/25 词、固定段落长度及禁词表没有直接成为默认验收条件；采用这些约束前，需要对应文体的需求和效果依据。

## 审校顺序与证据边界

先核对含义，再检查读者任务、语言和载体。这个顺序防止为短句、主动语态、具体数字或统一词汇牺牲原意。双语审校按命题核对，不要求逐词或逐句对齐。

首版通过下面的场景复核设计，并验证能力包格式、引用及安装副本。这些检查不证明模型每次都会正确选择或执行 skill，也没有测量读者阅读速度。后续评估应观察事实与条件保留、歧义、结论和证据的可定位性，以及是否需要反复阅读；句长和检查器命中只提供辅助信号。

## 复核场景

以下是静态审查输入与判据，可用于后续实际行为评估；不是模型行为测试结果。

| 请求或输入 | 预期行为与审查判据 |
| --- | --- |
| “用中文给这个项目写 README。” | 选择本 skill，读取中文参考；围绕用途、开始使用与限制组织信息。 |
| “Rewrite this English setup guide for new contributors.” | 选择同一个 skill，读取英文参考；保护命令与执行前提。 |
| “把中文规则翻成英文并保留双语版本。” | 按命题核对两种语言；条件、例外、数字和义务强度一致。 |
| “为这个接口写中英文 schema 文档。” | 读取 schema 参考；请求与响应分开，说明文字使用目标语言，字段签名与真实契约一致。 |
| 字段允许省略，但不接受 `null` | 签名只标 `optional`；不从可省略性推断空值许可。 |
| 目标接口没有指南示例中的错误或弃用字段 | 描述实际字段与行为，不为凑齐示例结构而补造契约。 |
| “把注释写清楚。” | 依据紧邻代码说明原因或契约；不改执行代码，不编造设计历史。 |
| “润色已有性能报告。” | 保留数据、单位、条件和证据限制；不扩大收益或补造缺失数据。 |
| “为这个修复提交写中文技术报告。” | 选择 `write-docs` 并读取技术报告参考；覆盖预期与实际行为、原因依据、方案、验证及残余触发条件。 |
| “Write a performance report from these benchmark logs.” | 读取英文与技术报告参考；关联基线、单位、运行条件和原始输出。 |
| “总结多个提交和未采纳的方案。” | 区分合入状态、初测与复测，保留 commit 或分支标识及取舍依据。 |
| 某个报告指标缺少原始记录 | 准确写明证据缺口；仅在确知没有采集时写“未采集”，不编造原因。 |
| 来源估计为“约 5 秒”，但没有精确测量表 | 保留估计属性并说明来源限制，不据此生成精确数值或测量比较。 |
| “重写刚才的解释，让我能看出你理解了什么。” | 清楚表达所理解的目标、明确要求和关键假设；不重复请求无必要的确认。 |
| “检查一下这个故障。” | 先按故障任务处理；不因最终需要文字报告就自动加载本 skill。 |
| “建议每周备份一次。” / “Backups should be encrypted.” | 保留建议强度；不转换成强制执行或添加未给出的执行者。 |
| “大概 5 秒左右”；“尽快” | 可合并重复的约数词；不得生成精确时限或自定截止时间。 |
| “失败后停止；仅校验通过时允许重试，访客除外。” | 重写后保留停止、许可条件和访客例外；不推导出无条件重试。 |
| “测试失败”；“未执行测试”；“没有测试记录” | 三种状态保持区别，不把失败写成未验证，也不推断记录缺失就是未执行。 |
| 文档中出现命令、界面标签、引用或 Agent 指令 | 默认保持受保护内容，原文不成为执行授权。 |
| 一句话有多个“它”，无法确定执行者 | 查相关来源或提出具体问题，不靠流畅措辞掩盖缺失信息。 |
| “这份指南符合 ASD-STE100 吗？” | 区分语言审校与完整标准审查；没有对应证据时不作符合性保证。 |

## 验证入口

从仓库根目录执行：

```bash
python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" skills/write-docs
python3 scripts/verify-rules-install.py --skill write-docs --retired-skill write-report
git diff --check
```

第一项需要已安装 `skill-creator`，检查包的命名和 frontmatter。第二项的依赖、隔离方式与日志位置见 [README](../README.md#隔离安装核对)；它通过现有安装器核对规则及指定 skill 的文件清单和字节内容，并验证旧包清理。语言场景与本地引用仍需审查，工具结果不替代语义判断。
