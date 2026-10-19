<p align="center">
  <a href="https://dshfind.com/zh/plugins/huanlinoto/dsh-neartoken"><img src="https://dshfind.com/api/card/huanlinoto/dsh-neartoken?lang=zh" alt="dsh-neartoken card"></a>
</p>
# dsh-neartoken

把 New API 站点（NearToken，`https://llm.pko.svcfusion.com`）变成 DSH 的模型供应商：**在设置页发起设备授权 → 用户在自己浏览器里登录站点并确认 → 插件自动接入 `neartoken` provider**。插件全程不接触密码。模型选择器再把这批模型按 New API 的渠道分组折成 **模型 → 分组 → 推理等级** 三级。

## 架构

插件只在三条流向上说话，其余都是它们的支撑：

| 流向 | 路径 |
|---|---|
| **登录** | 设置页 → `POST /neartoken/authorize` → 站点 `POST /api/dsh/device/authorize` 拿到确认码 → 用户在自己浏览器里批准 → 插件按 `interval` 轮询 `POST /api/dsh/device/token`（`authorization_pending` / `slow_down` 退避 +2s / `access_denied` / `expired_token` / `granted`）→ 把站点铸造的 key 写进 credentials 的 `NEARTOKEN_API_KEY` |
| **目录** | `GET /api/pricing`（TTL 缓存）→ 按 (分组, 模型) 展开成 `"<组>::<模型>"` → 可见性过滤 → `listModels` 交给 DSH |
| **出字** | `stream()` → 按模型选协议 → 站点 `/v1/messages`、`/v1beta/models/*:streamGenerateContent`、`/v1/responses`、`/v1/chat/completions`。`body.model` 是裸模型名，`x-neartoken-group` 头带分组的 `#<id>` |

一条实现约束：provider 只有在凭据存在时才挂载，且 `credentials` 服务可能晚于本插件就绪，所以启动时先同步一次、再用 `ctx.inject` 同步一次。

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 配置 schema、按凭据现状挂载 provider、装配其余模块 |
| `src/host/account.ts` | RFC 8628 形状的设备授权：发起、按 interval 轮询、把 key 写进 credentials |
| `src/host/routes.ts` | 设置页调用的同源路由（状态 / 授权 / 取消 / 断开 / 模型白名单） |
| `src/host/whitelist.ts` | 白名单读写在插件自身 Config 的 `enabledModels`（volatile），存 profile patch |
| `src/host/pricing.ts` | 拉 `/api/pricing`，展开成 `"<组>::<模型>"` 路由，过滤出能聊的模型 |
| `src/host/model-caps.ts` | 一个模型能不能聊、上下文窗口多大、可选的推理等级 |
| `src/host/adapter.ts` | 目录、元数据、按模型选协议并流式解析 |
| `src/host/*-wire.ts` | 四条上游协议各自的请求体与 SSE 解析 |
| `src/host/protocol-router.ts` | 按模型选上游协议（claude / gemini / gpt / 其余） |
| `src/host/provider-mount.ts` | 路由挂载、撤下、白名单变更时 `replace()` 重播 |
| `src/client/` | 设置页、模型选择器、分组胶囊渲染 |

## 使用

1. 装插件、重启 `dsh web`、硬刷新。
2. 打开 **设置 → NearToken**，点「连接 NearToken」。
3. 设置页显示确认码；点「打开浏览器确认」，在站点自己的页面登录（密码、2FA、passkey 都走站点原生流程）并批准。
4. 插件轮询到批准后自动完成：把站点为该插件铸造的 API key 写进 credentials 的 `NEARTOKEN_API_KEY`，并挂上 `neartoken` provider。
5. 「断开连接」删掉本地凭据、撤掉 provider，并调用站点的撤销端点。
6. 卡片下方的「模型白名单」勾选即自动保存 —— 未勾选的不再出现在模型选择器里，且当场生效（Host 用 `AdapterRegistrationHandle.replace()` 重新声明同一条路由，同步发布 `llm/adapters-updated`，浏览器重拉目录）。没设置过白名单时默认全部显示，「全部显示」清空白名单。

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
| `enabledModels` | `[]` | 模型白名单（裸模型名）；空数组 = 全部显示。唯一 volatile 字段，设置页直接写它 |

`modelOverrides` 是「站点没声明、目录还没收录」时的兜底手段，改完重启即生效，**不需要发新版本**：

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
2. 无论站点声明什么，`-c` 后缀与媒体名（image / tts / transcribe / asr）都不提供 —— 定价接口把这些路由也挂在 `openai` 这个 surface 下，只看声明会把生图和语音模型塞进聊天选择器。
3. **站点没声明时**回退到名字规则：pi-ai 目录里没有的名字不提供。

## 容量与推理等级

上下文窗口（`contextWindow`）决定两件事：对话里的占用率显示，以及自动压缩的阈值。**它缺失时自动压缩会直接放弃**（compaction 后端拒绝为无界模型计算摘要预算），所以插件永远会给出一个值。优先级：

