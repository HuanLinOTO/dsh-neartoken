
# dsh-neartoken

<p align="center">
  <a href="https://dshfind.com/zh/plugins/huanlinoto/dsh-neartoken"><img src="https://dshfind.com/api/card/huanlinoto/dsh-neartoken?lang=zh" alt="dsh-neartoken card"></a>
</p>

把 New API 站点（NearToken，`https://llm.pko.svcfusion.com`）变成 DSH 的模型供应商：**在设置页发起设备授权 → 用户在自己浏览器里登录站点并确认 → 插件自动接入 `neartoken` provider**。插件全程不接触密码。模型选择器再把这批模型按 New API 的渠道分组折成 **模型 → 分组 → 推理等级** 三级。

## 架构

插件只在三条流向上说话，其余都是它们的支撑：

| 流向 | 路径 |
|---|---|
| **登录** | 设置页 → `POST /neartoken/authorize` → 站点 `POST /api/dsh/device/authorize` 拿到确认码 → 用户在自己浏览器里批准 → 插件按 `interval` 轮询 `POST /api/dsh/device/token`（`authorization_pending` / `slow_down` 退避 +2s / `access_denied` / `expired_token` / `granted`）→ 把站点铸造的 key 写进 credentials 的 `NEARTOKEN_API_KEY` |
| **目录** | `GET /api/pricing`（TTL 缓存）→ 按 (分组, 模型) 展开成 `"<组>::<模型>"` → 可见性过滤 → `listModels` 交给 DSH |
| **出字** | `stream()` → 按模型选协议 → 站点 `/v1/messages`、`/v1beta/models/*:streamGenerateContent`、`/v1/responses`、`/v1/chat/completions`。`body.model` 是裸模型名，`x-neartoken-group` 头带分组的 `#<id>`，每个请求另带**会话亲和键**（`prompt_cache_key` / `metadata.user_id`，见已知限制） |
| **画图** | 工具 `generate_image` → 站点 `/v1/images/generations`（声明了 `image-generation` 的模型）或 `/v1/chat/completions`（gemini 系）→ 取回 bytes → 存进 attachment → 结果里带图 |

一条实现约束：provider 只有在凭据存在时才挂载，且 `credentials` 服务可能晚于本插件就绪，所以启动时先同步一次、再用 `ctx.inject` 同步一次。

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 配置 schema、按凭据现状挂载 provider、装配其余模块 |
| `src/host/account.ts` | RFC 8628 形状的设备授权：发起、按 interval 轮询、把 key 写进 credentials |
| `src/host/routes.ts` | 设置页调用的同源路由（状态 / 授权 / 取消 / 断开 / 模型白名单） |
| `src/host/whitelist.ts` | 白名单读写在插件自身 Config 的 `enabledModels`（volatile），存 profile patch |
| `src/host/pricing.ts` | 拉 `/api/pricing`，展开成 `"<组>::<模型>"` 路由，过滤出能聊的模型 |
| `src/host/model-caps.ts` | 一个模型能不能聊、上下文窗口多大、可选的推理等级（只读站点声明，不存模型表） |
| `src/host/adapter.ts` | 目录、元数据、按模型选协议并流式解析 |
| `src/host/*-wire.ts` | 四条上游协议各自的请求体与 SSE 解析 |
| `src/host/protocol-router.ts` | 按模型选上游协议（claude / gemini / gpt / 其余） |
| `src/host/session-key.ts` | 从 `GenerateOptions.sessionId` 取会话亲和键，四条 wire 用它让站点把会话粘在同一渠道 |
| `src/host/provider-mount.ts` | 路由挂载、撤下、白名单变更时 `replace()` 重播 |
| `src/host/images.ts` | 生图：挑通道、发请求、两种响应都读成 bytes |
| `src/host/image-tool.ts` | `generate_image` 工具：选模型/分组、把图写进 attachment |
| `src/host/image-settings.ts` | 生图设置读写与校验（模型必须是站点当前的生图模型，分组必须是该模型自己的分组） |
| `src/client/` | 设置页、模型选择器、分组胶囊渲染 |

## 使用

1. 装插件、重启 `dsh web`、硬刷新。
2. 打开 **设置 → NearToken**，点「连接 NearToken」。
3. 设置页显示确认码；点「打开浏览器确认」，在站点自己的页面登录（密码、2FA、passkey 都走站点原生流程）并批准。
   这个按钮走 Host：页面自己 `window.open` 开出来的窗口会被困在承载页面的外壳里（Electron 桌面端会另开一个应用窗口、macOS 上甚至没有任何反应），所以由 Host 调平台启动器交给**系统默认浏览器**（macOS `open` / Windows `rundll32 url.dll,FileProtocolHandler` / Linux `xdg-open`）。地址固定取 Host 自己等待的那个，页面无法让 Host 打开任意 URL。
   卡片同时把确认地址当作可选文字列出来（带「复制链接」按钮）—— 没有桌面环境的机器（远程、容器）启动器可能不存在，把地址贴进自己的浏览器即可。
