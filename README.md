<p align="center">
  <a href="https://dshfind.com/zh/plugins/huanlinoto/dsh-neartoken"><img src="https://dshfind.com/api/card/huanlinoto/dsh-neartoken?lang=zh" alt="dsh-neartoken card"></a>
</p>
# dsh-neartoken

把 New API 站点（NearToken，`https://llm.pko.svcfusion.com`）变成 DSH 的模型供应商：**在设置页发起设备授权 → 用户在自己浏览器里登录站点并确认 → 插件自动接入 `neartoken` provider**。插件全程不接触密码。模型选择器再把这批模型按 New API 的渠道分组折成 **模型 → 分组 → 推理等级** 三级。

## 架构

```
┌─ host 半边（src/index.ts + src/host/）────────────────────────────┐
│ NearTokenAccount（account.ts）+ DeviceAuthorizationClient          │
│   · POST /api/dsh/device/authorize  → 拿 device_code + user_code   │
│   · 后台按 interval 轮询 POST /api/dsh/device/token                │
│     authorization_pending / slow_down(+2s 退避) / access_denied /  │
│     expired_token / granted                                        │
│   · granted → 写 credentials 的 NEARTOKEN_API_KEY → 挂 provider    │
│ routes.ts：webServer 同源路由（设置页调用）                         │
│   GET  /neartoken/status   POST /neartoken/authorize               │
│   POST /neartoken/cancel   POST /neartoken/logout                  │
│   GET  /neartoken/models   POST /neartoken/models（模型白名单）      │
│ whitelist.ts：白名单读/写                                          │
│   · 存插件自身 Config 的 enabledModels（volatile），经 settings.update │
│     写入 profile patch；volatile 使改动热提交、不重挂插件             │
│   · 空数组 = 没设白名单 = 全部显示                                   │
│ NearTokenProvider（provider-mount.ts）                             │
│   · 有 key → registerAdapter + registerConfigurableProviders        │
│   · 没 key → 撤掉路由（列表里不会出现调不通的模型）                 │
│ NearTokenAdapter（adapter.ts）                                     │
│   · listModels: GET /api/pricing → (group, model) 笛卡尔展开        │
│     catalog id = "<group>::<model>"，name = "<model> @ <group>"     │
│     再按「模型过滤」与白名单（裸模型名）过滤；stream 用同批路由找分组│
│   · stream:     按模型自动选协议（protocol-router.ts）              │
│     claude*→/v1/messages  gemini*→/v1beta/models/*:streamGenerate-  │
│     Content  gpt*/o1·o3·o4*→/v1/responses  其余→/v1/chat/completions│
│     body.model = 裸模型名                                           │
│     header x-neartoken-group = 分组的 ref "#<id>"（不是分组名）      │
└────────────────────────────────────────────────────────────────────┘
┌─ client 半边（src/client/）────────────────────────────────────────┐
│ settings.section（order -5，账号与余额 ↔ 通用设置之间）              │
│   NearTokenSection：连接按钮 / 确认码 + 打开浏览器 / 账号卡片 / 断开  │
│     + 模型白名单（搜索、全选、清空、全部显示、保存）                 │
│       · 行内：模型名 + 分组数 + 最低倍率胶囊；分组明细 hover 出浮层   │
│       · 分组名按站点规则渲染成彩色 tag 胶囊（低价=绿、反重力=青…）    │
│       · 只列出可提供的模型（见下「模型过滤」）                       │
│ conversation.input.model（priority -1 覆盖内置模型座）              │
│   · name 按 " @ " 拆回 (模型, 分组)，同模型折叠成一行                │
│   · 触发器显示 "Claude Opus 5 C @ NearToken"，不渲染分组             │
│   · 列表项按 displayModelName 美化（- → 空格，逐词首字母大写）        │
│   · 分组只在「分组」那一级里出现（"[低价][反重力] Claude" → tag 胶囊）│
│   · 倍率从 catalog description（"分组倍率 0.4x"）解析显示            │
│   · 数据仍走 ctx.modelDirectories（与 /model 弹窗同一份状态）        │
└────────────────────────────────────────────────────────────────────┘
```

