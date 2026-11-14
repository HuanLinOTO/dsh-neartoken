
# dsh-neartoken

<p align="center">
  <a href="https://dshfind.com/zh/plugins/huanlinoto/dsh-neartoken"><img src="https://dshfind.com/api/card/huanlinoto/dsh-neartoken?lang=zh" alt="dsh-neartoken card"></a>
</p>

把 New API 站点（NearToken，`https://neartoken.cc`）变成 DSH 的模型供应商：**在设置页发起设备授权 → 用户在自己浏览器里登录站点并确认 → 插件自动接入 `neartoken` provider**。插件全程不接触密码。模型选择器再把这批模型按 New API 的渠道分组折成 **模型 → 分组 → 推理等级** 三级。

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
| `src/host/routes.ts` | 设置页与模型选择器调用的同源路由（状态 / 余额立即刷新 / 授权 / 取消 / 断开 / 模型白名单 / 生图设置 / 长连接端点 / 防降智） |
| `src/host/whitelist.ts` | 白名单读写在插件自身 Config 的 `enabledModels`（volatile），存 profile patch |
| `src/host/pricing.ts` | 拉 `/api/pricing`，展开成 `"<组>::<模型>"` 路由，过滤出能聊的模型 |
| `src/host/model-caps.ts` | 一个模型能不能聊、上下文窗口多大、可选的推理等级（只读站点声明，不存模型表） |
| `src/host/adapter.ts` | 目录、元数据、按模型选协议并流式解析 |
| `src/host/*-wire.ts` | 四条上游协议各自的请求体与 SSE 解析 |
| `src/host/protocol-router.ts` | 按模型选上游协议（claude / gemini / gpt / 其余） |
| `src/host/session-key.ts` | 从 `GenerateOptions.sessionId` 取会话亲和键，四条 wire 用它让站点把会话粘在同一渠道 |
| `src/host/provider-mount.ts` | 路由挂载、撤下、白名单变更时 `replace()` 重播 |
| `src/host/relay.ts` | 模型接口走哪个域名：站点根或长连接端点，由模型选择器里的开关决定 |
| `src/host/topup.ts` | 站点充值面：读 amount 档位与渠道、下单，把 403 `DSH_TOKEN_REQUIRED` 翻成「是否 DSH 密钥」的原因 |
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
5. 卡片右上角的「断开连接」删掉本地凭据、撤掉 provider，并调用站点的撤销端点。
6. 卡片下方的「模型白名单」勾选即自动保存 —— 未勾选的不再出现在模型选择器里，且当场生效（Host 用 `AdapterRegistrationHandle.replace()` 重新声明同一条路由，同步发布 `llm/adapters-updated`，浏览器重拉目录）。没设置过白名单时默认全部显示，「全部显示」清空白名单。
7. 账户卡片里的「充值」区：点档位或自己填金额 → 「去支付」→ 站点生成易支付订单，插件把支付页交给系统浏览器打开，付完余额在 5 分钟内自动刷新。**只有 DSH 设备授权签发的密钥能下单**；换成普通令牌时这里会显示「重新连接」。
8. 「数据概览」卡片：右上角切「日 / 周 / 月」，看这个窗口的消耗（括注当前余额）、Token 数，以及按模型堆积的曲线，见下节。
9. 再往下的「图像生成」卡片：先勾「启用 generate_image 工具」，再勾要用的生图模型并为每个模型选分组（选的是**计费分组**，不是模型），最后点保存。工具随开关挂载/撤下，模型立刻能用或不能用。

备用路径：直接让 credentials 服务存 `NEARTOKEN_API_KEY`，或启动环境导出同名变量 —— provider 会在启动时按凭据现状挂载。

> 设备授权流需要 new-api 侧实现对应端点，契约见 [HANDOFF-new-api.md](HANDOFF-new-api.md) 第一部分。站点尚未实现时会直接报「站点拒绝发起设备授权」。

分组路由按同一文档：请求头 `x-neartoken-group` 的值是 `/api/pricing` 的 `group_refs` 给出的 **`#<id>`**（纯 ASCII），分组名只用于展示；某分组没有 ref 时不发该头，按令牌自身分组路由。