4. 插件轮询到批准后自动完成：把站点为该插件铸造的 API key 写进 credentials 的 `NEARTOKEN_API_KEY`，并挂上 `neartoken` provider。
5. 「断开连接」删掉本地凭据、撤掉 provider，并调用站点的撤销端点。
6. 卡片下方的「模型白名单」勾选即自动保存 —— 未勾选的不再出现在模型选择器里，且当场生效（Host 用 `AdapterRegistrationHandle.replace()` 重新声明同一条路由，同步发布 `llm/adapters-updated`，浏览器重拉目录）。没设置过白名单时默认全部显示，「全部显示」清空白名单。
7. 再往下的「图像生成」卡片：先勾「启用 generate_image 工具」，再勾要用的生图模型并为每个模型选分组（选的是**计费分组**，不是模型），最后点保存。工具随开关挂载/撤下，模型立刻能用或不能用。

备用路径：直接让 credentials 服务存 `NEARTOKEN_API_KEY`，或启动环境导出同名变量 —— provider 会在启动时按凭据现状挂载。

> 设备授权流需要 new-api 侧实现对应端点，契约见 [HANDOFF-new-api.md](HANDOFF-new-api.md) 第一部分。站点尚未实现时会直接报「站点拒绝发起设备授权」。

分组路由按同一文档：请求头 `x-neartoken-group` 的值是 `/api/pricing` 的 `group_refs` 给出的 **`#<id>`**（纯 ASCII），分组名只用于展示；某分组没有 ref 时不发该头，按令牌自身分组路由。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseURL` | `https://llm.pko.svcfusion.com` | 站点根地址，不带尾斜杠 |
| `apiKeyEnv` | `NEARTOKEN_API_KEY` | 授权写入、adapter 读取的凭据引用名 |
| `catalogTtlMs` | `300000` | `/api/pricing` 目录缓存时长 |
| `defaultContextWindow` | `200000` | 没有任何来源能说明某模型上下文窗口时上报的值 |
| `modelOverrides` | `{}` | 按裸模型名逐条修正容量与推理等级，见下 |
| `enabledModels` | `[]` | 模型白名单（裸模型名）；空数组 = 全部显示。volatile，设置页直接写它 |
| `imageTimeoutMs` | `300000` | 单次生图的预算（毫秒）；工具调用截止时间 = 它 + 30 秒，见下文「超时」 |
| `imageGeneration` | `{ enabled: false, models: {} }` | 生图开关与「模型 → 分组」映射；volatile，设置页写 |

`modelOverrides` 是「站点没声明清楚」时的逐条修正手段，改完重启即生效，**不需要发新版本**：

```yaml
- id: dsh-neartoken
  config:
    defaultContextWindow: 200000
    modelOverrides:
      gemini-4-argon:
        contextWindow: 1048576
        reasoning: [low, medium, high, max]
```

## 模型可见性

站点 `/api/pricing` 会列出它知道的所有模型，插件只提供会响应聊天请求的那部分：

1. **站点自己声明的 `supported_endpoint_types` 优先**：含 `openai` / `openai-response` / `anthropic` / `gemini` 任一即可见。这是站点上新增模型当天就能出现在选择器里的原因 —— 不需要等插件发版。
2. 无论站点声明什么，`-c` 后缀与媒体名都不提供 —— 名单是 `image` / `tts` / `transcribe` / `asr` / `embedding` / `lyria` / `midjourney` / `nano-banana` / `veo` / `imagen` / `dall-e` / `sd*`。**这是名字约定，不是能力元数据，也是当前唯一可用的判据**：定价接口把生图、embedding、音乐、视频模型同样挂在 `openai` / `gemini` 这个 surface 下（它们确实走那条路径），所以 `supported_endpoint_types` 分不出「聊天模型」和「共用该 surface 的媒体模型」。站点若将来能发布模型用途字段，这条约定就可以删。
3. **站点没声明时**（老部署）按名字规则放行：插件不再持有模型白名单，所以宁可多列一个也不能让整份目录消失。

## 容量与推理等级

