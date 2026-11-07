# AGENTS.md — dsh-neartoken

## 这个仓库里的“插件”指什么

“插件”= **本仓库这个 npm 包 `dsh-neartoken`**，即 DeepSeek Harness（DSH）的一个 cordis 插件，不是 DSH 主仓里的某个包，也不是 New API 站点。

它有两半，改任何一端都要知道另一半的存在：

| 半 | 入口 | 负责什么 |
| --- | --- | --- |
| host（Node） | `src/index.ts` 的 `apply()` | 注册 `neartoken` provider 路由、`/api/neartoken/*` 设置页接口、模型面工具（`generate_image`、`exa_search`、`exa_fetch`） |
| client（浏览器） | `src/client/index.ts` | Settings → NearToken 页面、模型/分组座位、徽标 |

打包：`tsdown` 产出 `lib/index.js` + `lib/client.js`；`cordis.patch.yml` 是 bundle patch，往 dshClient roster 插一行 `ui-neartoken-provider`。

## 路径

| 东西 | 路径 |
| --- | --- |
| 本仓库 | `D:/Projects/deepseek-harness/dsh-neartoken` |
| DSH checkout | `D:/Projects/deepseek-harness/dsh`（peer 依赖全部以 `link:` 指向它，改了 DSH 包不用重装） |
| 站点实现 | `D:/Projects/NearToken/new-api`（New API fork，跑在 neartoken.cc） |
| Exa 中转（站点侧） | `router/relay-router.go` 的 `/v1/exa/*`、`relay/helper/exa_request.go` 的计费单位推导 |
| 构建产物 | `lib/`（生成物，不要手改） |

## 命令

```bash
bun install          # 依赖（link: 指向 DSH checkout）
bun run typecheck    # tsc 两套（host / client）
bun run test         # vitest，*.spec.ts 与源文件同目录
bun run build        # tsc + tsdown 出 lib/
bun run watch        # 只跑 tsdown watch
```

改完 host 代码若要生效，需要在运行 DSH 的环境里重新 `build`；client 端改动还要 DSH 侧 `pnpm run dev:web` 才会热更。

## 约定

- **模型面工具**一律用 `defineTool`（`@deepseek-ai/dsh-tools`），在 `ctx.inject(['tools'], toolCtx => …)` 里用 `toolCtx.effect(...)` 注册并返回 disposer。开关即“是否注册”，不要注册一个每次都拒绝的工具。
- **工具命名**：不要占用 `web_search` / `web_fetch` —— 别的搜索插件可能同时挂载，同名会互相顶掉。本插件的搜索工具是 `exa_search` / `exa_fetch`。
- **出站 HTTP** 都从 `src/host/*-client.ts` 走。头部固定为 `attributionHeaders()` + `clientHeaders()` + `Authorization: Bearer <key>`；分组路由用 `x-neartoken-group: "#3"`（值取 catalog 的 `groupRef`，不是分组名）。
- **计费不在插件里算**：`exa-search` / `exa-contents` 的单价是 `0.001 USD / unit`，一次调用多少 unit 由站点按请求体推导（`relay/helper/exa_request.go`）。插件只决定“打哪个端点、走哪个分组、结果截多长”。
- **测试**：与被测文件同目录的 `*.spec.ts`，vitest；纯函数优先，`fetch` 由依赖注入（见 `exa-client.spec.ts`）。
- 代码注释、JSDoc、提交信息用英文；面向用户的中文文案只出现在 client 页面。
