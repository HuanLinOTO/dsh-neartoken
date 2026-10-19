# HANDOFF：New API ↔ DSH 的两件事（设备授权接入 + 分组路由）

> 面向 new-api（D:\Projects\new-api）与 `dsh-neartoken` 两侧的共同契约。
> 分两部分：**第 1 节是采编入（缺口，new-api 侧待实现）**，第 2~4 节是分组路由（new-api 侧待实现）。
> DSH 侧已按本文件实现完毕。

---

# 第一部分：设备授权接入（RFC 8628 形状）

## 1.0 为什么不是「插件收密码」

DSH 插件运行在同一台机器上的 Host 进程里。让插件收集站点用户名密码、经 Host 转发 `/api/user/login`，等于把密码交给一个第三方进程，还绕过了站点自己的 2FA/passkey/Turnstile 策略。正确做法是设备授权流：**用户在站点自己的浏览器页面登录，插件只轮询结果**。

## 1.1 端点契约（已冻结，字段名不得改）

### ① 发起授权（插件 → 站点，匿名）

```
POST /api/dsh/device/authorize
body: { "client_name": "DSH 插件" }

200 {
  "success": true,
  "data": {
    "device_code": "<32 字节 crypto/rand 的 base64url>",
    "user_code": "K7QM-3XPD",
    "verification_uri": "https://<site>/dsh/device",
    "verification_uri_complete": "https://<site>/dsh/device?user_code=K7QM-3XPD",
    "expires_in": 600,
    "interval": 5
  }
}
```

- `device_code` 只下发一次，服务端只存 SHA-256/HMAC
- `user_code` 人可读 8 字符，排除 `0 O 1 I`；生成后查重
- `expires_in` 秒（默认 600），`interval` 秒（默认 5）

### ② 浏览器确认页（人在站点上完成）

```
GET /dsh/device?user_code=K7QM-3XPD
```

- 后端渲染的极简 HTML 页（**不要改前端 SPA 工程**）
- 未登录 → 跳站点登录页，登录后回到本页（复用站点既有跳转约定）
- 已登录 → 显示「DSH 插件请求接入」+ 批准/拒绝按钮，页面内联 JS 调 ③ ④

### ③ 查询待批准的请求（需 dashboard 登录态）

```
GET /api/dsh/device/pending?user_code=K7QM-3XPD
200 { "success": true, "data": { "user_code": "...", "client_name": "...", "status": "pending|approved|denied|expired", "created_at": "..." } }
```

### ④ 批准 / 拒绝（需 dashboard 登录态）

```
POST /api/dsh/device/decide
body: { "user_code": "K7QM-3XPD", "approve": true }
200 { "success": true, "data": { "status": "approved|denied", "token_name": "DSH" } }
```

### ⑤ 轮询结果（插件 → 站点，匿名）

```
POST /api/dsh/device/token
body: { "device_code": "<device_code>" }

# 已批准
200 { "success": true, "data": {
  "access_token": "<48 字符裸 key，与 /v1/chat/completions 的 Bearer 完全一致>",
  "token_type": "Bearer",
  "token_name": "DSH",
  "user": { ...与登录应答同款的 buildSelfUserData... }
} }

# 未完成：必须是 HTTP 200 + success:false + 下面这四个精确字符串
200 { "success": false, "message": "authorization_pending" }
200 { "success": false, "message": "slow_down" }
200 { "success": false, "message": "access_denied" }
200 { "success": false, "message": "expired_token" }
```

> 这四种「未完成」状态**不要**用 4xx 区分：插件按 `message` 字符串判定，用状态码区分会让插件把「等待中」当成错误。

### ⑥ 撤销（插件 → 站点，用 key 自证）

```
POST /api/dsh/device/revoke
Authorization: Bearer <access_token>
200 { "success": true }
```

幂等：token 已不存在也返回成功（插件「断开连接」时调用）。

## 1.2 实现要求

1. `access_token` 必须是现有 `Token` 表里该用户的 key（`GetFullKey()` 的 48 字符裸串），与 relay 直接兼容
2. 批准时**幂等**：该用户已有名为 `DSH` 的 token 就复用并读其 key，没有才创建；创建必须遵守 `controller.AddToken` 的同一套不变量（`operation_setting.GetMaxUserTokens()` 上限、额度/分组默认值），不得绕过配额限制
3. 存储建议新表（不要动 `model.AuthFlow` 的既有语义）：
   `dsh_device_flows(Id, DeviceCodeHash uniqueIndex, UserCode uniqueIndex, ClientName, UserId, TokenId, Status, CreatedAt, ExpiresAt, ConsumedAt)`，在 `model/main.go` 的 `AutoMigrate` 列表注册
4. 安全：决定后 `device_code` 立即作废；同 `device_code` 在 `interval` 内重复轮询返回 `slow_down`；`user_code` 连续错误尝试要限流；过期记录需清理
5. 风格跟随仓库现有 controller/model/service 分层与 `common.ApiSuccess` / `common.ApiErrorT` 封装

## 1.3 DSH 侧的消费方式（已实现，供对照）