**模型 metadata 的单一真源是站点。** 插件不内置任何模型表：上下文窗口、最大输出、输入模态、推理档位全部读 `/api/pricing`，站点没声明就是没有（走配置兜底或干脆不提供），不再由插件猜。这样一台站点的容量对**所有客户端一致生效**，插件不需要跟着站点上新模型发版 —— 也因此不存在「插件里的表与站点打架」这种情况。

站点侧在 New API 管理后台按模型维护这四项，`/api/pricing` 以 `context_window` / `max_tokens` / `input_modalities` / `reasoning_levels` 发布。维护步骤见 new-api 仓库 `AGENTS.md` 的「模型能力清单」一节。

上下文窗口（`contextWindow`）决定两件事：对话里的占用率显示，以及自动压缩的阈值。**它缺失时自动压缩会直接放弃**（compaction 后端拒绝为无界模型计算摘要预算），所以插件永远会给出一个值。优先级：

| 优先级 | 来源 | 维护方式 |
|---|---|---|
| 1 | `modelOverrides.*.contextWindow` | 改 profile 配置，重启 |
| 2 | 站点 `/api/pricing` 的 `context_window` | 在 New API 管理后台维护 |
| 3 | `defaultContextWindow` | 改 profile 配置 |

最大输出（`max_tokens`）只在**站点或配置明确给出**时才写进请求。站点可能把同一个名字路由到上限更低的渠道，照抄厂商口径会把「回答被截断」换成「请求被拒」。不给出该字段时由上游默认值决定。

输入模态（`text` / `image`）优先级：`modelOverrides.*.input` > 站点 `input_modalities` > `['text']`。**站点没声明的模型一律当纯文本**，因为 harness 把「没有声明」当成「没有权限」：只有声明了 `image` 的模型才允许 `read_image` 和携带图片的请求，否则图片会在发出前被拦下。所以后台忘了勾 `image` 的模型，症状是「贴图被拦」而不是「报错」。

推理档位（`minimal` / `low` / `medium` / `high` / `xhigh` / `max`）优先级：`modelOverrides.*.reasoning` > 站点 `reasoning_levels` > 无档位。**站点没声明就没有档位选择器** —— 与其发一个上游不认的档位换来 400，不如不提供。

## 图像生成（`generate_image`）

开启后插件注册一个 `generate_image` 工具，模型可以直接出图：

```json
{ "prompt": "一只戴墨镜的柴犬，扁平插画风格", "model": "gpt-image-2.5-flare", "size": "1024x1024" }
```

参数：

| 参数 | 说明 | 通道 |
|---|---|---|
| `prompt` | 必填，描述要画什么 | 都行 |
| `model` | 省略时用设置页里第一个启用的模型 | 都行 |
| `images` | 参考图路径数组（最多 4 张），用于改图/合成；第一张决定输出长宽比 | 都行 |
| `path` | 额外把图写到这个路径（文件必须不存在） | 都行 |
| `size` | 如 `1024x1024` | 仅 images |
| `quality` | `low` / `medium` / `high` / `auto` | 仅 images |
| `background` | `transparent` / `opaque` / `auto` | 仅 images |

「仅 images」的参数发给 chat 通道的模型（nano-banana、`gemini-*-image`、grok）会**明确报错**，不会被静默丢掉 —— 静默丢弃会让模型以为自己在控制画幅和质量，那比报错更糟。

结果同时带**文字信封**（模型名、分组、写出路径、尺寸、字节数）和**图片块**，所以模型自己能看到画出来的东西，用户也能在卡片里看到。

两种上游通道由站点声明的端点决定，不用手动选：

| 通道 | 判定 | 请求 | 响应 |
|---|---|---|---|
| `images` | 声明含 `image-generation`（gpt-image 系） | `POST /v1/images/generations` | `data[0].b64_json` 或临时 `url` |
| `genai` | 声明含 `gemini`（nano-banana、`gemini-*-image`） | `POST /v1beta/models/<model>:generateContent` | `candidates[0].content.parts[].inlineData`（结构化） |
| `chat` | 其余（只有 `openai` 的，如 grok-imagine） | `POST /v1/chat/completions` | 回复文本里的 `data:image/...;base64,` 或图片链接 |

Gemini 系走原生 surface 而不是 openai 兼容层：同模型同提示词实测 **74 秒**（原生，返回 `inlineData`）对 **110 秒**（chat，返回 markdown data URL）。原生拿的是结构化字段，不用从文本里抠图，也不依赖网关的转换实现。