## 使用

1. 装插件、重启 `dsh web`、硬刷新。
2. 打开 **设置 → NearToken**，点「连接 NearToken」。
3. 设置页显示一个确认码；点「打开浏览器确认」，在站点自己的页面里登录（密码、2FA、passkey 都走站点原生流程）并批准。
4. 插件轮询到批准后自动完成：把站点为该插件铸造的 API key 写进 credentials 的 `NEARTOKEN_API_KEY`，并挂上 `neartoken` provider —— 模型选择器里立刻出现按分组折叠的模型。
5. 「断开连接」删掉本地凭据、撤掉 provider，并调用站点的撤销端点。
6. 卡片下方的「模型白名单」勾选即自动保存（无需点保存）——未勾选的不再出现在模型选择器里，且**当场生效、不用刷新页面**：保存后 Host 用 `AdapterRegistrationHandle.replace()` 重新声明同一条路由，它会同步发布 `llm/adapters-updated`，浏览器收到后重拉模型目录。没设置过白名单时默认全部显示；「全部显示」清空白名单。

备用路径：直接让 credentials 服务存 `NEARTOKEN_API_KEY`（Web 端 Models 页写入），或启动环境导出同名变量——provider 会在启动时按凭据现状挂载。

> 这依赖 new-api 侧实现设备授权流端点，契约见 [HANDOFF-new-api.md](HANDOFF-new-api.md) 第一部分。站点尚未实现时，第 2 步会直接报「站点拒绝发起设备授权」。

分组路由按同一文档第二部分：请求头 `x-neartoken-group` 的值是 `/api/pricing` 的 `group_refs` 给出的 **`#<id>`**（纯 ASCII），分组名只用于展示；某分组没有 ref 时不发该头，按令牌自身分组路由。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseURL` | `https://llm.pko.svcfusion.com` | 站点根地址，不带尾斜杠 |
| `apiKeyEnv` | `NEARTOKEN_API_KEY` | 授权写入、adapter 读取的凭据引用名 |
| `catalogTtlMs` | `300000` | `/api/pricing` 目录缓存时长 |
| `enabledModels` | `[]` | 模型白名单（裸模型名）；空数组 = 全部显示。唯一 volatile 字段，设置页直接写它 |

## 原型阶段的硬编码

| 位置 | 内容 |
|---|---|
| `src/client/groups.ts` `GROUPED_PROVIDERS` | 哪些 provider 的模型名带分组后缀（当前 `['neartoken']`） |
| `src/host/adapter.ts` `REASONING` | 所有路由统一通告 low/medium/high（演示值） |
| `src/client/groups.ts` `badgeOf` | badge 颜色规则：含「低价」→绿，「满血」→黄，其余→蓝 |
| `src/host/account.ts` `CLIENT_NAME` | 确认页上显示的客户端名 |

改完 `pnpm run build` + 浏览器硬刷新即可（profile 是 `link:` 引用）。

## 模型过滤与推理等级

站点 `/api/pricing` 会列出它知道的所有模型，插件只提供能描述的那个子集（`src/host/model-caps.ts`）：

| 隐藏条件 | 例子 |
|---|---|
| 名字以 `-c` 结尾 | `claude-opus-5-c`（站点总有一个同名无后缀的孪生） |
| 名字含 image / tts / transcribe / asr | `gpt-image-2.5-flare`、`gemini-3.8-flash-tts` |
| 不在模型能力表里 | `glm-5.0`、`grok-4.5量`、`qwen3-coder-plus` |

推理档位来自 `@earendil-works/pi-ai` 的模型目录（DSH 的 `llm-pi-ai` 用的同一份数据）。插件不在运行时依赖它：`scripts/gen-model-caps.mjs` 把目录生成成 `src/host/model-caps.generated.ts`（1101 个 chat 模型 / 486 个带档位），升级依赖后跑 `pnpm run gen:model-caps` 重建。表里没有档位的模型照常提供，只是不显示「推理等级」这一级，请求也不带 `reasoning_effort`。