模型选择器的根菜单里，「分组」下面一行是**长连接端点**开关：打开后所有**模型接口**（`/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1/images/*`、Gemini 的 `/v1beta/*`）改走 `https://direct.neartoken.cc`，站点控制台的 `/api/*`（目录、用量、钱包、充值、设备授权）仍走 `baseURL`。开关写进插件配置的 `directLink`（volatile），点完立刻对下一次请求生效，不需要重启。它只出现在本插件自己的 provider 上。

紧接着是**防降智**开关，只在当前模型属于 `gemini-4` 系列时出现。打开后，该模型每次请求体里 DSH 生成的 `@` 文件引用说明（`Tokens prefixed with @ are paths the user explicitly referenced. …` 那段英文）会被换成中文，system 提示、会话消息与工具描述里出现的都换；中文版保留全部规则和其中提到的 `read` 工具名。

替换是纯字符串替换：DSH 改了这段措辞之后就不再命中，请求照原样发出，不会留下半译的文本。开关写进插件配置的 `antiDegrade`（volatile），只作用于 `gemini-4` 模型——换成别的模型时开关不显示，请求也不改写。

模型选择器里的分组是**显式选择**：换模型时先保留当前分组；新模型不在该分组时，按分组名上的档位标签（`[低价]` / `[满血]` / `[官key]` 等）就近匹配同一档位的分组，而不是落回站点目录里的第一个分组——那一个往往是倍率最高的。跨模型族（`[低价] DeepSeek` → GPT）也按标签匹配。

## 数据概览（消耗 / Token / 模型堆积）

账户卡片下方是「数据概览」：窗口内的消耗金额（括注当前余额）、窗口内的 Token 数，以及按模型堆积的面积图。右上角的「日 / 周 / 月」切换整个窗口 —— 桶宽由站点给，插件不自己造桶：

| 窗口 | 回看 | 桶宽 | 桶数 |
|---|---|---|---|
| 日 | 24 小时 | 1 小时 | 24 |
| 周 | 7 天 | 6 小时 | 28 |
| 月 | 30 天 | 1 天 | 30 |

数据来自站点的 `GET /api/dsh/device/usage?range=day|week|month`（契约见 [HANDOFF-new-api.md](HANDOFF-new-api.md) 第七部分），和聊天用同一把 DSH 密钥认证。**不复用站点控制台的统计端点**（`/api/data/self` 之类）：那些要浏览器会话，relay key 读不到；`/api/log/token` 只回最近若干条日志，做不了月视图。

曲线按模型堆叠 Token；模型多于 5 个时其余合并成「其他」，图例给每个模型的占比。每个桶点上去有原生提示（时间 + 该桶总量）。窗口数字取自站点 `quota_data` 聚合表（与站点自己的「消耗分布」同源），所以最近几分钟的花费可能还没进表。

站点没有这个端点、或读不到时，卡片只留一行说明（「站点未提供用量统计。」/「暂时无法从站点读取用量。」），**不画空图** —— 空图会被读成「这段时间没有用量」，那是另一个结论。

## 邀请码（`window.NEARTOKEN_AFF`）

引导用户来到 DSH 的页面可以在窗口上留一个邀请码：`window.NEARTOKEN_AFF = '<code>'`。插件在发起设备授权时读取它，并作为 `aff` 参数拼到站点确认页地址上 —— 卡片里「打开浏览器确认」和「复制链接」用的都是这个带参数的地址：

```
https://<site>/dsh/device?user_code=K7QM-3XPD&aff=<code>
```

站点侧不需要为插件做任何改动：New API 前端本来就会把任意页面上的 `?aff=` 存进浏览器 localStorage，注册表单与第三方账号首次登录都从那里取，落库为邀请人。三种情形：

| 用户在站点上的状态 | 结果 |
|---|---|
| 已登录 | 设备授权照常完成，`aff` 不参与，无副作用 |
| 未登录、自己注册 | 注册请求带 `aff_code`，绑定邀请人（奖励按站点后台配置发放） |
| 未登录、用第三方账号 | 首次登录自动建号时按 `aff` 绑定邀请人 |