实测数据：`gpt-image-2.5-flare` 走促销分组 `#39` 约 43 秒返回 1.3 MB PNG（base64）；`nano-banana-pro` 打 images 端点会被站点拒绝（`only imagen models are supported`），走 chat 才出图；`grok-imagine-image` 两条都通。拿到 bytes 后按 magic bytes 判格式（PNG/JPEG/WebP/GIF），再交给 attachment 服务落盘。

**为什么分组必须选**：同一个模型常被好几个分组转售，价格差好几倍，站点靠 `x-neartoken-group` 头决定路由。所以设置页里「模型 → 分组」是显式配置，而不是取第一个分组了事。保存时 Host 会校验：模型必须仍在站点当前清单里、分组必须是**该模型自己**的分组，否则拒绝（400），宁可让你重选，也不存一条调到必然失败的路由。

### 改图

`images` 传工作区里的图片路径，工具读成 data URL 后按通道发送：

- **images 通道**：作为 `image` 数组（data URL）发给 `/v1/images/generations`（站点 DTO 里没有可用的 `edits` 路由，参考图只能搭生成请求）
- **genai 通道**：作为 `inlineData` part 与提示词一起进 `contents[0].parts`
- **chat 通道**：作为 `image_url` content part 与提示词一起进 `messages`

实测（`nano-banana-pro` + 一张 2.1 MB 的 PNG 参考图）：chat 通道 110 秒出图返回 jpeg；同一模型单轮文生图走 genai 通道 74 秒返回 PNG。参考图在**发请求前**读盘并校验（存在、是普通文件、是 PNG/JPEG/WebP/GIF、≤ 20 MB），所以缺文件不会白花一次生成。

### 落盘

`path` 把同一张图另存一份到工作区：

- **只复制不移动**：attachment 是会话历史的一部分，删了历史里的图就裂了
- **文件必须不存在**：存在即拒绝（`wx` 独占创建），不做覆盖
- **只写本地后端**：`ctx.fs` 只提供写入文本的接口，字节走宿主文件 API；目标路径仍由 `ctx.fs.resolve` 解析，所以工作区与沙箱策略照样生效。远程文件系统后端会拒绝并说明原因
- 写成功后会发 `fs/observed`，UI 的跟随高亮能跳到这个文件

限制：一次只出一张图（`n` 未暴露）；`mask` 局部重绘、`input_fidelity` 未暴露。

### 超时

生图是几十秒到几分钟的活，所以有两条时间线，故意错开：

| 层 | 值 | 超时后模型看到什么 |
|---|---|---|
| 插件自己的预算 | `imageTimeoutMs`（默认 300 秒） | `the site did not return an image within 300s (imageTimeoutMs); … retry, raise imageTimeoutMs, or enable a faster image model` |
| 工具调用截止时间 | `imageTimeoutMs + 30 秒`，声明给 harness 的 timeout policy | 通用的 `tool call timed out after …ms` |

自己那条早 30 秒触发，所以正常情况模型拿到的是**能指路**的那条（等了多久、该调哪个旋钮）；harness 那条只兜住「工具无视 abort 继续跑」。预算耗尽和调用方取消是分开处理的（`AbortSignal.any` 里单独持有预算信号），取消原样向上传递，不会被写成超时。

实测：促销组 43 秒出过图，也遇到过 114 秒；另有一次上游 504（`openai_error`），重试即成功 —— 渠道故障插件不重试、不跨分组兜底，原样报给模型。

还有一条时间线不在插件里：模型若用 `run_code` 这类 PTC 工具去调 `generate_image`，外层 `run_code` 的默认 120 秒会先到。当普通工具直接调则没有这层。

## 已知限制