| 步骤 | DSH 行为 |
|---|---|
| 用户点「连接 NearToken」 | Host 调 ①，把 `user_code`/`verification_uri_complete` 显示在设置页 |
| 用户在浏览器确认 | Host 按 `interval` 轮询 ⑤；`slow_down` 时退避 +2s |
| 拿到 grant | 写 `NEARTOKEN_API_KEY` → 挂上 `neartoken` provider → 模型出现 |
| 用户点「断开连接」 | 删本地凭据 + 调 ⑥ |

---

# 第二部分：分组路由

## 2. 分组 ref（`/api/pricing`）

`/api/pricing` 需在既有字段之外提供：

```json
{
  "group_refs": { "<分组名>": "#<id>" }
}
```

语义：

1. `<id>` 是**不随分组改名而变的稳定编号**；组名只用于展示，改名后 ref 不变。
2. DSH 只接受形如 `#<数字>` 的值：其它形态（含原样组名）一律视为「无 ref」，该分组不发路由头。
3. 拿不到 ref 的分组照常可选，只是不发 `X-Neartoken-Group`，退回令牌自身分组。

## 3. 正式 relay 认分组

**让正式 relay 路径接受 `X-Neartoken-Group: #<id>`。**

行为规格：

1. 读取时机：TokenAuth 之后、渠道选择之前（`Distribute()` 入口处即可）。
2. 值形态：纯 ASCII 的 `#<id>`，**不是**分组名——中文组名不是合法 HTTP header 值，会在客户端被 undici 的 ByteString 校验拦下。
3. 解析：`#<id>` → 分组名，走分组注册表 `model.ResolveGroupRef`（内存缓存 + DB 读穿；分组改名后同一 ref 仍解析到当前组名）；未注册的 ref 直接 400，不得静默按其它分组路由。
4. 校验：`service.CanUseGroup(当前 UsingGroup, headerGroup, admin)` —— 与游乐场 `body.group` 完全同一套语义；不通过 → 403（复用 `MsgAuthTokenGroupForbidden` 文案）。
5. 通过 → `common.SetContextKey(c, constant.ContextKeyUsingGroup, headerGroup)`，后续选渠道/计费自动按新分组走。
6. **无该头时行为必须完全不变**（所有现有客户端零影响）。

参考实现位置：`middleware/distributor.go` 里 `isPlaygroundRelayPath` 分支旁边加一个对称的 header 分支，逻辑几乎照抄 L90-104（把 `playgroundRequest.Group` 换成按 `#<id>` 反查出的组名）。

## 4. 前置确认（站点运营侧）

- `CanUseGroup` 基于 `UserUsableGroups[userGroup]`。若某令牌所属分组看不到目标分组，header 会被 403。**需要保证目标用户分组的 usable groups 覆盖要切的分组。**
- 令牌自身若绑定了分组（`token.Group` 非空），建议视为该令牌锁定分组、忽略 header（或允许 usable 范围内切换，二选一，告知 DSH 侧无需感知）。

## 5. 验收用例

1. **授权接入**：设置页点「连接 NearToken」→ 设置页显示确认码 → 浏览器打开确认页 → 站点登录 → 批准 → 插件自动接入、模型选择器出现 NearToken 模型；再点一次「连接」不会重复创建第二个 `DSH` 令牌。
2. **拒绝 / 过期**：站点上点拒绝 → 插件设置页显示「站点上拒绝了本次授权」；超时不做决定 → 显示超时并可重新发起。
3. **断开**：点「断开连接」→ 本地凭据删除、provider 撤下、站点上该 `DSH` 令牌被撤销。
4. **分组路由**：令牌 T（default 分组），`POST /v1/chat/completions`，model=`grok-4.6`，header `X-Neartoken-Group: #7`（`#7` 对应 `[低价] Grok`）→ 命中该分组渠道，日志按 `group_ratio`（0.1）计费。
5. 同请求去掉 header → 行为与改造前完全一致。
6. header 指向不可用分组 → 403，错误信息含分组名；header 值为组名或解析不到的 id → 400。

## 6. DSH 侧对接点速查

| 项 | 位置 |
|---|---|
| 设备授权客户端 | `src/host/device-flow.ts`（authorize / poll / revoke，路径常量在文件顶部） |
| 授权编排与轮询循环 | `src/host/account.ts`（`begin` / `cancel` / `signOut`） |
| 设置页同源路由 | `src/host/routes.ts`（`/neartoken/status|authorize|cancel|logout`） |
| provider 挂载 | `src/host/provider-mount.ts`（有 key 才注册路由） |
| header 名 | `src/host/adapter.ts` `stream()` 里 `'x-neartoken-group'`（值取自 `route.groupRef`） |
| 分组数据源 | `GET <baseURL>/api/pricing`（`src/host/pricing.ts`，TTL 5 分钟） |
| `group_refs` 解析 | `src/host/pricing.ts` `parsePricing()`，语法常量 `GROUP_REF_PATTERN = /^#[0-9]+$/` |
| catalog id 编码 | `"<group>::<model>"`（`expandRoutes`），请求时按**最后一个** `::` 解码回裸模型名 + ref |
| 凭据落点 | 引用 `NEARTOKEN_API_KEY`（不写任何配置文件） |
