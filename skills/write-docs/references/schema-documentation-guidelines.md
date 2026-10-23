# Schema 文档编写规范

本规范用于编写独立的 API schema 文档，重点描述请求体和响应体的字段契约。文档应让读者无需阅读实现代码，就能确认字段类型、可选性、允许值、嵌套结构和运行时语义。

## 来源与适用范围

本指南由用户根据 OpenAI 文档风格总结，用作本项目的 schema 文档写作约定。适用于中英文文档：说明文字使用目标语言，字段签名中的类型、`optional`、`or null` 及 `Body Parameters`、`Returns` 等结构标记按本指南书写。已有文档或更具体的项目约定按当前任务要求保留。

撰写前核对目标接口的 schema、类型定义及必要的运行时依据。下文中的字段、模型标识、默认值、状态和弃用替代项用于展示写法，使用时须依据目标接口的实际契约确认。错误、不完整响应和弃用字段仅在接口存在对应契约时展开；缺失的约束标明未决内容，不能为满足示例结构而新增字段或编造行为。

## 1. 基本结构

请求 schema 和响应 schema 分开描述：

```markdown
### Body Parameters

- `field_name: Type`

  字段说明。

### Returns

- `Response object { id, status }`

  - `id: string`

    字段说明。
```

正文只保留 schema 契约和理解字段所需的行为说明。完整请求示例或响应示例可以另设 `### Example`，不要用示例代替字段定义。

## 2. 字段条目的固定格式

每个字段按以下顺序编写：

1. 字段名。
2. 是否可省略。
3. 类型、联合类型或命名类型。
4. 是否允许 `null`。
5. 字段用途和运行时语义。
6. 嵌套字段、枚举值或联合分支。

```markdown
- `field_name: optional object { mode, timeout } or null`

  字段用途。

  说明默认值、适用条件、限制，以及它与其他字段的关系。

  - `mode: optional "fast" or "safe"`

    运行模式。

    - `"fast"`

    - `"safe"`

  - `timeout: optional number or null`

    超时时间，单位为毫秒。
```

字段签名使用反引号包裹，说明文字另起段落。字段与子字段使用 Markdown 缩进表达层级，不把多个层级压缩到一段文字中。

## 3. 类型和可选性

### 3.1 基本类型

直接使用 `string`、`number`、`boolean`、`object`、`array` 等类型名。数组说明元素类型：

```markdown
- `tags: array of string`

  标签列表。
```

### 3.2 可选字段与空值

- `optional` 表示调用方可以省略字段。
- `or null` 表示字段值可以明确传入 `null`。
- 两者同时出现时，表示字段既可以省略，也可以传入 `null`。
- 不要用“可选”代替 `optional`，也不要用文字说明代替 `or null`；这两个状态应直接出现在字段签名中。

```markdown
- `description: optional string or null`
```

### 3.3 对象

对象在类型后列出主要字段：

```markdown
- `settings: object { mode, retries }`
```

随后使用下级条目展开每个字段。对象为空或字段集合不固定时，说明其键和值的约束，例如 `map[string or number or boolean]` 或 `map[unknown]`。

### 3.4 联合类型

用 `or` 连接允许的类型或命名分支，并在下级条目分别展开：

```markdown
- `input: string or InputItemList or null`

  输入内容。

  - `string`

    纯文本输入。

  - `InputItemList = array of InputItem`

    结构化输入列表。
```

联合分支较多时，签名可用 `or N more` 表示其余分支，但文档应提供完整的可发现路径，不能只保留省略后的前三项。

### 3.5 类型别名和命名对象

可复用的类型使用稳定名称，并在首次出现处解释：

```markdown
- `model: ResponsesModel`

  用于生成响应的模型标识。

  - `ResponsesModel = string or "model-a" or "model-b"`
```

同一个命名对象在请求和响应中含义相同的，可以复用名称；如果输入和输出语义不同，应使用不同名称。

## 4. 枚举值和固定值

枚举字段先说明取值范围，再逐项列出允许值：

```markdown
- `status: "queued" or "completed" or "failed"`

  当前处理状态。

  - `"queued"`

  - `"completed"`

  - `"failed"`
```

固定值字段应说明其恒定含义，并列出该值：

```markdown
- `type: "response"`

  资源类型。始终为 `response`。

  - `"response"`
```

如果取值由判别字段决定，应把判别字段和对应对象放在同一个联合结构下，确保读者可以从 `type` 等字段识别实际形态。

## 5. 说明文字的写法

字段说明至少回答“它是什么”和“它如何生效”两个问题。根据需要补充：

- 默认值，以及字段省略时的行为；
- 生效条件或前置条件；
- 数值范围、长度限制、数量限制或格式限制；
- 与其他字段的互斥、依赖或覆盖关系；
- 请求字段与响应字段之间的差异；
- 服务端实际采用的值可能与请求值不同的情况；
- 弃用原因和替代字段。