- 四套 wire（chat / anthropic / genai / responses）各自解析 SSE；**用户消息里的图片按各协议原样发送** —— chat 用 `image_url` part、anthropic 用 `source.base64`、genai 用 `inlineData`、responses 用 `input_image`。字节由 `attachments.readImage` 在请求前内联；没有 attachments 服务或读不出来会**让请求失败**，不再静默降级成纯文本（曾经就是这样：贴的截图模型根本收不到）。文件块（非图片附件）仍不发；`/model` 弹窗仍是内置平铺列表；箭头键盘导航未接。
- 四套 wire 的 SSE 解析都有「帧样本 → 期望 chunk 序列」回归测试（`src/host/wire-parse.spec.ts`），帧样本取自生产网关的真实响应。网关在内容帧上发 `"usage": null`，只有末帧带真值：任何一处把 `usage` 当对象直接读都会让整条流中途崩掉（曾导致 claude 模型全不可用）。
- **每个请求都带会话亲和键**：chat 与 responses 发 `prompt_cache_key`，anthropic 发 `metadata.user_id`，取值都是 DSH 的 `GenerateOptions.sessionId`。站点就是靠这个值挑上游渠道的（New API 的「codex cli trace」规则：`^gpt-.*$` + `/v1/responses`，键取自 body 的 `prompt_cache_key`，取不到就把整条规则跳过），而提示词缓存按**上游账号**存 —— 不带键时每个请求随机换账号，缓存永远不中。实测同一 6k 前缀：不带键连发 4 次 `cached_tokens` 全 0；带键后第 2 次起 5888/6011 ≈ 98%。`/v1/chat/completions` 上目前没有对应规则，chat 线即使带键也只是偶发命中，要彻底解决需要站点加一条匹配该路径的亲和规则；anthropic 线的 `metadata.user_id` 同理（规则只作用于 `/v1/messages`，这一条已经匹配）。
- 推理等级按各协议自己的词汇发送：**anthropic 发 `thinking.type=adaptive` + `output_config.effort`**（不能再用 `thinking.type=enabled` + `budget_tokens`：Claude 5 代直接 400 `requires adaptive thinking`，而 adaptive 在老代际上同样可用，所以统一用它；`minimal` 收敛成 `low`）；genai 发 `thinkingConfig` 且带 `includeThoughts`（不带你拿不到思维链）；chat 与 responses 发 `reasoning_effort` / `reasoning.effort`。
- **Gemini 4 换成 `thinkingLevel`**：这一代不再接受 token 预算（发 budget 会 400 `Use thinking level instead`），按 `gemini-<主版本>` ≥ 4 自动切换字段，等级名用 `low` / `medium` / `high` / `max`。
- 思考历史**不回传**：harness 的 reasoning 块没有 signature 槽位，anthropic 的 `signature_delta` 与 gemini 的 `thoughtSignature` 都被丢弃。当前网关的转换层本身也会丢弃 thinking 块，所以多轮不会因此报错；接真正的 Anthropic / Gemini 直连渠道时这一条会变成硬限制。
- 文本与思维块由**第一个非空 delta** 打开，思维块为空时不产生空块；工具调用块在 `content_block_start` 打开，因为 id 与函数名只在那里出现。
- anthropic 线不硬编码 `max_tokens`：只在调用方给了上限、或开了 thinking 需要余量时才发。给死值会截断长回答。
- `-c` 后缀是站点自己的约定（带该后缀的模型工具调用不可靠）：站点声明了端点类型时插件按声明提供，声明里没有它就不会出现；没有声明时按名字隐藏它的无后缀孪生之外的变体。
- 站点上新但还没在后台填能力的模型：只要声明了端点类型就会提供，容量走 `defaultContextWindow`，模态按纯文本、没有推理档位（除非在 `modelOverrides` 里写明）。这不是 bug，是「站点是唯一真源」的直接后果——补能力请去后台填，不必等插件发版。
- pricing 加载失败时沿用上一次成功的结果，从未成功过则目录为空（失败不写缓存，下次调用会重试）。
- 账号卡片不自动刷新：数字只来自授权那一刻 grant 里的 `user`（站点的 dashboard 接口认浏览器会话，不认本插件持有的 relay key），落盘到 profile 下的 `neartoken-account.json`，重启后从文件恢复。之后余额变化不会反映，需要重新连接一次。
- 白名单按裸模型名过滤：勾掉某模型会把它的所有分组一起隐藏；某个正在使用的模型被勾掉后，会话里已选中的 id 仍在，但选择器里不再列出它。
- 白名单写入走 DSH 的 Settings：profile 里该行只保留 volatile 字段，所以别把 `baseURL` 等非 volatile 字段写进**同一个 profile 行**（会在此后第一次保存白名单时被 Settings 的 strip 规则清掉）。
- 生图一次一张；`size` 对 images 通道只是建议，上游常忽略（实测不传 size 时 gpt-image-2.5-flare 出 1536x1024）。
- 生图结果默认只存 attachment；要给文件就传 `path`（必须是不存在的路径，且只对本地文件系统后端生效）。
- 生图失败按站点原话报错（限流、渠道无可用 channel、模型不支持该端点都会原样透出），不重试、不跨分组兜底 —— 换分组是用户的决定。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run test       # vitest：account / pricing / adapter / model-caps / groups / whitelist / routes / config / wire-parse / images / image-settings / image-tool
pnpm run typecheck  # 两个 face 分别检查（host 与 client 的 ctx.sessions 声明互相冲突，不能同 program）
pnpm run build      # lib/index.js (host) + lib/client.js (client) + lib/types
```