同一模型 id 在不同 provider 下可能给出不同档位（网关常只列两档，厂商列六档），生成时取**最完整**的那份。

按生产快照：104 个模型 → 保留 49 个，其中 40 个有真实档位。

## 已知限制（原型）

- 四套 wire（chat / anthropic / genai / responses）各自解析 SSE；图片与文件仍以占位文本发送；`/model` 弹窗仍是内置平铺列表；箭头键盘导航未接。
- 四套 wire 的 SSE 解析都有「帧样本 → 期望 chunk 序列」回归测试（`src/host/wire-parse.spec.ts`），帧样本取自生产网关的真实响应。网关在内容帧上发 `"usage": null`，只有末帧带真值：任何一处把 `usage` 当对象直接读都会让整条流中途崩掉（曾导致 claude 模型全不可用）。
- 推理等级映射到各协议的**固定 token 预算**：anthropic 发 `thinking.budget_tokens`（minimal 1024 → max 32000），genai 发 `thinkingConfig.thinkingBudget` 且带 `includeThoughts`（不带你拿不到思维链）。chat 与 responses 仍按原样发 `reasoning_effort` / `reasoning.effort`。
- **Gemini 4 换成 `thinkingLevel`**：这一代不再接受 token 预算（发 budget 会 400 `Use thinking level instead`），按 `gemini-<主版本>` ≥ 4 自动切换字段，等级名直接用 `low` / `medium` / `high` / `max`。
- 站点会先上架 pi-ai 目录还没收录的模型。这类名字默认隐藏（不猜能力），`src/host/model-caps.ts` 的 `UNCALLED_MODELS` 是显式放行表，值为实测出来的推理等级（`gemini-4-argon` 就是一条）。目录收录后删掉对应条目即可。
- 思考历史**不回传**：harness 的 reasoning 块没有 signature 槽位，anthropic 的 `signature_delta` 与 gemini 的 `thoughtSignature` 都被丢弃。当前网关的转换层本身也会丢弃 thinking 块，所以多轮不会因此报错；接真正的 Anthropic / Gemini 直连渠道时这一条会变成硬限制。
- anthropic 线不再硬编码 `max_tokens`：只在调用方给了上限、或开了 thinking 需要给它留出余量时才发。给死值会截断长回答。
- pricing 加载失败时沿用上一次成功的结果，从未成功过则目录为空（失败不写缓存，下次调用会重试）。
- 账号卡片不自动刷新：数字只来自授权那一刻 grant 里的 `user`（站点的 dashboard 接口认浏览器会话，不认本插件持有的 relay key），落盘到 profile 下的 `neartoken-account.json`，重启后从文件恢复。之后余额变化不会反映，需要重新连接一次。
- 供应商是授权态驱动的：断开连接后，正在使用 NearToken 模型的会话需要重新选模型。
- 设备授权流依赖 new-api 侧实现，未实现前插件只能走「外部导出 key」的备用路径。
- 白名单按裸模型名过滤：勾掉某模型会把它的所有分组一起隐藏。某个正在使用的模型被勾掉后，会话里已选中的 id 仍在，但选择器里不再列出它。
- 「-c 后缀」是站点自己的约定：带该后缀的模型工具调用不可靠，插件只在界面上标注（设置页与模型选择器），不拦截选择。
- 白名单写入走 DSH 的 Settings：profile 里该行只保留 volatile 字段，所以别把 `baseURL` 等非 volatile 字段写进**同一个 profile 行**（会在此后第一次保存白名单时被 Settings 的 strip 规则清掉）。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm run test       # vitest：account（含设备授权轮询）/ pricing / adapter / groups / whitelist / routes / config
pnpm run build      # lib/index.js (host) + lib/client.js (client) + lib/types
```