边界：

- 只接受 `[A-Za-z0-9_-]{1,64}` 的取值，其它值整条丢弃，**连接照常发起** —— 一个坏邀请码不该让授权失败。
- 窗口上没有这个全局变量时，地址与以前完全一样（不带 `aff`）。
- 已有进行中的授权时再点「连接」不会重启，沿用第一次的地址与其中的 `aff`。
- 站点的 `/sign-in` 页本身没有注册入口：未登录用户从确认页被跳到这里后，只能登录或走第三方账号（首次登录会在站点上自动建号，`aff` 照样生效）；要密码注册就自己打开 `/sign-up?aff=<code>`（确认页已经把取值写进 localStorage，参数可省）。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseURL` | `https://neartoken.cc` | 站点根地址，不带尾斜杠 |
| `directEndpoint` | `https://direct.neartoken.cc` | 长连接端点；模型选择器打开开关后模型接口改走它，`/api/*` 不受影响 |
| `directLink` | `false` | 长连接端点开关；volatile，模型选择器直接写它 |
| `antiDegrade` | `false` | 防降智开关；volatile，模型选择器直接写它，只在 `gemini-4` 模型上生效 |
| `apiKeyEnv` | `NEARTOKEN_API_KEY` | 授权写入、adapter 读取的凭据引用名 |
| `catalogTtlMs` | `300000` | `/api/pricing` 目录缓存时长 |
| `defaultContextWindow` | `200000` | 没有任何来源能说明某模型上下文窗口时上报的值 |
| `modelOverrides` | `{}` | 按裸模型名逐条修正容量与推理等级，见下 |
| `enabledModels` | `[]` | 模型白名单（裸模型名）；空数组 = 全部显示。volatile，设置页直接写它 |
| `imageMaxEdge` | `2048` | 发送到上游前图片的长边上限（像素）；更大的图按长边缩到它，见下「图片压缩」 |
| `imageMaxBytes` | `2097152` | 单张请求图的编码字节上限；超出走编码质量阶梯，必要时把 PNG 转成 JPEG / WebP |
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

### 图片压缩

**图片在离开本机前先被重编码**，不是原图直传：请求前把每张图交给 harness 的附件服务（`attachments.readImageRequest`）按 `imageMaxEdge` / `imageMaxBytes` 生成一份请求版，sharp 缩放 + 质量阶梯重编码（有 alpha 走 WebP、无 alpha 走 JPEG），结果按「附件 + 目标尺寸 + 字节预算」缓存，同一张图重复发不重复编码。已经被上游视觉网格丢掉的分辨率不再上传，也就不再计费。

实测（`ds-harness-remote/docs/images/remote.png`，2559×1639 PNG 951 KB）：默认策略下变成 2048 长边 JPEG 219 KB，base64 后 292 KB，约为原图的 23%；把 `imageMaxEdge` 调到 768 且 `imageMaxBytes` 调到 300 KB 时降到 52 KB。

两条边界：

- **原图已经在两个上限内时不重编码**（附件服务直接返回原字节），所以小图不会被无谓地转成 JPEG。
- **附件服务不支持请求版**（`ATTACHMENT_PROJECTION_UNSUPPORTED`，非本地存储后端的默认行为）时**退回原图发送**，请求不会因此失败；其它错误照旧让请求失败，不会静默降级。

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
| 1 | 设置页「模型白名单 → 覆盖」填的上下文（`modelMeta`，volatile，保存即生效） | 设置页模型行点「覆盖」 |
| 2 | `modelOverrides.*.contextWindow` | 改 profile 配置，重启 |
| 3 | 站点 `/api/pricing` 的 `context_window` | 在 New API 管理后台维护 |
| 4 | `defaultContextWindow` | 改 profile 配置 |