| 优先级 | 来源 | 维护方式 |
|---|---|---|
| 1 | `modelOverrides` | 改 profile 配置，重启 |
| 2 | 站点 `/api/pricing` 的 `context_window` | 在 New API 管理后台维护，见下 |
| 3 | pi-ai 生成表（`src/host/model-caps.generated.ts`） | `pnpm run gen:model-caps` |
| 4 | `defaultContextWindow` | 改 profile 配置 |

**推荐在站点侧维护**：New API 管理后台可以给每个模型填上下文窗口与最大输出，`/api/pricing` 会把它们作为 `context_window` / `max_tokens` 发出来。这样一台站点的容量对**所有客户端一致生效**，插件不需要跟着站点上新模型发版。维护步骤见 new-api 仓库 `AGENTS.md` 的「模型容量清单」一节。

最大输出（`max_tokens`）只在**站点或配置明确给出**时才写进请求；生成表里的 `maxTokens` 是厂商口径，站点可能把同一个名字路由到上限更低的渠道，照发会把「回答被截断」换成「请求被拒」，所以不用它。不给出该字段时由上游默认值决定。

推理等级来自 `@earendil-works/pi-ai` 的模型目录（DSH 的 `llm-pi-ai` 用的同一份数据）。插件不在运行时依赖它：`scripts/gen-model-caps.mjs` 把目录生成成 `src/host/model-caps.generated.ts`（1101 个 chat 模型、486 个带推理档位、1101 个带上下文窗口），升级依赖后跑 `pnpm run gen:model-caps` 重建。同一模型 id 在不同 provider 下可能给出不同档位（网关常只列两档，厂商列六档），生成时取**最完整**的那份；上下文窗口取**最小**的那份。

## 已知限制

- 四套 wire（chat / anthropic / genai / responses）各自解析 SSE；图片与文件仍以占位文本发送；`/model` 弹窗仍是内置平铺列表；箭头键盘导航未接。
- 四套 wire 的 SSE 解析都有「帧样本 → 期望 chunk 序列」回归测试（`src/host/wire-parse.spec.ts`），帧样本取自生产网关的真实响应。网关在内容帧上发 `"usage": null`，只有末帧带真值：任何一处把 `usage` 当对象直接读都会让整条流中途崩掉（曾导致 claude 模型全不可用）。
- 推理等级按各协议自己的词汇发送：**anthropic 发 `thinking.type=adaptive` + `output_config.effort`**（不能再用 `thinking.type=enabled` + `budget_tokens`：Claude 5 代直接 400 `requires adaptive thinking`，而 adaptive 在老代际上同样可用，所以统一用它；`minimal` 收敛成 `low`）；genai 发 `thinkingConfig` 且带 `includeThoughts`（不带你拿不到思维链）；chat 与 responses 发 `reasoning_effort` / `reasoning.effort`。
- **Gemini 4 换成 `thinkingLevel`**：这一代不再接受 token 预算（发 budget 会 400 `Use thinking level instead`），按 `gemini-<主版本>` ≥ 4 自动切换字段，等级名用 `low` / `medium` / `high` / `max`。
- 思考历史**不回传**：harness 的 reasoning 块没有 signature 槽位，anthropic 的 `signature_delta` 与 gemini 的 `thoughtSignature` 都被丢弃。当前网关的转换层本身也会丢弃 thinking 块，所以多轮不会因此报错；接真正的 Anthropic / Gemini 直连渠道时这一条会变成硬限制。
- 文本与思维块由**第一个非空 delta** 打开，思维块为空时不产生空块；工具调用块在 `content_block_start` 打开，因为 id 与函数名只在那里出现。
- anthropic 线不硬编码 `max_tokens`：只在调用方给了上限、或开了 thinking 需要余量时才发。给死值会截断长回答。
- `-c` 后缀是站点自己的约定（带该后缀的模型工具调用不可靠）：站点声明了端点类型时插件按声明提供，声明里没有它就不会出现；没有声明时按名字隐藏它的无后缀孪生之外的变体。
- 站点上新、pi-ai 目录还没收录的模型：只要站点声明了端点类型就会提供，容量走 `defaultContextWindow`，推理等级为空（除非在 `modelOverrides` 里写明）。
- pricing 加载失败时沿用上一次成功的结果，从未成功过则目录为空（失败不写缓存，下次调用会重试）。
- 账号卡片不自动刷新：数字只来自授权那一刻 grant 里的 `user`（站点的 dashboard 接口认浏览器会话，不认本插件持有的 relay key），落盘到 profile 下的 `neartoken-account.json`，重启后从文件恢复。之后余额变化不会反映，需要重新连接一次。
- 白名单按裸模型名过滤：勾掉某模型会把它的所有分组一起隐藏；某个正在使用的模型被勾掉后，会话里已选中的 id 仍在，但选择器里不再列出它。
- 白名单写入走 DSH 的 Settings：profile 里该行只保留 volatile 字段，所以别把 `baseURL` 等非 volatile 字段写进**同一个 profile 行**（会在此后第一次保存白名单时被 Settings 的 strip 规则清掉）。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run test       # vitest：account / pricing / adapter / model-caps / groups / whitelist / routes / config / wire-parse
pnpm run gen:model-caps   # 升级 @earendil-works/pi-ai 后重建能力表
pnpm run build      # lib/index.js (host) + lib/client.js (client) + lib/types
```