优先使用短段落。一个字段的关键约束可以拆成多个段落或项目列表，但不要把多个无关规则堆在同一长句中。

示例：

```markdown
- `service_tier: optional ServiceTier or null`

  指定请求的处理层级。

  未设置时使用项目默认层级。响应中的值表示实际使用的层级，可能与请求中指定的值不同。
```

## 6. Body Parameters 的编写规则

`Body Parameters` 描述调用方可以发送的请求字段：

- 按稳定、可查找的顺序列出顶层字段；
- 每个顶层字段使用一个一级项目符号；
- 复杂字段先给用途说明，再展开子字段；
- 输入内容、工具、格式配置等多态字段应明确列出所有主要分支；
- 参数之间存在互斥或联动时，在相关字段说明中直接写出；
- 仅返回时生成的字段不要放进 `Body Parameters`；
- 只在请求允许的值清单中列出枚举值，不把响应中的实际值误写为可发送值。

推荐顺序：

1. 访问范围、后台执行和上下文关联；
2. 输入、指令和历史响应；
3. 模型、推理和输出格式；
4. 工具及工具选择；
5. 流式、存储、缓存和服务层级；
6. 限制、采样和截断；
7. 标识、元数据及安全相关字段。

如果项目已有字段顺序，应优先保持项目顺序，避免同一 schema 在不同文档中频繁变动。

## 7. Returns 的编写规则

`Returns` 描述服务端返回的实际资源：

- 先声明根响应类型，例如 `Response object { id, status, output }`；
- 先列出响应元数据，再列出状态、错误、输出和用量等核心字段；
- 对响应中的固定字段（如 `object: "response"`）说明其恒定值；
- 对数组说明元素类型、顺序、数量或顺序是否由模型决定；
- 对 `error`、`incomplete_details` 等异常或非完成状态字段说明何时出现；
- 对响应中的生效配置，说明它表示请求值、默认值还是服务端最终采用的值；
- 不要假设数组第一个元素就是目标内容；如果有更稳定的聚合字段，应在说明中指出。

推荐的响应核心结构：

```markdown
### Returns

- `Response object { id, object, status, output, error }`

  - `id: string`

    资源的唯一标识。

  - `object: "response"`

    资源类型。始终为 `response`。

  - `status: ResponseStatus`

    响应处理状态。

  - `error: ResponseError or null`

    生成失败时返回的错误；成功时为 `null`。

  - `output: array of ResponseOutputItem`

    模型生成的内容项列表。
```

## 8. 错误、不完整和弃用字段

### 8.1 错误对象

错误对象至少说明错误代码、人类可读消息，以及关联请求参数（如果有）：

```markdown
- `error: ResponseError or null`

  生成响应失败时返回的错误。

  - `code: string`

    稳定的错误代码。

  - `message: string`

    面向调用方的错误说明。

  - `param: optional string or null`

    产生错误的请求参数；无法确定时为 `null`。
```

错误代码是枚举时列出所有受支持值；客户端必须接受未来新增值时，应在说明中明确这一兼容要求。

### 8.2 不完整响应

如果响应可能在正常完成前停止，应提供专门的详情对象，并列出停止原因：

```markdown
- `incomplete_details: object { reason } or null`

  响应不完整时的原因；完整响应时为 `null`。

  - `reason: optional "max_output_tokens" or "content_filter"`
```

### 8.3 弃用字段

弃用信息放在字段说明开头，随后给出替代方案：

```markdown
- `user: optional string or null`

  **Deprecated:** 使用 `safety_identifier` 或 `prompt_cache_key` 代替。

  稳定的终端用户标识。
```

## 9. 链接、代码和示例

- 相关指南使用 Markdown 链接，并把链接放在对应字段或概念旁边。
- 外部规范、JSON Schema 或协议文档可以直接链接到权威来源。
- JSON 请求和响应使用 `json` 代码块；完整 HTTP 调用使用 `http` 或 `bash` 代码块。
- 示例应覆盖最小可用请求和典型响应；示例字段应与前面的 schema 定义一致。
- 示例不能引入未在 schema 中解释的字段、状态或隐含约束。

## 10. 完稿检查清单

- [ ] 请求和响应分别使用 `Body Parameters` 与 `Returns`。
- [ ] 每个字段都有字段签名和用途说明。
- [ ] `optional` 与 `or null` 已按真实契约区分。
- [ ] 对象、数组和联合类型均已展开到可理解的层级。
- [ ] 枚举值和固定值已列出并说明含义。
- [ ] 默认值、限制、互斥关系和依赖关系已写明。
- [ ] 响应字段描述的是服务端实际返回语义。
- [ ] 错误和不完整响应的结构已定义。
- [ ] 弃用字段提供了替代方案。
- [ ] 链接、代码示例和字段定义彼此一致。
- [ ] 文档没有用示例替代正式字段契约。