设置页的「覆盖」编辑器（模型白名单每行右侧按钮）可给单个模型改**上下文 / 最大输出 / 输入类型**三项：填了的字段逐项盖过 `modelOverrides` 与站点声明，留空的字段沿用下一级；输入类型（文本/图像）整体生效、至少留一项。数据存 `modelMeta`（volatile，与白名单同一次 profile 写入），保存后路由即重申、模型选择器立刻刷新，「清除覆盖」回到站点声明。编辑器里同时显示站点声明值作参照。

最大输出（`max_tokens`）只在**站点或配置明确给出**时才写进请求。站点可能把同一个名字路由到上限更低的渠道，照抄厂商口径会把「回答被截断」换成「请求被拒」。不给出该字段时由上游默认值决定。

输入模态（`text` / `image`）优先级：设置页「覆盖」的输入类型（`modelMeta.*.input`）> `modelOverrides.*.input` > 站点 `input_modalities` > `['text']`。**站点没声明的模型一律当纯文本**，因为 harness 把「没有声明」当成「没有权限」：只有声明了 `image` 的模型才允许 `read_image` 和携带图片的请求，否则图片会在发出前被拦下。所以后台忘了勾 `image` 的模型，症状是「贴图被拦」而不是「报错」。

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
| `images` | 声明含 `image-generation`（gpt-image 系） | 无参考图：`POST /v1/images/tasks` 提交 → `GET /v1/images/tasks/<id>` 轮询；有参考图：`POST /v1/images/edits` | 任务 `SUCCESS` 的 `data[0].url` / `b64_json`；站点回落同步时直接是 `data[0]` |
| `genai` | 声明含 `gemini`（nano-banana、`gemini-*-image`） | `POST /v1beta/models/<model>:generateContent` | `candidates[0].content.parts[].inlineData`（结构化） |
| `chat` | 其余（只有 `openai` 的，如 grok-imagine） | `POST /v1/chat/completions` | 回复文本里的 `data:image/...;base64,` 或图片链接 |

Gemini 系走原生 surface 而不是 openai 兼容层：同模型同提示词实测 **74 秒**（原生，返回 `inlineData`）对 **110 秒**（chat，返回 markdown data URL）。原生拿的是结构化字段，不用从文本里抠图，也不依赖网关的转换实现。

实测数据：`gpt-image-2.5-flare` 走促销分组 `#39` 约 43 秒返回 1.3 MB PNG（base64）；`nano-banana-pro` 打 images 端点会被站点拒绝（`only imagen models are supported`），走 chat 才出图；`grok-imagine-image` 两条都通。拿到 bytes 后按 magic bytes 判格式（PNG/JPEG/WebP/GIF），再交给 attachment 服务落盘。

**为什么分组必须选**：同一个模型常被好几个分组转售，价格差好几倍，站点靠 `x-neartoken-group` 头决定路由。所以设置页里「模型 → 分组」是显式配置，而不是取第一个分组了事。保存时 Host 会校验：模型必须仍在站点当前清单里、分组必须是**该模型自己**的分组，否则拒绝（400），宁可让你重选，也不存一条调到必然失败的路由。

### 改图

`images` 传工作区里的图片路径，工具读成 data URL 后按通道发送：

- **images 通道**：作为 `images` 数组（data URL）发给 `POST /v1/images/edits` —— 站点自己的编辑面，会在这里校验"必须有参考图"并走改图渠道；模型被任务插件认领时站点在请求内轮询到终态再回图。站点没有该路由（404/405）或只收 multipart 编辑体（415）时，退回到 `/v1/images/tasks` 并把参考图作为 `image` 数组随生成请求带上；400 是请求被拒（内容审查等），直接报错，不会换端点重打一次
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

### 异步任务

`images` 通道的模型走站点的 **durable task**：`POST /v1/images/tasks` 立刻返回 `202 + task_id`，插件每 3 秒（退避到 5 秒）轮询 `GET /v1/images/tasks/<id>`，`SUCCESS` 后再取 `data[0].url` / `b64_json`。慢模型不再靠一条长 HTTP 撑时间 —— 连接断了，任务还在站点上跑。

- **轮询只重读，不重提交**：轮询撞上 5xx、网关故障或断网，按同一 `task_id` 再来一次；任务没有幂等键，重复提交会重复计费，所以提交没拿到任务就原样报给模型，由模型决定要不要重试。
- **取消只停轮询**：`exec.signal` 中止后本地不再查询，站点上的任务照常跑完并按站点规则计费。
- **失败带站点原话**：`FAILURE` 的 `fail_reason`（例如 `DataInspectionFailed: …`）直接进错误消息，不用去站点后台翻。
- **两种回落都能接**：站点没把该模型认领成任务时，同一端点直接回 `200 + data[]`；不认这个端点的老站点回 404，插件改用 `POST /v1/images/generations` 同步等一次。
- **改图不走这条**：`/v1/images/edits` 对客户端是同步的（站点在请求内轮询到终态，最长 600 秒），所以改图那次调用是一条长连接；预算仍是 `imageTimeoutMs`，预算耗尽后站点任务照常跑完计费，重试用同一个提示词会再开一个任务。

### 超时

生图是几十秒到几分钟的活，所以有两条时间线，故意错开：

| 层 | 值 | 超时后模型看到什么 |
|---|---|---|
| 插件自己的预算 | `imageTimeoutMs`（默认 300 秒），**从提交到拿到图的总预算**（含轮询） | `the site did not return an image within 300s (imageTimeoutMs); … a submitted task keeps running on the site and is billed when it finishes …` |
| 工具调用截止时间 | `imageTimeoutMs + 30 秒`，声明给 harness 的 timeout policy | 通用的 `tool call timed out after …ms` |

自己那条早 30 秒触发，所以正常情况模型拿到的是**能指路**的那条（等了多久、该调哪个旋钮）；harness 那条只兜住「工具无视 abort 继续跑」。预算耗尽和调用方取消是分开处理的（`AbortSignal.any` 里单独持有预算信号），取消原样向上传递，不会被写成超时。

实测：促销组 43 秒出过图，也遇到过 114 秒；另有一次上游 504（`openai_error`），重试即成功 —— 渠道故障插件不重试、不跨分组兜底，原样报给模型。

还有一条时间线不在插件里：模型若用 `run_code` 这类 PTC 工具去调 `generate_image`，外层 `run_code` 的默认 120 秒会先到。当普通工具直接调则没有这层。

## 已知限制

- 四套 wire（chat / anthropic / genai / responses）各自解析 SSE；**图片按各协议发送** —— chat 用 `image_url` part、anthropic 用 `source.base64`、genai 用 `inlineData`、responses 用 `input_image`。发送前先按 `imageMaxEdge` / `imageMaxBytes` 重编码（见「图片压缩」），所以线上字节与媒体类型未必等于附件里的原图。**工具结果里的图片也发**（`read_image` 的结果就是一段文本信封 + 一张图）：anthropic 把图塞回同一个 `tool_result` 的 content 块数组；genai 在同一 user turn 的 parts 里补 `inlineData`；chat 的 tool 消息只能放字符串、responses 的 `function_call_output` 同理，所以图跟在**整段连续工具结果之后**的一条 user 消息 / 条目里（并行调用时不会把 tool 消息切断）。字节由 `attachments.readImage` 在请求前内联；没有 attachments 服务或读不出来会**让请求失败**，不再静默降级成纯文本（曾经就是这样：贴的截图模型根本收不到）。会话里被 image-offload 标记的图片（`offloaded: true`）不发字节；插件也不替它生成占位文本，所以那一次图片对模型完全不可见。文件块（非图片附件）仍不发；`/model` 弹窗仍是内置平铺列表；箭头键盘导航未接。
- **genai 线的并行工具调用必须收在同一个 user turn 里**：Gemini 校验「一个 functionCall turn ↔ 紧随其后那条 user turn 里等量的 functionResponse parts」，每条工具结果各开一条 user turn 会被上游拒成 400 `Please ensure that the number of function response parts is equal to the number of function call parts of the function call turn`。它是**确定性**错误：历史不变就必然复现，重试、换分组都无用，只能新开会话（0.16.1 及以前踩中过一次：一轮发了 6 个并行 `read`，整轮就此作废）。0.16.2 起把整段连续的工具结果折进同一个 user turn；Gemini ≥ 3 另给 `functionCall` / `functionResponse` 带上 `id`（同一个函数被并行调多次时才分得清谁答谁），`gemma*` 与更早的 Gemini 不发该字段，只按函数名匹配。
- **anthropic 线的工具结果同样必须合批**：messages API 校验「一条 assistant turn 的 `tool_use` ↔ 紧随其后那条 user turn 的 `tool_result`」一一对应。并行调用时若每条结果各开一条 user 消息，网关报 400 `Invalid message sequence: tool_use and tool_result blocks must be correctly paired and ordered`（0.17.1 以前 anthropic 线就是这个形状 —— genai 线 0.16.2 修了同类问题，anthropic 线漏了）。现在整段连续结果折进紧邻 assistant 的那一条 user 消息；结果没记录（中断、fork、压缩裁剪）的调用补一句占位结果；对不上任何调用的结果丢弃；批内混进来的 user 文本移到结果之后；相邻同角色轮次合并、`tool_result` 固定排在 user 消息首位。这条是**请求体形状**的错，与历史记录无关：升级后此前必挂的会话下一轮就能继续。
- **请求体按需 brotli 压缩**：每次请求都带全量工具定义，body 常在几十到几百 KB，带截图时上 MB。上游（New API 的 `DecompressRequestMiddleware`）在解析前解压 `content-encoding` 为 gzip / br / zstd 的 body，实测三条 wire（chat / messages / responses）全通；deflate 不支持，且不带该头就按明文解析。所以 **≥16 KB 的 body 以 brotli quality 5 发送**：实测 57 KB 的工具密集请求压到 468 B、2 MB 真实源码压到 418 KB（19%）。四条聊天 wire 与出图的三条通道（`images` / `genai` / `chat`）共用同一个出口 `postJson`，阈值与回落只有一份 —— 带参考图的出图请求是另一个 base64 大户。选型依据：同 CPU 下 brotli 比 gzip 小 8–14%；zstd level 3 与 gzip 等大但快 5 倍，只在 CPU 吃紧时更优；而 brotli 的**运行时默认 quality 是 11**，2 MB 上要 3.7 秒，必须显式钉 5。低于阈值走明文 —— 那么小的上行不值一次压缩加解压。图片主导的请求收益有天花板（base64 编码的已压缩图只能压到 75%，那 25% 只是还原 base64 膨胀），真正的杠杆仍是 `imageMaxEdge` / `imageMaxBytes`。若上游某天不认该编码（400 且 body 解析失败），同一请求立刻以明文重发一次：被拒的请求从未计费，代价是一个往返而不是整次调用。
- 四套 wire 的 SSE 解析都有「帧样本 → 期望 chunk 序列」回归测试（`src/host/wire-parse.spec.ts`），帧样本取自生产网关的真实响应。网关在内容帧上发 `"usage": null`，只有末帧带真值：任何一处把 `usage` 当对象直接读都会让整条流中途崩掉（曾导致 claude 模型全不可用）。
- **每个请求都带会话亲和键**：chat 与 responses 发 `prompt_cache_key`，anthropic 发 `metadata.user_id`，取值都是 DSH 的 `GenerateOptions.sessionId`。站点就是靠这个值挑上游渠道的（New API 的「codex cli trace」规则：`^gpt-.*$` + `/v1/responses`，键取自 body 的 `prompt_cache_key`，取不到就把整条规则跳过），而提示词缓存按**上游账号**存 —— 不带键时每个请求随机换账号，缓存永远不中。实测同一 6k 前缀：不带键连发 4 次 `cached_tokens` 全 0；带键后第 2 次起 5888/6011 ≈ 98%。`/v1/chat/completions` 上目前没有对应规则，chat 线即使带键也只是偶发命中，要彻底解决需要站点加一条匹配该路径的亲和规则；anthropic 线的 `metadata.user_id` 同理（规则只作用于 `/v1/messages`，这一条已经匹配）。
- **anthropic 线显式打缓存断点**：Anthropic 只在 `cache_control` 断点处写缓存，没有断点就整段 prompt 按新输入计价（亲和键只保证落在同一上游账号，不产生缓存）。每个请求打 4 个断点：`tools` 末项、`system` 末块、最后两条消息各自末块 —— harness 每轮全量重放历史，尾部双断点保证下一轮几乎全命中，每轮只写新增片段。实测（Claude Max 超惠分组，~6.3k token 前缀）：无断点连发两次 `cache_read` 全 0；打点后第 2 次起 `in=4, cr=6316`，三轮增长历史 `cr` 累积到 10811、`in` 恒为个位数。断点也覆盖 `tool_result` 结尾的轮次（DSH 会话的常态形态）。
- 推理等级按各协议自己的词汇发送：**anthropic 发 `thinking.type=adaptive` + `thinking.display=summarized` + `output_config.effort`**（不能再用 `thinking.type=enabled` + `budget_tokens`：Claude 5 代直接 400 `requires adaptive thinking`，而 adaptive 在老代际上同样可用，所以统一用它；`minimal` 收敛成 `low`；`display` 不是装饰：不带它，Claude 5 代的 thinking 块正文为空、只填 signature，而不带正文的块回放不出去（回放要与签名配对送出），界面上就表现为「这个模型从不思考」——Claude Opus 5.5 实测不带 `display` 正文 0 字符、带 `display=summarized` 正文 55~132 字符）；genai 发 `thinkingConfig` 且带 `includeThoughts`（不带你拿不到思维链）；chat 与 responses 发 `reasoning_effort` / `reasoning.effort`。
- **Gemini 4 换成 `thinkingLevel`**：这一代不再接受 token 预算（发 budget 会 400 `Use thinking level instead`），按 `gemini-<主版本>` ≥ 4 自动切换字段，等级名用 `low` / `medium` / `high` / `max`。
- **思考历史回传**：harness 的 `message.source.replayState` 就是这个槽位。anthropic 线把每个 thinking 块的 `signature_delta` 存进信封，下一轮把 thinking 块带签名放在 assistant 轮最前；responses 线存 reasoning item 的 `encrypted_content`，同在最前发出。两条线都按「provider + 裸模型名」比对，换模型或换 provider 就不回放（密文不通用）；签名/密文缺一个就整轮不回放，宁可没有也不发半截。
- **genai 线的 `thoughtSignature`**：Gemini 3 起强制——工具轮里没有签名的 `functionCall` part 会被 400 `Function call is missing a thought_signature in functionCall parts` 挡下，**每个** model 轮都单独校验（实测：两轮里只签第一轮，同样 400）。签名是上游签发的不可推导密文，插件只透传真值：解析时连"落在空 part 上的签名""晚于最后一个 call 才到的签名"一起收，回放时挂回该轮对应的 `functionCall`（实测挂在自带签名之外的空 part 上无效，必须挂 call）。信封的 `blocks` 必须与 harness 拼出的 block **逐条对齐、长度相等**，否则整个信封被丢弃——早先按"整轮一条元数据"写过，正是这个契约让它静默失效，签名等于没存。它**不**按 provider/模型比对（与另两条线不同）：实测同一签名跨请求、跨 Gemini 模型都可复用，比对了只会把有效签名判掉、反而制造 400。也不合成签名（gemini-cli 的 `SYNTHETIC_THOUGHT_SIGNATURE` 与网关侧的 `context_engineering_is_the_way_to_go` 这类绕过值都没采用），拿不到真签名就让上游拒——错误消息里带中文处置提示。
- **responses 线发 `store:false` 并主动要密文**：`include: ["reasoning.encrypted_content"]` 只在选了推理档位时带上。上游对这两项都不敏感（实测带与不带、两个模型三次组合全部 200），但无状态模式是密文随响应回来的前提，而回放靠的正是那份密文。另有一处曾经的坑：上游有时只在收尾事件里给 reasoning item、不推 `reasoning_summary_text.delta`，早先要求「必须流式出现过思维块」才存信封，把这类轮的密文整个丢了 —— 现在只要拿到 item 就存，放在最前。
- 文本与思维块由**第一个非空 delta** 打开，思维块为空时不产生空块；工具调用块在 `content_block_start` 打开，因为 id 与函数名只在那里出现。
- anthropic 线不硬编码 `max_tokens`：只在调用方给了上限、或开了 thinking 需要余量时才发。给死值会截断长回答。
- `-c` 后缀是站点自己的约定（带该后缀的模型工具调用不可靠）：站点声明了端点类型时插件按声明提供，声明里没有它就不会出现；没有声明时按名字隐藏它的无后缀孪生之外的变体。
- 站点上新但还没在后台填能力的模型：只要声明了端点类型就会提供，容量走 `defaultContextWindow`，模态按纯文本、没有推理档位（除非在 `modelOverrides` 里写明）。这不是 bug，是「站点是唯一真源」的直接后果——补能力请去后台填，不必等插件发版。
- pricing 加载失败时沿用上一次成功的结果，从未成功过则目录为空（失败不写缓存，下次调用会重试）。
- **上游错误映射到共享重试码表**（`src/host/wire-error.ts`）：429→`RATE_LIMIT`、5xx/529/流中途失败→`SERVER`、网络层断连→`TRANSPORT`（fetch 抛错但非用户取消），这三类是 base 组合里 `dsh-llm-retry` 默认策略（5 次、指数退避、读 `retry-after`）会等过去重试的；401/403→`AUTH`、402/余额耗尽→`QUOTA`、400/413→`INVALID_REQUEST`、上下文超限→`CONTEXT_WINDOW_EXCEEDED`、其余→`HTTP_<status>` 保持不可重试。曾经全部抛 `PROVIDER_ERROR`——不在默认可重试集合里，网关一次瞬断就终止整轮（「一遇错误立即停止」的根因）。识别到上面那句 function response 计数对不上的文案时，错误消息里会直接带一句中文处置提示（码仍是 `INVALID_REQUEST`，不进重试集合）。
- 账号卡片的钱是**两次读**拼接的：授权那一刻 grant 里的 `user` 给出身份事实，余额/已用/代金券则来自站点 `/api/dsh/device/wallet`——Host 每 5 分钟读一次，页面在余额旁另有**立即刷新**按钮（`POST /neartoken/refresh`，读完后把同一份状态回给页面），所以不必重连也能看到新数字。落盘到 profile 下的 `neartoken-account.json` 只作重启回退。站点若没有该端点或读不到，卡片保留上一次的数字、不会清空。代金券为空时卡片给一句去「邀请计划」（站点 `/wallet` 页）领免费代金券的提示。
- 白名单按裸模型名过滤：勾掉某模型会把它的所有分组一起隐藏；某个正在使用的模型被勾掉后，会话里已选中的 id 仍在，但选择器里不再列出它。
- 白名单写入走 DSH 的 Settings：profile 里该行只保留 volatile 字段，所以别把 `baseURL` 等非 volatile 字段写进**同一个 profile 行**（会在此后第一次保存白名单时被 Settings 的 strip 规则清掉）。
- 生图一次一张；`size` 对 images 通道只是建议，上游常忽略（实测不传 size 时 gpt-image-2.5-flare 出 1536x1024）。
- 生图结果默认只存 attachment；要给文件就传 `path`（必须是不存在的路径，且只对本地文件系统后端生效）。
- 生图失败按站点原话报错（限流、渠道无可用 channel、模型不支持该端点都会原样透出），不重试、不跨分组兜底 —— 换分组是用户的决定。
- 数据概览读的是**站点侧**的用量端点，插件自己不做统计也不落盘：站点没升级就只显示一行「站点未提供用量统计。」。金额换算沿用站点 `/api/status` 的 `quota_per_unit` / `usd_exchange_rate`，与账号卡片同源，两块数字不会互相打架。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run test       # vitest：account / pricing / adapter / model-caps / groups / whitelist / routes / usage / config / affiliate / wire-parse / images / image-settings / image-tool
pnpm run typecheck  # 两个 face 分别检查（host 与 client 的 ctx.sessions 声明互相冲突，不能同 program）
pnpm run build      # lib/index.js (host) + lib/client.js (client) + lib/types
```