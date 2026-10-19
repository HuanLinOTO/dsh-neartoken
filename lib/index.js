import z from "@deepseek-ai/schemastery";
import { credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import { HarnessError, LlmAdapter, LlmError, attributionHeaders } from "@deepseek-ai/dsh-llm";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brandString } from "@deepseek-ai/dsh-brand";
//#region src/host/new-api.ts
/**
* The one HTTP call every site endpoint shares, and the error taxonomy of the
* answers it can get.
*
* Both the dashboard endpoints and the device-authorization endpoints answer the
* same `{ success, message, data }` envelope, but the device poll reports its
* normal states as `success: false` — so this module hands back the parsed body
* untouched and leaves every judgement to the caller. Only an unreachable site
* or an unparsable body is an error here.
*
* @module
*/
/**
* A dashboard call that could not produce the answer it was made for. The code
* names which layer refused: transport, HTTP status, or the site's own body.
*/
var NewApiError = class extends HarnessError {
	/**
	* @param message - what was called and what came back.
	* @param code - the failure layer (`NEW_API_UNREACHABLE`, `NEW_API_REFUSED`, `NEW_API_RESPONSE_INVALID`).
	* @param options - the underlying cause, when there is one.
	*/
	constructor(message, code, options) {
		super(message, code, options);
		this.name = "NewApiError";
	}
};
/**
* Read one JSON object, or say the value is not one.
* @param value - any parsed JSON value.
* @returns the value when it is a plain object.
*/
function asObject$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/**
* Call one endpoint and return its whole body WITHOUT treating `success: false`
* as a failure.
*
* The device-authorization poll is the reason this exists: every answer that is
* not a grant — still waiting, polled too fast, denied, expired — is a body with
* `success: false` and one fixed message string, and reading that string is
* exactly what the caller needs to do. Only an unreachable site or an unparsable
* body is an error here.
* @param call - the endpoint, its method, and its body.
* @returns the parsed JSON body.
* @throws {NewApiError} when the site could not be reached or answered non-JSON.
*/
async function callNewApiBody(call) {
	const headers = { accept: "application/json" };
	if (call.sessionToken !== void 0) headers.authorization = `Bearer ${call.sessionToken}`;
	if (call.body !== void 0) headers["content-type"] = "application/json";
	let response;
	try {
		response = await fetch(`${call.baseURL}${call.path}`, {
			method: call.method,
			headers,
			...call.body === void 0 ? {} : { body: JSON.stringify(call.body) }
		});
	} catch (error) {
		throw new NewApiError(`NearToken: ${call.path} could not be reached`, "NEW_API_UNREACHABLE", { cause: error });
	}
	const payload = asObject$1(await response.json().catch(() => void 0));
	if (payload === void 0) throw new NewApiError(`NearToken: ${call.path} answered ${response.status} with a non-JSON body`, "NEW_API_RESPONSE_INVALID");
	return payload;
}
//#endregion
//#region src/host/device-flow.ts
/**
* The site's device-authorization flow (RFC 8628 shape): the plugin asks the
* site for a code, the human finishes the sign-in in their own browser, and the
* plugin polls until the site hands over the API key.
*
* No password ever reaches this plugin: the site's own login page authenticates
* the human, and the only thing that travels back is the key the site minted for
* this plugin.
*
* @module
*/
/** Start one authorization. */
const DEVICE_AUTHORIZE_PATH = "/api/dsh/device/authorize";
/** Poll one authorization. */
const DEVICE_TOKEN_PATH = "/api/dsh/device/token";
/** Revoke a key this plugin obtained. */
const DEVICE_REVOKE_PATH = "/api/dsh/device/revoke";
/** One non-empty string member, or undefined. */
function text$2(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** One finite number member, or undefined. */
function num$1(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* The device-authorization endpoints of one site.
*/
var DeviceAuthorizationClient = class {
	baseURL;
	/**
	* @param baseURL - site root without a trailing slash.
	*/
	constructor(baseURL) {
		this.baseURL = baseURL;
	}
	/**
	* Ask the site for a new authorization.
	* @param clientName - how the confirmation page names this device.
	* @returns the codes and the polling schedule.
	* @throws {NewApiError} when the site refuses or answers without a code.
	*/
	async authorize(clientName) {
		const body = await callNewApiBody({
			baseURL: this.baseURL(),
			path: DEVICE_AUTHORIZE_PATH,
			method: "POST",
			body: { client_name: clientName }
		});
		if (body.success !== true) throw new NewApiError(`NearToken: 站点拒绝发起设备授权${messageOf$1(body) ? `: ${messageOf$1(body)}` : ""}`, "DEVICE_AUTHORIZE_REFUSED");
		const data = asObject$1(body.data);
		const deviceCode = text$2(data?.device_code);
		const userCode = text$2(data?.user_code);
		const verificationUri = text$2(data?.verification_uri);
		if (deviceCode === void 0 || userCode === void 0 || verificationUri === void 0) throw new NewApiError("NearToken: 设备授权应答缺少 device_code / user_code / verification_uri", "DEVICE_AUTHORIZE_INVALID");
		const expiresIn = num$1(data?.expires_in) ?? 600;
		const interval = num$1(data?.interval) ?? 5;
		return {
			deviceCode,
			userCode,
			verificationUri,
			verificationUriComplete: text$2(data?.verification_uri_complete) ?? verificationUri,
			expiresAt: Date.now() + expiresIn * 1e3,
			intervalMs: Math.max(1, interval) * 1e3
		};
	}
	/**
	* Ask the site whether the human decided yet.
	* @param deviceCode - the code from {@link authorize}.
	* @returns the outcome; only an unrecognized answer throws.
	* @throws {NewApiError} when the site answers neither a grant nor a known state.
	*/
	async poll(deviceCode) {
		const body = await callNewApiBody({
			baseURL: this.baseURL(),
			path: DEVICE_TOKEN_PATH,
			method: "POST",
			body: { device_code: deviceCode }
		});
		if (body.success === true) {
			const data = asObject$1(body.data);
			const accessToken = text$2(data?.access_token);
			if (accessToken === void 0) throw new NewApiError("NearToken: 设备授权应答缺少 access_token", "DEVICE_TOKEN_INVALID");
			return {
				status: "granted",
				accessToken,
				tokenName: text$2(data?.token_name) ?? "DSH",
				user: asObject$1(data?.user)
			};
		}
		switch (text$2(body.message)) {
			case "authorization_pending": return { status: "pending" };
			case "slow_down": return { status: "slow-down" };
			case "access_denied": return { status: "denied" };
			case "expired_token": return { status: "expired" };
			default: throw new NewApiError(`NearToken: 设备授权轮询返回了未知状态${messageOf$1(body) ? `: ${messageOf$1(body)}` : ""}`, "DEVICE_TOKEN_UNKNOWN");
		}
	}
	/**
	* Revoke one key on the site.
	* @param accessToken - the key to revoke.
	* @returns after the site acknowledged (a key already gone counts as revoked).
	* @throws {NewApiError} when the site refused the revocation.
	*/
	async revoke(accessToken) {
		const body = await callNewApiBody({
			baseURL: this.baseURL(),
			path: DEVICE_REVOKE_PATH,
			method: "POST",
			sessionToken: accessToken
		});
		if (body.success !== true) throw new NewApiError(`NearToken: 站点拒绝撤销令牌${messageOf$1(body) ? `: ${messageOf$1(body)}` : ""}`, "DEVICE_REVOKE_REFUSED");
	}
};
/**
* Read one body's `message` member.
* @param body - the site's answer.
* @returns the message when it carried one.
*/
function messageOf$1(body) {
	return text$2(body.message);
}
//#endregion
//#region src/host/account.ts
/**
* The NearToken account: one device authorization at a time, its poll loop, and
* the stored key that a finished authorization leaves behind.
*
* The plugin never sees a password. {@link begin} asks the site for a code, the
* human signs in on the site's own page, and this class polls until the site
* hands back the key it minted — which is then the only thing written to the
* credential store, under `<apiKeyRef>` (default `NEARTOKEN_API_KEY`).
*
* @module
*/
/** How the site's confirmation page names this plugin. */
const CLIENT_NAME = "DSH 插件";
/** Name the site gives the token it mints, until an answer says otherwise. */
const DEFAULT_TOKEN_NAME = "DSH";
/** How long one `/api/status` currency lookup stays fresh. */
const CURRENCY_TTL_MS = 3e5;
/** Extra wait added after the site answers `slow_down`. */
const SLOW_DOWN_PENALTY_MS = 2e3;
/**
* File the granted account facts are kept in, inside the profile.
*
* The site's dashboard endpoints authenticate a browser session, not the relay
* key this plugin holds, so the numbers cannot be read again afterwards. They
* arrive exactly once — in the grant that minted the key — and are recorded
* here so a restart still shows whose account this is.
*/
const SNAPSHOT_FILE = "neartoken-account.json";
/** One non-empty string member, or undefined. */
function text$1(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** One finite number member, or undefined. */
function num(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* Format one quota amount the way the site's dashboard shows it.
* @param quota - the raw quota units.
* @param currency - the site's formatting facts.
* @returns the amount with its symbol.
*/
function money(quota, currency) {
	const base = currency.quotaPerUnit > 0 ? quota / currency.quotaPerUnit : quota;
	const value = currency.display && currency.rate > 0 ? base * currency.rate : base;
	return `${currency.display ? "￥" : "$"}${value.toFixed(2)}`;
}
/**
* Project one dashboard user object onto the card's fields.
* @param user - the `user` a grant carried, or `/api/user/self`'s data.
* @param currency - the site's formatting facts.
* @returns the account summary; empty strings where the site omitted a field.
*/
function summarize(user, currency) {
	const username = text$1(user?.username) ?? "";
	return {
		username,
		displayName: text$1(user?.display_name) ?? username,
		group: text$1(user?.group) ?? "",
		balance: money(num(user?.quota) ?? 0, currency),
		used: money(num(user?.used_quota) ?? 0, currency)
	};
}
/**
* Read one stored snapshot back into the card's fields.
* @param record - the parsed snapshot file.
* @returns the summary, or undefined when the file is not one.
*/
function asSummary(record) {
	const fields = [
		"username",
		"displayName",
		"group",
		"balance",
		"used"
	];
	const read = [];
	for (const field of fields) {
		const value = record[field];
		if (typeof value !== "string") return void 0;
		read.push(value);
	}
	const [username, displayName, group, balance, used] = read;
	return {
		username,
		displayName,
		group,
		balance,
		used
	};
}
/**
* Render one attempt as the browser-facing pending record.
* @param grant - the attempt's site-issued codes.
* @returns the record the settings page shows.
*/
function pendingOf(grant) {
	return {
		userCode: grant.userCode,
		verificationUri: grant.verificationUri,
		verificationUriComplete: grant.verificationUriComplete,
		expiresAt: grant.expiresAt
	};
}
/**
* Wait, unless the attempt is withdrawn first.
* @param ms - how long to wait.
* @param signal - withdraws the wait.
* @returns after the wait elapses or the signal fires.
*/
function sleep(ms, signal) {
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		};
		const timer = setTimeout(finish, ms);
		signal.addEventListener("abort", finish, { once: true });
	});
}
/**
* Render one thrown value as the message the settings page shows.
* @param error - whatever the attempt threw.
* @returns the error's own message for a typed failure, its text otherwise.
*/
function messageOf(error) {
	if (error instanceof HarnessError) return error.message;
	return error instanceof Error ? error.message : String(error);
}
/** The NearToken account, one instance per plugin mount. */
var NearTokenAccount = class {
	ctx;
	site;
	onGranted;
	client;
	/** The authorization being polled, while one is. */
	attempt;
	/** Account facts obtained by the last grant in this process. */
	summary;
	/** The read that restores those facts from the stored key, while one is running. */
	summaryLoad;
	/** The site-side token name behind the stored key. */
	tokenName = DEFAULT_TOKEN_NAME;
	/** Why the last attempt ended without a key. */
	error;
	/** Cached `/api/status` currency facts. */
	currency;
	/**
	* @param ctx - the owning plugin context, for the credentials service.
	* @param site - site root and the API key reference.
	* @param onGranted - called once a key has been stored, so the provider route can mount.
	*/
	constructor(ctx, site, onGranted) {
		this.ctx = ctx;
		this.site = site;
		this.onGranted = onGranted;
		this.client = new DeviceAuthorizationClient(site.baseURL);
	}
	/**
	* Whether an API key is stored, i.e. whether the provider route can serve.
	* @returns true when the credential resolves to a non-empty value.
	*/
	async configured() {
		return await this.read(this.site.apiKeyRef()) !== void 0;
	}
	/**
	* Read the state the settings page draws: the key state, the account, and any
	* authorization still waiting for its human.
	* @returns the current status.
	*/
	async status() {
		const configured = await this.configured();
		if (configured) await this.loadSummary();
		const attempt = this.attempt;
		const pending = attempt !== void 0 && attempt.grant.expiresAt > Date.now() ? pendingOf(attempt.grant) : void 0;
		return {
			configured,
			baseURL: this.site.baseURL(),
			tokenName: this.tokenName,
			...configured && this.summary !== void 0 ? { account: this.summary } : {},
			...pending === void 0 ? {} : { pending },
			...this.error === void 0 ? {} : { error: this.error }
		};
	}
	/**
	* Start an authorization, or report the one already running.
	* @returns the codes the human needs, or why the site refused to issue them.
	*/
	async begin() {
		const running = this.attempt;
		if (running !== void 0 && running.grant.expiresAt > Date.now()) return {
			status: "pending",
			pending: pendingOf(running.grant)
		};
		this.stop();
		this.error = void 0;
		try {
			const grant = await this.client.authorize(CLIENT_NAME);
			const attempt = {
				grant,
				controller: new AbortController()
			};
			this.attempt = attempt;
			this.pollUntilSettled(attempt);
			return {
				status: "pending",
				pending: pendingOf(grant)
			};
		} catch (error) {
			this.error = messageOf(error);
			return {
				status: "failed",
				message: this.error
			};
		}
	}
	/**
	* Abandon the authorization in progress.
	* @returns after the poll loop stops; the site's own record expires on its own.
	*/
	async cancel() {
		this.stop();
		this.error = void 0;
	}
	/**
	* Forget the stored key, and tell the site to revoke it.
	*
	* The revocation is best-effort: the credential this plugin holds is gone the
	* moment this resolves, and a site that cannot be reached must not leave the
	* user connected here.
	* @returns after the credential record is removed.
	*/
	async signOut() {
		this.stop();
		this.summary = void 0;
		this.error = void 0;
		await this.forgetSummary();
		const key = await this.read(this.site.apiKeyRef());
		await this.clear(this.site.apiKeyRef());
		if (key !== void 0) this.client.revoke(key).catch(() => {});
	}
	/**
	* Poll the site until the human decides, the attempt expires, or it is withdrawn.
	* @param attempt - the authorization to poll.
	*/
	async pollUntilSettled(attempt) {
		let delay = attempt.grant.intervalMs;
		while (!attempt.controller.signal.aborted) {
			await sleep(delay, attempt.controller.signal);
			if (attempt.controller.signal.aborted) return;
			if (Date.now() > attempt.grant.expiresAt) {
				this.settle(attempt, "授权已超时，请重新发起。");
				return;
			}
			let outcome;
			try {
				outcome = await this.client.poll(attempt.grant.deviceCode);
			} catch (error) {
				this.settle(attempt, messageOf(error));
				return;
			}
			if (attempt.controller.signal.aborted) return;
			switch (outcome.status) {
				case "pending": continue;
				case "slow-down":
					delay += SLOW_DOWN_PENALTY_MS;
					continue;
				case "denied":
					this.settle(attempt, "站点上拒绝了本次授权。");
					return;
				case "expired":
					this.settle(attempt, "授权已超时，请重新发起。");
					return;
				case "granted":
					await this.commit(attempt, outcome);
					return;
			}
		}
	}
	/**
	* Store a granted key and announce the provider route.
	* @param attempt - the authorization that was granted.
	* @param outcome - the grant, with the key and the account it belongs to.
	*/
	async commit(attempt, outcome) {
		try {
			await this.write(this.site.apiKeyRef(), outcome.accessToken);
		} catch (error) {
			this.settle(attempt, messageOf(error));
			return;
		}
		this.tokenName = outcome.tokenName;
		try {
			this.summary = summarize(outcome.user, await this.currencyInfo());
		} catch (_error) {
			this.summary = summarize(outcome.user, {
				quotaPerUnit: 1,
				rate: 1,
				display: false
			});
		}
		await this.persistSummary();
		this.clearAttempt(attempt);
		this.error = void 0;
		this.onGranted();
	}
	/**
	* End one attempt with a message for the page.
	* @param attempt - the attempt that ended.
	* @param message - why it ended without a key.
	*/
	settle(attempt, message) {
		this.error = message;
		this.clearAttempt(attempt);
	}
	/**
	* Retire one attempt if it is still the current one.
	* @param attempt - the attempt to retire.
	*/
	clearAttempt(attempt) {
		if (this.attempt === attempt) this.attempt = void 0;
	}
	/** Withdraw whatever attempt is running. */
	stop() {
		const attempt = this.attempt;
		this.attempt = void 0;
		attempt?.controller.abort();
	}
	/**
	* Restore the card's facts for a key that was stored before this process.
	*
	* One read per process: a grant fills the summary itself, and the settings
	* page asks for the status on every poll while an authorization waits, so a
	* second concurrent read would only repeat the first.
	* @returns after the read settles, whether or not it found anything.
	*/
	async loadSummary() {
		if (this.summary !== void 0) return;
		if (this.summaryLoad !== void 0) return this.summaryLoad;
		this.summaryLoad = this.restoreSummary().finally(() => {
			this.summaryLoad = void 0;
		});
		return this.summaryLoad;
	}
	/** Where the account snapshot lives, when the composition exposes a profile. */
	snapshotPath() {
		const profile = this.ctx.get("profileContext");
		return typeof profile?.home === "string" ? join(profile.home, SNAPSHOT_FILE) : void 0;
	}
	/** Read the snapshot a previous process recorded when the grant arrived. */
	async restoreSummary() {
		const path = this.snapshotPath();
		if (path === void 0) return;
		let raw;
		try {
			raw = await readFile(path, "utf8");
		} catch (error) {
			if (error.code !== "ENOENT") this.ctx.logger.warn("neartoken: could not read the stored account facts", error);
			return;
		}
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (_error) {
			return;
		}
		const record = asObject$1(parsed);
		const summary = record === void 0 ? void 0 : asSummary(record);
		if (summary !== void 0) this.summary = summary;
	}
	/** Record the facts a grant carried, so they outlive this process. */
	async persistSummary() {
		const path = this.snapshotPath();
		const summary = this.summary;
		if (path === void 0 || summary === void 0) return;
		try {
			await writeFile(path, JSON.stringify(summary), "utf8");
		} catch (error) {
			this.ctx.logger.warn("neartoken: could not store the account facts", error);
		}
	}
	/** Drop the snapshot once the key it describes is gone. */
	async forgetSummary() {
		const path = this.snapshotPath();
		if (path === void 0) return;
		try {
			await unlink(path);
		} catch (error) {
			if (error.code !== "ENOENT") this.ctx.logger.warn("neartoken: could not remove the stored account facts", error);
		}
	}
	/** Read one credential reference, or undefined when nothing is stored. */
	async read(ref) {
		const credentials = this.ctx.get("credentials");
		if (credentials === void 0) return void 0;
		return text$1((await credentials.resolve(credentialRef(ref)))?.value);
	}
	/** Write one credential reference. */
	async write(ref, value) {
		const credentials = this.ctx.get("credentials");
		if (credentials === void 0) throw new NewApiError(`NearToken: this composition mounts no credentials service, so ${ref} has nowhere to go`, "NO_CREDENTIAL_STORE");
		await credentials.set(credentialRef(ref), value);
	}
	/** Remove one credential reference. */
	async clear(ref) {
		const credentials = this.ctx.get("credentials");
		if (credentials === void 0) return;
		await credentials.unset(credentialRef(ref));
	}
	/**
	* The cached currency facts, read from the site when the cache is cold.
	* @returns the formatting facts.
	* @throws {NewApiError} when a cold read fails.
	*/
	async currencyInfo() {
		const cached = this.currency;
		if (cached !== void 0 && Date.now() - cached.at < CURRENCY_TTL_MS) return cached.info;
		const data = asObject$1(await callNewApiBody({
			baseURL: this.site.baseURL(),
			path: "/api/status",
			method: "GET"
		}).then((body) => body.data));
		const info = {
			quotaPerUnit: num(data?.quota_per_unit) ?? 1,
			rate: num(data?.usd_exchange_rate) ?? 1,
			display: data?.display_in_currency === true
		};
		this.currency = {
			at: Date.now(),
			info
		};
		return info;
	}
};
//#endregion
//#region src/host/model-caps.generated.ts
/**
* Generated from @earendil-works/pi-ai@1.1.0. Run node scripts/gen-model-caps.mjs; do not edit.
*
* CHAT_MODELS is every chat model the catalog describes. TIER_SETS holds each
* distinct reasoning level list once; MODEL_TIERS points models at one of them.
* Level names are the catalog own wire spellings. MODEL_CONTEXT_WINDOW is the
* smallest context window the catalog states for the model, used only when
* neither the site nor the plugin configuration answers.
*/
/** Distinct reasoning level lists. */
const TIER_SETS = [
	["max"],
	["max", "minimal"],
	[
		"minimal",
		"low",
		"medium"
	],
	[
		"minimal",
		"low",
		"medium",
		"high"
	],
	[
		"minimal",
		"low",
		"medium",
		"high",
		"max"
	],
	[
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh"
	],
	[
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max"
	],
	["xhigh"],
	["xhigh", "max"],
	[
		"xhigh",
		"max",
		"minimal"
	]
];
/** Model id -> the index in TIER_SETS describing its reasoning levels. */
const MODEL_TIERS = {
	"@cf/deepseek-ai/deepseek-v4-flash-0731": 4,
	"@cf/deepseek-ai/deepseek-v4-pro-0813": 4,
	"@cf/google/gemma-4-26b-a4b-it": 6,
	"@cf/moonshotai/kimi-k2.6": 6,
	"@cf/nvidia/nemotron-3-120b-a12b": 6,
	"@cf/openai/gpt-oss-120b": 6,
	"@cf/openai/gpt-oss-20b": 6,
	"@cf/qwen/qwen3.8-27b": 6,
	"@cf/zai-org/glm-5.2": 6,
	"@cf/zai-org/glm-5.3": 6,
	"@cf/zai-org/glm-5.3-flash": 6,
	"MiniMaxAI/MiniMax-M2.7": 2,
	"MiniMaxAI/MiniMax-M3": 2,
	"Qwen/Qwen3-VL-235B-A22B-Thinking": 6,
	"Qwen/Qwen3.5-397B-A17B": 6,
	"Qwen/Qwen3.5-9B": 2,
	"Qwen/Qwen3.6-Plus": 2,
	"Qwen/Qwen3.8-2.4T-A95B": 6,
	"Qwen/Qwen3.8-27B": 6,
	"Ring-2.6-1T": 5,
	"XiaomiMiMo/MiMo-V2.5": 6,
	"XiaomiMiMo/MiMo-V2.5-Pro": 6,
	"accounts/fireworks/models/deepseek-v4p1-flash": 6,
	"accounts/fireworks/models/ember-1": 6,
	"accounts/fireworks/models/glm-5p3": 6,
	"accounts/fireworks/models/glm-5p3-flash": 6,
	"accounts/fireworks/models/gpt-oss-120b": 6,
	"accounts/fireworks/models/kimi-k3": 6,
	"accounts/fireworks/models/minimax-m3": 6,
	"accounts/fireworks/models/qwen3p8-2p4t-a95b": 6,
	"accounts/fireworks/models/qwen3p8-max": 6,
	"accounts/fireworks/routers/deepseek-flash-latest": 6,
	"accounts/fireworks/routers/glm-5p3-fast": 6,
	"accounts/fireworks/routers/glm-fast-latest": 6,
	"accounts/fireworks/routers/glm-flash-latest": 6,
	"accounts/fireworks/routers/glm-latest": 6,
	"accounts/fireworks/routers/kimi-fast-latest": 6,
	"accounts/fireworks/routers/kimi-k3-fast": 6,
	"accounts/fireworks/routers/kimi-latest": 6,
	"accounts/fireworks/routers/minimax-latest": 6,
	"aion-labs/aion-3.5": 6,
	"aion-labs/aion-3.5-mini": 6,
	"anthropic.claude-fable-5": 8,
	"anthropic.claude-fable-5-1": 8,
	"anthropic.claude-haiku-5-5": 8,
	"anthropic.claude-opus-4-6-v1": 0,
	"anthropic.claude-opus-4-7": 8,
	"anthropic.claude-opus-4-8": 8,
	"anthropic.claude-opus-5-5": 8,
	"anthropic.claude-sonnet-4-6": 0,
	"anthropic.claude-sonnet-5": 8,
	"anthropic.claude-sonnet-5-5": 8,
	"anthropic/claude-fable-5": 6,
	"anthropic/claude-fable-5.1": 6,
	"anthropic/claude-fable-5.1:batch": 6,
	"anthropic/claude-fable-5:batch": 6,
	"anthropic/claude-haiku-5.5": 6,
	"anthropic/claude-haiku-5.5:batch": 6,
	"anthropic/claude-opus-4.6": 6,
	"anthropic/claude-opus-4.6:batch": 6,
	"anthropic/claude-opus-4.7": 6,
	"anthropic/claude-opus-4.7:batch": 6,
	"anthropic/claude-opus-4.8": 6,
	"anthropic/claude-opus-4.8-fast": 8,
	"anthropic/claude-opus-4.8:batch": 6,
	"anthropic/claude-opus-5": 6,
	"anthropic/claude-opus-5-fast": 8,
	"anthropic/claude-opus-5.5": 6,
	"anthropic/claude-opus-5.5-fast": 8,
	"anthropic/claude-opus-5.5:batch": 6,
	"anthropic/claude-opus-5:batch": 6,
	"anthropic/claude-sonnet-4.6": 6,
	"anthropic/claude-sonnet-4.6:batch": 6,
	"anthropic/claude-sonnet-5": 6,
	"anthropic/claude-sonnet-5.5": 6,
	"anthropic/claude-sonnet-5.5:batch": 6,
	"anthropic/claude-sonnet-5:batch": 6,
	"au.anthropic.claude-haiku-5-5": 8,
	"au.anthropic.claude-opus-4-6-v1": 0,
	"au.anthropic.claude-opus-4-7": 8,
	"au.anthropic.claude-opus-4-8": 8,
	"au.anthropic.claude-opus-5": 8,
	"au.anthropic.claude-opus-5-5": 8,
	"au.anthropic.claude-sonnet-4-6": 0,
	"au.anthropic.claude-sonnet-5": 8,
	"balanced": 6,
	"bytedance-seed/seed-2.0-code": 6,
	"bytedance-seed/seed-2.0-lite": 6,
	"bytedance-seed/seed-2.0-mini": 6,
	"cheap": 6,
	"claude-fable-5": 8,
	"claude-fable-5-1": 8,
	"claude-fable-5.1": 8,
	"claude-haiku-5-5": 6,
	"claude-opus-4-6": 0,
	"claude-opus-4-7": 8,
	"claude-opus-4-8": 8,
	"claude-opus-4.7": 9,
	"claude-opus-4.8": 9,
	"claude-opus-5": 9,
	"claude-opus-5-5": 6,
	"claude-opus-5.5": 6,
	"claude-sonnet-4-6": 0,
	"claude-sonnet-4.6": 1,
	"claude-sonnet-5": 8,
	"claude-sonnet-5-5": 6,
	"claude-sonnet-5.5": 8,
	"deepseek-ai/DeepSeek-V4-Flash-0731": 6,
	"deepseek-ai/DeepSeek-V4-Flash-Vision-Exp": 6,
	"deepseek-ai/DeepSeek-V4-Pro": 6,
	"deepseek-ai/DeepSeek-V4-Pro-0813": 6,
	"deepseek-ai/DeepSeek-V4.1-Flash": 6,
	"deepseek-ai/DeepSeek-V4.1-Flash-Fast": 6,
	"deepseek-ai/deepseek-v4.1-flash": 4,
	"deepseek-flash": 4,
	"deepseek-v4-flash": 6,
	"deepseek-v4-flash-0731": 6,
	"deepseek-v4-flash-vision-exp": 6,
	"deepseek-v4-pro": 6,
	"deepseek-v4-pro-0813": 6,
	"deepseek-v4.1-flash": 6,
	"deepseek/deepseek-v4-flash": 6,
	"deepseek/deepseek-v4-flash-0731": 6,
	"deepseek/deepseek-v4-flash-vision-exp": 6,
	"deepseek/deepseek-v4-pro": 6,
	"deepseek/deepseek-v4-pro-0813": 6,
	"deepseek/deepseek-v4.1-flash": 6,
	"deepseek/deepseek-v4.1-flash:batch": 6,
	"eu.anthropic.claude-fable-5": 8,
	"eu.anthropic.claude-haiku-5-5": 8,
	"eu.anthropic.claude-opus-4-6-v1": 0,
	"eu.anthropic.claude-opus-4-7": 8,
	"eu.anthropic.claude-opus-4-8": 8,
	"eu.anthropic.claude-opus-5": 8,
	"eu.anthropic.claude-opus-5-5": 8,
	"eu.anthropic.claude-sonnet-4-6": 0,
	"eu.anthropic.claude-sonnet-5": 8,
	"eu.anthropic.claude-sonnet-5-5": 8,
	"exo-free": 6,
	"fireworks/ember-1": 6,
	"fledge-alpha-free": 6,
	"gemini-3-flash": 6,
	"gemini-3-flash-preview": 6,
	"gemini-3.1-flash-lite": 6,
	"gemini-3.1-flash-lite-image": 6,
	"gemini-3.1-flash-lite-preview": 6,
	"gemini-3.1-flash-live-preview": 6,
	"gemini-3.1-pro": 6,
	"gemini-3.1-pro-preview": 6,
	"gemini-3.1-pro-preview-customtools": 6,
	"gemini-3.5-flash": 6,
	"gemini-3.5-flash-lite": 6,
	"gemini-3.6-flash": 6,
	"gemini-3.7-flash": 6,
	"gemini-3.8-flash": 6,
	"gemini-flash-latest": 6,
	"gemini-flash-lite-latest": 6,
	"gemma-4-26b-a4b-it": 3,
	"gemma-4-31b-it": 3,
	"glm-5": 6,
	"glm-5-2": 6,
	"glm-5.1": 6,
	"glm-5.2": 6,
	"glm-5.2-highspeed": 6,
	"glm-5.3": 6,
	"glm-5.3-flash": 6,
	"glm-5.3-highspeed": 6,
	"global.anthropic.claude-fable-5": 8,
	"global.anthropic.claude-fable-5-1": 8,
	"global.anthropic.claude-haiku-5-5": 8,
	"global.anthropic.claude-opus-4-6-v1": 0,
	"global.anthropic.claude-opus-4-7": 8,
	"global.anthropic.claude-opus-4-8": 8,
	"global.anthropic.claude-opus-5": 8,
	"global.anthropic.claude-opus-5-5": 8,
	"global.anthropic.claude-sonnet-4-6": 0,
	"global.anthropic.claude-sonnet-5": 8,
	"global.anthropic.claude-sonnet-5-5": 8,
	"global.openai.gpt-5.6-luna": 7,
	"global.openai.gpt-5.6-sol": 7,
	"global.openai.gpt-5.6-terra": 7,
	"global.openai.gpt-6-astra": 7,
	"global.openai.gpt-6-luna": 7,
	"global.openai.gpt-6-sol": 7,
	"global.openai.gpt-6.1-sol": 7,
	"google/gemini-3-flash-preview": 6,
	"google/gemini-3-flash-preview:batch": 6,
	"google/gemini-3.1-flash-lite": 6,
	"google/gemini-3.1-flash-lite-preview": 6,
	"google/gemini-3.1-flash-lite:batch": 6,
	"google/gemini-3.1-pro-preview": 6,
	"google/gemini-3.1-pro-preview-customtools": 6,
	"google/gemini-3.1-pro-preview:batch": 6,
	"google/gemini-3.5-flash": 6,
	"google/gemini-3.5-flash-lite": 6,
	"google/gemini-3.5-flash-lite:batch": 6,
	"google/gemini-3.5-flash:batch": 6,
	"google/gemini-3.6-flash": 6,
	"google/gemini-3.6-flash:batch": 6,
	"google/gemini-3.7-flash": 6,
	"google/gemini-3.7-flash:batch": 6,
	"google/gemini-3.8-flash": 6,
	"google/gemini-3.8-flash:batch": 6,
	"google/gemini-nano-banana-2.1": 6,
	"gpt-5": 6,
	"gpt-5-codex": 6,
	"gpt-5-mini": 6,
	"gpt-5-nano": 6,
	"gpt-5-pro": 6,
	"gpt-5.1": 6,
	"gpt-5.1-codex": 6,
	"gpt-5.1-codex-max": 6,
	"gpt-5.1-codex-mini": 6,
	"gpt-5.2": 6,
	"gpt-5.2-chat-latest": 6,
	"gpt-5.2-codex": 6,
	"gpt-5.2-pro": 6,
	"gpt-5.3-chat-latest": 7,
	"gpt-5.3-codex": 6,
	"gpt-5.3-codex-spark": 6,
	"gpt-5.4": 6,
	"gpt-5.4-mini": 6,
	"gpt-5.4-nano": 6,
	"gpt-5.4-pro": 6,
	"gpt-5.5": 6,
	"gpt-5.5-pro": 6,
	"gpt-5.6-luna": 6,
	"gpt-5.6-sol": 6,
	"gpt-5.6-terra": 6,
	"gpt-6-astra": 6,
	"gpt-6-luna": 6,
	"gpt-6-sol": 6,
	"gpt-6.1-sol": 6,
	"gpt-daybreak-blue-latest": 6,
	"gpt-daybreak-red-latest": 6,
	"gpt-oss-120b": 6,
	"gpt-realtime-2.1": 6,
	"grok-4.3": 6,
	"grok-4.5": 6,
	"grok-4.6": 6,
	"grok-4.7": 6,
	"grok-build-0.1": 2,
	"hy3": 6,
	"hy4-preview": 6,
	"ibm-granite/granite-4.2-8b": 6,
	"in.anthropic.claude-opus-5": 8,
	"in.anthropic.claude-sonnet-5": 8,
	"in.openai.gpt-5.6-luna": 7,
	"in.openai.gpt-5.6-terra": 7,
	"inception/mercury-2": 6,
	"inception/mercury-2.5": 6,
	"jp.anthropic.claude-haiku-5-5": 8,
	"jp.anthropic.claude-opus-4-7": 8,
	"jp.anthropic.claude-opus-4-8": 8,
	"jp.anthropic.claude-opus-5": 8,
	"jp.anthropic.claude-opus-5-5": 8,
	"jp.anthropic.claude-sonnet-4-6": 0,
	"jp.anthropic.claude-sonnet-5": 8,
	"k3": 6,
	"k3-256k": 6,
	"kimi-for-coding": 6,
	"kimi-k3": 6,
	"labs-leanstral-1-5-1": 6,
	"magistral-medium-latest": 6,
	"mai-code-1-flash-picker": 6,
	"mai-code-1.1-flash": 6,
	"meta/muse-glimmer-30b": 6,
	"meta/muse-spark-1.1": 6,
	"meta/muse-spark-1.2": 6,
	"meta/muse-spark-1.2-contributor": 6,
	"meta/muse-spark-1.3": 6,
	"meta/muse-spark-1.3-contributor": 6,
	"mistral-large-4": 6,
	"mistral-medium-2604": 6,
	"mistral-medium-3.5": 6,
	"mistral-medium-latest": 6,
	"mistral-small-2603": 6,
	"mistral-small-latest": 6,
	"mistralai/mistral-large-4-0": 6,
	"mistralai/mistral-medium-3-5": 6,
	"mistralai/mistral-medium-3-5:batch": 6,
	"mistralai/mistral-small-2603": 6,
	"mistralai/mistral-small-2603:batch": 6,
	"moonshotai/Kimi-K2.5": 6,
	"moonshotai/Kimi-K2.6": 6,
	"moonshotai/Kimi-K2.7-Code": 6,
	"moonshotai/Kimi-K3": 6,
	"moonshotai/kimi-k3": 6,
	"moonshotai/kimi-k3:batch": 6,
	"muse-spark-1.1": 6,
	"muse-spark-1.2": 6,
	"muse-spark-1.2-contributor": 6,
	"muse-spark-1.3": 6,
	"muse-spark-1.3-contributor": 6,
	"muse-spark-1.3-contributor-free": 6,
	"nex-agi/nex-n2.5-pro": 6,
	"nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B": 6,
	"nvidia/Nemotron-120B-A12B": 6,
	"nvidia/nemotron-3-super-120b-a12b": 6,
	"nvidia/nemotron-3-super-120b-a12b:free": 6,
	"nvidia/nemotron-3-ultra-550b-a55b": 6,
	"nvidia/nemotron-3-ultra-550b-a55b:free": 6,
	"o1": 6,
	"o1-pro": 6,
	"o3": 6,
	"o3-mini": 6,
	"o3-pro": 6,
	"o4-mini": 6,
	"openai.gpt-5.4": 7,
	"openai.gpt-5.5": 7,
	"openai.gpt-5.6-luna": 7,
	"openai.gpt-5.6-sol": 7,
	"openai.gpt-5.6-terra": 7,
	"openai.gpt-6-astra": 7,
	"openai.gpt-6-luna": 7,
	"openai.gpt-6-sol": 7,
	"openai.gpt-6.1-sol": 7,
	"openai/gpt-5": 6,
	"openai/gpt-5-mini": 6,
	"openai/gpt-5-mini:batch": 6,
	"openai/gpt-5-nano": 6,
	"openai/gpt-5-nano:batch": 6,
	"openai/gpt-5-pro": 6,
	"openai/gpt-5-pro:batch": 6,
	"openai/gpt-5.1": 6,
	"openai/gpt-5.1-codex": 6,
	"openai/gpt-5.1-codex-max": 6,
	"openai/gpt-5.1-codex-mini": 6,
	"openai/gpt-5.1:batch": 6,
	"openai/gpt-5.2": 6,
	"openai/gpt-5.2-chat": 7,
	"openai/gpt-5.2-codex": 6,
	"openai/gpt-5.2-fast": 7,
	"openai/gpt-5.2-pro": 6,
	"openai/gpt-5.2-pro:batch": 6,
	"openai/gpt-5.2:batch": 6,
	"openai/gpt-5.3-codex": 6,
	"openai/gpt-5.3-codex-fast": 7,
	"openai/gpt-5.4": 6,
	"openai/gpt-5.4-fast": 7,
	"openai/gpt-5.4-mini": 6,
	"openai/gpt-5.4-mini-fast": 7,
	"openai/gpt-5.4-mini:batch": 6,
	"openai/gpt-5.4-nano": 6,
	"openai/gpt-5.4-nano:batch": 6,
	"openai/gpt-5.4-pro": 6,
	"openai/gpt-5.4-pro:batch": 6,
	"openai/gpt-5.4:batch": 6,
	"openai/gpt-5.5": 6,
	"openai/gpt-5.5-fast": 7,
	"openai/gpt-5.5-pro": 6,
	"openai/gpt-5.5-pro:batch": 6,
	"openai/gpt-5.5:batch": 6,
	"openai/gpt-5.6-luna": 6,
	"openai/gpt-5.6-luna-fast": 7,
	"openai/gpt-5.6-luna-pro": 6,
	"openai/gpt-5.6-luna-pro:batch": 6,
	"openai/gpt-5.6-luna:batch": 6,
	"openai/gpt-5.6-sol": 6,
	"openai/gpt-5.6-sol-fast": 7,
	"openai/gpt-5.6-sol-pro": 6,
	"openai/gpt-5.6-sol-pro:batch": 6,
	"openai/gpt-5.6-sol:batch": 6,
	"openai/gpt-5.6-terra": 6,
	"openai/gpt-5.6-terra-fast": 7,
	"openai/gpt-5.6-terra-pro": 6,
	"openai/gpt-5.6-terra-pro:batch": 6,
	"openai/gpt-5.6-terra:batch": 6,
	"openai/gpt-5:batch": 6,
	"openai/gpt-6-astra": 6,
	"openai/gpt-6-astra-fast": 7,
	"openai/gpt-6-astra-pro": 6,
	"openai/gpt-6-astra-pro:batch": 6,
	"openai/gpt-6-astra:batch": 6,
	"openai/gpt-6-luna": 6,
	"openai/gpt-6-luna-fast": 7,
	"openai/gpt-6-luna-pro": 6,
	"openai/gpt-6-luna-pro:batch": 6,
	"openai/gpt-6-luna:batch": 6,
	"openai/gpt-6-sol": 6,
	"openai/gpt-6-sol-fast": 7,
	"openai/gpt-6-sol-pro": 6,
	"openai/gpt-6-sol-pro:batch": 6,
	"openai/gpt-6-sol:batch": 6,
	"openai/gpt-6.1-sol": 6,
	"openai/gpt-6.1-sol-fast": 7,
	"openai/gpt-6.1-sol-pro": 6,
	"openai/gpt-oss-120b": 6,
	"openai/gpt-oss-120b:batch": 6,
	"openai/gpt-oss-20b": 6,
	"openai/gpt-oss-20b:batch": 6,
	"openai/gpt-oss-safeguard-20b": 6,
	"openai/o3-mini-high": 6,
	"openai/o4-mini-high": 6,
	"perceptron/perceptron-mk1.5": 6,
	"precise": 6,
	"prism-ml/ternary-bonsai-2-27b": 6,
	"qwen-3.8-27b": 6,
	"qwen/qwen3.6-27b": 6,
	"qwen/qwen3.8-2.4t-a95b": 6,
	"qwen/qwen3.8-27b": 6,
	"qwen/qwen3.8-max-0902": 6,
	"qwen/qwen3.8-max-prime": 6,
	"qwen3.8-flash": 6,
	"qwen3.8-max": 6,
	"sakana/fugu-max": 6,
	"sakana/fugu-ultra": 6,
	"sakana/fugu-ultra-v2": 6,
	"sakana/sakana-namazu": 6,
	"space-bunny": 6,
	"space-bunny-free": 6,
	"stepfun-ai/Step-3.7-Flash": 6,
	"stepfun/step-3.7-flash": 6,
	"tencent/Hy3": 6,
	"tencent/Hy4-preview": 6,
	"tencent/hy3": 6,
	"tencent/hy3-preview": 6,
	"tencent/hy4-preview": 6,
	"thinkingmachines/Inkling": 6,
	"thinkingmachines/inkling": 6,
	"thinkingmachines/inkling-small": 6,
	"thinkingmachines/inkling-small:free": 6,
	"thinkingmachines/inkling:free": 6,
	"upstage/solar-mini4": 6,
	"upstage/solar-pro-3": 6,
	"upstage/solar-pro4": 6,
	"us.anthropic.claude-fable-5": 8,
	"us.anthropic.claude-fable-5-1": 8,
	"us.anthropic.claude-haiku-5-5": 8,
	"us.anthropic.claude-opus-4-6-v1": 0,
	"us.anthropic.claude-opus-4-7": 8,
	"us.anthropic.claude-opus-4-8": 8,
	"us.anthropic.claude-opus-5": 8,
	"us.anthropic.claude-opus-5-5": 8,
	"us.anthropic.claude-sonnet-4-6": 0,
	"us.anthropic.claude-sonnet-5": 8,
	"us.anthropic.claude-sonnet-5-5": 8,
	"us.openai.gpt-5.6-luna": 7,
	"us.openai.gpt-5.6-sol": 7,
	"us.openai.gpt-5.6-terra": 7,
	"us.openai.gpt-6-astra": 7,
	"us.openai.gpt-6-luna": 7,
	"us.openai.gpt-6-sol": 7,
	"us.openai.gpt-6.1-sol": 7,
	"workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731": 4,
	"workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813": 4,
	"x-ai/grok-4.3": 6,
	"x-ai/grok-4.3:batch": 6,
	"x-ai/grok-4.5": 6,
	"x-ai/grok-4.6": 6,
	"x-ai/grok-4.7": 6,
	"z-ai/glm-5.2": 6,
	"z-ai/glm-5.3": 6,
	"z-ai/glm-5.3-flash": 6,
	"z-ai/glm-5.3-flash:batch": 6,
	"z-ai/glm-5.3-flashx": 6,
	"z-ai/glm-5.3-prime": 6,
	"z-ai/glm-5.3:batch": 6,
	"zai-glm-5-2": 6,
	"zai-glm-5-3": 6,
	"zai-org/GLM-4.7": 6,
	"zai-org/GLM-5": 6,
	"zai-org/GLM-5.1": 6,
	"zai-org/GLM-5.2": 6,
	"zai-org/GLM-5.2-Fast": 6,
	"zai-org/GLM-5.3": 6,
	"zai-org/GLM-5.3-Fast": 6,
	"zai-org/GLM-5.3-Flash": 6,
	"~anthropic/claude-fable-latest": 6,
	"~anthropic/claude-haiku-latest": 6,
	"~anthropic/claude-opus-latest": 6,
	"~anthropic/claude-sonnet-latest": 6,
	"~deepseek/deepseek-flash-latest": 6,
	"~deepseek/deepseek-pro-latest": 6,
	"~deepseek/deepseek-v4-flash-latest": 6,
	"~google/gemini-flash-latest": 6,
	"~google/gemini-pro-latest": 6,
	"~moonshotai/kimi-latest": 6,
	"~openai/gpt-astra-latest": 6,
	"~openai/gpt-luna-latest": 6,
	"~openai/gpt-mini-latest": 6,
	"~openai/gpt-sol-latest": 6,
	"~openai/gpt-terra-latest": 6,
	"~x-ai/grok-latest": 6,
	"~z-ai/glm-flash-latest": 6,
	"~z-ai/glm-latest": 6
};
/** Model id -> the smallest context window the catalog states for it, in tokens. */
const MODEL_CONTEXT_WINDOW = {
	"@cf/deepseek-ai/deepseek-v4-flash-0731": 1048576,
	"@cf/deepseek-ai/deepseek-v4-pro-0813": 1048576,
	"@cf/google/gemma-4-26b-a4b-it": 256e3,
	"@cf/ibm-granite/granite-4.0-h-micro": 131e3,
	"@cf/meta/llama-3.3-70b-instruct-fp8-fast": 24e3,
	"@cf/meta/llama-4-scout-17b-16e-instruct": 131e3,
	"@cf/mistralai/mistral-small-3.1-24b-instruct": 128e3,
	"@cf/moonshotai/kimi-k2.6": 262144,
	"@cf/moonshotai/kimi-k2.7-code": 262144,
	"@cf/nvidia/nemotron-3-120b-a12b": 256e3,
	"@cf/openai/gpt-oss-120b": 128e3,
	"@cf/openai/gpt-oss-20b": 128e3,
	"@cf/qwen/qwen3-30b-a3b-fp8": 32768,
	"@cf/qwen/qwen3.8-27b": 262144,
	"@cf/zai-org/glm-4.7-flash": 131072,
	"@cf/zai-org/glm-5.2": 262144,
	"@cf/zai-org/glm-5.3": 1048576,
	"@cf/zai-org/glm-5.3-flash": 1048576,
	"Ling-2.6-1T": 262144,
	"Ling-2.6-flash": 262144,
	"MiniMax-M2.5": 196608,
	"MiniMax-M2.7": 204800,
	"MiniMax-M2.7-highspeed": 204800,
	"MiniMax-M3": 1e6,
	"MiniMaxAI/MiniMax-M2": 204800,
	"MiniMaxAI/MiniMax-M2.1": 204800,
	"MiniMaxAI/MiniMax-M2.5": 204800,
	"MiniMaxAI/MiniMax-M2.7": 196608,
	"MiniMaxAI/MiniMax-M3": 524288,
	"Qwen/Qwen2.5-7B-Instruct-Turbo": 32768,
	"Qwen/Qwen2.5-Coder-32B-Instruct": 131072,
	"Qwen/Qwen3-235B-A22B": 40960,
	"Qwen/Qwen3-235B-A22B-Instruct-2507": 262144,
	"Qwen/Qwen3-235B-A22B-Thinking-2507": 262144,
	"Qwen/Qwen3-30B-A3B": 40960,
	"Qwen/Qwen3-32B": 131072,
	"Qwen/Qwen3-Coder-30B-A3B-Instruct": 262144,
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": 262144,
	"Qwen/Qwen3-Coder-Next": 262144,
	"Qwen/Qwen3-Next-80B-A3B-Instruct": 262144,
	"Qwen/Qwen3-Next-80B-A3B-Thinking": 262144,
	"Qwen/Qwen3-VL-235B-A22B-Instruct": 131072,
	"Qwen/Qwen3-VL-235B-A22B-Thinking": 131072,
	"Qwen/Qwen3.5-122B-A10B": 262144,
	"Qwen/Qwen3.5-27B": 262144,
	"Qwen/Qwen3.5-35B-A3B": 262144,
	"Qwen/Qwen3.5-397B-A17B": 262144,
	"Qwen/Qwen3.5-9B": 262144,
	"Qwen/Qwen3.6-27B": 262144,
	"Qwen/Qwen3.6-35B-A3B": 262144,
	"Qwen/Qwen3.6-Plus": 1e6,
	"Qwen/Qwen3.7-Max": 1e6,
	"Qwen/Qwen3.8-2.4T-A95B": 262144,
	"Qwen/Qwen3.8-27B": 262144,
	"Ring-2.6-1T": 262144,
	"XiaomiMiMo/MiMo-V2-Flash": 262144,
	"XiaomiMiMo/MiMo-V2.5": 262144,
	"XiaomiMiMo/MiMo-V2.5-Pro": 1048576,
	"accounts/fireworks/models/deepseek-v4p1-flash": 1e6,
	"accounts/fireworks/models/ember-1": 1048576,
	"accounts/fireworks/models/glm-5p3": 1048573,
	"accounts/fireworks/models/glm-5p3-flash": 1048573,
	"accounts/fireworks/models/gpt-oss-120b": 131072,
	"accounts/fireworks/models/inkling": 1048576,
	"accounts/fireworks/models/kimi-k3": 1048576,
	"accounts/fireworks/models/minimax-m3": 512e3,
	"accounts/fireworks/models/nemotron-3-ultra-nvfp4": 262144,
	"accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b": 262144,
	"accounts/fireworks/models/qwen3p8-2p4t-a95b": 262144,
	"accounts/fireworks/models/qwen3p8-max": 262144,
	"accounts/fireworks/routers/deepseek-flash-latest": 1e6,
	"accounts/fireworks/routers/glm-5p3-fast": 1048572,
	"accounts/fireworks/routers/glm-fast-latest": 1048572,
	"accounts/fireworks/routers/glm-flash-latest": 1048573,
	"accounts/fireworks/routers/glm-latest": 1048573,
	"accounts/fireworks/routers/kimi-fast-latest": 1048576,
	"accounts/fireworks/routers/kimi-k3-fast": 1048576,
	"accounts/fireworks/routers/kimi-latest": 1048576,
	"accounts/fireworks/routers/minimax-latest": 512e3,
	"accounts/fireworks/routers/qwen-max-latest": 262144,
	"aion-labs/aion-2.0": 131072,
	"aion-labs/aion-3.0": 131072,
	"aion-labs/aion-3.0-mini": 131072,
	"aion-labs/aion-3.5": 262144,
	"aion-labs/aion-3.5-mini": 262144,
	"alibaba/qwen-3-14b": 40960,
	"alibaba/qwen-3-235b": 262144,
	"alibaba/qwen-3-30b": 40960,
	"alibaba/qwen-3-32b": 128e3,
	"alibaba/qwen-3.6-max-preview": 24e4,
	"alibaba/qwen3-235b-a22b-thinking": 131072,
	"alibaba/qwen3-coder": 262144,
	"alibaba/qwen3-coder-30b-a3b": 262144,
	"alibaba/qwen3-coder-next": 256e3,
	"alibaba/qwen3-coder-plus": 1e6,
	"alibaba/qwen3-max": 262144,
	"alibaba/qwen3-max-preview": 262144,
	"alibaba/qwen3-max-thinking": 256e3,
	"alibaba/qwen3-next-80b-a3b-instruct": 262114,
	"alibaba/qwen3-next-80b-a3b-thinking": 262144,
	"alibaba/qwen3-vl-235b-a22b-instruct": 131072,
	"alibaba/qwen3-vl-instruct": 131072,
	"alibaba/qwen3-vl-thinking": 131072,
	"alibaba/qwen3.5-flash": 1e6,
	"alibaba/qwen3.5-plus": 1e6,
	"alibaba/qwen3.6-27b": 256e3,
	"alibaba/qwen3.6-plus": 1e6,
	"alibaba/qwen3.7-flash": 991e3,
	"alibaba/qwen3.7-max": 991e3,
	"alibaba/qwen3.7-plus": 1e6,
	"alibaba/qwen3.8-2.4t-a95b": 262144,
	"alibaba/qwen3.8-27b": 1e6,
	"alibaba/qwen3.8-flash": 991e3,
	"alibaba/qwen3.8-max": 262144,
	"alibaba/qwen3.8-max-0902": 991e3,
	"alibaba/qwen3.8-max-prime": 1e6,
	"alibaba/qwen3.8-omni-flash": 1e6,
	"amazon.nova-2-lite-v1:0": 1e6,
	"amazon.nova-lite-v1:0": 3e5,
	"amazon.nova-micro-v1:0": 128e3,
	"amazon.nova-pro-v1:0": 3e5,
	"amazon/nova-2-lite": 1e6,
	"amazon/nova-2-lite-v1": 1e6,
	"amazon/nova-lite": 3e5,
	"amazon/nova-lite-v1": 3e5,
	"amazon/nova-micro": 128e3,
	"amazon/nova-micro-v1": 128e3,
	"amazon/nova-premier-v1": 1e6,
	"amazon/nova-pro": 3e5,
	"amazon/nova-pro-v1": 3e5,
	"anthropic.claude-fable-5": 1e6,
	"anthropic.claude-fable-5-1": 1e6,
	"anthropic.claude-haiku-4-5-20251001-v1:0": 2e5,
	"anthropic.claude-haiku-5-5": 1e6,
	"anthropic.claude-opus-4-1-20250805-v1:0": 2e5,
	"anthropic.claude-opus-4-5-20251101-v1:0": 2e5,
	"anthropic.claude-opus-4-6-v1": 1e6,
	"anthropic.claude-opus-4-7": 1e6,
	"anthropic.claude-opus-4-8": 1e6,
	"anthropic.claude-opus-5-5": 1e6,
	"anthropic.claude-sonnet-4-5-20250929-v1:0": 2e5,
	"anthropic.claude-sonnet-4-6": 1e6,
	"anthropic.claude-sonnet-5": 1e6,
	"anthropic.claude-sonnet-5-5": 1e6,
	"anthropic/claude-3-haiku": 2e5,
	"anthropic/claude-fable-5": 1e6,
	"anthropic/claude-fable-5.1": 1e6,
	"anthropic/claude-fable-5.1:batch": 1e6,
	"anthropic/claude-fable-5:batch": 1e6,
	"anthropic/claude-haiku-4.5": 2e5,
	"anthropic/claude-haiku-4.5:batch": 2e5,
	"anthropic/claude-haiku-5.5": 1e6,
	"anthropic/claude-haiku-5.5:batch": 1e6,
	"anthropic/claude-opus-4": 2e5,
	"anthropic/claude-opus-4.1": 2e5,
	"anthropic/claude-opus-4.1:batch": 2e5,
	"anthropic/claude-opus-4.5": 2e5,
	"anthropic/claude-opus-4.5:batch": 2e5,
	"anthropic/claude-opus-4.6": 1e6,
	"anthropic/claude-opus-4.6:batch": 1e6,
	"anthropic/claude-opus-4.7": 1e6,
	"anthropic/claude-opus-4.7:batch": 1e6,
	"anthropic/claude-opus-4.8": 1e6,
	"anthropic/claude-opus-4.8-fast": 1e6,
	"anthropic/claude-opus-4.8:batch": 1e6,
	"anthropic/claude-opus-5": 1e6,
	"anthropic/claude-opus-5-fast": 1e6,
	"anthropic/claude-opus-5.5": 1e6,
	"anthropic/claude-opus-5.5-fast": 1e6,
	"anthropic/claude-opus-5.5:batch": 1e6,
	"anthropic/claude-opus-5:batch": 1e6,
	"anthropic/claude-sonnet-4": 2e5,
	"anthropic/claude-sonnet-4.5": 1e6,
	"anthropic/claude-sonnet-4.5:batch": 1e6,
	"anthropic/claude-sonnet-4.6": 1e6,
	"anthropic/claude-sonnet-4.6:batch": 1e6,
	"anthropic/claude-sonnet-5": 1e6,
	"anthropic/claude-sonnet-5.5": 1e6,
	"anthropic/claude-sonnet-5.5:batch": 1e6,
	"anthropic/claude-sonnet-5:batch": 1e6,
	"apac.amazon.nova-lite-v1:0": 3e5,
	"apac.amazon.nova-micro-v1:0": 128e3,
	"apac.amazon.nova-pro-v1:0": 3e5,
	"apac.anthropic.claude-sonnet-4-20250514-v1:0": 2e5,
	"apodex/apodex-1.1-mini:free": 262144,
	"arcee-ai/trinity-large-thinking": 262100,
	"au.anthropic.claude-haiku-4-5-20251001-v1:0": 2e5,
	"au.anthropic.claude-haiku-5-5": 1e6,
	"au.anthropic.claude-opus-4-6-v1": 1e6,
	"au.anthropic.claude-opus-4-7": 1e6,
	"au.anthropic.claude-opus-4-8": 1e6,
	"au.anthropic.claude-opus-5": 1e6,
	"au.anthropic.claude-opus-5-5": 1e6,
	"au.anthropic.claude-sonnet-4-5-20250929-v1:0": 2e5,
	"au.anthropic.claude-sonnet-4-6": 1e6,
	"au.anthropic.claude-sonnet-5": 1e6,
	"auto": 2e6,
	"balanced": 1048576,
	"big-pickle": 2e5,
	"bytedance-seed/seed-1.6": 262144,
	"bytedance-seed/seed-1.6-flash": 262144,
	"bytedance-seed/seed-2-1-turbo": 262144,
	"bytedance-seed/seed-2.0-code": 262144,
	"bytedance-seed/seed-2.0-lite": 262144,
	"bytedance-seed/seed-2.0-mini": 262144,
	"bytedance/seed-1.6": 256e3,
	"bytedance/seed-1.8": 256e3,
	"bytedance/seed-2.1-turbo": 262144,
	"ca.amazon.nova-lite-v1:0": 3e5,
	"cheap": 1e6,
	"claude-fable-5": 1e6,
	"claude-fable-5-1": 1e6,
	"claude-fable-5.1": 1e6,
	"claude-haiku-4-5": 2e5,
	"claude-haiku-4-5-20251001": 2e5,
	"claude-haiku-4.5": 2e5,
	"claude-haiku-5-5": 1e6,
	"claude-opus-4-5": 2e5,
	"claude-opus-4-5-20251101": 2e5,
	"claude-opus-4-6": 1e6,
	"claude-opus-4-7": 1e6,
	"claude-opus-4-8": 1e6,
	"claude-opus-4.7": 1e6,
	"claude-opus-4.8": 1e6,
	"claude-opus-5": 1e6,
	"claude-opus-5-5": 1e6,
	"claude-opus-5.5": 1e6,
	"claude-sonnet-4": 2e5,
	"claude-sonnet-4-5": 2e5,
	"claude-sonnet-4-5-20250929": 1e6,
	"claude-sonnet-4-6": 1e6,
	"claude-sonnet-4.6": 1e6,
	"claude-sonnet-5": 1e6,
	"claude-sonnet-5-5": 1e6,
	"claude-sonnet-5.5": 1e6,
	"codestral-2508": 256e3,
	"codestral-latest": 256e3,
	"cohere/command-a": 256e3,
	"cohere/command-a-plus": 192e3,
	"cohere/command-r-08-2024": 128e3,
	"cohere/command-r-plus-08-2024": 128e3,
	"cohere/north-mini-code:free": 256e3,
	"deep-research-max-preview-04-2026": 131072,
	"deep-research-preview-04-2026": 131072,
	"deepseek-ai/DeepSeek-R1": 64e3,
	"deepseek-ai/DeepSeek-R1-0528": 163840,
	"deepseek-ai/DeepSeek-V3": 64e3,
	"deepseek-ai/DeepSeek-V3-0324": 163840,
	"deepseek-ai/DeepSeek-V3.1": 131072,
	"deepseek-ai/DeepSeek-V3.2": 163840,
	"deepseek-ai/DeepSeek-V4-Flash": 1048576,
	"deepseek-ai/DeepSeek-V4-Flash-0731": 1048576,
	"deepseek-ai/DeepSeek-V4-Flash-Vision-Exp": 1048576,
	"deepseek-ai/DeepSeek-V4-Pro": 1048576,
	"deepseek-ai/DeepSeek-V4-Pro-0813": 1e6,
	"deepseek-ai/DeepSeek-V4.1-Flash": 1048576,
	"deepseek-ai/DeepSeek-V4.1-Flash-Fast": 1048576,
	"deepseek-ai/deepseek-v4.1-flash": 1e6,
	"deepseek-flash": 1e6,
	"deepseek-v3.2": 131072,
	"deepseek-v4-flash": 1e6,
	"deepseek-v4-flash-0731": 1e6,
	"deepseek-v4-flash-vision-exp": 1e6,
	"deepseek-v4-pro": 1e6,
	"deepseek-v4-pro-0813": 1e6,
	"deepseek-v4.1-flash": 1e6,
	"deepseek.v3-v1:0": 163840,
	"deepseek.v3.2": 163840,
	"deepseek/deepseek-chat": 128e3,
	"deepseek/deepseek-chat-v3-0324": 128e3,
	"deepseek/deepseek-chat-v3.1": 163840,
	"deepseek/deepseek-r1": 64e3,
	"deepseek/deepseek-r1-0528": 163840,
	"deepseek/deepseek-v3.1": 163840,
	"deepseek/deepseek-v3.1-terminus": 163840,
	"deepseek/deepseek-v3.2": 128e3,
	"deepseek/deepseek-v3.2-exp": 163840,
	"deepseek/deepseek-v3.2-thinking": 128e3,
	"deepseek/deepseek-v4-flash": 1e6,
	"deepseek/deepseek-v4-flash-0731": 1e6,
	"deepseek/deepseek-v4-flash-vision-exp": 1048576,
	"deepseek/deepseek-v4-pro": 1e6,
	"deepseek/deepseek-v4-pro-0813": 1e6,
	"deepseek/deepseek-v4.1-flash": 1048576,
	"deepseek/deepseek-v4.1-flash-fast": 1048576,
	"deepseek/deepseek-v4.1-flash:batch": 1048576,
	"devstral-2512": 262144,
	"devstral-latest": 262144,
	"devstral-medium-2507": 128e3,
	"devstral-medium-latest": 262144,
	"devstral-small-2505": 128e3,
	"devstral-small-2507": 128e3,
	"dots-studio/dots-3-note-preview:free": 512e3,
	"eu.amazon.nova-2-lite-v1:0": 1e6,
	"eu.amazon.nova-lite-v1:0": 3e5,
	"eu.amazon.nova-micro-v1:0": 128e3,
	"eu.amazon.nova-pro-v1:0": 3e5,
	"eu.anthropic.claude-fable-5": 1e6,
	"eu.anthropic.claude-haiku-4-5-20251001-v1:0": 2e5,
	"eu.anthropic.claude-haiku-5-5": 1e6,
	"eu.anthropic.claude-opus-4-5-20251101-v1:0": 2e5,
	"eu.anthropic.claude-opus-4-6-v1": 1e6,
	"eu.anthropic.claude-opus-4-7": 1e6,
	"eu.anthropic.claude-opus-4-8": 1e6,
	"eu.anthropic.claude-opus-5": 1e6,
	"eu.anthropic.claude-opus-5-5": 1e6,
	"eu.anthropic.claude-sonnet-4-20250514-v1:0": 2e5,
	"eu.anthropic.claude-sonnet-4-5-20250929-v1:0": 2e5,
	"eu.anthropic.claude-sonnet-4-6": 1e6,
	"eu.anthropic.claude-sonnet-5": 1e6,
	"eu.anthropic.claude-sonnet-5-5": 1e6,
	"eu.mistral.pixtral-large-2502-v1:0": 128e3,
	"exo-free": 1048576,
	"fireworks/ember-1": 1048576,
	"fledge-alpha-free": 1048576,
	"gemini-2.5-computer-use-preview-10-2025": 128e3,
	"gemini-2.5-flash": 1048576,
	"gemini-2.5-flash-lite": 1048576,
	"gemini-2.5-pro": 1048576,
	"gemini-3-flash": 1048576,
	"gemini-3-flash-preview": 1048576,
	"gemini-3.1-flash-lite": 1048576,
	"gemini-3.1-flash-lite-image": 65536,
	"gemini-3.1-flash-lite-preview": 1048576,
	"gemini-3.1-flash-live-preview": 131072,
	"gemini-3.1-pro": 1048576,
	"gemini-3.1-pro-preview": 1048576,
	"gemini-3.1-pro-preview-customtools": 1048576,
	"gemini-3.5-flash": 2e5,
	"gemini-3.5-flash-lite": 1048576,
	"gemini-3.6-flash": 1e6,
	"gemini-3.7-flash": 1e6,
	"gemini-3.8-flash": 1e6,
	"gemini-flash-latest": 1048576,
	"gemini-flash-lite-latest": 1048576,
	"gemma-4-26b-a4b-it": 262144,
	"gemma-4-31b-it": 262144,
	"glm-4.6v": 128e3,
	"glm-4.7": 204800,
	"glm-5": 202752,
	"glm-5-2": 1048576,
	"glm-5-turbo": 2e5,
	"glm-5.1": 202752,
	"glm-5.2": 1e6,
	"glm-5.2-highspeed": 1e6,
	"glm-5.3": 1e6,
	"glm-5.3-flash": 1e6,
	"glm-5.3-highspeed": 1e6,
	"global.amazon.nova-2-lite-v1:0": 1e6,
	"global.anthropic.claude-fable-5": 1e6,
	"global.anthropic.claude-fable-5-1": 1e6,
	"global.anthropic.claude-haiku-4-5-20251001-v1:0": 2e5,
	"global.anthropic.claude-haiku-5-5": 1e6,
	"global.anthropic.claude-opus-4-5-20251101-v1:0": 2e5,
	"global.anthropic.claude-opus-4-6-v1": 1e6,
	"global.anthropic.claude-opus-4-7": 1e6,
	"global.anthropic.claude-opus-4-8": 1e6,
	"global.anthropic.claude-opus-5": 1e6,
	"global.anthropic.claude-opus-5-5": 1e6,
	"global.anthropic.claude-sonnet-4-20250514-v1:0": 2e5,
	"global.anthropic.claude-sonnet-4-5-20250929-v1:0": 2e5,
	"global.anthropic.claude-sonnet-4-6": 1e6,
	"global.anthropic.claude-sonnet-5": 1e6,
	"global.anthropic.claude-sonnet-5-5": 1e6,
	"global.moonshotai.kimi-k3": 1048576,
	"global.openai.gpt-5.6-luna": 105e4,
	"global.openai.gpt-5.6-sol": 105e4,
	"global.openai.gpt-5.6-terra": 105e4,
	"global.openai.gpt-6-astra": 105e4,
	"global.openai.gpt-6-luna": 105e4,
	"global.openai.gpt-6-sol": 105e4,
	"global.openai.gpt-6.1-sol": 105e4,
	"global.xai.grok-4.6": 5e5,
	"global.xai.grok-4.7": 5e5,
	"global.zai.glm-5.3": 1e6,
	"google.gemma-4-26b-a4b": 262144,
	"google.gemma-4-31b": 262144,
	"google.gemma-4-e2b": 131072,
	"google/diffusiongemma-26b-a4b-it": 25e4,
	"google/gemini-2.5-flash": 1e6,
	"google/gemini-2.5-flash-lite": 1048576,
	"google/gemini-2.5-flash-lite:batch": 1048576,
	"google/gemini-2.5-flash:batch": 1048576,
	"google/gemini-2.5-pro": 1048576,
	"google/gemini-2.5-pro-preview": 1048576,
	"google/gemini-2.5-pro:batch": 1048576,
	"google/gemini-3-flash": 1e6,
	"google/gemini-3-flash-preview": 1048576,
	"google/gemini-3-flash-preview:batch": 1048576,
	"google/gemini-3-pro-image": 65536,
	"google/gemini-3.1-flash-lite": 1e6,
	"google/gemini-3.1-flash-lite-preview": 1048576,
	"google/gemini-3.1-flash-lite:batch": 1048576,
	"google/gemini-3.1-pro-preview": 1e6,
	"google/gemini-3.1-pro-preview-customtools": 1048576,
	"google/gemini-3.1-pro-preview:batch": 1048576,
	"google/gemini-3.5-flash": 1e6,
	"google/gemini-3.5-flash-lite": 1e6,
	"google/gemini-3.5-flash-lite:batch": 1048576,
	"google/gemini-3.5-flash:batch": 1048576,
	"google/gemini-3.6-flash": 1e6,
	"google/gemini-3.6-flash:batch": 1048576,
	"google/gemini-3.7-flash": 1e6,
	"google/gemini-3.7-flash:batch": 1048576,
	"google/gemini-3.8-flash": 1e6,
	"google/gemini-3.8-flash:batch": 1048576,
	"google/gemini-nano-banana-2.1": 65536,
	"google/gemma-3-12b-it": 131072,
	"google/gemma-3-27b-it": 131072,
	"google/gemma-3-4b-it": 131072,
	"google/gemma-4-26B-A4B-it": 262144,
	"google/gemma-4-26b-a4b-it": 262144,
	"google/gemma-4-26b-a4b-it:free": 262144,
	"google/gemma-4-31B-it": 262144,
	"google/gemma-4-31b-it": 262144,
	"google/gemma-4-31b-it:free": 262144,
	"gpt-4": 8192,
	"gpt-4-turbo": 128e3,
	"gpt-4.1": 1047576,
	"gpt-4.1-mini": 1047576,
	"gpt-4.1-nano": 1e6,
	"gpt-4o": 128e3,
	"gpt-4o-2024-05-13": 128e3,
	"gpt-4o-2024-08-06": 128e3,
	"gpt-4o-2024-11-20": 128e3,
	"gpt-4o-mini": 128e3,
	"gpt-5": 128e3,
	"gpt-5-chat-latest": 128e3,
	"gpt-5-codex": 4e5,
	"gpt-5-mini": 128e3,
	"gpt-5-nano": 128e3,
	"gpt-5-pro": 4e5,
	"gpt-5.1": 128e3,
	"gpt-5.1-codex": 4e5,
	"gpt-5.1-codex-max": 4e5,
	"gpt-5.1-codex-mini": 4e5,
	"gpt-5.2": 4e5,
	"gpt-5.2-chat-latest": 128e3,
	"gpt-5.2-codex": 4e5,
	"gpt-5.2-pro": 4e5,
	"gpt-5.3-chat-latest": 128e3,
	"gpt-5.3-codex": 4e5,
	"gpt-5.3-codex-spark": 128e3,
	"gpt-5.4": 272e3,
	"gpt-5.4-mini": 128e3,
	"gpt-5.4-nano": 128e3,
	"gpt-5.4-pro": 1e6,
	"gpt-5.5": 272e3,
	"gpt-5.5-pro": 1e6,
	"gpt-5.6-luna": 272e3,
	"gpt-5.6-sol": 272e3,
	"gpt-5.6-terra": 272e3,
	"gpt-6-astra": 272e3,
	"gpt-6-luna": 272e3,
	"gpt-6-sol": 272e3,
	"gpt-6.1-sol": 272e3,
	"gpt-daybreak-blue-latest": 105e4,
	"gpt-daybreak-red-latest": 4e5,
	"gpt-oss-120b": 131072,
	"gpt-realtime-2.1": 128e3,
	"grok-4.3": 1e6,
	"grok-4.5": 5e5,
	"grok-4.6": 5e5,
	"grok-4.7": 5e5,
	"grok-build-0.1": 256e3,
	"hy3": 256e3,
	"hy4-preview": 1024e3,
	"ibm-granite/granite-4.2-8b": 131072,
	"in.anthropic.claude-haiku-4-5-20251001-v1:0": 2e5,
	"in.anthropic.claude-opus-5": 1e6,
	"in.anthropic.claude-sonnet-5": 1e6,
	"in.openai.gpt-5.6-luna": 105e4,
	"in.openai.gpt-5.6-terra": 105e4,
	"inception/mercury-2": 128e3,
	"inception/mercury-2.5": 26e4,
	"inception/mercury-coder-small": 32e3,
	"inclusionai/ling-3.0-flash": 256e3,
	"inclusionai/ling-3.0-flash-fin": 256e3,
	"inclusionai/ling-3.0-flash-sante": 256e3,
	"inclusionai/ling-3.0-flash-sante:free": 262144,
	"inclusionai/ling-3.0-flash-vl": 256e3,
	"inclusionai/ling-3.1-flash": 262144,
	"inclusionai/ling-3.1-flash-free": 262144,
	"interfaze/interfaze-beta": 1e6,
	"jp.amazon.nova-2-lite-v1:0": 1e6,
	"jp.anthropic.claude-haiku-4-5-20251001-v1:0": 2e5,
	"jp.anthropic.claude-haiku-5-5": 1e6,
	"jp.anthropic.claude-opus-4-7": 1e6,
	"jp.anthropic.claude-opus-4-8": 1e6,
	"jp.anthropic.claude-opus-5": 1e6,
	"jp.anthropic.claude-opus-5-5": 1e6,
	"jp.anthropic.claude-sonnet-4-5-20250929-v1:0": 2e5,
	"jp.anthropic.claude-sonnet-4-6": 1e6,
	"jp.anthropic.claude-sonnet-5": 1e6,
	"k3": 1048576,
	"k3-256k": 262144,
	"kimi-for-coding": 1048576,
	"kimi-for-coding-highspeed": 262144,
	"kimi-k2.5": 262144,
	"kimi-k2.6": 262144,
	"kimi-k2.7-code": 256e3,
	"kimi-k2.7-code-highspeed": 262144,
	"kimi-k3": 1048576,
	"labs-devstral-small-2512": 256e3,
	"labs-leanstral-1-5-1": 262144,
	"ling-3.0-flash-fin-free": 262144,
	"ling-3.1-flash-free": 262144,
	"liquid/lfm-2.5-2.6b:free": 65536,
	"llama-3.1-8b-instant": 131072,
	"llama-3.3-70b-versatile": 131072,
	"longcat-2.0": 1e6,
	"longcat-2.5-preview-free": 1e6,
	"magistral-medium-latest": 262144,
	"mai-code-1-flash-picker": 256e3,
	"mai-code-1.1-flash": 256e3,
	"meituan/longcat-2.0": 1048756,
	"meituan/longcat-2.5-preview": 1048576,
	"meta-llama/Llama-3.1-8B-Instruct": 131072,
	"meta-llama/Llama-3.3-70B-Instruct": 131072,
	"meta-llama/Llama-3.3-70B-Instruct-Turbo": 131072,
	"meta-llama/llama-3.1-70b-instruct": 131072,
	"meta-llama/llama-3.1-8b-instruct": 131072,
	"meta-llama/llama-3.3-70b-instruct": 131072,
	"meta-llama/llama-4-maverick": 128e3,
	"meta-llama/llama-4-scout": 327680,
	"meta.llama3-1-70b-instruct-v1:0": 128e3,
	"meta.llama3-1-8b-instruct-v1:0": 128e3,
	"meta.llama3-3-70b-instruct-v1:0": 128e3,
	"meta.llama4-maverick-17b-instruct-v1:0": 1e6,
	"meta.llama4-scout-17b-instruct-v1:0": 1e7,
	"meta/llama-3.1-70b": 128e3,
	"meta/llama-3.1-8b": 128e3,
	"meta/llama-3.2-11b-vision-instruct": 128e3,
	"meta/llama-3.2-90b-vision-instruct": 128e3,
	"meta/llama-3.3-70b": 128e3,
	"meta/llama-4-maverick": 128e3,
	"meta/llama-4-scout": 128e3,
	"meta/muse-glimmer-30b": 131072,
	"meta/muse-spark-1.1": 1048576,
	"meta/muse-spark-1.2": 1048576,
	"meta/muse-spark-1.2-contributor": 1048576,
	"meta/muse-spark-1.3": 1048576,
	"meta/muse-spark-1.3-contributor": 1048576,
	"mimo-v2.5": 1e6,
	"mimo-v2.5-pro": 1048576,
	"mimo-v2.5-pro-ultraspeed": 1048576,
	"mimo-v2.6-flash": 1048576,
	"mimo-v2.6-flash-free": 2e5,
	"mimo-v2.6-pro": 1048576,
	"mimo-v2.6-pro-ultraspeed": 1048576,
	"minimax-m2.5": 204800,
	"minimax-m2.7": 204800,
	"minimax-m3": 512e3,
	"minimax.minimax-m2": 204608,
	"minimax.minimax-m2.1": 196608,
	"minimax.minimax-m2.5": 196608,
	"minimax/minimax-m1": 1e6,
	"minimax/minimax-m2": 196608,
	"minimax/minimax-m2.1": 204800,
	"minimax/minimax-m2.1-lightning": 204800,
	"minimax/minimax-m2.5": 2e5,
	"minimax/minimax-m2.5-highspeed": 204800,
	"minimax/minimax-m2.7": 196608,
	"minimax/minimax-m2.7-highspeed": 204800,
	"minimax/minimax-m3": 512e3,
	"ministral-14b-2512": 262144,
	"ministral-3b-2512": 131072,
	"ministral-3b-latest": 131072,
	"ministral-8b-2512": 262144,
	"ministral-8b-latest": 262144,
	"mistral-large-2411": 131072,
	"mistral-large-2512": 262144,
	"mistral-large-4": 524288,
	"mistral-large-latest": 262144,
	"mistral-medium-2505": 131072,
	"mistral-medium-2508": 262144,
	"mistral-medium-2604": 262144,
	"mistral-medium-3.5": 262144,
	"mistral-medium-latest": 262144,
	"mistral-nemo": 128e3,
	"mistral-small-2506": 128e3,
	"mistral-small-2603": 262144,
	"mistral-small-latest": 262144,
	"mistral.devstral-2-123b": 262144,
	"mistral.magistral-small-2509": 128e3,
	"mistral.ministral-3-14b-instruct": 128e3,
	"mistral.ministral-3-3b-instruct": 256e3,
	"mistral.ministral-3-8b-instruct": 128e3,
	"mistral.mistral-large-3-675b-instruct": 262144,
	"mistral.pixtral-large-2502-v1:0": 128e3,
	"mistral.voxtral-mini-3b-2507": 32768,
	"mistral.voxtral-small-24b-2507": 32768,
	"mistral/codestral": 128e3,
	"mistral/ministral-14b": 262144,
	"mistral/ministral-3b": 131072,
	"mistral/ministral-8b": 262144,
	"mistral/mistral-large-3": 262144,
	"mistral/mistral-large-4": 524288,
	"mistral/mistral-medium-3.5": 262144,
	"mistral/mistral-nemo": 60288,
	"mistral/mistral-small": 262144,
	"mistralai/codestral-2508": 256e3,
	"mistralai/codestral-2508:batch": 256e3,
	"mistralai/devstral-2512": 262144,
	"mistralai/ministral-14b-2512": 262144,
	"mistralai/ministral-3b-2512": 131072,
	"mistralai/ministral-8b-2512": 262144,
	"mistralai/ministral-8b-2512:batch": 262144,
	"mistralai/mistral-7b-instruct-v0.3": 65536,
	"mistralai/mistral-large": 128e3,
	"mistralai/mistral-large-2407": 131072,
	"mistralai/mistral-large-2512": 262144,
	"mistralai/mistral-large-2512:batch": 262144,
	"mistralai/mistral-large-4-0": 524288,
	"mistralai/mistral-medium-3": 131072,
	"mistralai/mistral-medium-3-5": 262144,
	"mistralai/mistral-medium-3-5:batch": 262144,
	"mistralai/mistral-medium-3.1": 131072,
	"mistralai/mistral-medium-3.1:batch": 131072,
	"mistralai/mistral-nemo": 131072,
	"mistralai/mistral-saba": 32768,
	"mistralai/mistral-small-2603": 262144,
	"mistralai/mistral-small-2603:batch": 262144,
	"mistralai/mistral-small-3.1-24b-instruct": 128e3,
	"mistralai/mistral-small-3.2-24b-instruct": 256e3,
	"mistralai/mixtral-8x22b-instruct": 65536,
	"mistralai/voxtral-small-24b-2507": 32768,
	"mixedbread/toast-1": 131e3,
	"moonshot.kimi-k2-thinking": 262144,
	"moonshotai.kimi-k2.5": 262144,
	"moonshotai/Kimi-K2-Instruct": 131072,
	"moonshotai/Kimi-K2-Instruct-0905": 262144,
	"moonshotai/Kimi-K2-Thinking": 262144,
	"moonshotai/Kimi-K2.5": 262e3,
	"moonshotai/Kimi-K2.6": 262e3,
	"moonshotai/Kimi-K2.7-Code": 262e3,
	"moonshotai/Kimi-K3": 1e6,
	"moonshotai/kimi-k2": 131072,
	"moonshotai/kimi-k2-0905": 262144,
	"moonshotai/kimi-k2-thinking": 262144,
	"moonshotai/kimi-k2.5": 256e3,
	"moonshotai/kimi-k2.6": 262e3,
	"moonshotai/kimi-k2.7-code": 256e3,
	"moonshotai/kimi-k2.7-code-highspeed": 262144,
	"moonshotai/kimi-k3": 1e6,
	"moonshotai/kimi-k3-fast": 1e6,
	"moonshotai/kimi-k3:batch": 1048576,
	"muse-spark-1.1": 1048576,
	"muse-spark-1.2": 1048576,
	"muse-spark-1.2-contributor": 1048576,
	"muse-spark-1.3": 1048576,
	"muse-spark-1.3-contributor": 1048576,
	"muse-spark-1.3-contributor-free": 1048576,
	"nemotron-3-ultra-free": 1e6,
	"nemotron-3.5-lightning-free": 262144,
	"nex-agi/nex-n2.5-pro": 262144,
	"nvidia.nemotron-nano-12b-v2": 131072,
	"nvidia.nemotron-nano-3-30b": 262144,
	"nvidia.nemotron-nano-9b-v2": 131072,
	"nvidia.nemotron-super-3-120b": 262144,
	"nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B": 202800,
	"nvidia/Nemotron-120B-A12B": 202800,
	"nvidia/cosmos-reason2-8b": 131072,
	"nvidia/llama-3.1-nemotron-70b-instruct": 128e3,
	"nvidia/llama-3.1-nemotron-ultra-253b-v1": 128e3,
	"nvidia/nemotron-3-nano-30b-a3b": 262144,
	"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": 256e3,
	"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": 256e3,
	"nvidia/nemotron-3-super-120b-a12b": 256e3,
	"nvidia/nemotron-3-super-120b-a12b:free": 262144,
	"nvidia/nemotron-3-ultra-550b-a55b": 262144,
	"nvidia/nemotron-3-ultra-550b-a55b:free": 1e6,
	"nvidia/nemotron-3.5-lightning": 262144,
	"nvidia/nemotron-3.5-lightning-30b-a3b": 262144,
	"nvidia/nemotron-3.5-lightning:free": 1e6,
	"nvidia/nemotron-nano-12b-v2-vl": 131072,
	"nvidia/nemotron-nano-9b-v2": 131072,
	"o1": 2e5,
	"o1-pro": 2e5,
	"o3": 2e5,
	"o3-mini": 2e5,
	"o3-pro": 2e5,
	"o4-mini": 2e5,
	"open-mistral-7b": 8e3,
	"open-mistral-nemo": 128e3,
	"open-mixtral-8x22b": 64e3,
	"open-mixtral-8x7b": 32e3,
	"openai.gpt-5.4": 1e6,
	"openai.gpt-5.5": 1e6,
	"openai.gpt-5.6-luna": 105e4,
	"openai.gpt-5.6-sol": 105e4,
	"openai.gpt-5.6-terra": 105e4,
	"openai.gpt-6-astra": 105e4,
	"openai.gpt-6-luna": 105e4,
	"openai.gpt-6-sol": 105e4,
	"openai.gpt-6.1-sol": 105e4,
	"openai.gpt-oss-120b": 131072,
	"openai.gpt-oss-120b-1:0": 131072,
	"openai.gpt-oss-20b": 131072,
	"openai.gpt-oss-20b-1:0": 131072,
	"openai.gpt-oss-safeguard-120b": 128e3,
	"openai.gpt-oss-safeguard-20b": 128e3,
	"openai/gpt-3.5-turbo": 16385,
	"openai/gpt-3.5-turbo-0613": 4095,
	"openai/gpt-3.5-turbo-16k": 16385,
	"openai/gpt-3.5-turbo:batch": 16385,
	"openai/gpt-4": 8191,
	"openai/gpt-4-turbo": 128e3,
	"openai/gpt-4-turbo:batch": 128e3,
	"openai/gpt-4.1": 1047576,
	"openai/gpt-4.1-fast": 1047576,
	"openai/gpt-4.1-mini": 1047576,
	"openai/gpt-4.1-mini-fast": 1047576,
	"openai/gpt-4.1-mini:batch": 1047576,
	"openai/gpt-4.1-nano": 1047576,
	"openai/gpt-4.1-nano-fast": 1047576,
	"openai/gpt-4.1-nano:batch": 1047576,
	"openai/gpt-4.1:batch": 1047576,
	"openai/gpt-4o": 128e3,
	"openai/gpt-4o-2024-05-13": 128e3,
	"openai/gpt-4o-2024-08-06": 128e3,
	"openai/gpt-4o-2024-11-20": 128e3,
	"openai/gpt-4o-fast": 128e3,
	"openai/gpt-4o-mini": 128e3,
	"openai/gpt-4o-mini-2024-07-18": 128e3,
	"openai/gpt-4o-mini-fast": 128e3,
	"openai/gpt-4o-mini:batch": 128e3,
	"openai/gpt-4o:batch": 128e3,
	"openai/gpt-5": 4e5,
	"openai/gpt-5-codex": 4e5,
	"openai/gpt-5-fast": 4e5,
	"openai/gpt-5-mini": 4e5,
	"openai/gpt-5-mini-fast": 4e5,
	"openai/gpt-5-mini:batch": 4e5,
	"openai/gpt-5-nano": 4e5,
	"openai/gpt-5-nano:batch": 4e5,
	"openai/gpt-5-pro": 4e5,
	"openai/gpt-5-pro:batch": 4e5,
	"openai/gpt-5.1": 4e5,
	"openai/gpt-5.1-codex": 4e5,
	"openai/gpt-5.1-codex-max": 4e5,
	"openai/gpt-5.1-codex-mini": 4e5,
	"openai/gpt-5.1-thinking": 4e5,
	"openai/gpt-5.1-thinking-fast": 4e5,
	"openai/gpt-5.1:batch": 4e5,
	"openai/gpt-5.2": 4e5,
	"openai/gpt-5.2-chat": 128e3,
	"openai/gpt-5.2-codex": 4e5,
	"openai/gpt-5.2-fast": 4e5,
	"openai/gpt-5.2-pro": 4e5,
	"openai/gpt-5.2-pro:batch": 4e5,
	"openai/gpt-5.2:batch": 4e5,
	"openai/gpt-5.3-codex": 4e5,
	"openai/gpt-5.3-codex-fast": 4e5,
	"openai/gpt-5.4": 105e4,
	"openai/gpt-5.4-fast": 105e4,
	"openai/gpt-5.4-mini": 4e5,
	"openai/gpt-5.4-mini-fast": 4e5,
	"openai/gpt-5.4-mini:batch": 4e5,
	"openai/gpt-5.4-nano": 4e5,
	"openai/gpt-5.4-nano:batch": 4e5,
	"openai/gpt-5.4-pro": 105e4,
	"openai/gpt-5.4-pro:batch": 105e4,
	"openai/gpt-5.4:batch": 105e4,
	"openai/gpt-5.5": 1e6,
	"openai/gpt-5.5-fast": 1e6,
	"openai/gpt-5.5-pro": 1e6,
	"openai/gpt-5.5-pro:batch": 105e4,
	"openai/gpt-5.5:batch": 105e4,
	"openai/gpt-5.6-luna": 105e4,
	"openai/gpt-5.6-luna-fast": 105e4,
	"openai/gpt-5.6-luna-pro": 105e4,
	"openai/gpt-5.6-luna-pro:batch": 105e4,
	"openai/gpt-5.6-luna:batch": 105e4,
	"openai/gpt-5.6-sol": 105e4,
	"openai/gpt-5.6-sol-fast": 105e4,
	"openai/gpt-5.6-sol-pro": 105e4,
	"openai/gpt-5.6-sol-pro:batch": 105e4,
	"openai/gpt-5.6-sol:batch": 105e4,
	"openai/gpt-5.6-terra": 105e4,
	"openai/gpt-5.6-terra-fast": 105e4,
	"openai/gpt-5.6-terra-pro": 105e4,
	"openai/gpt-5.6-terra-pro:batch": 105e4,
	"openai/gpt-5.6-terra:batch": 105e4,
	"openai/gpt-5:batch": 4e5,
	"openai/gpt-6-astra": 105e4,
	"openai/gpt-6-astra-fast": 105e4,
	"openai/gpt-6-astra-pro": 105e4,
	"openai/gpt-6-astra-pro:batch": 105e4,
	"openai/gpt-6-astra:batch": 105e4,
	"openai/gpt-6-luna": 105e4,
	"openai/gpt-6-luna-fast": 105e4,
	"openai/gpt-6-luna-pro": 105e4,
	"openai/gpt-6-luna-pro:batch": 105e4,
	"openai/gpt-6-luna:batch": 105e4,
	"openai/gpt-6-sol": 105e4,
	"openai/gpt-6-sol-fast": 105e4,
	"openai/gpt-6-sol-pro": 105e4,
	"openai/gpt-6-sol-pro:batch": 105e4,
	"openai/gpt-6-sol:batch": 105e4,
	"openai/gpt-6.1-sol": 105e4,
	"openai/gpt-6.1-sol-fast": 105e4,
	"openai/gpt-6.1-sol-pro": 105e4,
	"openai/gpt-audio": 128e3,
	"openai/gpt-audio-mini": 128e3,
	"openai/gpt-chat-latest": 4e5,
	"openai/gpt-oss-120b": 128072,
	"openai/gpt-oss-120b:batch": 131072,
	"openai/gpt-oss-20b": 131072,
	"openai/gpt-oss-20b:batch": 131072,
	"openai/gpt-oss-safeguard-120b": 128e3,
	"openai/gpt-oss-safeguard-20b": 128e3,
	"openai/o1": 2e5,
	"openai/o3": 2e5,
	"openai/o3-fast": 2e5,
	"openai/o3-mini": 2e5,
	"openai/o3-mini-high": 2e5,
	"openai/o3-mini:batch": 2e5,
	"openai/o3-pro": 2e5,
	"openai/o3:batch": 2e5,
	"openai/o4-mini": 2e5,
	"openai/o4-mini-fast": 2e5,
	"openai/o4-mini-high": 2e5,
	"openai/o4-mini:batch": 2e5,
	"openrouter/auto": 2e6,
	"openrouter/auto-beta": 2e6,
	"openrouter/free": 2e5,
	"openrouter/fusion": 1e6,
	"perceptron/perceptron-mk1.5": 36864,
	"pixtral-12b": 128e3,
	"pixtral-large-latest": 128e3,
	"poolside/laguna-s-2.1": 1e6,
	"poolside/laguna-s-2.1-free": 256e3,
	"poolside/laguna-s-2.1:free": 262144,
	"poolside/laguna-xs-2.1": 262144,
	"poolside/laguna-xs-2.1:free": 262144,
	"precise": 272e3,
	"prism-ml/ternary-bonsai-2-27b": 262144,
	"quiverai/arrow-2": 131072,
	"quiverai/arrow-2-telos": 131072,
	"qwen-3.8-27b": 131072,
	"qwen.qwen3-235b-a22b-2507-v1:0": 262144,
	"qwen.qwen3-32b-v1:0": 32768,
	"qwen.qwen3-coder-30b-a3b-v1:0": 262144,
	"qwen.qwen3-coder-480b-a35b-v1:0": 131072,
	"qwen.qwen3-coder-next": 262144,
	"qwen.qwen3-next-80b-a3b": 262144,
	"qwen.qwen3-vl-235b-a22b": 262144,
	"qwen/qwen-2.5-72b-instruct": 32768,
	"qwen/qwen-2.5-7b-instruct": 32768,
	"qwen/qwen-plus": 1e6,
	"qwen/qwen-plus-2025-07-28": 1e6,
	"qwen/qwen3-14b": 40960,
	"qwen/qwen3-235b-a22b": 131072,
	"qwen/qwen3-235b-a22b-2507": 262144,
	"qwen/qwen3-235b-a22b-thinking-2507": 131072,
	"qwen/qwen3-30b-a3b": 40960,
	"qwen/qwen3-30b-a3b-instruct-2507": 128e3,
	"qwen/qwen3-30b-a3b-thinking-2507": 81920,
	"qwen/qwen3-32b": 40960,
	"qwen/qwen3-8b": 131072,
	"qwen/qwen3-coder": 262144,
	"qwen/qwen3-coder-30b-a3b-instruct": 262144,
	"qwen/qwen3-coder-flash": 1e6,
	"qwen/qwen3-coder-next": 262144,
	"qwen/qwen3-coder-plus": 1e6,
	"qwen/qwen3-max": 262144,
	"qwen/qwen3-max-thinking": 262144,
	"qwen/qwen3-next-80b-a3b-instruct": 262144,
	"qwen/qwen3-next-80b-a3b-thinking": 131072,
	"qwen/qwen3-vl-235b-a22b-instruct": 131072,
	"qwen/qwen3-vl-235b-a22b-thinking": 131072,
	"qwen/qwen3-vl-30b-a3b-instruct": 262144,
	"qwen/qwen3-vl-30b-a3b-thinking": 131072,
	"qwen/qwen3-vl-32b-instruct": 131072,
	"qwen/qwen3-vl-8b-instruct": 131072,
	"qwen/qwen3-vl-8b-thinking": 131072,
	"qwen/qwen3.5-122b-a10b": 262144,
	"qwen/qwen3.5-27b": 262144,
	"qwen/qwen3.5-35b-a3b": 262144,
	"qwen/qwen3.5-397b-a17b": 262144,
	"qwen/qwen3.5-9b": 256e3,
	"qwen/qwen3.5-flash-02-23": 1e6,
	"qwen/qwen3.5-plus-02-15": 1e6,
	"qwen/qwen3.5-plus-20260420": 1e6,
	"qwen/qwen3.6-27b": 131072,
	"qwen/qwen3.6-35b-a3b": 262144,
	"qwen/qwen3.6-flash": 1e6,
	"qwen/qwen3.6-max-preview": 262144,
	"qwen/qwen3.6-plus": 1e6,
	"qwen/qwen3.7-flash": 1e6,
	"qwen/qwen3.7-max": 1e6,
	"qwen/qwen3.7-plus": 1e6,
	"qwen/qwen3.8-2.4t-a95b": 1048576,
	"qwen/qwen3.8-27b": 131042,
	"qwen/qwen3.8-flash": 1e6,
	"qwen/qwen3.8-max-0902": 1e6,
	"qwen/qwen3.8-max-prime": 1e6,
	"qwen/qwen3.8-omni-flash": 1e6,
	"qwen3.5-plus": 262144,
	"qwen3.6-flash": 1e6,
	"qwen3.6-plus": 262144,
	"qwen3.7-max": 1e6,
	"qwen3.7-plus": 1e6,
	"qwen3.8-flash": 1e6,
	"qwen3.8-max": 262144,
	"rekaai/reka-edge": 16384,
	"relace/relace-search": 256e3,
	"sakana/fugu-max": 1e6,
	"sakana/fugu-ultra": 1e6,
	"sakana/fugu-ultra-v2": 1e6,
	"sakana/namazu": 256e3,
	"sakana/sakana-namazu": 262144,
	"sao10k/l3.1-euryale-70b": 131072,
	"space-bunny": 1048576,
	"space-bunny-free": 1048576,
	"spacexai/grok-4.1-fast-non-reasoning": 1e6,
	"spacexai/grok-4.1-fast-reasoning": 1e6,
	"spacexai/grok-4.20-multi-agent": 2e6,
	"spacexai/grok-4.20-multi-agent-beta": 2e6,
	"spacexai/grok-4.20-non-reasoning": 2e6,
	"spacexai/grok-4.20-non-reasoning-beta": 2e6,
	"spacexai/grok-4.20-reasoning": 2e6,
	"spacexai/grok-4.20-reasoning-beta": 2e6,
	"spacexai/grok-4.3": 1e6,
	"spacexai/grok-4.5": 5e5,
	"spacexai/grok-4.6": 5e5,
	"spacexai/grok-4.7": 5e5,
	"spacexai/grok-build-0.1": 256e3,
	"stealth/glyph-cluster": 256e3,
	"stepfun-ai/Step-3.5-Flash": 262144,
	"stepfun-ai/Step-3.7-Flash": 262144,
	"stepfun/step-3.5-flash": 262144,
	"stepfun/step-3.7-flash": 256e3,
	"tencent/Hy3": 262144,
	"tencent/Hy4-preview": 1e6,
	"tencent/hy3": 262144,
	"tencent/hy3-preview": 262144,
	"tencent/hy4-preview": 1024e3,
	"thinkingmachines/Inkling": 524288,
	"thinkingmachines/Inkling-Small": 524288,
	"thinkingmachines/inkling": 256e3,
	"thinkingmachines/inkling-small": 524288,
	"thinkingmachines/inkling-small:free": 1048576,
	"thinkingmachines/inkling:free": 1048576,
	"typesafe/jev-router": 1e6,
	"unbiased/pareto": 262144,
	"unbiased/pareto-26.10-preview": 1048576,
	"upstage/solar-mini4": 524288,
	"upstage/solar-pro-3": 131072,
	"upstage/solar-pro4": 524288,
	"us-gov.openai.gpt-oss-120b-1:0": 128e3,
	"us-gov.openai.gpt-oss-20b-1:0": 128e3,
	"us.amazon.nova-2-lite-v1:0": 1e6,
	"us.amazon.nova-lite-v1:0": 3e5,
	"us.amazon.nova-micro-v1:0": 128e3,
	"us.amazon.nova-premier-v1:0": 1e6,
	"us.amazon.nova-pro-v1:0": 3e5,
	"us.anthropic.claude-fable-5": 1e6,
	"us.anthropic.claude-fable-5-1": 1e6,
	"us.anthropic.claude-haiku-4-5-20251001-v1:0": 2e5,
	"us.anthropic.claude-haiku-5-5": 1e6,
	"us.anthropic.claude-opus-4-1-20250805-v1:0": 2e5,
	"us.anthropic.claude-opus-4-5-20251101-v1:0": 2e5,
	"us.anthropic.claude-opus-4-6-v1": 1e6,
	"us.anthropic.claude-opus-4-7": 1e6,
	"us.anthropic.claude-opus-4-8": 1e6,
	"us.anthropic.claude-opus-5": 1e6,
	"us.anthropic.claude-opus-5-5": 1e6,
	"us.anthropic.claude-sonnet-4-20250514-v1:0": 2e5,
	"us.anthropic.claude-sonnet-4-5-20250929-v1:0": 2e5,
	"us.anthropic.claude-sonnet-4-6": 1e6,
	"us.anthropic.claude-sonnet-5": 1e6,
	"us.anthropic.claude-sonnet-5-5": 1e6,
	"us.meta.llama3-1-70b-instruct-v1:0": 128e3,
	"us.meta.llama3-1-8b-instruct-v1:0": 128e3,
	"us.meta.llama3-3-70b-instruct-v1:0": 128e3,
	"us.meta.llama4-maverick-17b-instruct-v1:0": 1e6,
	"us.meta.llama4-scout-17b-instruct-v1:0": 1e7,
	"us.mistral.pixtral-large-2502-v1:0": 128e3,
	"us.moonshotai.kimi-k3": 1048576,
	"us.openai.gpt-5.6-luna": 105e4,
	"us.openai.gpt-5.6-sol": 105e4,
	"us.openai.gpt-5.6-terra": 105e4,
	"us.openai.gpt-6-astra": 105e4,
	"us.openai.gpt-6-luna": 105e4,
	"us.openai.gpt-6-sol": 105e4,
	"us.openai.gpt-6.1-sol": 105e4,
	"us.writer.palmyra-x4-v1:0": 122880,
	"us.writer.palmyra-x5-v1:0": 104e4,
	"us.xai.grok-4.6": 5e5,
	"us.xai.grok-4.7": 5e5,
	"us.zai.glm-5.3": 1e6,
	"voxtral-small-2507": 32768,
	"voxtral-small-latest": 32768,
	"workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731": 1048576,
	"workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813": 1048576,
	"workers-ai/@cf/google/gemma-4-26b-a4b-it": 256e3,
	"workers-ai/@cf/ibm-granite/granite-4.0-h-micro": 131e3,
	"workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast": 24e3,
	"workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct": 131e3,
	"workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct": 128e3,
	"workers-ai/@cf/moonshotai/kimi-k2.6": 262144,
	"workers-ai/@cf/moonshotai/kimi-k2.7-code": 262144,
	"workers-ai/@cf/nvidia/nemotron-3-120b-a12b": 256e3,
	"workers-ai/@cf/openai/gpt-oss-120b": 128e3,
	"workers-ai/@cf/openai/gpt-oss-20b": 128e3,
	"workers-ai/@cf/qwen/qwen3-30b-a3b-fp8": 32768,
	"workers-ai/@cf/qwen/qwen3.8-27b": 262144,
	"workers-ai/@cf/zai-org/glm-4.7-flash": 131072,
	"workers-ai/@cf/zai-org/glm-5.2": 262144,
	"workers-ai/@cf/zai-org/glm-5.3": 1048576,
	"workers-ai/@cf/zai-org/glm-5.3-flash": 1048576,
	"writer.palmyra-x4-v1:0": 122880,
	"writer.palmyra-x5-v1:0": 104e4,
	"x-ai/grok-4.20": 2e6,
	"x-ai/grok-4.3": 1e6,
	"x-ai/grok-4.3:batch": 1e6,
	"x-ai/grok-4.5": 5e5,
	"x-ai/grok-4.6": 5e5,
	"x-ai/grok-4.7": 5e5,
	"x-ai/grok-build-0.1": 256e3,
	"xai.grok-4.3": 1e6,
	"xai.grok-4.6": 5e5,
	"xiaomi/mimo-v2.5": 1048576,
	"xiaomi/mimo-v2.5-pro": 1048576,
	"xiaomi/mimo-v2.6-flash": 1048576,
	"xiaomi/mimo-v2.6-pro": 1048576,
	"xiaomi/mimo-v2.6-pro-ultraspeed": 1048576,
	"z-ai/glm-4.5": 131072,
	"z-ai/glm-4.5-air": 131072,
	"z-ai/glm-4.5v": 65536,
	"z-ai/glm-4.6": 198e3,
	"z-ai/glm-4.6v": 131072,
	"z-ai/glm-4.7": 202752,
	"z-ai/glm-4.7-flash": 131072,
	"z-ai/glm-5": 198e3,
	"z-ai/glm-5-turbo": 202752,
	"z-ai/glm-5.1": 2e5,
	"z-ai/glm-5.2": 1048576,
	"z-ai/glm-5.3": 1e6,
	"z-ai/glm-5.3-flash": 1e6,
	"z-ai/glm-5.3-flash:batch": 1048576,
	"z-ai/glm-5.3-flashx": 1048576,
	"z-ai/glm-5.3-prime": 1e6,
	"z-ai/glm-5.3:batch": 1048576,
	"z-ai/glm-5v-turbo": 202752,
	"zai-glm-5-2": 1048576,
	"zai-glm-5-3": 1048576,
	"zai-org/GLM-4.5": 131072,
	"zai-org/GLM-4.5-Air": 131072,
	"zai-org/GLM-4.5V": 65536,
	"zai-org/GLM-4.6": 204800,
	"zai-org/GLM-4.6V-Flash": 131072,
	"zai-org/GLM-4.7": 2e5,
	"zai-org/GLM-4.7-Flash": 2e5,
	"zai-org/GLM-5": 202752,
	"zai-org/GLM-5.1": 202752,
	"zai-org/GLM-5.2": 262144,
	"zai-org/GLM-5.2-Fast": 1048576,
	"zai-org/GLM-5.3": 1048576,
	"zai-org/GLM-5.3-Fast": 1048576,
	"zai-org/GLM-5.3-Flash": 1048575,
	"zai.glm-4.7": 202752,
	"zai.glm-4.7-flash": 202752,
	"zai.glm-5": 202752,
	"zai/glm-4.5": 128e3,
	"zai/glm-4.5-air": 128e3,
	"zai/glm-4.5v": 66e3,
	"zai/glm-4.6": 2e5,
	"zai/glm-4.7": 2e5,
	"zai/glm-4.7-flash": 2e5,
	"zai/glm-4.7-flashx": 2e5,
	"zai/glm-5": 202800,
	"zai/glm-5-turbo": 202800,
	"zai/glm-5.1": 202800,
	"zai/glm-5.2": 1e6,
	"zai/glm-5.2-fast": 1e6,
	"zai/glm-5.3": 1e6,
	"zai/glm-5.3-fast": 1048576,
	"zai/glm-5.3-flash": 1e6,
	"zai/glm-5.3-flashx": 1e6,
	"zai/glm-5v-turbo": 2e5,
	"~anthropic/claude-fable-latest": 1e6,
	"~anthropic/claude-haiku-latest": 1e6,
	"~anthropic/claude-opus-latest": 1e6,
	"~anthropic/claude-sonnet-latest": 1e6,
	"~deepseek/deepseek-flash-latest": 1048576,
	"~deepseek/deepseek-pro-latest": 1048576,
	"~deepseek/deepseek-v4-flash-latest": 1048576,
	"~google/gemini-flash-latest": 1048576,
	"~google/gemini-pro-latest": 1048576,
	"~moonshotai/kimi-latest": 1048576,
	"~openai/gpt-astra-latest": 105e4,
	"~openai/gpt-luna-latest": 105e4,
	"~openai/gpt-mini-latest": 4e5,
	"~openai/gpt-sol-latest": 105e4,
	"~openai/gpt-terra-latest": 105e4,
	"~x-ai/grok-latest": 5e5,
	"~z-ai/glm-flash-latest": 1048576,
	"~z-ai/glm-latest": 1048576
};
/** Model id -> the input modalities the catalog states, for models that take images. */
const MODEL_INPUT = {
	"@cf/google/gemma-4-26b-a4b-it": ["image", "text"],
	"@cf/meta/llama-4-scout-17b-16e-instruct": ["image", "text"],
	"@cf/moonshotai/kimi-k2.6": ["image", "text"],
	"@cf/moonshotai/kimi-k2.7-code": ["image", "text"],
	"@cf/qwen/qwen3.8-27b": ["image", "text"],
	"@cf/zai-org/glm-5.3-flash": ["image", "text"],
	"MiniMax-M3": ["image", "text"],
	"MiniMaxAI/MiniMax-M3": ["image", "text"],
	"Qwen/Qwen3-VL-235B-A22B-Instruct": ["image", "text"],
	"Qwen/Qwen3-VL-235B-A22B-Thinking": ["image", "text"],
	"Qwen/Qwen3.5-122B-A10B": ["image", "text"],
	"Qwen/Qwen3.5-27B": ["image", "text"],
	"Qwen/Qwen3.5-35B-A3B": ["image", "text"],
	"Qwen/Qwen3.5-397B-A17B": ["image", "text"],
	"Qwen/Qwen3.5-9B": ["image", "text"],
	"Qwen/Qwen3.6-27B": ["image", "text"],
	"Qwen/Qwen3.6-35B-A3B": ["image", "text"],
	"Qwen/Qwen3.8-27B": ["image", "text"],
	"accounts/fireworks/models/deepseek-v4p1-flash": ["image", "text"],
	"accounts/fireworks/models/ember-1": ["image", "text"],
	"accounts/fireworks/models/glm-5p3-flash": ["image", "text"],
	"accounts/fireworks/models/inkling": ["image", "text"],
	"accounts/fireworks/models/kimi-k3": ["image", "text"],
	"accounts/fireworks/models/qwen3p8-max": ["image", "text"],
	"accounts/fireworks/routers/deepseek-flash-latest": ["image", "text"],
	"accounts/fireworks/routers/glm-flash-latest": ["image", "text"],
	"accounts/fireworks/routers/kimi-fast-latest": ["image", "text"],
	"accounts/fireworks/routers/kimi-k3-fast": ["image", "text"],
	"accounts/fireworks/routers/kimi-latest": ["image", "text"],
	"accounts/fireworks/routers/qwen-max-latest": ["image", "text"],
	"alibaba/qwen3-235b-a22b-thinking": ["image", "text"],
	"alibaba/qwen3-vl-235b-a22b-instruct": ["image", "text"],
	"alibaba/qwen3-vl-instruct": ["image", "text"],
	"alibaba/qwen3-vl-thinking": ["image", "text"],
	"alibaba/qwen3.5-flash": ["image", "text"],
	"alibaba/qwen3.5-plus": ["image", "text"],
	"alibaba/qwen3.6-27b": ["image", "text"],
	"alibaba/qwen3.6-plus": ["image", "text"],
	"alibaba/qwen3.7-flash": ["image", "text"],
	"alibaba/qwen3.7-plus": ["image", "text"],
	"alibaba/qwen3.8-2.4t-a95b": ["image", "text"],
	"alibaba/qwen3.8-27b": ["image", "text"],
	"alibaba/qwen3.8-flash": ["image", "text"],
	"alibaba/qwen3.8-max": ["image", "text"],
	"alibaba/qwen3.8-max-0902": ["image", "text"],
	"alibaba/qwen3.8-max-prime": ["image", "text"],
	"alibaba/qwen3.8-omni-flash": ["image", "text"],
	"amazon.nova-2-lite-v1:0": ["image", "text"],
	"amazon.nova-lite-v1:0": ["image", "text"],
	"amazon.nova-pro-v1:0": ["image", "text"],
	"amazon/nova-2-lite": ["image", "text"],
	"amazon/nova-2-lite-v1": ["image", "text"],
	"amazon/nova-lite": ["image", "text"],
	"amazon/nova-lite-v1": ["image", "text"],
	"amazon/nova-premier-v1": ["image", "text"],
	"amazon/nova-pro": ["image", "text"],
	"amazon/nova-pro-v1": ["image", "text"],
	"anthropic.claude-fable-5": ["image", "text"],
	"anthropic.claude-fable-5-1": ["image", "text"],
	"anthropic.claude-haiku-4-5-20251001-v1:0": ["image", "text"],
	"anthropic.claude-haiku-5-5": ["image", "text"],
	"anthropic.claude-opus-4-1-20250805-v1:0": ["image", "text"],
	"anthropic.claude-opus-4-5-20251101-v1:0": ["image", "text"],
	"anthropic.claude-opus-4-6-v1": ["image", "text"],
	"anthropic.claude-opus-4-7": ["image", "text"],
	"anthropic.claude-opus-4-8": ["image", "text"],
	"anthropic.claude-opus-5-5": ["image", "text"],
	"anthropic.claude-sonnet-4-5-20250929-v1:0": ["image", "text"],
	"anthropic.claude-sonnet-4-6": ["image", "text"],
	"anthropic.claude-sonnet-5": ["image", "text"],
	"anthropic.claude-sonnet-5-5": ["image", "text"],
	"anthropic/claude-3-haiku": ["image", "text"],
	"anthropic/claude-fable-5": ["image", "text"],
	"anthropic/claude-fable-5.1": ["image", "text"],
	"anthropic/claude-fable-5.1:batch": ["image", "text"],
	"anthropic/claude-fable-5:batch": ["image", "text"],
	"anthropic/claude-haiku-4.5": ["image", "text"],
	"anthropic/claude-haiku-4.5:batch": ["image", "text"],
	"anthropic/claude-haiku-5.5": ["image", "text"],
	"anthropic/claude-haiku-5.5:batch": ["image", "text"],
	"anthropic/claude-opus-4": ["image", "text"],
	"anthropic/claude-opus-4.1": ["image", "text"],
	"anthropic/claude-opus-4.1:batch": ["image", "text"],
	"anthropic/claude-opus-4.5": ["image", "text"],
	"anthropic/claude-opus-4.5:batch": ["image", "text"],
	"anthropic/claude-opus-4.6": ["image", "text"],
	"anthropic/claude-opus-4.6:batch": ["image", "text"],
	"anthropic/claude-opus-4.7": ["image", "text"],
	"anthropic/claude-opus-4.7:batch": ["image", "text"],
	"anthropic/claude-opus-4.8": ["image", "text"],
	"anthropic/claude-opus-4.8-fast": ["image", "text"],
	"anthropic/claude-opus-4.8:batch": ["image", "text"],
	"anthropic/claude-opus-5": ["image", "text"],
	"anthropic/claude-opus-5-fast": ["image", "text"],
	"anthropic/claude-opus-5.5": ["image", "text"],
	"anthropic/claude-opus-5.5-fast": ["image", "text"],
	"anthropic/claude-opus-5.5:batch": ["image", "text"],
	"anthropic/claude-opus-5:batch": ["image", "text"],
	"anthropic/claude-sonnet-4": ["image", "text"],
	"anthropic/claude-sonnet-4.5": ["image", "text"],
	"anthropic/claude-sonnet-4.5:batch": ["image", "text"],
	"anthropic/claude-sonnet-4.6": ["image", "text"],
	"anthropic/claude-sonnet-4.6:batch": ["image", "text"],
	"anthropic/claude-sonnet-5": ["image", "text"],
	"anthropic/claude-sonnet-5.5": ["image", "text"],
	"anthropic/claude-sonnet-5.5:batch": ["image", "text"],
	"anthropic/claude-sonnet-5:batch": ["image", "text"],
	"apac.amazon.nova-lite-v1:0": ["image", "text"],
	"apac.amazon.nova-pro-v1:0": ["image", "text"],
	"apac.anthropic.claude-sonnet-4-20250514-v1:0": ["image", "text"],
	"au.anthropic.claude-haiku-4-5-20251001-v1:0": ["image", "text"],
	"au.anthropic.claude-haiku-5-5": ["image", "text"],
	"au.anthropic.claude-opus-4-6-v1": ["image", "text"],
	"au.anthropic.claude-opus-4-7": ["image", "text"],
	"au.anthropic.claude-opus-4-8": ["image", "text"],
	"au.anthropic.claude-opus-5": ["image", "text"],
	"au.anthropic.claude-opus-5-5": ["image", "text"],
	"au.anthropic.claude-sonnet-4-5-20250929-v1:0": ["image", "text"],
	"au.anthropic.claude-sonnet-4-6": ["image", "text"],
	"au.anthropic.claude-sonnet-5": ["image", "text"],
	"auto": ["image", "text"],
	"balanced": ["image", "text"],
	"bytedance-seed/seed-1.6": ["image", "text"],
	"bytedance-seed/seed-1.6-flash": ["image", "text"],
	"bytedance-seed/seed-2-1-turbo": ["image", "text"],
	"bytedance-seed/seed-2.0-code": ["image", "text"],
	"bytedance-seed/seed-2.0-lite": ["image", "text"],
	"bytedance-seed/seed-2.0-mini": ["image", "text"],
	"bytedance/seed-1.6": ["image", "text"],
	"bytedance/seed-1.8": ["image", "text"],
	"bytedance/seed-2.1-turbo": ["image", "text"],
	"ca.amazon.nova-lite-v1:0": ["image", "text"],
	"cheap": ["image", "text"],
	"claude-fable-5": ["image", "text"],
	"claude-fable-5-1": ["image", "text"],
	"claude-fable-5.1": ["image", "text"],
	"claude-haiku-4-5": ["image", "text"],
	"claude-haiku-4-5-20251001": ["image", "text"],
	"claude-haiku-4.5": ["image", "text"],
	"claude-haiku-5-5": ["image", "text"],
	"claude-opus-4-5": ["image", "text"],
	"claude-opus-4-5-20251101": ["image", "text"],
	"claude-opus-4-6": ["image", "text"],
	"claude-opus-4-7": ["image", "text"],
	"claude-opus-4-8": ["image", "text"],
	"claude-opus-4.7": ["image", "text"],
	"claude-opus-4.8": ["image", "text"],
	"claude-opus-5": ["image", "text"],
	"claude-opus-5-5": ["image", "text"],
	"claude-opus-5.5": ["image", "text"],
	"claude-sonnet-4": ["image", "text"],
	"claude-sonnet-4-5": ["image", "text"],
	"claude-sonnet-4-5-20250929": ["image", "text"],
	"claude-sonnet-4-6": ["image", "text"],
	"claude-sonnet-4.6": ["image", "text"],
	"claude-sonnet-5": ["image", "text"],
	"claude-sonnet-5-5": ["image", "text"],
	"claude-sonnet-5.5": ["image", "text"],
	"cohere/command-a-plus": ["image", "text"],
	"deep-research-max-preview-04-2026": ["image", "text"],
	"deep-research-preview-04-2026": ["image", "text"],
	"deepseek-ai/DeepSeek-V4-Flash-Vision-Exp": ["image", "text"],
	"deepseek-ai/DeepSeek-V4.1-Flash": ["image", "text"],
	"deepseek-ai/DeepSeek-V4.1-Flash-Fast": ["image", "text"],
	"deepseek-ai/deepseek-v4.1-flash": ["image", "text"],
	"deepseek-flash": ["image", "text"],
	"deepseek-v4-flash-vision-exp": ["image", "text"],
	"deepseek-v4.1-flash": ["image", "text"],
	"deepseek/deepseek-v4-flash-vision-exp": ["image", "text"],
	"deepseek/deepseek-v4.1-flash": ["image", "text"],
	"deepseek/deepseek-v4.1-flash-fast": ["image", "text"],
	"deepseek/deepseek-v4.1-flash:batch": ["image", "text"],
	"dots-studio/dots-3-note-preview:free": ["image", "text"],
	"eu.amazon.nova-2-lite-v1:0": ["image", "text"],
	"eu.amazon.nova-lite-v1:0": ["image", "text"],
	"eu.amazon.nova-pro-v1:0": ["image", "text"],
	"eu.anthropic.claude-fable-5": ["image", "text"],
	"eu.anthropic.claude-haiku-4-5-20251001-v1:0": ["image", "text"],
	"eu.anthropic.claude-haiku-5-5": ["image", "text"],
	"eu.anthropic.claude-opus-4-5-20251101-v1:0": ["image", "text"],
	"eu.anthropic.claude-opus-4-6-v1": ["image", "text"],
	"eu.anthropic.claude-opus-4-7": ["image", "text"],
	"eu.anthropic.claude-opus-4-8": ["image", "text"],
	"eu.anthropic.claude-opus-5": ["image", "text"],
	"eu.anthropic.claude-opus-5-5": ["image", "text"],
	"eu.anthropic.claude-sonnet-4-20250514-v1:0": ["image", "text"],
	"eu.anthropic.claude-sonnet-4-5-20250929-v1:0": ["image", "text"],
	"eu.anthropic.claude-sonnet-4-6": ["image", "text"],
	"eu.anthropic.claude-sonnet-5": ["image", "text"],
	"eu.anthropic.claude-sonnet-5-5": ["image", "text"],
	"eu.mistral.pixtral-large-2502-v1:0": ["image", "text"],
	"exo-free": ["image", "text"],
	"fireworks/ember-1": ["image", "text"],
	"fledge-alpha-free": ["image", "text"],
	"gemini-2.5-computer-use-preview-10-2025": ["image", "text"],
	"gemini-2.5-flash": ["image", "text"],
	"gemini-2.5-flash-lite": ["image", "text"],
	"gemini-2.5-pro": ["image", "text"],
	"gemini-3-flash": ["image", "text"],
	"gemini-3-flash-preview": ["image", "text"],
	"gemini-3.1-flash-lite": ["image", "text"],
	"gemini-3.1-flash-lite-image": ["image", "text"],
	"gemini-3.1-flash-lite-preview": ["image", "text"],
	"gemini-3.1-flash-live-preview": ["image", "text"],
	"gemini-3.1-pro": ["image", "text"],
	"gemini-3.1-pro-preview": ["image", "text"],
	"gemini-3.1-pro-preview-customtools": ["image", "text"],
	"gemini-3.5-flash": ["image", "text"],
	"gemini-3.5-flash-lite": ["image", "text"],
	"gemini-3.6-flash": ["image", "text"],
	"gemini-3.7-flash": ["image", "text"],
	"gemini-3.8-flash": ["image", "text"],
	"gemini-flash-latest": ["image", "text"],
	"gemini-flash-lite-latest": ["image", "text"],
	"gemma-4-26b-a4b-it": ["image", "text"],
	"gemma-4-31b-it": ["image", "text"],
	"glm-4.6v": ["image", "text"],
	"glm-5.3-flash": ["image", "text"],
	"global.amazon.nova-2-lite-v1:0": ["image", "text"],
	"global.anthropic.claude-fable-5": ["image", "text"],
	"global.anthropic.claude-fable-5-1": ["image", "text"],
	"global.anthropic.claude-haiku-4-5-20251001-v1:0": ["image", "text"],
	"global.anthropic.claude-haiku-5-5": ["image", "text"],
	"global.anthropic.claude-opus-4-5-20251101-v1:0": ["image", "text"],
	"global.anthropic.claude-opus-4-6-v1": ["image", "text"],
	"global.anthropic.claude-opus-4-7": ["image", "text"],
	"global.anthropic.claude-opus-4-8": ["image", "text"],
	"global.anthropic.claude-opus-5": ["image", "text"],
	"global.anthropic.claude-opus-5-5": ["image", "text"],
	"global.anthropic.claude-sonnet-4-20250514-v1:0": ["image", "text"],
	"global.anthropic.claude-sonnet-4-5-20250929-v1:0": ["image", "text"],
	"global.anthropic.claude-sonnet-4-6": ["image", "text"],
	"global.anthropic.claude-sonnet-5": ["image", "text"],
	"global.anthropic.claude-sonnet-5-5": ["image", "text"],
	"global.moonshotai.kimi-k3": ["image", "text"],
	"global.openai.gpt-5.6-luna": ["image", "text"],
	"global.openai.gpt-5.6-sol": ["image", "text"],
	"global.openai.gpt-5.6-terra": ["image", "text"],
	"global.openai.gpt-6-astra": ["image", "text"],
	"global.openai.gpt-6-luna": ["image", "text"],
	"global.openai.gpt-6-sol": ["image", "text"],
	"global.openai.gpt-6.1-sol": ["image", "text"],
	"global.xai.grok-4.6": ["image", "text"],
	"global.xai.grok-4.7": ["image", "text"],
	"google.gemma-4-26b-a4b": ["image", "text"],
	"google.gemma-4-31b": ["image", "text"],
	"google.gemma-4-e2b": ["image", "text"],
	"google/diffusiongemma-26b-a4b-it": ["image", "text"],
	"google/gemini-2.5-flash": ["image", "text"],
	"google/gemini-2.5-flash-lite": ["image", "text"],
	"google/gemini-2.5-flash-lite:batch": ["image", "text"],
	"google/gemini-2.5-flash:batch": ["image", "text"],
	"google/gemini-2.5-pro": ["image", "text"],
	"google/gemini-2.5-pro-preview": ["image", "text"],
	"google/gemini-2.5-pro:batch": ["image", "text"],
	"google/gemini-3-flash": ["image", "text"],
	"google/gemini-3-flash-preview": ["image", "text"],
	"google/gemini-3-flash-preview:batch": ["image", "text"],
	"google/gemini-3-pro-image": ["image", "text"],
	"google/gemini-3.1-flash-lite": ["image", "text"],
	"google/gemini-3.1-flash-lite-preview": ["image", "text"],
	"google/gemini-3.1-flash-lite:batch": ["image", "text"],
	"google/gemini-3.1-pro-preview": ["image", "text"],
	"google/gemini-3.1-pro-preview-customtools": ["image", "text"],
	"google/gemini-3.1-pro-preview:batch": ["image", "text"],
	"google/gemini-3.5-flash": ["image", "text"],
	"google/gemini-3.5-flash-lite": ["image", "text"],
	"google/gemini-3.5-flash-lite:batch": ["image", "text"],
	"google/gemini-3.5-flash:batch": ["image", "text"],
	"google/gemini-3.6-flash": ["image", "text"],
	"google/gemini-3.6-flash:batch": ["image", "text"],
	"google/gemini-3.7-flash": ["image", "text"],
	"google/gemini-3.7-flash:batch": ["image", "text"],
	"google/gemini-3.8-flash": ["image", "text"],
	"google/gemini-3.8-flash:batch": ["image", "text"],
	"google/gemini-nano-banana-2.1": ["image", "text"],
	"google/gemma-3-12b-it": ["image", "text"],
	"google/gemma-3-27b-it": ["image", "text"],
	"google/gemma-3-4b-it": ["image", "text"],
	"google/gemma-4-26B-A4B-it": ["image", "text"],
	"google/gemma-4-26b-a4b-it": ["image", "text"],
	"google/gemma-4-26b-a4b-it:free": ["image", "text"],
	"google/gemma-4-31B-it": ["image", "text"],
	"google/gemma-4-31b-it": ["image", "text"],
	"google/gemma-4-31b-it:free": ["image", "text"],
	"gpt-4-turbo": ["image", "text"],
	"gpt-4.1": ["image", "text"],
	"gpt-4.1-mini": ["image", "text"],
	"gpt-4.1-nano": ["image", "text"],
	"gpt-4o": ["image", "text"],
	"gpt-4o-2024-05-13": ["image", "text"],
	"gpt-4o-2024-08-06": ["image", "text"],
	"gpt-4o-2024-11-20": ["image", "text"],
	"gpt-4o-mini": ["image", "text"],
	"gpt-5": ["image", "text"],
	"gpt-5-chat-latest": ["image", "text"],
	"gpt-5-codex": ["image", "text"],
	"gpt-5-mini": ["image", "text"],
	"gpt-5-nano": ["image", "text"],
	"gpt-5-pro": ["image", "text"],
	"gpt-5.1": ["image", "text"],
	"gpt-5.1-codex": ["image", "text"],
	"gpt-5.1-codex-max": ["image", "text"],
	"gpt-5.1-codex-mini": ["image", "text"],
	"gpt-5.2": ["image", "text"],
	"gpt-5.2-chat-latest": ["image", "text"],
	"gpt-5.2-codex": ["image", "text"],
	"gpt-5.2-pro": ["image", "text"],
	"gpt-5.3-chat-latest": ["image", "text"],
	"gpt-5.3-codex": ["image", "text"],
	"gpt-5.3-codex-spark": ["image", "text"],
	"gpt-5.4": ["image", "text"],
	"gpt-5.4-mini": ["image", "text"],
	"gpt-5.4-nano": ["image", "text"],
	"gpt-5.4-pro": ["image", "text"],
	"gpt-5.5": ["image", "text"],
	"gpt-5.5-pro": ["image", "text"],
	"gpt-5.6-luna": ["image", "text"],
	"gpt-5.6-sol": ["image", "text"],
	"gpt-5.6-terra": ["image", "text"],
	"gpt-6-astra": ["image", "text"],
	"gpt-6-luna": ["image", "text"],
	"gpt-6-sol": ["image", "text"],
	"gpt-6.1-sol": ["image", "text"],
	"gpt-daybreak-blue-latest": ["image", "text"],
	"gpt-daybreak-red-latest": ["image", "text"],
	"gpt-realtime-2.1": ["image", "text"],
	"grok-4.3": ["image", "text"],
	"grok-4.5": ["image", "text"],
	"grok-4.6": ["image", "text"],
	"grok-4.7": ["image", "text"],
	"grok-build-0.1": ["image", "text"],
	"in.anthropic.claude-haiku-4-5-20251001-v1:0": ["image", "text"],
	"in.anthropic.claude-opus-5": ["image", "text"],
	"in.anthropic.claude-sonnet-5": ["image", "text"],
	"in.openai.gpt-5.6-luna": ["image", "text"],
	"in.openai.gpt-5.6-terra": ["image", "text"],
	"inclusionai/ling-3.0-flash-vl": ["image", "text"],
	"interfaze/interfaze-beta": ["image", "text"],
	"jp.amazon.nova-2-lite-v1:0": ["image", "text"],
	"jp.anthropic.claude-haiku-4-5-20251001-v1:0": ["image", "text"],
	"jp.anthropic.claude-haiku-5-5": ["image", "text"],
	"jp.anthropic.claude-opus-4-7": ["image", "text"],
	"jp.anthropic.claude-opus-4-8": ["image", "text"],
	"jp.anthropic.claude-opus-5": ["image", "text"],
	"jp.anthropic.claude-opus-5-5": ["image", "text"],
	"jp.anthropic.claude-sonnet-4-5-20250929-v1:0": ["image", "text"],
	"jp.anthropic.claude-sonnet-4-6": ["image", "text"],
	"jp.anthropic.claude-sonnet-5": ["image", "text"],
	"k3": ["image", "text"],
	"k3-256k": ["image", "text"],
	"kimi-for-coding": ["image", "text"],
	"kimi-for-coding-highspeed": ["image", "text"],
	"kimi-k2.5": ["image", "text"],
	"kimi-k2.6": ["image", "text"],
	"kimi-k2.7-code": ["image", "text"],
	"kimi-k2.7-code-highspeed": ["image", "text"],
	"kimi-k3": ["image", "text"],
	"labs-devstral-small-2512": ["image", "text"],
	"labs-leanstral-1-5-1": ["image", "text"],
	"longcat-2.5-preview-free": ["image", "text"],
	"magistral-medium-latest": ["image", "text"],
	"mai-code-1.1-flash": ["image", "text"],
	"meituan/longcat-2.5-preview": ["image", "text"],
	"meta-llama/llama-4-maverick": ["image", "text"],
	"meta-llama/llama-4-scout": ["image", "text"],
	"meta.llama4-maverick-17b-instruct-v1:0": ["image", "text"],
	"meta.llama4-scout-17b-instruct-v1:0": ["image", "text"],
	"meta/llama-3.2-11b-vision-instruct": ["image", "text"],
	"meta/llama-3.2-90b-vision-instruct": ["image", "text"],
	"meta/llama-4-maverick": ["image", "text"],
	"meta/llama-4-scout": ["image", "text"],
	"meta/muse-glimmer-30b": ["image", "text"],
	"meta/muse-spark-1.1": ["image", "text"],
	"meta/muse-spark-1.2": ["image", "text"],
	"meta/muse-spark-1.2-contributor": ["image", "text"],
	"meta/muse-spark-1.3": ["image", "text"],
	"meta/muse-spark-1.3-contributor": ["image", "text"],
	"mimo-v2.5": ["image", "text"],
	"mimo-v2.6-flash": ["image", "text"],
	"mimo-v2.6-flash-free": ["image", "text"],
	"mimo-v2.6-pro": ["image", "text"],
	"mimo-v2.6-pro-ultraspeed": ["image", "text"],
	"minimax-m3": ["image", "text"],
	"minimax/minimax-m3": ["image", "text"],
	"ministral-14b-2512": ["image", "text"],
	"ministral-3b-2512": ["image", "text"],
	"ministral-3b-latest": ["image", "text"],
	"ministral-8b-2512": ["image", "text"],
	"ministral-8b-latest": ["image", "text"],
	"mistral-large-2512": ["image", "text"],
	"mistral-large-4": ["image", "text"],
	"mistral-large-latest": ["image", "text"],
	"mistral-medium-2505": ["image", "text"],
	"mistral-medium-2508": ["image", "text"],
	"mistral-medium-2604": ["image", "text"],
	"mistral-medium-3.5": ["image", "text"],
	"mistral-medium-latest": ["image", "text"],
	"mistral-small-2506": ["image", "text"],
	"mistral-small-2603": ["image", "text"],
	"mistral-small-latest": ["image", "text"],
	"mistral.magistral-small-2509": ["image", "text"],
	"mistral.ministral-3-14b-instruct": ["image", "text"],
	"mistral.ministral-3-3b-instruct": ["image", "text"],
	"mistral.ministral-3-8b-instruct": ["image", "text"],
	"mistral.mistral-large-3-675b-instruct": ["image", "text"],
	"mistral.pixtral-large-2502-v1:0": ["image", "text"],
	"mistral/ministral-14b": ["image", "text"],
	"mistral/ministral-3b": ["image", "text"],
	"mistral/ministral-8b": ["image", "text"],
	"mistral/mistral-large-3": ["image", "text"],
	"mistral/mistral-large-4": ["image", "text"],
	"mistral/mistral-medium-3.5": ["image", "text"],
	"mistral/mistral-small": ["image", "text"],
	"mistralai/ministral-14b-2512": ["image", "text"],
	"mistralai/ministral-3b-2512": ["image", "text"],
	"mistralai/ministral-8b-2512": ["image", "text"],
	"mistralai/ministral-8b-2512:batch": ["image", "text"],
	"mistralai/mistral-large-2512": ["image", "text"],
	"mistralai/mistral-large-2512:batch": ["image", "text"],
	"mistralai/mistral-large-4-0": ["image", "text"],
	"mistralai/mistral-medium-3": ["image", "text"],
	"mistralai/mistral-medium-3-5": ["image", "text"],
	"mistralai/mistral-medium-3-5:batch": ["image", "text"],
	"mistralai/mistral-medium-3.1": ["image", "text"],
	"mistralai/mistral-medium-3.1:batch": ["image", "text"],
	"mistralai/mistral-small-2603": ["image", "text"],
	"mistralai/mistral-small-2603:batch": ["image", "text"],
	"mistralai/mistral-small-3.1-24b-instruct": ["image", "text"],
	"mistralai/mistral-small-3.2-24b-instruct": ["image", "text"],
	"moonshotai.kimi-k2.5": ["image", "text"],
	"moonshotai/Kimi-K2.5": ["image", "text"],
	"moonshotai/Kimi-K2.6": ["image", "text"],
	"moonshotai/Kimi-K2.7-Code": ["image", "text"],
	"moonshotai/Kimi-K3": ["image", "text"],
	"moonshotai/kimi-k2.5": ["image", "text"],
	"moonshotai/kimi-k2.6": ["image", "text"],
	"moonshotai/kimi-k2.7-code": ["image", "text"],
	"moonshotai/kimi-k2.7-code-highspeed": ["image", "text"],
	"moonshotai/kimi-k3": ["image", "text"],
	"moonshotai/kimi-k3-fast": ["image", "text"],
	"moonshotai/kimi-k3:batch": ["image", "text"],
	"muse-spark-1.1": ["image", "text"],
	"muse-spark-1.2": ["image", "text"],
	"muse-spark-1.2-contributor": ["image", "text"],
	"muse-spark-1.3": ["image", "text"],
	"muse-spark-1.3-contributor": ["image", "text"],
	"muse-spark-1.3-contributor-free": ["image", "text"],
	"nex-agi/nex-n2.5-pro": ["image", "text"],
	"nvidia.nemotron-nano-12b-v2": ["image", "text"],
	"nvidia/cosmos-reason2-8b": ["image", "text"],
	"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": ["image", "text"],
	"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": ["image", "text"],
	"nvidia/nemotron-nano-12b-v2-vl": ["image", "text"],
	"o1": ["image", "text"],
	"o1-pro": ["image", "text"],
	"o3": ["image", "text"],
	"o3-pro": ["image", "text"],
	"o4-mini": ["image", "text"],
	"openai.gpt-5.4": ["image", "text"],
	"openai.gpt-5.5": ["image", "text"],
	"openai.gpt-5.6-luna": ["image", "text"],
	"openai.gpt-5.6-sol": ["image", "text"],
	"openai.gpt-5.6-terra": ["image", "text"],
	"openai.gpt-6-astra": ["image", "text"],
	"openai.gpt-6-luna": ["image", "text"],
	"openai.gpt-6-sol": ["image", "text"],
	"openai.gpt-6.1-sol": ["image", "text"],
	"openai/gpt-4-turbo": ["image", "text"],
	"openai/gpt-4-turbo:batch": ["image", "text"],
	"openai/gpt-4.1": ["image", "text"],
	"openai/gpt-4.1-fast": ["image", "text"],
	"openai/gpt-4.1-mini": ["image", "text"],
	"openai/gpt-4.1-mini-fast": ["image", "text"],
	"openai/gpt-4.1-mini:batch": ["image", "text"],
	"openai/gpt-4.1-nano": ["image", "text"],
	"openai/gpt-4.1-nano-fast": ["image", "text"],
	"openai/gpt-4.1-nano:batch": ["image", "text"],
	"openai/gpt-4.1:batch": ["image", "text"],
	"openai/gpt-4o": ["image", "text"],
	"openai/gpt-4o-2024-05-13": ["image", "text"],
	"openai/gpt-4o-2024-08-06": ["image", "text"],
	"openai/gpt-4o-2024-11-20": ["image", "text"],
	"openai/gpt-4o-fast": ["image", "text"],
	"openai/gpt-4o-mini": ["image", "text"],
	"openai/gpt-4o-mini-2024-07-18": ["image", "text"],
	"openai/gpt-4o-mini-fast": ["image", "text"],
	"openai/gpt-4o-mini:batch": ["image", "text"],
	"openai/gpt-4o:batch": ["image", "text"],
	"openai/gpt-5": ["image", "text"],
	"openai/gpt-5-codex": ["image", "text"],
	"openai/gpt-5-fast": ["image", "text"],
	"openai/gpt-5-mini": ["image", "text"],
	"openai/gpt-5-mini-fast": ["image", "text"],
	"openai/gpt-5-mini:batch": ["image", "text"],
	"openai/gpt-5-nano": ["image", "text"],
	"openai/gpt-5-nano:batch": ["image", "text"],
	"openai/gpt-5-pro": ["image", "text"],
	"openai/gpt-5-pro:batch": ["image", "text"],
	"openai/gpt-5.1": ["image", "text"],
	"openai/gpt-5.1-codex": ["image", "text"],
	"openai/gpt-5.1-codex-max": ["image", "text"],
	"openai/gpt-5.1-codex-mini": ["image", "text"],
	"openai/gpt-5.1-thinking": ["image", "text"],
	"openai/gpt-5.1-thinking-fast": ["image", "text"],
	"openai/gpt-5.1:batch": ["image", "text"],
	"openai/gpt-5.2": ["image", "text"],
	"openai/gpt-5.2-chat": ["image", "text"],
	"openai/gpt-5.2-codex": ["image", "text"],
	"openai/gpt-5.2-fast": ["image", "text"],
	"openai/gpt-5.2-pro": ["image", "text"],
	"openai/gpt-5.2-pro:batch": ["image", "text"],
	"openai/gpt-5.2:batch": ["image", "text"],
	"openai/gpt-5.3-codex": ["image", "text"],
	"openai/gpt-5.3-codex-fast": ["image", "text"],
	"openai/gpt-5.4": ["image", "text"],
	"openai/gpt-5.4-fast": ["image", "text"],
	"openai/gpt-5.4-mini": ["image", "text"],
	"openai/gpt-5.4-mini-fast": ["image", "text"],
	"openai/gpt-5.4-mini:batch": ["image", "text"],
	"openai/gpt-5.4-nano": ["image", "text"],
	"openai/gpt-5.4-nano:batch": ["image", "text"],
	"openai/gpt-5.4-pro": ["image", "text"],
	"openai/gpt-5.4-pro:batch": ["image", "text"],
	"openai/gpt-5.4:batch": ["image", "text"],
	"openai/gpt-5.5": ["image", "text"],
	"openai/gpt-5.5-fast": ["image", "text"],
	"openai/gpt-5.5-pro": ["image", "text"],
	"openai/gpt-5.5-pro:batch": ["image", "text"],
	"openai/gpt-5.5:batch": ["image", "text"],
	"openai/gpt-5.6-luna": ["image", "text"],
	"openai/gpt-5.6-luna-fast": ["image", "text"],
	"openai/gpt-5.6-luna-pro": ["image", "text"],
	"openai/gpt-5.6-luna-pro:batch": ["image", "text"],
	"openai/gpt-5.6-luna:batch": ["image", "text"],
	"openai/gpt-5.6-sol": ["image", "text"],
	"openai/gpt-5.6-sol-fast": ["image", "text"],
	"openai/gpt-5.6-sol-pro": ["image", "text"],
	"openai/gpt-5.6-sol-pro:batch": ["image", "text"],
	"openai/gpt-5.6-sol:batch": ["image", "text"],
	"openai/gpt-5.6-terra": ["image", "text"],
	"openai/gpt-5.6-terra-fast": ["image", "text"],
	"openai/gpt-5.6-terra-pro": ["image", "text"],
	"openai/gpt-5.6-terra-pro:batch": ["image", "text"],
	"openai/gpt-5.6-terra:batch": ["image", "text"],
	"openai/gpt-5:batch": ["image", "text"],
	"openai/gpt-6-astra": ["image", "text"],
	"openai/gpt-6-astra-fast": ["image", "text"],
	"openai/gpt-6-astra-pro": ["image", "text"],
	"openai/gpt-6-astra-pro:batch": ["image", "text"],
	"openai/gpt-6-astra:batch": ["image", "text"],
	"openai/gpt-6-luna": ["image", "text"],
	"openai/gpt-6-luna-fast": ["image", "text"],
	"openai/gpt-6-luna-pro": ["image", "text"],
	"openai/gpt-6-luna-pro:batch": ["image", "text"],
	"openai/gpt-6-luna:batch": ["image", "text"],
	"openai/gpt-6-sol": ["image", "text"],
	"openai/gpt-6-sol-fast": ["image", "text"],
	"openai/gpt-6-sol-pro": ["image", "text"],
	"openai/gpt-6-sol-pro:batch": ["image", "text"],
	"openai/gpt-6-sol:batch": ["image", "text"],
	"openai/gpt-6.1-sol": ["image", "text"],
	"openai/gpt-6.1-sol-fast": ["image", "text"],
	"openai/gpt-6.1-sol-pro": ["image", "text"],
	"openai/gpt-chat-latest": ["image", "text"],
	"openai/o1": ["image", "text"],
	"openai/o3": ["image", "text"],
	"openai/o3-fast": ["image", "text"],
	"openai/o3-pro": ["image", "text"],
	"openai/o3:batch": ["image", "text"],
	"openai/o4-mini": ["image", "text"],
	"openai/o4-mini-fast": ["image", "text"],
	"openai/o4-mini-high": ["image", "text"],
	"openai/o4-mini:batch": ["image", "text"],
	"openrouter/auto": ["image", "text"],
	"openrouter/auto-beta": ["image", "text"],
	"openrouter/free": ["image", "text"],
	"perceptron/perceptron-mk1.5": ["image", "text"],
	"pixtral-12b": ["image", "text"],
	"pixtral-large-latest": ["image", "text"],
	"precise": ["image", "text"],
	"prism-ml/ternary-bonsai-2-27b": ["image", "text"],
	"quiverai/arrow-2": ["image", "text"],
	"quiverai/arrow-2-telos": ["image", "text"],
	"qwen-3.8-27b": ["image", "text"],
	"qwen.qwen3-vl-235b-a22b": ["image", "text"],
	"qwen/qwen3-vl-235b-a22b-instruct": ["image", "text"],
	"qwen/qwen3-vl-235b-a22b-thinking": ["image", "text"],
	"qwen/qwen3-vl-30b-a3b-instruct": ["image", "text"],
	"qwen/qwen3-vl-30b-a3b-thinking": ["image", "text"],
	"qwen/qwen3-vl-32b-instruct": ["image", "text"],
	"qwen/qwen3-vl-8b-instruct": ["image", "text"],
	"qwen/qwen3-vl-8b-thinking": ["image", "text"],
	"qwen/qwen3.5-122b-a10b": ["image", "text"],
	"qwen/qwen3.5-27b": ["image", "text"],
	"qwen/qwen3.5-35b-a3b": ["image", "text"],
	"qwen/qwen3.5-397b-a17b": ["image", "text"],
	"qwen/qwen3.5-9b": ["image", "text"],
	"qwen/qwen3.5-flash-02-23": ["image", "text"],
	"qwen/qwen3.5-plus-02-15": ["image", "text"],
	"qwen/qwen3.5-plus-20260420": ["image", "text"],
	"qwen/qwen3.6-27b": ["image", "text"],
	"qwen/qwen3.6-35b-a3b": ["image", "text"],
	"qwen/qwen3.6-flash": ["image", "text"],
	"qwen/qwen3.6-plus": ["image", "text"],
	"qwen/qwen3.7-flash": ["image", "text"],
	"qwen/qwen3.7-plus": ["image", "text"],
	"qwen/qwen3.8-27b": ["image", "text"],
	"qwen/qwen3.8-flash": ["image", "text"],
	"qwen/qwen3.8-max-0902": ["image", "text"],
	"qwen/qwen3.8-max-prime": ["image", "text"],
	"qwen/qwen3.8-omni-flash": ["image", "text"],
	"qwen3.5-plus": ["image", "text"],
	"qwen3.6-flash": ["image", "text"],
	"qwen3.6-plus": ["image", "text"],
	"qwen3.7-plus": ["image", "text"],
	"qwen3.8-flash": ["image", "text"],
	"qwen3.8-max": ["image", "text"],
	"rekaai/reka-edge": ["image", "text"],
	"sakana/fugu-max": ["image", "text"],
	"sakana/fugu-ultra": ["image", "text"],
	"sakana/fugu-ultra-v2": ["image", "text"],
	"sakana/namazu": ["image", "text"],
	"sakana/sakana-namazu": ["image", "text"],
	"space-bunny": ["image", "text"],
	"space-bunny-free": ["image", "text"],
	"spacexai/grok-4.1-fast-non-reasoning": ["image", "text"],
	"spacexai/grok-4.1-fast-reasoning": ["image", "text"],
	"spacexai/grok-4.20-multi-agent": ["image", "text"],
	"spacexai/grok-4.20-multi-agent-beta": ["image", "text"],
	"spacexai/grok-4.20-non-reasoning": ["image", "text"],
	"spacexai/grok-4.20-non-reasoning-beta": ["image", "text"],
	"spacexai/grok-4.20-reasoning": ["image", "text"],
	"spacexai/grok-4.20-reasoning-beta": ["image", "text"],
	"spacexai/grok-4.3": ["image", "text"],
	"spacexai/grok-4.5": ["image", "text"],
	"spacexai/grok-4.6": ["image", "text"],
	"spacexai/grok-4.7": ["image", "text"],
	"spacexai/grok-build-0.1": ["image", "text"],
	"stepfun-ai/Step-3.7-Flash": ["image", "text"],
	"stepfun/step-3.7-flash": ["image", "text"],
	"thinkingmachines/Inkling": ["image", "text"],
	"thinkingmachines/Inkling-Small": ["image", "text"],
	"thinkingmachines/inkling": ["image", "text"],
	"thinkingmachines/inkling-small": ["image", "text"],
	"thinkingmachines/inkling-small:free": ["image", "text"],
	"thinkingmachines/inkling:free": ["image", "text"],
	"typesafe/jev-router": ["image", "text"],
	"unbiased/pareto": ["image", "text"],
	"unbiased/pareto-26.10-preview": ["image", "text"],
	"us.amazon.nova-2-lite-v1:0": ["image", "text"],
	"us.amazon.nova-lite-v1:0": ["image", "text"],
	"us.amazon.nova-premier-v1:0": ["image", "text"],
	"us.amazon.nova-pro-v1:0": ["image", "text"],
	"us.anthropic.claude-fable-5": ["image", "text"],
	"us.anthropic.claude-fable-5-1": ["image", "text"],
	"us.anthropic.claude-haiku-4-5-20251001-v1:0": ["image", "text"],
	"us.anthropic.claude-haiku-5-5": ["image", "text"],
	"us.anthropic.claude-opus-4-1-20250805-v1:0": ["image", "text"],
	"us.anthropic.claude-opus-4-5-20251101-v1:0": ["image", "text"],
	"us.anthropic.claude-opus-4-6-v1": ["image", "text"],
	"us.anthropic.claude-opus-4-7": ["image", "text"],
	"us.anthropic.claude-opus-4-8": ["image", "text"],
	"us.anthropic.claude-opus-5": ["image", "text"],
	"us.anthropic.claude-opus-5-5": ["image", "text"],
	"us.anthropic.claude-sonnet-4-20250514-v1:0": ["image", "text"],
	"us.anthropic.claude-sonnet-4-5-20250929-v1:0": ["image", "text"],
	"us.anthropic.claude-sonnet-4-6": ["image", "text"],
	"us.anthropic.claude-sonnet-5": ["image", "text"],
	"us.anthropic.claude-sonnet-5-5": ["image", "text"],
	"us.meta.llama4-maverick-17b-instruct-v1:0": ["image", "text"],
	"us.meta.llama4-scout-17b-instruct-v1:0": ["image", "text"],
	"us.mistral.pixtral-large-2502-v1:0": ["image", "text"],
	"us.moonshotai.kimi-k3": ["image", "text"],
	"us.openai.gpt-5.6-luna": ["image", "text"],
	"us.openai.gpt-5.6-sol": ["image", "text"],
	"us.openai.gpt-5.6-terra": ["image", "text"],
	"us.openai.gpt-6-astra": ["image", "text"],
	"us.openai.gpt-6-luna": ["image", "text"],
	"us.openai.gpt-6-sol": ["image", "text"],
	"us.openai.gpt-6.1-sol": ["image", "text"],
	"us.xai.grok-4.6": ["image", "text"],
	"us.xai.grok-4.7": ["image", "text"],
	"workers-ai/@cf/google/gemma-4-26b-a4b-it": ["image", "text"],
	"workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct": ["image", "text"],
	"workers-ai/@cf/moonshotai/kimi-k2.6": ["image", "text"],
	"workers-ai/@cf/moonshotai/kimi-k2.7-code": ["image", "text"],
	"workers-ai/@cf/qwen/qwen3.8-27b": ["image", "text"],
	"workers-ai/@cf/zai-org/glm-5.3-flash": ["image", "text"],
	"x-ai/grok-4.20": ["image", "text"],
	"x-ai/grok-4.3": ["image", "text"],
	"x-ai/grok-4.3:batch": ["image", "text"],
	"x-ai/grok-4.5": ["image", "text"],
	"x-ai/grok-4.6": ["image", "text"],
	"x-ai/grok-4.7": ["image", "text"],
	"x-ai/grok-build-0.1": ["image", "text"],
	"xai.grok-4.3": ["image", "text"],
	"xai.grok-4.6": ["image", "text"],
	"xiaomi/mimo-v2.5": ["image", "text"],
	"xiaomi/mimo-v2.6-flash": ["image", "text"],
	"xiaomi/mimo-v2.6-pro": ["image", "text"],
	"xiaomi/mimo-v2.6-pro-ultraspeed": ["image", "text"],
	"z-ai/glm-4.5v": ["image", "text"],
	"z-ai/glm-4.6v": ["image", "text"],
	"z-ai/glm-5.3-flash": ["image", "text"],
	"z-ai/glm-5.3-flash:batch": ["image", "text"],
	"z-ai/glm-5.3-flashx": ["image", "text"],
	"z-ai/glm-5v-turbo": ["image", "text"],
	"zai-org/GLM-4.5V": ["image", "text"],
	"zai-org/GLM-4.6V-Flash": ["image", "text"],
	"zai-org/GLM-5.3-Fast": ["image", "text"],
	"zai-org/GLM-5.3-Flash": ["image", "text"],
	"zai/glm-4.5v": ["image", "text"],
	"zai/glm-5.3-flash": ["image", "text"],
	"zai/glm-5.3-flashx": ["image", "text"],
	"zai/glm-5v-turbo": ["image", "text"],
	"~anthropic/claude-fable-latest": ["image", "text"],
	"~anthropic/claude-haiku-latest": ["image", "text"],
	"~anthropic/claude-opus-latest": ["image", "text"],
	"~anthropic/claude-sonnet-latest": ["image", "text"],
	"~deepseek/deepseek-flash-latest": ["image", "text"],
	"~google/gemini-flash-latest": ["image", "text"],
	"~google/gemini-pro-latest": ["image", "text"],
	"~moonshotai/kimi-latest": ["image", "text"],
	"~openai/gpt-astra-latest": ["image", "text"],
	"~openai/gpt-luna-latest": ["image", "text"],
	"~openai/gpt-mini-latest": ["image", "text"],
	"~openai/gpt-sol-latest": ["image", "text"],
	"~openai/gpt-terra-latest": ["image", "text"],
	"~x-ai/grok-latest": ["image", "text"],
	"~z-ai/glm-flash-latest": ["image", "text"]
};
/** Every chat model the catalog describes, one per line. */
const CHAT_MODELS = new Set(`
@cf/deepseek-ai/deepseek-v4-flash-0731
@cf/deepseek-ai/deepseek-v4-pro-0813
@cf/google/gemma-4-26b-a4b-it
@cf/ibm-granite/granite-4.0-h-micro
@cf/meta/llama-3.3-70b-instruct-fp8-fast
@cf/meta/llama-4-scout-17b-16e-instruct
@cf/mistralai/mistral-small-3.1-24b-instruct
@cf/moonshotai/kimi-k2.6
@cf/moonshotai/kimi-k2.7-code
@cf/nvidia/nemotron-3-120b-a12b
@cf/openai/gpt-oss-120b
@cf/openai/gpt-oss-20b
@cf/qwen/qwen3-30b-a3b-fp8
@cf/qwen/qwen3.8-27b
@cf/zai-org/glm-4.7-flash
@cf/zai-org/glm-5.2
@cf/zai-org/glm-5.3
@cf/zai-org/glm-5.3-flash
Ling-2.6-1T
Ling-2.6-flash
MiniMax-M2.5
MiniMax-M2.7
MiniMax-M2.7-highspeed
MiniMax-M3
MiniMaxAI/MiniMax-M2
MiniMaxAI/MiniMax-M2.1
MiniMaxAI/MiniMax-M2.5
MiniMaxAI/MiniMax-M2.7
MiniMaxAI/MiniMax-M3
Qwen/Qwen2.5-7B-Instruct-Turbo
Qwen/Qwen2.5-Coder-32B-Instruct
Qwen/Qwen3-235B-A22B
Qwen/Qwen3-235B-A22B-Instruct-2507
Qwen/Qwen3-235B-A22B-Thinking-2507
Qwen/Qwen3-30B-A3B
Qwen/Qwen3-32B
Qwen/Qwen3-Coder-30B-A3B-Instruct
Qwen/Qwen3-Coder-480B-A35B-Instruct
Qwen/Qwen3-Coder-Next
Qwen/Qwen3-Next-80B-A3B-Instruct
Qwen/Qwen3-Next-80B-A3B-Thinking
Qwen/Qwen3-VL-235B-A22B-Instruct
Qwen/Qwen3-VL-235B-A22B-Thinking
Qwen/Qwen3.5-122B-A10B
Qwen/Qwen3.5-27B
Qwen/Qwen3.5-35B-A3B
Qwen/Qwen3.5-397B-A17B
Qwen/Qwen3.5-9B
Qwen/Qwen3.6-27B
Qwen/Qwen3.6-35B-A3B
Qwen/Qwen3.6-Plus
Qwen/Qwen3.7-Max
Qwen/Qwen3.8-2.4T-A95B
Qwen/Qwen3.8-27B
Ring-2.6-1T
XiaomiMiMo/MiMo-V2-Flash
XiaomiMiMo/MiMo-V2.5
XiaomiMiMo/MiMo-V2.5-Pro
accounts/fireworks/models/deepseek-v4p1-flash
accounts/fireworks/models/ember-1
accounts/fireworks/models/glm-5p3
accounts/fireworks/models/glm-5p3-flash
accounts/fireworks/models/gpt-oss-120b
accounts/fireworks/models/inkling
accounts/fireworks/models/kimi-k3
accounts/fireworks/models/minimax-m3
accounts/fireworks/models/nemotron-3-ultra-nvfp4
accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b
accounts/fireworks/models/qwen3p8-2p4t-a95b
accounts/fireworks/models/qwen3p8-max
accounts/fireworks/routers/deepseek-flash-latest
accounts/fireworks/routers/glm-5p3-fast
accounts/fireworks/routers/glm-fast-latest
accounts/fireworks/routers/glm-flash-latest
accounts/fireworks/routers/glm-latest
accounts/fireworks/routers/kimi-fast-latest
accounts/fireworks/routers/kimi-k3-fast
accounts/fireworks/routers/kimi-latest
accounts/fireworks/routers/minimax-latest
accounts/fireworks/routers/qwen-max-latest
aion-labs/aion-2.0
aion-labs/aion-3.0
aion-labs/aion-3.0-mini
aion-labs/aion-3.5
aion-labs/aion-3.5-mini
alibaba/qwen-3-14b
alibaba/qwen-3-235b
alibaba/qwen-3-30b
alibaba/qwen-3-32b
alibaba/qwen-3.6-max-preview
alibaba/qwen3-235b-a22b-thinking
alibaba/qwen3-coder
alibaba/qwen3-coder-30b-a3b
alibaba/qwen3-coder-next
alibaba/qwen3-coder-plus
alibaba/qwen3-max
alibaba/qwen3-max-preview
alibaba/qwen3-max-thinking
alibaba/qwen3-next-80b-a3b-instruct
alibaba/qwen3-next-80b-a3b-thinking
alibaba/qwen3-vl-235b-a22b-instruct
alibaba/qwen3-vl-instruct
alibaba/qwen3-vl-thinking
alibaba/qwen3.5-flash
alibaba/qwen3.5-plus
alibaba/qwen3.6-27b
alibaba/qwen3.6-plus
alibaba/qwen3.7-flash
alibaba/qwen3.7-max
alibaba/qwen3.7-plus
alibaba/qwen3.8-2.4t-a95b
alibaba/qwen3.8-27b
alibaba/qwen3.8-flash
alibaba/qwen3.8-max
alibaba/qwen3.8-max-0902
alibaba/qwen3.8-max-prime
alibaba/qwen3.8-omni-flash
amazon.nova-2-lite-v1:0
amazon.nova-lite-v1:0
amazon.nova-micro-v1:0
amazon.nova-pro-v1:0
amazon/nova-2-lite
amazon/nova-2-lite-v1
amazon/nova-lite
amazon/nova-lite-v1
amazon/nova-micro
amazon/nova-micro-v1
amazon/nova-premier-v1
amazon/nova-pro
amazon/nova-pro-v1
anthropic.claude-fable-5
anthropic.claude-fable-5-1
anthropic.claude-haiku-4-5-20251001-v1:0
anthropic.claude-haiku-5-5
anthropic.claude-opus-4-1-20250805-v1:0
anthropic.claude-opus-4-5-20251101-v1:0
anthropic.claude-opus-4-6-v1
anthropic.claude-opus-4-7
anthropic.claude-opus-4-8
anthropic.claude-opus-5-5
anthropic.claude-sonnet-4-5-20250929-v1:0
anthropic.claude-sonnet-4-6
anthropic.claude-sonnet-5
anthropic.claude-sonnet-5-5
anthropic/claude-3-haiku
anthropic/claude-fable-5
anthropic/claude-fable-5.1
anthropic/claude-fable-5.1:batch
anthropic/claude-fable-5:batch
anthropic/claude-haiku-4.5
anthropic/claude-haiku-4.5:batch
anthropic/claude-haiku-5.5
anthropic/claude-haiku-5.5:batch
anthropic/claude-opus-4
anthropic/claude-opus-4.1
anthropic/claude-opus-4.1:batch
anthropic/claude-opus-4.5
anthropic/claude-opus-4.5:batch
anthropic/claude-opus-4.6
anthropic/claude-opus-4.6:batch
anthropic/claude-opus-4.7
anthropic/claude-opus-4.7:batch
anthropic/claude-opus-4.8
anthropic/claude-opus-4.8-fast
anthropic/claude-opus-4.8:batch
anthropic/claude-opus-5
anthropic/claude-opus-5-fast
anthropic/claude-opus-5.5
anthropic/claude-opus-5.5-fast
anthropic/claude-opus-5.5:batch
anthropic/claude-opus-5:batch
anthropic/claude-sonnet-4
anthropic/claude-sonnet-4.5
anthropic/claude-sonnet-4.5:batch
anthropic/claude-sonnet-4.6
anthropic/claude-sonnet-4.6:batch
anthropic/claude-sonnet-5
anthropic/claude-sonnet-5.5
anthropic/claude-sonnet-5.5:batch
anthropic/claude-sonnet-5:batch
apac.amazon.nova-lite-v1:0
apac.amazon.nova-micro-v1:0
apac.amazon.nova-pro-v1:0
apac.anthropic.claude-sonnet-4-20250514-v1:0
apodex/apodex-1.1-mini:free
arcee-ai/trinity-large-thinking
au.anthropic.claude-haiku-4-5-20251001-v1:0
au.anthropic.claude-haiku-5-5
au.anthropic.claude-opus-4-6-v1
au.anthropic.claude-opus-4-7
au.anthropic.claude-opus-4-8
au.anthropic.claude-opus-5
au.anthropic.claude-opus-5-5
au.anthropic.claude-sonnet-4-5-20250929-v1:0
au.anthropic.claude-sonnet-4-6
au.anthropic.claude-sonnet-5
auto
balanced
big-pickle
bytedance-seed/seed-1.6
bytedance-seed/seed-1.6-flash
bytedance-seed/seed-2-1-turbo
bytedance-seed/seed-2.0-code
bytedance-seed/seed-2.0-lite
bytedance-seed/seed-2.0-mini
bytedance/seed-1.6
bytedance/seed-1.8
bytedance/seed-2.1-turbo
ca.amazon.nova-lite-v1:0
cheap
claude-fable-5
claude-fable-5-1
claude-fable-5.1
claude-haiku-4-5
claude-haiku-4-5-20251001
claude-haiku-4.5
claude-haiku-5-5
claude-opus-4-5
claude-opus-4-5-20251101
claude-opus-4-6
claude-opus-4-7
claude-opus-4-8
claude-opus-4.7
claude-opus-4.8
claude-opus-5
claude-opus-5-5
claude-opus-5.5
claude-sonnet-4
claude-sonnet-4-5
claude-sonnet-4-5-20250929
claude-sonnet-4-6
claude-sonnet-4.6
claude-sonnet-5
claude-sonnet-5-5
claude-sonnet-5.5
codestral-2508
codestral-latest
cohere/command-a
cohere/command-a-plus
cohere/command-r-08-2024
cohere/command-r-plus-08-2024
cohere/north-mini-code:free
deep-research-max-preview-04-2026
deep-research-preview-04-2026
deepseek-ai/DeepSeek-R1
deepseek-ai/DeepSeek-R1-0528
deepseek-ai/DeepSeek-V3
deepseek-ai/DeepSeek-V3-0324
deepseek-ai/DeepSeek-V3.1
deepseek-ai/DeepSeek-V3.2
deepseek-ai/DeepSeek-V4-Flash
deepseek-ai/DeepSeek-V4-Flash-0731
deepseek-ai/DeepSeek-V4-Flash-Vision-Exp
deepseek-ai/DeepSeek-V4-Pro
deepseek-ai/DeepSeek-V4-Pro-0813
deepseek-ai/DeepSeek-V4.1-Flash
deepseek-ai/DeepSeek-V4.1-Flash-Fast
deepseek-ai/deepseek-v4.1-flash
deepseek-flash
deepseek-v3.2
deepseek-v4-flash
deepseek-v4-flash-0731
deepseek-v4-flash-vision-exp
deepseek-v4-pro
deepseek-v4-pro-0813
deepseek-v4.1-flash
deepseek.v3-v1:0
deepseek.v3.2
deepseek/deepseek-chat
deepseek/deepseek-chat-v3-0324
deepseek/deepseek-chat-v3.1
deepseek/deepseek-r1
deepseek/deepseek-r1-0528
deepseek/deepseek-v3.1
deepseek/deepseek-v3.1-terminus
deepseek/deepseek-v3.2
deepseek/deepseek-v3.2-exp
deepseek/deepseek-v3.2-thinking
deepseek/deepseek-v4-flash
deepseek/deepseek-v4-flash-0731
deepseek/deepseek-v4-flash-vision-exp
deepseek/deepseek-v4-pro
deepseek/deepseek-v4-pro-0813
deepseek/deepseek-v4.1-flash
deepseek/deepseek-v4.1-flash-fast
deepseek/deepseek-v4.1-flash:batch
devstral-2512
devstral-latest
devstral-medium-2507
devstral-medium-latest
devstral-small-2505
devstral-small-2507
dots-studio/dots-3-note-preview:free
eu.amazon.nova-2-lite-v1:0
eu.amazon.nova-lite-v1:0
eu.amazon.nova-micro-v1:0
eu.amazon.nova-pro-v1:0
eu.anthropic.claude-fable-5
eu.anthropic.claude-haiku-4-5-20251001-v1:0
eu.anthropic.claude-haiku-5-5
eu.anthropic.claude-opus-4-5-20251101-v1:0
eu.anthropic.claude-opus-4-6-v1
eu.anthropic.claude-opus-4-7
eu.anthropic.claude-opus-4-8
eu.anthropic.claude-opus-5
eu.anthropic.claude-opus-5-5
eu.anthropic.claude-sonnet-4-20250514-v1:0
eu.anthropic.claude-sonnet-4-5-20250929-v1:0
eu.anthropic.claude-sonnet-4-6
eu.anthropic.claude-sonnet-5
eu.anthropic.claude-sonnet-5-5
eu.mistral.pixtral-large-2502-v1:0
exo-free
fireworks/ember-1
fledge-alpha-free
gemini-2.5-computer-use-preview-10-2025
gemini-2.5-flash
gemini-2.5-flash-lite
gemini-2.5-pro
gemini-3-flash
gemini-3-flash-preview
gemini-3.1-flash-lite
gemini-3.1-flash-lite-image
gemini-3.1-flash-lite-preview
gemini-3.1-flash-live-preview
gemini-3.1-pro
gemini-3.1-pro-preview
gemini-3.1-pro-preview-customtools
gemini-3.5-flash
gemini-3.5-flash-lite
gemini-3.6-flash
gemini-3.7-flash
gemini-3.8-flash
gemini-flash-latest
gemini-flash-lite-latest
gemma-4-26b-a4b-it
gemma-4-31b-it
glm-4.6v
glm-4.7
glm-5
glm-5-2
glm-5-turbo
glm-5.1
glm-5.2
glm-5.2-highspeed
glm-5.3
glm-5.3-flash
glm-5.3-highspeed
global.amazon.nova-2-lite-v1:0
global.anthropic.claude-fable-5
global.anthropic.claude-fable-5-1
global.anthropic.claude-haiku-4-5-20251001-v1:0
global.anthropic.claude-haiku-5-5
global.anthropic.claude-opus-4-5-20251101-v1:0
global.anthropic.claude-opus-4-6-v1
global.anthropic.claude-opus-4-7
global.anthropic.claude-opus-4-8
global.anthropic.claude-opus-5
global.anthropic.claude-opus-5-5
global.anthropic.claude-sonnet-4-20250514-v1:0
global.anthropic.claude-sonnet-4-5-20250929-v1:0
global.anthropic.claude-sonnet-4-6
global.anthropic.claude-sonnet-5
global.anthropic.claude-sonnet-5-5
global.moonshotai.kimi-k3
global.openai.gpt-5.6-luna
global.openai.gpt-5.6-sol
global.openai.gpt-5.6-terra
global.openai.gpt-6-astra
global.openai.gpt-6-luna
global.openai.gpt-6-sol
global.openai.gpt-6.1-sol
global.xai.grok-4.6
global.xai.grok-4.7
global.zai.glm-5.3
google.gemma-4-26b-a4b
google.gemma-4-31b
google.gemma-4-e2b
google/diffusiongemma-26b-a4b-it
google/gemini-2.5-flash
google/gemini-2.5-flash-lite
google/gemini-2.5-flash-lite:batch
google/gemini-2.5-flash:batch
google/gemini-2.5-pro
google/gemini-2.5-pro-preview
google/gemini-2.5-pro:batch
google/gemini-3-flash
google/gemini-3-flash-preview
google/gemini-3-flash-preview:batch
google/gemini-3-pro-image
google/gemini-3.1-flash-lite
google/gemini-3.1-flash-lite-preview
google/gemini-3.1-flash-lite:batch
google/gemini-3.1-pro-preview
google/gemini-3.1-pro-preview-customtools
google/gemini-3.1-pro-preview:batch
google/gemini-3.5-flash
google/gemini-3.5-flash-lite
google/gemini-3.5-flash-lite:batch
google/gemini-3.5-flash:batch
google/gemini-3.6-flash
google/gemini-3.6-flash:batch
google/gemini-3.7-flash
google/gemini-3.7-flash:batch
google/gemini-3.8-flash
google/gemini-3.8-flash:batch
google/gemini-nano-banana-2.1
google/gemma-3-12b-it
google/gemma-3-27b-it
google/gemma-3-4b-it
google/gemma-4-26B-A4B-it
google/gemma-4-26b-a4b-it
google/gemma-4-26b-a4b-it:free
google/gemma-4-31B-it
google/gemma-4-31b-it
google/gemma-4-31b-it:free
gpt-4
gpt-4-turbo
gpt-4.1
gpt-4.1-mini
gpt-4.1-nano
gpt-4o
gpt-4o-2024-05-13
gpt-4o-2024-08-06
gpt-4o-2024-11-20
gpt-4o-mini
gpt-5
gpt-5-chat-latest
gpt-5-codex
gpt-5-mini
gpt-5-nano
gpt-5-pro
gpt-5.1
gpt-5.1-codex
gpt-5.1-codex-max
gpt-5.1-codex-mini
gpt-5.2
gpt-5.2-chat-latest
gpt-5.2-codex
gpt-5.2-pro
gpt-5.3-chat-latest
gpt-5.3-codex
gpt-5.3-codex-spark
gpt-5.4
gpt-5.4-mini
gpt-5.4-nano
gpt-5.4-pro
gpt-5.5
gpt-5.5-pro
gpt-5.6-luna
gpt-5.6-sol
gpt-5.6-terra
gpt-6-astra
gpt-6-luna
gpt-6-sol
gpt-6.1-sol
gpt-daybreak-blue-latest
gpt-daybreak-red-latest
gpt-oss-120b
gpt-realtime-2.1
grok-4.3
grok-4.5
grok-4.6
grok-4.7
grok-build-0.1
hy3
hy4-preview
ibm-granite/granite-4.2-8b
in.anthropic.claude-haiku-4-5-20251001-v1:0
in.anthropic.claude-opus-5
in.anthropic.claude-sonnet-5
in.openai.gpt-5.6-luna
in.openai.gpt-5.6-terra
inception/mercury-2
inception/mercury-2.5
inception/mercury-coder-small
inclusionai/ling-3.0-flash
inclusionai/ling-3.0-flash-fin
inclusionai/ling-3.0-flash-sante
inclusionai/ling-3.0-flash-sante:free
inclusionai/ling-3.0-flash-vl
inclusionai/ling-3.1-flash
inclusionai/ling-3.1-flash-free
interfaze/interfaze-beta
jp.amazon.nova-2-lite-v1:0
jp.anthropic.claude-haiku-4-5-20251001-v1:0
jp.anthropic.claude-haiku-5-5
jp.anthropic.claude-opus-4-7
jp.anthropic.claude-opus-4-8
jp.anthropic.claude-opus-5
jp.anthropic.claude-opus-5-5
jp.anthropic.claude-sonnet-4-5-20250929-v1:0
jp.anthropic.claude-sonnet-4-6
jp.anthropic.claude-sonnet-5
k3
k3-256k
kimi-for-coding
kimi-for-coding-highspeed
kimi-k2.5
kimi-k2.6
kimi-k2.7-code
kimi-k2.7-code-highspeed
kimi-k3
labs-devstral-small-2512
labs-leanstral-1-5-1
ling-3.0-flash-fin-free
ling-3.1-flash-free
liquid/lfm-2.5-2.6b:free
llama-3.1-8b-instant
llama-3.3-70b-versatile
longcat-2.0
longcat-2.5-preview-free
magistral-medium-latest
mai-code-1-flash-picker
mai-code-1.1-flash
meituan/longcat-2.0
meituan/longcat-2.5-preview
meta-llama/Llama-3.1-8B-Instruct
meta-llama/Llama-3.3-70B-Instruct
meta-llama/Llama-3.3-70B-Instruct-Turbo
meta-llama/llama-3.1-70b-instruct
meta-llama/llama-3.1-8b-instruct
meta-llama/llama-3.3-70b-instruct
meta-llama/llama-4-maverick
meta-llama/llama-4-scout
meta.llama3-1-70b-instruct-v1:0
meta.llama3-1-8b-instruct-v1:0
meta.llama3-3-70b-instruct-v1:0
meta.llama4-maverick-17b-instruct-v1:0
meta.llama4-scout-17b-instruct-v1:0
meta/llama-3.1-70b
meta/llama-3.1-8b
meta/llama-3.2-11b-vision-instruct
meta/llama-3.2-90b-vision-instruct
meta/llama-3.3-70b
meta/llama-4-maverick
meta/llama-4-scout
meta/muse-glimmer-30b
meta/muse-spark-1.1
meta/muse-spark-1.2
meta/muse-spark-1.2-contributor
meta/muse-spark-1.3
meta/muse-spark-1.3-contributor
mimo-v2.5
mimo-v2.5-pro
mimo-v2.5-pro-ultraspeed
mimo-v2.6-flash
mimo-v2.6-flash-free
mimo-v2.6-pro
mimo-v2.6-pro-ultraspeed
minimax-m2.5
minimax-m2.7
minimax-m3
minimax.minimax-m2
minimax.minimax-m2.1
minimax.minimax-m2.5
minimax/minimax-m1
minimax/minimax-m2
minimax/minimax-m2.1
minimax/minimax-m2.1-lightning
minimax/minimax-m2.5
minimax/minimax-m2.5-highspeed
minimax/minimax-m2.7
minimax/minimax-m2.7-highspeed
minimax/minimax-m3
ministral-14b-2512
ministral-3b-2512
ministral-3b-latest
ministral-8b-2512
ministral-8b-latest
mistral-large-2411
mistral-large-2512
mistral-large-4
mistral-large-latest
mistral-medium-2505
mistral-medium-2508
mistral-medium-2604
mistral-medium-3.5
mistral-medium-latest
mistral-nemo
mistral-small-2506
mistral-small-2603
mistral-small-latest
mistral.devstral-2-123b
mistral.magistral-small-2509
mistral.ministral-3-14b-instruct
mistral.ministral-3-3b-instruct
mistral.ministral-3-8b-instruct
mistral.mistral-large-3-675b-instruct
mistral.pixtral-large-2502-v1:0
mistral.voxtral-mini-3b-2507
mistral.voxtral-small-24b-2507
mistral/codestral
mistral/ministral-14b
mistral/ministral-3b
mistral/ministral-8b
mistral/mistral-large-3
mistral/mistral-large-4
mistral/mistral-medium-3.5
mistral/mistral-nemo
mistral/mistral-small
mistralai/codestral-2508
mistralai/codestral-2508:batch
mistralai/devstral-2512
mistralai/ministral-14b-2512
mistralai/ministral-3b-2512
mistralai/ministral-8b-2512
mistralai/ministral-8b-2512:batch
mistralai/mistral-7b-instruct-v0.3
mistralai/mistral-large
mistralai/mistral-large-2407
mistralai/mistral-large-2512
mistralai/mistral-large-2512:batch
mistralai/mistral-large-4-0
mistralai/mistral-medium-3
mistralai/mistral-medium-3-5
mistralai/mistral-medium-3-5:batch
mistralai/mistral-medium-3.1
mistralai/mistral-medium-3.1:batch
mistralai/mistral-nemo
mistralai/mistral-saba
mistralai/mistral-small-2603
mistralai/mistral-small-2603:batch
mistralai/mistral-small-3.1-24b-instruct
mistralai/mistral-small-3.2-24b-instruct
mistralai/mixtral-8x22b-instruct
mistralai/voxtral-small-24b-2507
mixedbread/toast-1
moonshot.kimi-k2-thinking
moonshotai.kimi-k2.5
moonshotai/Kimi-K2-Instruct
moonshotai/Kimi-K2-Instruct-0905
moonshotai/Kimi-K2-Thinking
moonshotai/Kimi-K2.5
moonshotai/Kimi-K2.6
moonshotai/Kimi-K2.7-Code
moonshotai/Kimi-K3
moonshotai/kimi-k2
moonshotai/kimi-k2-0905
moonshotai/kimi-k2-thinking
moonshotai/kimi-k2.5
moonshotai/kimi-k2.6
moonshotai/kimi-k2.7-code
moonshotai/kimi-k2.7-code-highspeed
moonshotai/kimi-k3
moonshotai/kimi-k3-fast
moonshotai/kimi-k3:batch
muse-spark-1.1
muse-spark-1.2
muse-spark-1.2-contributor
muse-spark-1.3
muse-spark-1.3-contributor
muse-spark-1.3-contributor-free
nemotron-3-ultra-free
nemotron-3.5-lightning-free
nex-agi/nex-n2.5-pro
nvidia.nemotron-nano-12b-v2
nvidia.nemotron-nano-3-30b
nvidia.nemotron-nano-9b-v2
nvidia.nemotron-super-3-120b
nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B
nvidia/Nemotron-120B-A12B
nvidia/cosmos-reason2-8b
nvidia/llama-3.1-nemotron-70b-instruct
nvidia/llama-3.1-nemotron-ultra-253b-v1
nvidia/nemotron-3-nano-30b-a3b
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
nvidia/nemotron-3-super-120b-a12b
nvidia/nemotron-3-super-120b-a12b:free
nvidia/nemotron-3-ultra-550b-a55b
nvidia/nemotron-3-ultra-550b-a55b:free
nvidia/nemotron-3.5-lightning
nvidia/nemotron-3.5-lightning-30b-a3b
nvidia/nemotron-3.5-lightning:free
nvidia/nemotron-nano-12b-v2-vl
nvidia/nemotron-nano-9b-v2
o1
o1-pro
o3
o3-mini
o3-pro
o4-mini
open-mistral-7b
open-mistral-nemo
open-mixtral-8x22b
open-mixtral-8x7b
openai.gpt-5.4
openai.gpt-5.5
openai.gpt-5.6-luna
openai.gpt-5.6-sol
openai.gpt-5.6-terra
openai.gpt-6-astra
openai.gpt-6-luna
openai.gpt-6-sol
openai.gpt-6.1-sol
openai.gpt-oss-120b
openai.gpt-oss-120b-1:0
openai.gpt-oss-20b
openai.gpt-oss-20b-1:0
openai.gpt-oss-safeguard-120b
openai.gpt-oss-safeguard-20b
openai/gpt-3.5-turbo
openai/gpt-3.5-turbo-0613
openai/gpt-3.5-turbo-16k
openai/gpt-3.5-turbo:batch
openai/gpt-4
openai/gpt-4-turbo
openai/gpt-4-turbo:batch
openai/gpt-4.1
openai/gpt-4.1-fast
openai/gpt-4.1-mini
openai/gpt-4.1-mini-fast
openai/gpt-4.1-mini:batch
openai/gpt-4.1-nano
openai/gpt-4.1-nano-fast
openai/gpt-4.1-nano:batch
openai/gpt-4.1:batch
openai/gpt-4o
openai/gpt-4o-2024-05-13
openai/gpt-4o-2024-08-06
openai/gpt-4o-2024-11-20
openai/gpt-4o-fast
openai/gpt-4o-mini
openai/gpt-4o-mini-2024-07-18
openai/gpt-4o-mini-fast
openai/gpt-4o-mini:batch
openai/gpt-4o:batch
openai/gpt-5
openai/gpt-5-codex
openai/gpt-5-fast
openai/gpt-5-mini
openai/gpt-5-mini-fast
openai/gpt-5-mini:batch
openai/gpt-5-nano
openai/gpt-5-nano:batch
openai/gpt-5-pro
openai/gpt-5-pro:batch
openai/gpt-5.1
openai/gpt-5.1-codex
openai/gpt-5.1-codex-max
openai/gpt-5.1-codex-mini
openai/gpt-5.1-thinking
openai/gpt-5.1-thinking-fast
openai/gpt-5.1:batch
openai/gpt-5.2
openai/gpt-5.2-chat
openai/gpt-5.2-codex
openai/gpt-5.2-fast
openai/gpt-5.2-pro
openai/gpt-5.2-pro:batch
openai/gpt-5.2:batch
openai/gpt-5.3-codex
openai/gpt-5.3-codex-fast
openai/gpt-5.4
openai/gpt-5.4-fast
openai/gpt-5.4-mini
openai/gpt-5.4-mini-fast
openai/gpt-5.4-mini:batch
openai/gpt-5.4-nano
openai/gpt-5.4-nano:batch
openai/gpt-5.4-pro
openai/gpt-5.4-pro:batch
openai/gpt-5.4:batch
openai/gpt-5.5
openai/gpt-5.5-fast
openai/gpt-5.5-pro
openai/gpt-5.5-pro:batch
openai/gpt-5.5:batch
openai/gpt-5.6-luna
openai/gpt-5.6-luna-fast
openai/gpt-5.6-luna-pro
openai/gpt-5.6-luna-pro:batch
openai/gpt-5.6-luna:batch
openai/gpt-5.6-sol
openai/gpt-5.6-sol-fast
openai/gpt-5.6-sol-pro
openai/gpt-5.6-sol-pro:batch
openai/gpt-5.6-sol:batch
openai/gpt-5.6-terra
openai/gpt-5.6-terra-fast
openai/gpt-5.6-terra-pro
openai/gpt-5.6-terra-pro:batch
openai/gpt-5.6-terra:batch
openai/gpt-5:batch
openai/gpt-6-astra
openai/gpt-6-astra-fast
openai/gpt-6-astra-pro
openai/gpt-6-astra-pro:batch
openai/gpt-6-astra:batch
openai/gpt-6-luna
openai/gpt-6-luna-fast
openai/gpt-6-luna-pro
openai/gpt-6-luna-pro:batch
openai/gpt-6-luna:batch
openai/gpt-6-sol
openai/gpt-6-sol-fast
openai/gpt-6-sol-pro
openai/gpt-6-sol-pro:batch
openai/gpt-6-sol:batch
openai/gpt-6.1-sol
openai/gpt-6.1-sol-fast
openai/gpt-6.1-sol-pro
openai/gpt-audio
openai/gpt-audio-mini
openai/gpt-chat-latest
openai/gpt-oss-120b
openai/gpt-oss-120b:batch
openai/gpt-oss-20b
openai/gpt-oss-20b:batch
openai/gpt-oss-safeguard-120b
openai/gpt-oss-safeguard-20b
openai/o1
openai/o3
openai/o3-fast
openai/o3-mini
openai/o3-mini-high
openai/o3-mini:batch
openai/o3-pro
openai/o3:batch
openai/o4-mini
openai/o4-mini-fast
openai/o4-mini-high
openai/o4-mini:batch
openrouter/auto
openrouter/auto-beta
openrouter/free
openrouter/fusion
perceptron/perceptron-mk1.5
pixtral-12b
pixtral-large-latest
poolside/laguna-s-2.1
poolside/laguna-s-2.1-free
poolside/laguna-s-2.1:free
poolside/laguna-xs-2.1
poolside/laguna-xs-2.1:free
precise
prism-ml/ternary-bonsai-2-27b
quiverai/arrow-2
quiverai/arrow-2-telos
qwen-3.8-27b
qwen.qwen3-235b-a22b-2507-v1:0
qwen.qwen3-32b-v1:0
qwen.qwen3-coder-30b-a3b-v1:0
qwen.qwen3-coder-480b-a35b-v1:0
qwen.qwen3-coder-next
qwen.qwen3-next-80b-a3b
qwen.qwen3-vl-235b-a22b
qwen/qwen-2.5-72b-instruct
qwen/qwen-2.5-7b-instruct
qwen/qwen-plus
qwen/qwen-plus-2025-07-28
qwen/qwen3-14b
qwen/qwen3-235b-a22b
qwen/qwen3-235b-a22b-2507
qwen/qwen3-235b-a22b-thinking-2507
qwen/qwen3-30b-a3b
qwen/qwen3-30b-a3b-instruct-2507
qwen/qwen3-30b-a3b-thinking-2507
qwen/qwen3-32b
qwen/qwen3-8b
qwen/qwen3-coder
qwen/qwen3-coder-30b-a3b-instruct
qwen/qwen3-coder-flash
qwen/qwen3-coder-next
qwen/qwen3-coder-plus
qwen/qwen3-max
qwen/qwen3-max-thinking
qwen/qwen3-next-80b-a3b-instruct
qwen/qwen3-next-80b-a3b-thinking
qwen/qwen3-vl-235b-a22b-instruct
qwen/qwen3-vl-235b-a22b-thinking
qwen/qwen3-vl-30b-a3b-instruct
qwen/qwen3-vl-30b-a3b-thinking
qwen/qwen3-vl-32b-instruct
qwen/qwen3-vl-8b-instruct
qwen/qwen3-vl-8b-thinking
qwen/qwen3.5-122b-a10b
qwen/qwen3.5-27b
qwen/qwen3.5-35b-a3b
qwen/qwen3.5-397b-a17b
qwen/qwen3.5-9b
qwen/qwen3.5-flash-02-23
qwen/qwen3.5-plus-02-15
qwen/qwen3.5-plus-20260420
qwen/qwen3.6-27b
qwen/qwen3.6-35b-a3b
qwen/qwen3.6-flash
qwen/qwen3.6-max-preview
qwen/qwen3.6-plus
qwen/qwen3.7-flash
qwen/qwen3.7-max
qwen/qwen3.7-plus
qwen/qwen3.8-2.4t-a95b
qwen/qwen3.8-27b
qwen/qwen3.8-flash
qwen/qwen3.8-max-0902
qwen/qwen3.8-max-prime
qwen/qwen3.8-omni-flash
qwen3.5-plus
qwen3.6-flash
qwen3.6-plus
qwen3.7-max
qwen3.7-plus
qwen3.8-flash
qwen3.8-max
rekaai/reka-edge
relace/relace-search
sakana/fugu-max
sakana/fugu-ultra
sakana/fugu-ultra-v2
sakana/namazu
sakana/sakana-namazu
sao10k/l3.1-euryale-70b
space-bunny
space-bunny-free
spacexai/grok-4.1-fast-non-reasoning
spacexai/grok-4.1-fast-reasoning
spacexai/grok-4.20-multi-agent
spacexai/grok-4.20-multi-agent-beta
spacexai/grok-4.20-non-reasoning
spacexai/grok-4.20-non-reasoning-beta
spacexai/grok-4.20-reasoning
spacexai/grok-4.20-reasoning-beta
spacexai/grok-4.3
spacexai/grok-4.5
spacexai/grok-4.6
spacexai/grok-4.7
spacexai/grok-build-0.1
stealth/glyph-cluster
stepfun-ai/Step-3.5-Flash
stepfun-ai/Step-3.7-Flash
stepfun/step-3.5-flash
stepfun/step-3.7-flash
tencent/Hy3
tencent/Hy4-preview
tencent/hy3
tencent/hy3-preview
tencent/hy4-preview
thinkingmachines/Inkling
thinkingmachines/Inkling-Small
thinkingmachines/inkling
thinkingmachines/inkling-small
thinkingmachines/inkling-small:free
thinkingmachines/inkling:free
typesafe/jev-router
unbiased/pareto
unbiased/pareto-26.10-preview
upstage/solar-mini4
upstage/solar-pro-3
upstage/solar-pro4
us-gov.openai.gpt-oss-120b-1:0
us-gov.openai.gpt-oss-20b-1:0
us.amazon.nova-2-lite-v1:0
us.amazon.nova-lite-v1:0
us.amazon.nova-micro-v1:0
us.amazon.nova-premier-v1:0
us.amazon.nova-pro-v1:0
us.anthropic.claude-fable-5
us.anthropic.claude-fable-5-1
us.anthropic.claude-haiku-4-5-20251001-v1:0
us.anthropic.claude-haiku-5-5
us.anthropic.claude-opus-4-1-20250805-v1:0
us.anthropic.claude-opus-4-5-20251101-v1:0
us.anthropic.claude-opus-4-6-v1
us.anthropic.claude-opus-4-7
us.anthropic.claude-opus-4-8
us.anthropic.claude-opus-5
us.anthropic.claude-opus-5-5
us.anthropic.claude-sonnet-4-20250514-v1:0
us.anthropic.claude-sonnet-4-5-20250929-v1:0
us.anthropic.claude-sonnet-4-6
us.anthropic.claude-sonnet-5
us.anthropic.claude-sonnet-5-5
us.meta.llama3-1-70b-instruct-v1:0
us.meta.llama3-1-8b-instruct-v1:0
us.meta.llama3-3-70b-instruct-v1:0
us.meta.llama4-maverick-17b-instruct-v1:0
us.meta.llama4-scout-17b-instruct-v1:0
us.mistral.pixtral-large-2502-v1:0
us.moonshotai.kimi-k3
us.openai.gpt-5.6-luna
us.openai.gpt-5.6-sol
us.openai.gpt-5.6-terra
us.openai.gpt-6-astra
us.openai.gpt-6-luna
us.openai.gpt-6-sol
us.openai.gpt-6.1-sol
us.writer.palmyra-x4-v1:0
us.writer.palmyra-x5-v1:0
us.xai.grok-4.6
us.xai.grok-4.7
us.zai.glm-5.3
voxtral-small-2507
voxtral-small-latest
workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731
workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813
workers-ai/@cf/google/gemma-4-26b-a4b-it
workers-ai/@cf/ibm-granite/granite-4.0-h-micro
workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast
workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct
workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct
workers-ai/@cf/moonshotai/kimi-k2.6
workers-ai/@cf/moonshotai/kimi-k2.7-code
workers-ai/@cf/nvidia/nemotron-3-120b-a12b
workers-ai/@cf/openai/gpt-oss-120b
workers-ai/@cf/openai/gpt-oss-20b
workers-ai/@cf/qwen/qwen3-30b-a3b-fp8
workers-ai/@cf/qwen/qwen3.8-27b
workers-ai/@cf/zai-org/glm-4.7-flash
workers-ai/@cf/zai-org/glm-5.2
workers-ai/@cf/zai-org/glm-5.3
workers-ai/@cf/zai-org/glm-5.3-flash
writer.palmyra-x4-v1:0
writer.palmyra-x5-v1:0
x-ai/grok-4.20
x-ai/grok-4.3
x-ai/grok-4.3:batch
x-ai/grok-4.5
x-ai/grok-4.6
x-ai/grok-4.7
x-ai/grok-build-0.1
xai.grok-4.3
xai.grok-4.6
xiaomi/mimo-v2.5
xiaomi/mimo-v2.5-pro
xiaomi/mimo-v2.6-flash
xiaomi/mimo-v2.6-pro
xiaomi/mimo-v2.6-pro-ultraspeed
z-ai/glm-4.5
z-ai/glm-4.5-air
z-ai/glm-4.5v
z-ai/glm-4.6
z-ai/glm-4.6v
z-ai/glm-4.7
z-ai/glm-4.7-flash
z-ai/glm-5
z-ai/glm-5-turbo
z-ai/glm-5.1
z-ai/glm-5.2
z-ai/glm-5.3
z-ai/glm-5.3-flash
z-ai/glm-5.3-flash:batch
z-ai/glm-5.3-flashx
z-ai/glm-5.3-prime
z-ai/glm-5.3:batch
z-ai/glm-5v-turbo
zai-glm-5-2
zai-glm-5-3
zai-org/GLM-4.5
zai-org/GLM-4.5-Air
zai-org/GLM-4.5V
zai-org/GLM-4.6
zai-org/GLM-4.6V-Flash
zai-org/GLM-4.7
zai-org/GLM-4.7-Flash
zai-org/GLM-5
zai-org/GLM-5.1
zai-org/GLM-5.2
zai-org/GLM-5.2-Fast
zai-org/GLM-5.3
zai-org/GLM-5.3-Fast
zai-org/GLM-5.3-Flash
zai.glm-4.7
zai.glm-4.7-flash
zai.glm-5
zai/glm-4.5
zai/glm-4.5-air
zai/glm-4.5v
zai/glm-4.6
zai/glm-4.7
zai/glm-4.7-flash
zai/glm-4.7-flashx
zai/glm-5
zai/glm-5-turbo
zai/glm-5.1
zai/glm-5.2
zai/glm-5.2-fast
zai/glm-5.3
zai/glm-5.3-fast
zai/glm-5.3-flash
zai/glm-5.3-flashx
zai/glm-5v-turbo
~anthropic/claude-fable-latest
~anthropic/claude-haiku-latest
~anthropic/claude-opus-latest
~anthropic/claude-sonnet-latest
~deepseek/deepseek-flash-latest
~deepseek/deepseek-pro-latest
~deepseek/deepseek-v4-flash-latest
~google/gemini-flash-latest
~google/gemini-pro-latest
~moonshotai/kimi-latest
~openai/gpt-astra-latest
~openai/gpt-luna-latest
~openai/gpt-mini-latest
~openai/gpt-sol-latest
~openai/gpt-terra-latest
~x-ai/grok-latest
~z-ai/glm-flash-latest
~z-ai/glm-latest
`.split("\n"));
//#endregion
//#region src/host/model-caps.ts
/**
* What one site model name can actually do: whether it answers chat at all, and
* how much context it holds.
*
* Three sources answer, in falling priority, and each answers something the
* others cannot:
*
* 1. the site itself, through `/api/pricing` — `supported_endpoint_types` says
*    which downstream surfaces the model serves, and `context_window` /
*    `max_tokens` are the capacities an operator maintained in the New API
*    console (see the `HANDOFF-new-api.md` capacity section);
* 2. this plugin's own configuration — `modelOverrides` (per bare model name)
*    and `defaultContextWindow` (everything else), so a capacity can be
*    corrected without publishing a new plugin version;
* 3. the generated pi-ai table beside this module, which describes the models
*    the catalog knows even when the site declares nothing.
*
* @module
*/
/**
* Variants the site marks as unfit for coding: it pairs every such name with a
* twin that lacks the suffix, so offering both only invites a wrong pick.
*/
const CODING_VARIANT = /-c$/i;
/** Media routes that carry a model name but never answer a chat request. */
const NON_TEXT = /(image|tts|transcribe|asr)/i;
/**
* The downstream surfaces that answer a chat request. A model the site
* declares without any of these is a media, embedding, or rerank route, and the
* endpoint list is the site's own statement rather than a guess from the name.
*/
const CHAT_ENDPOINTS = /* @__PURE__ */ new Set([
	"openai",
	"openai-response",
	"anthropic",
	"gemini"
]);
/**
* Chat models the site publishes before the pi-ai catalog learns them.
*
* Only the name-based fallback below consults this list; a site that declares
* `supported_endpoint_types` needs no allowlist at all. A model listed here is
* offered with the reasoning levels measured against the live gateway;
* `null` offers it without claiming any. Delete an entry once the catalog
* describes the model, since the catalog is the better authority.
*
* `gemini-4-argon`: Gemini 4 replaced the thinking token budget with a level
* name. Its accepted levels are low/medium/high/max; minimal and xhigh are
* rejected by the upstream.
*/
const UNCALLED_MODELS = { "gemini-4-argon": {
	levels: [
		"low",
		"medium",
		"high",
		"max"
	],
	input: ["text", "image"]
} };
/** Display spelling of each level the catalog names. */
const LEVEL_LABELS = {
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "XHigh",
	max: "Max"
};
/**
* Whether the name-based fallback keeps this model.
*
* Three exclusions: a coding-suffixed twin, a media route, and any name neither
* the catalog nor {@link UNCALLED_MODELS} describes — an unknown model would
* otherwise be advertised with invented capabilities. Only a site that declares
* no endpoint types reaches this rule; see {@link isChatOffering}.
* @param model - a bare model name from the pricing endpoint.
* @returns whether the model stays in the catalog.
*/
function isOfferedModel(model) {
	if (CODING_VARIANT.test(model)) return false;
	if (NON_TEXT.test(model)) return false;
	if (Object.hasOwn(UNCALLED_MODELS, model)) return true;
	return CHAT_MODELS.has(model);
}
/**
* Whether the catalog should offer this model at all.
*
* The site's declared endpoint types decide when it declares any: that is what
* lets a model the catalog has never heard of appear the day the site adds it,
* instead of waiting for a plugin release. A site that declares nothing falls
* back to the name rules, which is the only answer available there.
* @param model - a bare model name from the pricing endpoint.
* @param endpoints - the site's declared downstream surfaces, if any.
* @returns whether the model stays in the catalog.
*/
function isChatOffering(model, endpoints) {
	if (NON_TEXT.test(model) || CODING_VARIANT.test(model)) return false;
	if (endpoints === void 0 || endpoints.length === 0) return isOfferedModel(model);
	return endpoints.some((endpoint) => CHAT_ENDPOINTS.has(endpoint));
}
/**
* The selectable reasoning levels for one model.
* @param model - a bare model name.
* @param declared - levels configured for this exact model, which win when given.
* @returns the level names, or undefined when nothing names any.
*/
function reasoningLevels(model, declared) {
	if (declared !== void 0) return declared.length === 0 ? void 0 : declared;
	if (Object.hasOwn(UNCALLED_MODELS, model)) return UNCALLED_MODELS[model]?.levels ?? void 0;
	const index = MODEL_TIERS[model];
	return index === void 0 ? void 0 : TIER_SETS[index];
}
/**
* The input modalities one model accepts.
*
* The harness treats a declared modality list as the only permission a request
* has: the `read_image` tool refuses to load a file for a model without
* `image`, and a request carrying an image is rejected before it is sent. So
* this answers for every model — a name nothing describes is stated as text-only
* rather than left unknown, which is what the site actually serves in practice
* and keeps an image out of a request that would fail.
* @param model - a bare model name.
* @param declared - modalities configured for this exact model, which win when given.
* @returns the modalities, always including `text`.
*/
function inputModalitiesOf(model, declared) {
	if (declared !== void 0 && declared.length > 0) return declared;
	if (Object.hasOwn(UNCALLED_MODELS, model)) return UNCALLED_MODELS[model]?.input ?? ["text"];
	return MODEL_INPUT[model] ?? ["text"];
}
/**
* Resolve one model's context window.
*
* A harness model without a context window loses automatic compaction entirely
* — the compaction backend refuses to size a summary budget it cannot bound —
* so this always answers, falling back to the configured capacity rather than
* declining. Priority: operator override, then the site's own declaration, then
* the generated catalog, then the configured fallback.
* @param model - a bare model name.
* @param sources - the four candidate answers.
* @returns a positive token count.
*/
function contextWindowOf(model, sources) {
	return sources.override ?? sources.reported ?? MODEL_CONTEXT_WINDOW[model] ?? sources.fallback;
}
/**
* Resolve one model's maximum output tokens.
*
* Only an explicit answer counts: the generated catalog's `maxTokens` is the
* vendor's own ceiling, and the site may route the name to a channel with a
* lower one, so sending it would trade a truncated reply for a rejected
* request. Without an explicit answer the request omits the field and the
* upstream default applies.
* @param reported - what the site declared for this exact model.
* @param override - the operator's configuration for this bare model name.
* @returns the output ceiling, or undefined to leave it to the upstream.
*/
function maxTokensOf(reported, override) {
	return override ?? reported;
}
/**
* The level a request uses until the human picks another.
* @param levels - the model's selectable levels, which is never empty.
* @returns `medium` when offered, otherwise the least intensive level.
*/
function defaultReasoningLevel(levels) {
	if (levels.includes("medium")) return "medium";
	return levels[0] ?? "medium";
}
/**
* Display name of one level.
* @param level - a level id from the catalog.
* @returns the capitalized name the selector shows.
*/
function reasoningLevelLabel(level) {
	return LEVEL_LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1);
}
//#endregion
//#region src/host/sse.ts
/**
* The SSE plumbing the four wires share: turn a streaming body into `data:`
* payloads, and read JSON fields without trusting their type.
*
* Every value here comes off the wire, so nothing may be assumed: a field the
* gateway sends as `null` is as ordinary as one it omits, and reading through
* it would throw and kill the whole stream mid-answer.
*
* @module
*/
/**
* Read one JSON value as an object.
* @param value - any decoded JSON value.
* @returns the object, or undefined for null, an array, or a primitive.
*/
function asObject(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	return value;
}
/**
* Read one JSON value as an array of unknown entries.
* @param value - any decoded JSON value.
* @returns the array, or an empty array for anything else.
*/
function asArray(value) {
	return Array.isArray(value) ? value : [];
}
/**
* Read a finite number from an unknown field.
* @param value - the candidate.
* @returns the number, or undefined for anything else (including numeric strings).
*/
function numberOf(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
/**
* Read a string from an unknown field.
* @param value - the candidate.
* @returns the string, or undefined.
*/
function stringOf(value) {
	return typeof value === "string" ? value : void 0;
}
/**
* Read one `data:` line.
* @param line - one raw line, already split at \n.
* @returns the payload text, or undefined when the line carries no data.
*/
function dataOf(line) {
	const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
	if (!trimmed.startsWith("data:")) return void 0;
	return trimmed.slice(5).trim();
}
/**
* Yield every `data:` payload of one SSE response, in arrival order.
*
* The `[DONE]` sentinel, comments, and blank lines are skipped. A payload split
* across two reads is reassembled, and a final payload with no trailing newline
* is still yielded: a stream that ends mid-line must not lose its last event.
* @param response - the streaming fetch response.
* @param signal - cancellation passthrough for the read loop.
* @returns the payload strings, `[DONE]` excluded.
*/
async function* sseData(response, signal) {
	if (response.body === null) return;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			if (signal?.aborted === true) return;
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const payload = dataOf(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (payload === void 0 || payload === "" || payload === "[DONE]") continue;
				yield payload;
			}
		}
		const tail = dataOf(buffer);
		if (tail !== void 0 && tail !== "" && tail !== "[DONE]") yield tail;
	} finally {
		reader.releaseLock();
	}
}
/**
* Unwrap one JSON `data:` payload.
* @param payload - the raw payload text.
* @returns the parsed object, or undefined when it is not a JSON object.
*/
function parseJsonObject(payload) {
	let parsed;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return;
	}
	return asObject(parsed);
}
//#endregion
//#region src/host/anthropic-wire.ts
/**
* The Anthropic messages wire: what a Claude model behind the gateway expects,
* and the SSE events it answers with, folded back into harness chunks.
*
* Two properties of the gateway shape this module:
*
* - Content block indexes arrive in the order the gateway opened them, which is
*   not fixed (a thinking block can precede the text block). Blocks are read by
*   the index the wire sent, never by a guessed position.
* - `message_start.usage` carries the gateway's own prompt estimate; the real
*   counts arrive with `message_delta`. Both are read, the later one winning.
*
* @module
*/
/**
* Flatten one message's text blocks.
* @param content - the message's content blocks.
* @returns the joined plain text.
*/
function textOf$3(content) {
	let text = "";
	for (const block of content) if (typeof block === "object" && block !== null && block.type === "text") text += block.text;
	return text;
}
/**
* Map one harness message onto its Anthropic form.
*
* Assistant thinking blocks are not sent back: the harness ReasoningBlock
* carries no signature, and the gateway drops a thinking block without one.
* @param message - one conversation message.
* @returns the wire message, or undefined when it carries nothing.
*/
function serializeMessage$3(message) {
	const content = message.content;
	switch (message.role) {
		case "user":
		case "system": {
			const text = textOf$3(content);
			return text === "" ? void 0 : {
				role: "user",
				content: [{
					type: "text",
					text
				}]
			};
		}
		case "assistant": {
			const blocks = [];
			const text = textOf$3(content);
			if (text !== "") blocks.push({
				type: "text",
				text
			});
			for (const block of content) {
				if (typeof block !== "object" || block === null) continue;
				const call = block;
				if (call.type !== "tool-call") continue;
				let input = {};
				try {
					input = call.arguments === void 0 || call.arguments === "" ? {} : JSON.parse(call.arguments);
				} catch {
					input = {};
				}
				blocks.push({
					type: "tool_use",
					id: call.id,
					name: call.name,
					input
				});
			}
			return blocks.length === 0 ? void 0 : {
				role: "assistant",
				content: blocks
			};
		}
		case "tool": {
			const text = textOf$3(content);
			return {
				role: "user",
				content: [{
					type: "tool_result",
					tool_use_id: message.toolCallId,
					content: text
				}]
			};
		}
		default: return;
	}
}
/**
* The effort the messages API accepts for one harness level.
*
* `minimal` is not a value the API knows; `low` is its floor.
* @param effort - the harness effort id.
* @returns the effort to send.
*/
function claudeEffort(effort) {
	return effort === "minimal" ? "low" : effort;
}
/**
* Serialize one harness request into an Anthropic messages body.
*
* Reasoning is requested as `thinking.type = "adaptive"` with the effort in
* `output_config`, which every Claude generation behind this gateway accepts.
* The older `thinking.type = "enabled"` budget form is not portable: models of
* the Claude 5 generation reject it outright ("requires adaptive thinking"),
* and an adaptive request still works on the older ones.
*
* `max_tokens` is only sent when the caller set one: the gateway does not
* require it, and inventing a cap would truncate long answers.
* @param options - the harness request.
* @param model - the real model id the provider should route to.
* @returns the ready-to-JSON body object.
*/
function serializeRequest$3(options, model) {
	const messages = [];
	for (const message of options.messages) {
		const wire = serializeMessage$3(message);
		if (wire !== void 0) messages.push(wire);
	}
	const body = {
		model,
		messages,
		stream: true
	};
	if (options.reasoningEffort !== void 0) {
		body.thinking = { type: "adaptive" };
		body.output_config = { effort: claudeEffort(options.reasoningEffort) };
	}
	if (options.maxTokens !== void 0) body.max_tokens = options.maxTokens;
	if (options.temperature !== void 0) body.temperature = options.temperature;
	if (options.system !== void 0 && options.system.length > 0) body.system = options.system;
	if (options.tools !== void 0 && options.tools.length > 0) body.tools = options.tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters
	}));
	if (options.stop !== void 0 && options.stop.length > 0) body.stop_sequences = options.stop;
	return body;
}
/**
* Open (or re-open) the block a wire index refers to.
* @param state - the live assembly state.
* @param wireIndex - the index the wire used for this block.
* @param kind - the block kind the wire announced.
* @returns the block, and whether it was just opened.
*/
function open$2(state, wireIndex, kind) {
	const existing = state.blocks.get(wireIndex);
	if (existing !== void 0) return {
		block: existing,
		fresh: false
	};
	const block = {
		index: state.nextIndex,
		kind,
		id: "",
		name: "",
		body: ""
	};
	state.nextIndex += 1;
	state.blocks.set(wireIndex, block);
	return {
		block,
		fresh: true
	};
}
/**
* Fold one Anthropic event into the assembly state.
* @param payload - one SSE data payload.
* @param state - the live assembly state.
* @returns zero or more harness chunks. Text and reasoning blocks open on
* their first non-empty delta; tool calls open on `content_block_start`, which
* is where their id and name arrive.
*/
function* consume$3(payload, state) {
	const event = parseJsonObject(payload);
	if (event === void 0) return;
	const type = stringOf(event.type);
	if (type === "message_start") {
		const usage = asObject(asObject(event.message)?.usage) ?? {};
		state.usage = {
			input: numberOf(usage.input_tokens) ?? 0,
			cacheRead: numberOf(usage.cache_read_input_tokens) ?? 0,
			cacheWrite: numberOf(usage.cache_creation_input_tokens) ?? 0,
			output: numberOf(usage.output_tokens) ?? 0
		};
		return;
	}
	if (type === "content_block_start") {
		const wireIndex = numberOf(event.index) ?? 0;
		const block = asObject(event.content_block) ?? {};
		if (stringOf(block.type) === "tool_use") {
			const opened = open$2(state, wireIndex, "tool-call");
			if (opened.fresh) {
				opened.block.id = stringOf(block.id) ?? `tool_${wireIndex}`;
				opened.block.name = stringOf(block.name) ?? "";
				yield {
					type: "block-start",
					index: opened.block.index,
					blockType: "tool-call"
				};
			}
			return;
		}
		return;
	}
	if (type === "content_block_delta") {
		const wireIndex = numberOf(event.index) ?? 0;
		const delta = asObject(event.delta) ?? {};
		const kind = stringOf(delta.type);
		const known = state.blocks.get(wireIndex);
		if (kind === "text_delta") {
			const text = stringOf(delta.text) ?? "";
			if (text === "") return;
			const opened = known === void 0 ? open$2(state, wireIndex, "text") : {
				block: known,
				fresh: false
			};
			if (opened.fresh) yield {
				type: "block-start",
				index: opened.block.index,
				blockType: "text"
			};
			opened.block.body += text;
			yield {
				type: "text-delta",
				index: opened.block.index,
				text
			};
			return;
		}
		if (kind === "thinking_delta") {
			const text = stringOf(delta.thinking) ?? "";
			if (text === "") return;
			const opened = known === void 0 ? open$2(state, wireIndex, "reasoning") : {
				block: known,
				fresh: false
			};
			if (opened.fresh) yield {
				type: "block-start",
				index: opened.block.index,
				blockType: "reasoning"
			};
			opened.block.body += text;
			yield {
				type: "reasoning-delta",
				index: opened.block.index,
				text
			};
			return;
		}
		if (kind === "input_json_delta") {
			const partial = stringOf(delta.partial_json) ?? "";
			if (partial === "" || known === void 0 || known.kind !== "tool-call") return;
			known.body += partial;
			yield {
				type: "tool-call-delta",
				index: known.index,
				id: brandString(known.id),
				...known.name !== "" ? { name: known.name } : {},
				argumentsDelta: partial
			};
		}
		return;
	}
	if (type === "message_delta") {
		const stop = stringOf(asObject(event.delta)?.stop_reason);
		if (stop !== void 0) state.finish = stop;
		const usage = asObject(event.usage);
		if (usage === void 0 || state.usage === null) return;
		state.usage.input = numberOf(usage.input_tokens) ?? state.usage.input;
		state.usage.cacheRead = numberOf(usage.cache_read_input_tokens) ?? state.usage.cacheRead;
		state.usage.cacheWrite = numberOf(usage.cache_creation_input_tokens) ?? state.usage.cacheWrite;
		state.usage.output = numberOf(usage.output_tokens) ?? state.usage.output;
	}
}
/**
* Fold one Anthropic stop reason into a harness finish reason.
* @param reason - the raw stop_reason.
* @returns the finish reason.
*/
function finishOf$3(reason) {
	switch (reason) {
		case "tool_use": return { kind: "tool-calls" };
		case "max_tokens": return { kind: "max-tokens" };
		default: return { kind: "stop" };
	}
}
/**
* Parse one streamed Anthropic response into harness chunks.
* @param response - the streaming fetch response.
* @param signal - cancellation passthrough for the read loop.
* @returns the chunk stream.
*/
async function* parseSse$3(response, signal) {
	if (!response.ok || response.body === null) {
		const detail = await response.text().catch(() => "");
		throw new LlmError(`NearToken answered ${response.status}: ${detail.slice(0, 500)}`, "PROVIDER_ERROR");
	}
	const state = {
		blocks: /* @__PURE__ */ new Map(),
		nextIndex: 0,
		usage: null,
		finish: null
	};
	for await (const payload of sseData(response, signal)) yield* consume$3(payload, state);
	for (const block of state.blocks.values()) {
		if (block.kind === "text") {
			yield {
				type: "block-end",
				index: block.index,
				block: {
					type: "text",
					text: block.body
				}
			};
			continue;
		}
		if (block.kind === "reasoning") {
			yield {
				type: "block-end",
				index: block.index,
				block: {
					type: "reasoning",
					text: block.body
				}
			};
			continue;
		}
		yield {
			type: "block-end",
			index: block.index,
			block: {
				type: "tool-call",
				id: brandString(block.id),
				name: block.name,
				arguments: block.body
			}
		};
	}
	if (state.usage !== null) yield {
		type: "usage",
		usage: {
			inputTokens: state.usage.input,
			outputTokens: state.usage.output,
			...state.usage.cacheRead > 0 ? { cacheReadTokens: state.usage.cacheRead } : {},
			...state.usage.cacheWrite > 0 ? { cacheWriteTokens: state.usage.cacheWrite } : {}
		}
	};
	yield {
		type: "finish",
		reason: finishOf$3(state.finish)
	};
}
//#endregion
//#region src/host/genai-wire.ts
/**
* The Google genai wire: `models/{model}:streamGenerateContent`, whose
* `candidates[0].content.parts` arrive one SSE frame at a time.
*
* Function calls come back as whole `functionCall` parts rather than token
* deltas, so each one is emitted as a complete tool-call block. Sending a tool
* result back requires the function's own name, which the harness tool message
* does not carry: it is looked up from the assistant turn that called it.
*
* @module
*/
/**
* Flatten one message's text blocks.
* @param content - the message's content blocks.
* @returns the joined plain text.
*/
function textOf$2(content) {
	let text = "";
	for (const block of content) if (typeof block === "object" && block !== null && block.type === "text") text += block.text;
	return text;
}
/**
* Collect every tool call name by its call id across the conversation.
*
* A genai `functionResponse` is matched to its call by function name, while the
* harness tool message only carries the call id, so the name has to be recovered
* from the assistant turn that issued it.
* @param messages - the whole conversation.
* @returns call id to function name.
*/
function toolNamesOf(messages) {
	const names = /* @__PURE__ */ new Map();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) {
			if (typeof block !== "object" || block === null) continue;
			const call = block;
			if (call.type !== "tool-call") continue;
			if (call.id !== void 0 && call.name !== void 0) names.set(String(call.id), call.name);
		}
	}
	return names;
}
/**
* Map one harness message onto its genai form.
* @param message - one conversation message.
* @param toolNames - call id to function name, for tool results.
* @returns the wire content, or undefined when it carries nothing.
*/
function serializeMessage$2(message, toolNames) {
	const content = message.content;
	switch (message.role) {
		case "user":
		case "system":
		case "developer": {
			const text = textOf$2(content);
			return text === "" ? void 0 : {
				role: "user",
				parts: [{ text }]
			};
		}
		case "assistant": {
			const parts = [];
			const text = textOf$2(content);
			if (text !== "") parts.push({ text });
			for (const block of content) {
				if (typeof block !== "object" || block === null) continue;
				const call = block;
				if (call.type !== "tool-call") continue;
				let args = {};
				try {
					args = call.arguments === void 0 || call.arguments === "" ? {} : JSON.parse(call.arguments);
				} catch {
					args = {};
				}
				parts.push({ functionCall: {
					name: call.name,
					args
				} });
			}
			return parts.length === 0 ? void 0 : {
				role: "model",
				parts
			};
		}
		case "tool": {
			const text = textOf$2(content);
			return {
				role: "user",
				parts: [{ functionResponse: {
					name: toolNames.get(String(message.toolCallId)) ?? String(message.toolCallId),
					response: { result: text }
				} }]
			};
		}
		default: return;
	}
}
/**
* Thinking budget for one harness reasoning effort.
*
* genai takes a token budget rather than an effort name. Levels are only
* advertised for models whose catalog entry lists them, so a model that cannot
* think never receives this field.
* @param effort - the harness effort id.
* @returns the budget in tokens, or undefined when the effort is not a level.
*/
function thinkingBudget(effort) {
	switch (effort) {
		case "minimal": return 1024;
		case "low": return 2048;
		case "medium": return 8192;
		case "high": return 16384;
		case "xhigh": return 24576;
		case "max": return 32768;
		default: return;
	}
}
/**
* Whether a model takes a thinking level instead of a token budget.
*
* Gemini 4 dropped `thinkingBudget`; sending one answers 400 "Use thinking
* level instead". The level names it accepts are the effort ids themselves.
* @param model - the bare model id.
* @returns true for the level vocabulary.
*/
function usesThinkingLevel(model) {
	const major = /gemini-(\d+)/i.exec(model)?.[1];
	return major !== void 0 && Number(major) >= 4;
}
/**
* The `thinkingConfig` for one request, in the vocabulary the model speaks.
* @param model - the bare model id.
* @param effort - the harness reasoning effort, when one was chosen.
* @returns the config, or undefined when the model gets no thinking request.
*/
function thinkingConfigOf(model, effort) {
	if (effort === void 0) return void 0;
	if (usesThinkingLevel(model)) return {
		thinkingLevel: effort === "minimal" ? "low" : effort,
		includeThoughts: true
	};
	const budget = thinkingBudget(effort);
	return budget === void 0 ? void 0 : {
		thinkingBudget: budget,
		includeThoughts: true
	};
}
/**
* Serialize one harness request into a genai request body.
* @param options - the harness request.
* @param model - the real model id the provider should route to; genai carries
* it in the URL, so the body does not repeat it.
* @returns the ready-to-JSON body object.
*/
function serializeRequest$2(options, model) {
	const toolNames = toolNamesOf(options.messages);
	const contents = [];
	for (const message of options.messages) {
		const wire = serializeMessage$2(message, toolNames);
		if (wire !== void 0) contents.push(wire);
	}
	const generationConfig = {};
	if (options.temperature !== void 0) generationConfig.temperature = options.temperature;
	if (options.maxTokens !== void 0) generationConfig.maxOutputTokens = options.maxTokens;
	if (options.stop !== void 0 && options.stop.length > 0) generationConfig.stopSequences = options.stop;
	const thinking = thinkingConfigOf(model, options.reasoningEffort);
	if (thinking !== void 0) generationConfig.thinkingConfig = thinking;
	const body = { contents };
	if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
	if (options.system !== void 0 && options.system.length > 0) body.systemInstruction = { parts: [{ text: options.system }] };
	if (options.tools !== void 0 && options.tools.length > 0) body.tools = [{ functionDeclarations: options.tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters
	})) }];
	return body;
}
/**
* Allocate the next block index.
* @param state - the live assembly state.
* @param kind - the block kind being opened.
* @returns the new block.
*/
function open$1(state, kind) {
	const block = {
		index: state.nextIndex,
		kind,
		id: "",
		name: "",
		body: ""
	};
	state.nextIndex += 1;
	return block;
}
/**
* Fold the per-frame usage block, keeping the last non-zero counts.
*
* Every frame repeats `usageMetadata`, and the running counts are cumulative;
* a zero-valued frame must not erase what an earlier frame already reported.
* @param state - the live assembly state.
* @param value - the raw `usageMetadata` value.
*/
function absorbUsage(state, value) {
	const usage = asObject(value);
	if (usage === void 0) return;
	const cached = numberOf(usage.cachedContentTokenCount) ?? 0;
	const prompt = numberOf(usage.promptTokenCount) ?? 0;
	const output = numberOf(usage.candidatesTokenCount) ?? 0;
	const reasoning = numberOf(usage.thoughtsTokenCount);
	const previous = state.usage;
	state.usage = {
		input: prompt > 0 ? Math.max(0, prompt - cached) : previous?.input ?? 0,
		cached: cached > 0 ? cached : previous?.cached ?? 0,
		output: output > 0 ? output : previous?.output ?? 0,
		reasoning: reasoning !== void 0 && reasoning > 0 ? reasoning : previous?.reasoning
	};
}
/**
* Fold one genai frame into the assembly state.
* @param payload - one SSE data payload.
* @param state - the live assembly state.
* @returns zero or more harness chunks.
*/
function* consume$2(payload, state) {
	const frame = parseJsonObject(payload);
	if (frame === void 0) return;
	absorbUsage(state, frame.usageMetadata);
	const candidate = asObject(asArray(frame.candidates)[0]);
	if (candidate === void 0) return;
	for (const entry of asArray(asObject(candidate.content)?.parts)) {
		const part = asObject(entry);
		if (part === void 0) continue;
		const text = stringOf(part.text);
		const thought = part.thought === true;
		if (text !== void 0 && text.length > 0) {
			if (thought) {
				if (state.reasoning === null) {
					state.reasoning = open$1(state, "reasoning");
					yield {
						type: "block-start",
						index: state.reasoning.index,
						blockType: "reasoning"
					};
				}
				state.reasoning.body += text;
				yield {
					type: "reasoning-delta",
					index: state.reasoning.index,
					text
				};
			} else {
				if (state.text === null) {
					state.text = open$1(state, "text");
					yield {
						type: "block-start",
						index: state.text.index,
						blockType: "text"
					};
				}
				state.text.body += text;
				yield {
					type: "text-delta",
					index: state.text.index,
					text
				};
			}
			continue;
		}
		const call = asObject(part.functionCall);
		if (call === void 0) continue;
		const name = stringOf(call.name) ?? "";
		const slot = state.toolBlocks.length;
		const id = stringOf(call.id) ?? (name === "" ? `tool_${slot}` : `tool_${name}_${slot}`);
		const args = call.args === void 0 ? "{}" : JSON.stringify(call.args);
		const block = {
			...open$1(state, "tool-call"),
			id,
			name,
			body: args
		};
		state.toolBlocks.push(block);
		yield {
			type: "block-start",
			index: block.index,
			blockType: "tool-call"
		};
		yield {
			type: "tool-call-delta",
			index: block.index,
			id: brandString(block.id),
			...name !== "" ? { name } : {},
			argumentsDelta: args
		};
	}
	const finish = stringOf(candidate.finishReason);
	if (finish !== void 0 && finish !== "") state.finish = finish;
}
/**
* Fold one genai finishReason into a harness finish reason.
* @param reason - the raw finishReason.
* @param hadToolCalls - whether any functionCall part was produced.
* @returns the finish reason.
*/
function finishOf$2(reason, hadToolCalls) {
	if (reason === "MAX_TOKENS") return { kind: "max-tokens" };
	if (hadToolCalls) return { kind: "tool-calls" };
	return { kind: "stop" };
}
/**
* Parse one streamed genai response into harness chunks.
* @param response - the streaming fetch response.
* @param signal - cancellation passthrough for the read loop.
* @returns the chunk stream.
*/
async function* parseSse$2(response, signal) {
	if (!response.ok || response.body === null) {
		const detail = await response.text().catch(() => "");
		throw new LlmError(`NearToken answered ${response.status}: ${detail.slice(0, 500)}`, "PROVIDER_ERROR");
	}
	const state = {
		text: null,
		reasoning: null,
		toolBlocks: [],
		nextIndex: 0,
		usage: null,
		finish: null
	};
	for await (const payload of sseData(response, signal)) yield* consume$2(payload, state);
	const ordered = [
		...state.text === null ? [] : [state.text],
		...state.reasoning === null ? [] : [state.reasoning],
		...state.toolBlocks
	].sort((left, right) => left.index - right.index);
	for (const block of ordered) {
		if (block.kind === "text") {
			yield {
				type: "block-end",
				index: block.index,
				block: {
					type: "text",
					text: block.body
				}
			};
			continue;
		}
		if (block.kind === "reasoning") {
			yield {
				type: "block-end",
				index: block.index,
				block: {
					type: "reasoning",
					text: block.body
				}
			};
			continue;
		}
		yield {
			type: "block-end",
			index: block.index,
			block: {
				type: "tool-call",
				id: brandString(block.id),
				name: block.name,
				arguments: block.body
			}
		};
	}
	if (state.usage !== null) yield {
		type: "usage",
		usage: {
			inputTokens: state.usage.input,
			outputTokens: state.usage.output,
			...state.usage.cached > 0 ? { cacheReadTokens: state.usage.cached } : {},
			...state.usage.reasoning !== void 0 ? { reasoningTokens: state.usage.reasoning } : {}
		}
	};
	yield {
		type: "finish",
		reason: finishOf$2(state.finish, state.toolBlocks.length > 0)
	};
}
//#endregion
//#region src/host/responses-wire.ts
/**
* The OpenAI Responses wire: `POST /v1/responses`, whose SSE stream speaks in
* typed events (`response.output_text.delta`, `response.function_call_arguments.delta`,
* …) rather than chat deltas.
*
* @module
*/
/**
* Flatten one message's text blocks.
* @param content - the message's content blocks.
* @returns the joined plain text.
*/
function textOf$1(content) {
	let text = "";
	for (const block of content) if (typeof block === "object" && block !== null && block.type === "text") text += block.text;
	return text;
}
/**
* Map one harness message onto its responses input items.
*
* An assistant turn that both speaks and calls tools expands to one message item
* followed by one `function_call` item per call.
* @param message - one conversation message.
* @returns the items, empty when the message carries nothing.
*/
function serializeMessage$1(message) {
	const content = message.content;
	switch (message.role) {
		case "user":
		case "system":
		case "developer": {
			const text = textOf$1(content);
			return text === "" ? [] : [{
				role: "user",
				content: text
			}];
		}
		case "assistant": {
			const text = textOf$1(content);
			const items = text === "" ? [] : [{
				role: "assistant",
				content: text
			}];
			for (const block of content) {
				if (typeof block !== "object" || block === null) continue;
				const call = block;
				if (call.type !== "tool-call") continue;
				items.push({
					type: "function_call",
					call_id: call.id,
					name: call.name,
					arguments: call.arguments ?? ""
				});
			}
			return items;
		}
		case "tool": return [{
			type: "function_call_output",
			call_id: message.toolCallId,
			output: textOf$1(content)
		}];
		default: return [];
	}
}
/**
* Serialize one harness request into a responses body.
* @param options - the harness request.
* @param model - the real model id the provider should route to.
* @returns the ready-to-JSON body object.
*/
function serializeRequest$1(options, model) {
	const input = [];
	for (const message of options.messages) input.push(...serializeMessage$1(message));
	const body = {
		model,
		input,
		stream: true
	};
	if (options.system !== void 0 && options.system.length > 0) body.instructions = options.system;
	if (options.tools !== void 0 && options.tools.length > 0) body.tools = options.tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters
	}));
	if (options.temperature !== void 0) body.temperature = options.temperature;
	if (options.maxTokens !== void 0) body.max_output_tokens = options.maxTokens;
	if (options.reasoningEffort !== void 0) body.reasoning = {
		effort: options.reasoningEffort,
		summary: "auto"
	};
	return body;
}
/**
* Allocate the next block index.
* @param state - the live assembly state.
* @param kind - the block kind being opened.
* @returns the new block.
*/
function open(state, kind) {
	const block = {
		index: state.nextIndex,
		kind,
		id: "",
		name: "",
		body: ""
	};
	state.nextIndex += 1;
	return block;
}
/**
* Fold one responses usage object into harness token accounting.
* @param value - the raw `response.usage` value.
* @returns the usage, or undefined when the field is absent or not an object.
*/
function usageOf(value) {
	const usage = asObject(value);
	if (usage === void 0) return void 0;
	const cached = numberOf(asObject(usage.input_tokens_details)?.cached_tokens) ?? 0;
	const input = numberOf(usage.input_tokens) ?? 0;
	const reasoningTokens = numberOf(asObject(usage.output_tokens_details)?.reasoning_tokens);
	const total = numberOf(usage.total_tokens);
	return {
		inputTokens: Math.max(0, input - cached),
		outputTokens: numberOf(usage.output_tokens) ?? 0,
		...total !== void 0 ? { totalTokens: total } : {},
		...cached > 0 ? { cacheReadTokens: cached } : {},
		...reasoningTokens !== void 0 ? { reasoningTokens } : {}
	};
}
/**
* Fold one responses event into the assembly state.
* @param payload - one SSE data payload.
* @param state - the live assembly state.
* @returns zero or more harness chunks.
*/
function* consume$1(payload, state) {
	const event = parseJsonObject(payload);
	if (event === void 0) return;
	const type = stringOf(event.type);
	switch (type) {
		case "response.output_item.added": {
			const item = asObject(event.item) ?? {};
			if (stringOf(item.type) !== "function_call") return;
			const key = stringOf(item.id) ?? `call_${state.toolBlocks.size}`;
			const block = {
				...open(state, "tool-call"),
				id: stringOf(item.call_id) ?? key,
				name: stringOf(item.name) ?? ""
			};
			state.toolBlocks.set(key, block);
			yield {
				type: "block-start",
				index: block.index,
				blockType: "tool-call"
			};
			return;
		}
		case "response.output_item.done": {
			const item = asObject(event.item) ?? {};
			if (stringOf(item.type) !== "function_call") return;
			const key = stringOf(item.id) ?? "";
			const block = state.toolBlocks.get(key);
			const args = stringOf(item.arguments);
			if (block === void 0 || args === void 0 || args === "" || block.body !== "") return;
			block.body = args;
			yield {
				type: "tool-call-delta",
				index: block.index,
				id: brandString(block.id),
				...block.name !== "" ? { name: block.name } : {},
				argumentsDelta: args
			};
			return;
		}
		case "response.output_text.delta": {
			const text = stringOf(event.delta) ?? "";
			if (text === "") return;
			if (state.text === null) {
				state.text = open(state, "text");
				yield {
					type: "block-start",
					index: state.text.index,
					blockType: "text"
				};
			}
			state.text.body += text;
			yield {
				type: "text-delta",
				index: state.text.index,
				text
			};
			return;
		}
		case "response.reasoning_summary_text.delta":
		case "response.reasoning_text.delta": {
			const text = stringOf(event.delta) ?? "";
			if (text === "") return;
			if (state.reasoning === null) {
				state.reasoning = open(state, "reasoning");
				yield {
					type: "block-start",
					index: state.reasoning.index,
					blockType: "reasoning"
				};
			}
			state.reasoning.body += text;
			yield {
				type: "reasoning-delta",
				index: state.reasoning.index,
				text
			};
			return;
		}
		case "response.function_call_arguments.delta": {
			const block = state.toolBlocks.get(stringOf(event.item_id) ?? "");
			const delta = stringOf(event.delta) ?? "";
			if (block === void 0 || delta === "") return;
			block.body += delta;
			yield {
				type: "tool-call-delta",
				index: block.index,
				id: brandString(block.id),
				...block.name !== "" ? { name: block.name } : {},
				argumentsDelta: delta
			};
			return;
		}
		case "response.completed":
		case "response.incomplete": {
			const response = asObject(event.response) ?? {};
			const usage = usageOf(response.usage);
			if (usage !== void 0) state.usage = usage;
			if (type === "response.incomplete") state.incomplete = true;
			const status = stringOf(response.status);
			if (status !== void 0) state.status = status;
			return;
		}
		case "response.failed":
		case "error": {
			const response = asObject(event.response);
			const message = stringOf((asObject(event.error) ?? asObject(response?.error))?.message) ?? stringOf(response?.status) ?? "responses stream failed";
			throw new LlmError(`NearToken answered with a stream failure: ${message.slice(0, 500)}`, "PROVIDER_ERROR");
		}
		default: return;
	}
}
/**
* Fold one responses outcome into a harness finish reason.
*
* An incomplete response is reported as truncation even when a tool call was in
* flight: its arguments are partial, and the harness drops tool calls it cannot
* dispatch safely.
* @param state - the finished assembly state.
* @returns the finish reason.
*/
function finishOf$1(state) {
	if (state.incomplete || state.status === "incomplete") return { kind: "max-tokens" };
	if (state.toolBlocks.size > 0) return { kind: "tool-calls" };
	return { kind: "stop" };
}
/**
* Parse one streamed responses response into harness chunks.
* @param response - the streaming fetch response.
* @param signal - cancellation passthrough for the read loop.
* @returns the chunk stream.
*/
async function* parseSse$1(response, signal) {
	if (!response.ok || response.body === null) {
		const detail = await response.text().catch(() => "");
		throw new LlmError(`NearToken answered ${response.status}: ${detail.slice(0, 500)}`, "PROVIDER_ERROR");
	}
	const state = {
		text: null,
		reasoning: null,
		toolBlocks: /* @__PURE__ */ new Map(),
		nextIndex: 0,
		usage: null,
		status: null,
		incomplete: false
	};
	for await (const payload of sseData(response, signal)) yield* consume$1(payload, state);
	if (state.text !== null) yield {
		type: "block-end",
		index: state.text.index,
		block: {
			type: "text",
			text: state.text.body
		}
	};
	if (state.reasoning !== null) yield {
		type: "block-end",
		index: state.reasoning.index,
		block: {
			type: "reasoning",
			text: state.reasoning.body
		}
	};
	for (const block of state.toolBlocks.values()) yield {
		type: "block-end",
		index: block.index,
		block: {
			type: "tool-call",
			id: brandString(block.id),
			name: block.name,
			arguments: block.body
		}
	};
	if (state.usage !== null) yield {
		type: "usage",
		usage: state.usage
	};
	yield {
		type: "finish",
		reason: finishOf$1(state)
	};
}
//#endregion
//#region src/host/openai-wire.ts
/**
* Minimal OpenAI chat-completions wire for the NearToken adapter: request
* serialization from the harness message vocabulary and SSE response parsing
* into `StreamChunk`s. Prototype scope: text and tool calls round-trip
* faithfully; images and files are sent as placeholder text.
*/
/**
* Flatten one message's text blocks; non-text blocks contribute nothing here.
* @param content - the message's content blocks.
* @returns the joined plain text.
*/
function textOf(content) {
	let text = "";
	for (const block of content) if (typeof block === "object" && block !== null && block.type === "text") text += block.text;
	return text;
}
/**
* Serialize one fully-assembled request into an OpenAI chat-completions body.
* @param options - the harness request.
* @param model - the real model id the provider should route to.
* @returns the ready-to-JSON body object.
*/
function serializeRequest(options, model) {
	const messages = [];
	if (options.system !== void 0 && options.system.length > 0) messages.push({
		role: "system",
		content: options.system
	});
	for (const message of options.messages) {
		const wire = serializeMessage(message);
		if (wire !== void 0) messages.push(wire);
	}
	const body = {
		model,
		messages,
		stream: true,
		stream_options: { include_usage: true }
	};
	if (options.tools !== void 0 && options.tools.length > 0) body.tools = options.tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters
		}
	}));
	if (options.temperature !== void 0) body.temperature = options.temperature;
	if (options.maxTokens !== void 0) body.max_tokens = options.maxTokens;
	if (options.stop !== void 0 && options.stop.length > 0) body.stop = options.stop;
	if (options.reasoningEffort !== void 0) body.reasoning_effort = options.reasoningEffort;
	return body;
}
/**
* Map one harness message onto its OpenAI wire form.
* @param message - one conversation or user-input message.
* @returns the wire message, or undefined for a message with nothing to send.
*/
function serializeMessage(message) {
	const content = message.content;
	switch (message.role) {
		case "system":
		case "developer": {
			const text = textOf(content);
			return text === "" ? void 0 : {
				role: "system",
				content: text
			};
		}
		case "user": return {
			role: "user",
			content: textOf(content)
		};
		case "assistant": {
			const toolCalls = content.filter((block) => typeof block === "object" && block !== null && block.type === "tool-call").map((block) => ({
				type: "function",
				id: block.id,
				function: {
					name: block.name,
					arguments: block.arguments
				}
			}));
			const text = textOf(content);
			const wire = {
				role: "assistant",
				content: text === "" && toolCalls.length > 0 ? null : text
			};
			if (toolCalls.length > 0) wire.tool_calls = toolCalls;
			return wire;
		}
		case "tool": return {
			role: "tool",
			tool_call_id: message.toolCallId,
			content: textOf(content)
		};
		default: return;
	}
}
/**
* Fold one chat-completions chunk into the assembly state.
*
* The gateway sends `"usage": null` on every content frame and the real numbers
* only on the last one, so the field must be read as `unknown` and discarded
* when it is not an object.
* @param payload - one SSE data payload.
* @param state - the live assembly state.
* @returns zero or more stream chunks in wire order.
*/
function* consume(payload, state) {
	const chunk = parseJsonObject(payload);
	if (chunk === void 0) return;
	const usage = asObject(chunk.usage);
	if (usage !== void 0) {
		const cached = numberOf(asObject(usage.prompt_tokens_details)?.cached_tokens) ?? 0;
		const prompt = numberOf(usage.prompt_tokens) ?? 0;
		const reasoningTokens = numberOf(asObject(usage.completion_tokens_details)?.reasoning_tokens);
		const total = numberOf(usage.total_tokens);
		state.usage = {
			inputTokens: Math.max(0, prompt - cached),
			outputTokens: numberOf(usage.completion_tokens) ?? 0,
			...total !== void 0 ? { totalTokens: total } : {},
			...cached > 0 ? { cacheReadTokens: cached } : {},
			...reasoningTokens !== void 0 ? { reasoningTokens } : {}
		};
	}
	const choice = asObject(asArrayFirst(chunk.choices));
	if (choice === void 0) return;
	const delta = asObject(choice.delta) ?? {};
	const content = stringOf(delta.content);
	if (content !== void 0 && content.length > 0) {
		if (state.textIndex === null) {
			state.textIndex = 0;
			yield {
				type: "block-start",
				index: 0,
				blockType: "text"
			};
		}
		state.text += content;
		yield {
			type: "text-delta",
			index: 0,
			text: content
		};
	}
	const reasoning = stringOf(delta.reasoning_content) ?? stringOf(delta.reasoning);
	if (reasoning !== void 0 && reasoning.length > 0) {
		if (state.reasoningIndex === null) {
			state.reasoningIndex = 1;
			yield {
				type: "block-start",
				index: 1,
				blockType: "reasoning"
			};
		}
		state.reasoning += reasoning;
		yield {
			type: "reasoning-delta",
			index: 1,
			text: reasoning
		};
	}
	for (const candidate of asArray(delta.tool_calls)) {
		const call = asObject(candidate);
		if (call === void 0) continue;
		const fn = asObject(call.function);
		const slot = numberOf(call.index) ?? 0;
		let block = state.toolBlocks.get(slot);
		if (block === void 0) {
			block = {
				index: state.toolBase + slot,
				id: "",
				name: "",
				arguments: ""
			};
			state.toolBlocks.set(slot, block);
			yield {
				type: "block-start",
				index: block.index,
				blockType: "tool-call"
			};
		}
		const id = stringOf(call.id);
		if (id !== void 0 && block.id === "") block.id = id;
		const name = stringOf(fn?.name);
		if (name !== void 0 && name !== "" && block.name === "") block.name = name;
		const argument = stringOf(fn?.arguments);
		if (argument !== void 0 && argument.length > 0) {
			block.arguments += argument;
			yield {
				type: "tool-call-delta",
				index: block.index,
				id: brandString(block.id),
				...block.name !== "" ? { name: block.name } : {},
				argumentsDelta: argument
			};
		}
	}
	const finish = stringOf(choice.finish_reason);
	if (finish !== void 0 && finish.length > 0) state.finish = finish;
}
/**
* First entry of a decoded array, as an object.
* @param value - any decoded JSON value.
* @returns the first object, or undefined when there is none.
*/
function asArrayFirst(value) {
	return Array.isArray(value) ? value[0] : void 0;
}
/**
* Parse one streamed OpenAI chat-completions response into harness chunks.
* @param response - the streaming fetch response.
* @param signal - cancellation passthrough for the read loop.
* @returns the chunk stream: block-start/delta as they arrive, then
* block-end/usage/finish once the stream completes.
*/
async function* parseSse(response, signal) {
	if (!response.ok || response.body === null) {
		const detail = await response.text().catch(() => "");
		throw new LlmError(`NearToken answered ${response.status}: ${detail.slice(0, 500)}`, "PROVIDER_ERROR");
	}
	const state = {
		textIndex: null,
		text: "",
		reasoningIndex: null,
		reasoning: "",
		toolBase: 2,
		toolBlocks: /* @__PURE__ */ new Map(),
		usage: null,
		finish: null
	};
	for await (const payload of sseData(response, signal)) yield* consume(payload, state);
	if (state.textIndex !== null) yield {
		type: "block-end",
		index: state.textIndex,
		block: {
			type: "text",
			text: state.text
		}
	};
	if (state.reasoningIndex !== null) yield {
		type: "block-end",
		index: state.reasoningIndex,
		block: {
			type: "reasoning",
			text: state.reasoning
		}
	};
	for (const block of state.toolBlocks.values()) yield {
		type: "block-end",
		index: block.index,
		block: {
			type: "tool-call",
			id: brandString(block.id),
			name: block.name,
			arguments: block.arguments
		}
	};
	if (state.usage !== null) yield {
		type: "usage",
		usage: state.usage
	};
	yield {
		type: "finish",
		reason: finishOf(state.finish)
	};
}
/**
* @param reason - the provider's finish_reason, when it sent one.
* @returns the harness finish reason.
*/
function finishOf(reason) {
	switch (reason) {
		case "tool_calls": return { kind: "tool-calls" };
		case "length": return { kind: "max-tokens" };
		default: return { kind: "stop" };
	}
}
//#endregion
//#region src/host/protocol-router.ts
/**
* The group reference header, present only when the site published one.
* @param groupRef - the site's own ASCII reference for the group, if any.
* @returns the header pair, or an empty object.
*/
function groupHeader(groupRef) {
	return groupRef === void 0 ? {} : { "x-neartoken-group": groupRef };
}
const CHAT = {
	protocol: "chat",
	url: (baseURL) => `${baseURL}/v1/chat/completions`,
	headers: (key, groupRef) => ({
		authorization: `Bearer ${key}`,
		"content-type": "application/json",
		...groupHeader(groupRef)
	}),
	serialize: serializeRequest,
	parse: parseSse
};
const ANTHROPIC = {
	protocol: "anthropic",
	url: (baseURL) => `${baseURL}/v1/messages`,
	headers: (key, groupRef) => ({
		"x-api-key": key,
		authorization: `Bearer ${key}`,
		"anthropic-version": "2023-06-01",
		"content-type": "application/json",
		...groupHeader(groupRef)
	}),
	serialize: serializeRequest$3,
	parse: parseSse$3
};
/**
* Encode one model id as a URL path segment sequence.
*
* A catalog id may carry a `vendor/` prefix, which is part of the route the
* gateway matches on; percent-encoding the separators would fold the whole id
* into a single segment and miss it.
* @param model - the bare model id.
* @returns the path-safe form, separators preserved.
*/
function modelPath(model) {
	return model.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
const GENAI = {
	protocol: "genai",
	url: (baseURL, model) => `${baseURL}/v1beta/models/${modelPath(model)}:streamGenerateContent?alt=sse`,
	headers: (key, groupRef) => ({
		"x-goog-api-key": key,
		authorization: `Bearer ${key}`,
		"content-type": "application/json",
		...groupHeader(groupRef)
	}),
	serialize: serializeRequest$2,
	parse: parseSse$2
};
const RESPONSES = {
	protocol: "responses",
	url: (baseURL) => `${baseURL}/v1/responses`,
	headers: (key, groupRef) => ({
		authorization: `Bearer ${key}`,
		"content-type": "application/json",
		...groupHeader(groupRef)
	}),
	serialize: serializeRequest$1,
	parse: parseSse$1
};
/** Family prefixes that do not speak chat completions. */
const ANTHROPIC_PREFIXES = ["claude", "anthropic"];
/** Gemini's own family name and its proxied alias. */
const GENAI_PREFIXES = [
	"gemini",
	"gemma",
	"google/"
];
/** GPT answers the Responses API; the o-series reasoning models do too. */
const RESPONSES_PREFIXES = [
	"gpt",
	"chatgpt",
	"codex",
	"o1",
	"o3",
	"o4"
];
/** A vendor prefix in front of the family, as some routes publish it. */
const VENDOR_PREFIX = /^(?:[a-z0-9-]+\/)+/;
/**
* Pick the wire a bare model name speaks.
* @param model - the real model id, without its `group::` prefix.
* @returns the wire to dispatch through; chat completions when unknown.
*/
function wireFor(model) {
	const name = model.trim().toLowerCase().replace(VENDOR_PREFIX, "");
	if (ANTHROPIC_PREFIXES.some((prefix) => name.startsWith(prefix))) return ANTHROPIC;
	if (GENAI_PREFIXES.some((prefix) => name.startsWith(prefix))) return GENAI;
	if (RESPONSES_PREFIXES.some((prefix) => name.startsWith(prefix))) return RESPONSES;
	return CHAT;
}
//#endregion
//#region src/host/whitelist.ts
/** Longest model name a save may carry, in characters. */
const MAX_MODEL_NAME = 200;
/** Most model names one save may carry. */
const MAX_MODELS = 2e3;
/** The ratio caption the catalog stores in a route's description (`分组倍率 0.4x`). */
const RATIO_PATTERN = /([0-9]+(?:\.[0-9]+)?)x/;
/**
* Keep only the routes whose model the user left visible.
* @param routes - the full catalog.
* @param enabled - the stored whitelist; empty keeps every route.
* @returns the routes the provider advertises.
*/
function selectedRoutes(routes, enabled) {
	if (enabled.length === 0) return routes;
	const allowed = new Set(enabled);
	return routes.filter((route) => allowed.has(route.model));
}
/**
* Fold the catalog's per-group routes into one entry per model.
* @param routes - the full catalog, in endpoint order.
* @returns one entry per model name, in first-seen order.
*/
function summarizeModels(routes) {
	const byModel = /* @__PURE__ */ new Map();
	for (const route of routes) {
		const ratio = RATIO_PATTERN.exec(route.description)?.[1];
		const groups = byModel.get(route.model);
		const entry = ratio === void 0 ? { group: route.group } : {
			group: route.group,
			ratio: `${ratio}x`
		};
		if (groups === void 0) byModel.set(route.model, [entry]);
		else groups.push(entry);
	}
	return [...byModel].map(([model, groups]) => {
		const cheapest = groups.reduce((low, group) => {
			if (group.ratio === void 0) return low;
			const value = Number.parseFloat(group.ratio);
			if (!Number.isFinite(value)) return low;
			return low === void 0 || value < low ? value : low;
		}, void 0);
		return cheapest === void 0 ? {
			model,
			groups
		} : {
			model,
			groups,
			minRatio: cheapest
		};
	});
}
/**
* Validate one `POST /neartoken/models` body's model list.
* @param value - the raw `enabled` member.
* @returns the trimmed, de-duplicated names in order, or undefined when the
* value is not a list of short non-empty strings.
*/
function parseEnabled(value) {
	if (!Array.isArray(value) || value.length > MAX_MODELS) return void 0;
	const names = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of value) {
		if (typeof entry !== "string") return void 0;
		const name = entry.trim();
		if (name.length === 0 || name.length > MAX_MODEL_NAME) return void 0;
		if (seen.has(name)) continue;
		seen.add(name);
		names.push(name);
	}
	return names;
}
/** The whitelist's read and write faces, mounted on the settings routes. */
var NearTokenWhitelist = class {
	deps;
	/**
	* @param deps - the stored list, the catalog, and the profile entry a save writes.
	*/
	constructor(deps) {
		this.deps = deps;
	}
	/**
	* Read the catalog and the stored whitelist together.
	* @returns every model the site offers, plus the list the user kept.
	*/
	async state() {
		return {
			models: summarizeModels(await this.deps.routes()),
			enabled: [...this.deps.enabled()]
		};
	}
	/**
	* Persist one whitelist.
	* @param enabled - model names to keep visible; empty restores every model.
	* @returns resolution after the profile write and its live application.
	* @throws {Error} when the composition has no settings service, so nothing
	* could persist the list.
	*/
	async save(enabled) {
		const settings = this.deps.settings();
		if (settings === void 0) throw new Error("neartoken: the model whitelist needs the settings service");
		await settings.update(this.deps.entryId, { enabledModels: [...enabled] });
	}
};
//#endregion
//#region src/host/adapter.ts
/**
* The NearToken LLM adapter: one provider route over a New API deployment,
* whose model catalog is the (group, model) expansion of the pricing endpoint.
*
* Catalog model ids are `"<group>::<model>"`; the adapter decodes them at
* dispatch and sends the bare model name in the request body.
*
* The group itself travels in the `x-neartoken-group` request header as the
* site's own ASCII reference (`"#7"`), never as the group name: a name is
* display text, and its non-latin1 characters are not a legal HTTP header
* value. A group the site published no reference for sends no header at all
* and routes by the token's own group (see HANDOFF).
*
* The wire is chosen per model (see `protocol-router.ts`): Claude goes to the
* messages API, Gemini to generateContent, GPT to the Responses API, and the
* rest of the catalog stays on chat completions.
*/
/** Display name of the single provider route this adapter owns. */
const NEARTOKEN_PROVIDER_NAME = "NearToken";
/**
* The configured or catalogued modalities as the harness vocabulary.
* @param model - the bare model name.
* @param declared - the operator's configured modalities for this model, if any.
* @returns only the modalities this harness version understands.
*/
function modalitiesOf(model, declared) {
	return inputModalitiesOf(model, declared).filter((modality) => modality === "text" || modality === "image");
}
/**
* The reasoning offering for one model, or nothing.
*
* Configured levels win; otherwise they come from the catalog's own table. A
* model neither source describes is advertised without any, rather than with
* levels it may not have.
* @param model - the bare model name the route serves.
* @param declared - the operator's configured levels for this model, if any.
* @returns the reasoning metadata, or undefined for a model without levels.
*/
function reasoningOf(model, declared) {
	const levels = reasoningLevels(model, declared);
	if (levels === void 0) return void 0;
	return {
		efforts: levels.map((level) => ({
			id: brandString(level),
			name: reasoningLevelLabel(level)
		})),
		defaultEffort: brandString(defaultReasoningLevel(levels))
	};
}
/**
* Decode one catalog model id into its routing parts.
* @param id - a catalog id ("`[低价] Grok::grok-4.6`") or a bare model name.
* @returns the group (when the id carries one) and the real model name.
*/
function decodeRoute(id) {
	const at = id.lastIndexOf("::");
	if (at <= 0) return { model: id };
	return {
		group: id.slice(0, at),
		model: id.slice(at + 2)
	};
}
/** The NearToken provider adapter. */
var NearTokenAdapter = class extends LlmAdapter {
	deps;
	/**
	* @param deps - routing, credential, and endpoint facts from the host entry.
	*/
	constructor(deps) {
		super();
		this.deps = deps;
	}
	/**
	* @param provider - the route this adapter registered (`neartoken`).
	* @returns detached display metadata.
	*/
	providerInfo(provider) {
		return {
			id: provider,
			name: NEARTOKEN_PROVIDER_NAME
		};
	}
	/**
	* Advertise the visible (group, model) routes as the provider catalog.
	* @param provider - the route this adapter registered.
	* @returns one model entry per group offering, in endpoint order.
	*/
	async listModels(provider) {
		return selectedRoutes(await this.deps.routes(), this.deps.enabled()).map((route) => ({
			provider,
			id: route.id,
			name: route.name,
			description: route.description,
			inputModalities: modalitiesOf(route.model, this.deps.modelOverride(route.model)?.input)
		}));
	}
	/**
	* Resolve one exact route's metadata from the same generation as dispatch.
	* @param provider - the route this adapter registered.
	* @param model - the catalog id passed to `GenerateOptions.model`.
	* @returns route identity plus the model's capacity and reasoning levels.
	*/
	async resolveModel(provider, model) {
		const route = selectedRoutes(await this.deps.routes(), this.deps.enabled()).find((entry) => entry.id === model);
		const bare = route?.model ?? decodeRoute(model).model;
		const override = this.deps.modelOverride(bare);
		const reasoning = reasoningOf(bare, override?.reasoning);
		const contextWindow = contextWindowOf(bare, {
			...override?.contextWindow === void 0 ? {} : { override: override.contextWindow },
			...route?.contextWindow === void 0 ? {} : { reported: route.contextWindow },
			fallback: this.deps.defaultContextWindow()
		});
		const maxTokens = maxTokensOf(route?.maxTokens, override?.maxTokens);
		const facts = {
			context: { contextWindow },
			inputModalities: modalitiesOf(bare, override?.input),
			...maxTokens === void 0 ? {} : { defaultMaxTokens: maxTokens },
			...reasoning === void 0 ? {} : { reasoning }
		};
		if (route === void 0) return {
			provider,
			id: model,
			name: model,
			...facts
		};
		return {
			provider,
			id: route.id,
			name: route.name,
			description: route.description,
			...facts
		};
	}
	/**
	* Stream one model call through the wire its model speaks: Claude's messages
	* API, Gemini's generateContent, the Responses API for GPT, and chat
	* completions for everything else.
	* @param options - the fully-assembled request; the abort signal is honored.
	* @returns the parsed chunk stream.
	*/
	async *stream(options) {
		const key = await this.deps.apiKey();
		const { model } = decodeRoute(options.model);
		const groupRef = (await this.deps.routes()).find((entry) => entry.id === options.model)?.groupRef;
		const wire = wireFor(model);
		const response = await fetch(wire.url(this.deps.baseURL(), model), {
			method: "POST",
			headers: {
				...attributionHeaders(),
				...wire.headers(key, groupRef)
			},
			body: JSON.stringify(wire.serialize(options, model)),
			signal: options.signal
		});
		yield* wire.parse(response, options.signal);
	}
};
//#endregion
//#region src/host/pricing.ts
/**
* The NearToken pricing directory: one shared load of the New API
* `/api/pricing` endpoint, expanded into per-(group, model) catalog routes.
*
* The endpoint is public (no key) and answers everything the catalog dimension
* needs: the model list, each model's `enable_groups`, the `group_ratio`
* multiplier table, the `group_refs` routing references, the declared
* `supported_endpoint_types`, and — on a deployment that maintains them — the
* `context_window` / `max_tokens` capacities. Group names carry their own badge
* prefix convention (`[低价][反重力] Claude`), which the browser half parses for
* display; here they stay opaque strings.
*
* @module
*/
/**
* The reference grammar the dispatch header accepts: `#` and the site's own
* numeric id. A value outside it is not a reference, and sending a group NAME
* in the header is what the site's HTTP layer rejects.
*/
const GROUP_REF_PATTERN = /^#[0-9]+$/;
/**
* Read a positive token count from an endpoint field.
* @param value - the raw JSON member.
* @returns the count, or undefined when the field is absent or not a positive integer.
*/
function tokenCount(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : void 0;
}
/**
* Read one model's declared endpoint types.
* @param value - the raw `supported_endpoint_types` member.
* @returns the declared names, or undefined when the site declared none.
*/
function endpointTypes(value) {
	if (!Array.isArray(value)) return void 0;
	const names = value.filter((entry) => typeof entry === "string" && entry.length > 0);
	return names.length === 0 ? void 0 : names;
}
/**
* Expand one pricing payload into one route per (group, model) pair.
* @param pricing - the loaded endpoint payload.
* @returns routes in endpoint order, group order preserved per model.
*/
function expandRoutes(pricing) {
	const routes = [];
	for (const model of pricing.models) for (const group of model.enable_groups) {
		const ratio = pricing.groupRatio[group];
		const groupRef = pricing.groupRefs[group];
		routes.push({
			id: `${group}::${model.model_name}`,
			name: `${model.model_name} @ ${group}`,
			description: ratio === void 0 ? "分组倍率 1x" : `分组倍率 ${ratio}x`,
			group,
			...groupRef === void 0 ? {} : { groupRef },
			model: model.model_name,
			...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
			...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
			...model.endpoints === void 0 ? {} : { endpoints: model.endpoints }
		});
	}
	return routes;
}
/**
* Parse the endpoint's JSON into the consumed shape; unknown extra fields are
* ignored so the New API side can evolve.
* @param value - the parsed JSON body.
* @returns the normalized payload.
*/
function parsePricing(value) {
	if (typeof value !== "object" || value === null) throw new Error("neartoken: pricing payload is not an object");
	const record = value;
	const models = [];
	for (const entry of Array.isArray(record.data) ? record.data : []) {
		if (typeof entry !== "object" || entry === null) continue;
		const row = entry;
		const name = row.model_name;
		const groups = row.enable_groups;
		if (typeof name !== "string" || !Array.isArray(groups)) continue;
		const contextWindow = tokenCount(row.context_window);
		const maxTokens = tokenCount(row.max_tokens);
		const endpoints = endpointTypes(row.supported_endpoint_types);
		models.push({
			model_name: name,
			enable_groups: groups.filter((group) => typeof group === "string"),
			...contextWindow === void 0 ? {} : { contextWindow },
			...maxTokens === void 0 ? {} : { maxTokens },
			...endpoints === void 0 ? {} : { endpoints }
		});
	}
	const ratio = {};
	if (typeof record.group_ratio === "object" && record.group_ratio !== null) {
		for (const [group, value] of Object.entries(record.group_ratio)) if (typeof value === "number" && Number.isFinite(value)) ratio[group] = value;
	}
	const description = {};
	if (typeof record.usable_group === "object" && record.usable_group !== null) {
		for (const [group, value] of Object.entries(record.usable_group)) if (typeof value === "string" && value.length > 0) description[group] = value;
	}
	const refs = {};
	if (typeof record.group_refs === "object" && record.group_refs !== null) {
		for (const [group, value] of Object.entries(record.group_refs)) if (typeof value === "string" && GROUP_REF_PATTERN.test(value)) refs[group] = value;
	}
	return {
		models,
		groupRatio: ratio,
		groupDescription: description,
		groupRefs: refs
	};
}
/** Loads and caches the pricing payload for one adapter instance. */
var PricingDirectory = class {
	ctx;
	baseURL;
	ttlMs;
	cache;
	inflight;
	/**
	* @param ctx - the owning plugin context (logging only).
	* @param baseURL - the site root, e.g. `https://llm.pko.svcfusion.com`.
	* @param ttlMs - how long one load stays fresh.
	*/
	constructor(ctx, baseURL, ttlMs) {
		this.ctx = ctx;
		this.baseURL = baseURL;
		this.ttlMs = ttlMs;
	}
	/**
	* Return the expanded routes, reloading when the cache is older than the TTL.
	* @param force - bypass the TTL and reload now.
	* @returns one route per (group, model); empty when the endpoint is unreachable.
	*/
	load(force = false) {
		const fresh = this.cache !== void 0 && Date.now() - this.cache.at < this.ttlMs();
		if (!force && fresh && this.cache !== void 0) return Promise.resolve(this.cache.routes);
		if (this.inflight !== void 0) return this.inflight;
		const operation = fetch(`${this.baseURL()}/api/pricing`, { headers: { accept: "application/json" } }).then(async (response) => {
			if (!response.ok) throw new Error(`pricing endpoint answered ${response.status}`);
			return expandRoutes(parsePricing(await response.json())).filter((route) => isChatOffering(route.model, route.endpoints));
		}).then((routes) => {
			this.cache = {
				at: Date.now(),
				routes
			};
			return routes;
		}).catch((error) => {
			this.ctx.logger.warn("neartoken: pricing load failed", error);
			return this.cache?.routes ?? [];
		}).finally(() => {
			this.inflight = void 0;
		});
		this.inflight = operation;
		return operation;
	}
};
//#endregion
//#region src/host/provider-mount.ts
/** The NearToken provider route, mounted at most once per process. */
var NearTokenProvider = class {
	ctx;
	deps;
	pricing;
	routes;
	directory;
	/**
	* @param ctx - the owning plugin context carrying `llm`.
	* @param deps - the route name, site root, and credential lookup.
	*/
	constructor(ctx, deps) {
		this.ctx = ctx;
		this.deps = deps;
		this.pricing = new PricingDirectory(ctx, deps.baseURL, deps.catalogTtlMs);
	}
	/** Whether the route is currently registered. */
	get mounted() {
		return this.routes !== void 0;
	}
	/**
	* Read the catalog the adapter advertises from, whitelist included.
	* @returns one route per (group, model), straight from the shared load.
	*/
	async catalog() {
		return await this.pricing.load();
	}
	/**
	* Register the adapter and its configurable-provider entry.
	* @returns after the route serves requests; a no-op when already mounted.
	*/
	mount() {
		if (this.routes !== void 0) return;
		const adapter = new NearTokenAdapter({
			routes: () => this.pricing.load(),
			enabled: this.deps.enabled,
			apiKey: this.deps.apiKey,
			baseURL: this.deps.baseURL,
			defaultContextWindow: this.deps.defaultContextWindow,
			modelOverride: this.deps.modelOverride
		});
		this.routes = this.ctx.llm.registerAdapter([this.deps.provider], adapter);
		this.directory = this.ctx.llm.registerConfigurableProviders([{
			provider: this.deps.provider,
			displayName: this.deps.displayName,
			settingsNs: this.deps.settingsNs,
			settingsPath: [],
			defaultBaseURL: this.deps.baseURL()
		}]);
	}
	/**
	* Announce the route again without dropping it.
	*
	* The catalog the adapter serves changed (the model whitelist), and a client
	* only refetches its model list after `llm/adapters-updated`. Re-declaring
	* the same route publishes that event in one synchronous section, so no
	* caller ever observes a provider that is missing — unlike unmount/mount,
	* which would leave a gap and make the picker flash.
	* @returns after the event was published; a no-op when not mounted.
	*/
	refresh() {
		if (this.routes === void 0) return;
		this.routes.replace([this.deps.provider]);
	}
	/**
	* Release the route, and with it every model it advertised.
	* @returns after the route is gone; a no-op when not mounted.
	*/
	unmount() {
		this.directory?.();
		this.routes?.();
		this.directory = void 0;
		this.routes = void 0;
	}
};
//#endregion
//#region src/protocol.ts
/**
* The wire vocabulary shared by the Host routes and the browser section: four
* route paths and the JSON each answers. Both build faces import this file, so
* a route rename cannot leave the browser calling a path the Host stopped
* serving.
*
* Nothing here carries a password: the plugin never collects site credentials.
* A connection is authorized by the site's own device-authorization flow, in
* the user's browser — the Host only polls its result.
*
* @module
*/
/** State read by the settings page before it draws, and while it waits. */
const STATUS_PATH = "/neartoken/status";
/** Start a device authorization (the Host then polls the site). */
const AUTHORIZE_PATH = "/neartoken/authorize";
/** Abandon the authorization in progress. */
const CANCEL_PATH = "/neartoken/cancel";
/** Forget the stored key and revoke it on the site. */
const LOGOUT_PATH = "/neartoken/logout";
/** Read the catalog beside the stored whitelist; POST a new whitelist. */
const MODELS_PATH = "/neartoken/models";
//#endregion
//#region src/host/routes.ts
/** Bodies here are at most one short object; anything larger is hostile. */
const MAX_BODY_BYTES = 8192;
/** A whitelist body names up to a few thousand models, so it gets its own bound. */
const MAX_WHITELIST_BODY_BYTES = 65536;
/**
* @param ctx - a context that carries `webServer`.
* @param deps - the account and the disconnect callback.
*/
function registerNearTokenRoutes(ctx, deps) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: STATUS_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method !== "GET") {
				sendMethodNotAllowed(res, "GET");
				return;
			}
			sendJson(res, 200, await deps.account.status());
		}
	}), `neartoken: GET ${STATUS_PATH}`);
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: AUTHORIZE_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			sendJson(res, 200, await deps.account.begin());
		}
	}), `neartoken: POST ${AUTHORIZE_PATH}`);
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: CANCEL_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			await deps.account.cancel();
			sendJson(res, 200, { ok: true });
		}
	}), `neartoken: POST ${CANCEL_PATH}`);
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: LOGOUT_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			await deps.account.signOut();
			deps.onDisconnect();
			sendJson(res, 200, { ok: true });
		}
	}), `neartoken: POST ${LOGOUT_PATH}`);
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: MODELS_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method === "GET") {
				sendJson(res, 200, await deps.models());
				return;
			}
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "GET, POST");
				return;
			}
			const body = await readJsonObject(req, res, MAX_WHITELIST_BODY_BYTES);
			if (body === void 0) return;
			const enabled = parseEnabled(body.enabled);
			if (enabled === void 0) {
				sendJson(res, 400, {
					code: "bad-request",
					message: "enabled 必须是模型名数组"
				});
				return;
			}
			try {
				await deps.saveModels(enabled);
			} catch (error) {
				sendJson(res, 500, {
					code: "save-failed",
					message: error instanceof Error ? error.message : String(error)
				});
				return;
			}
			sendJson(res, 200, { ok: true });
		}
	}), `neartoken: ${MODELS_PATH}`);
}
/**
* Answer an untrusted or unauthenticated request.
* @param ctx - the plugin context, which may carry `connection`.
* @param req - the request under test.
* @param res - the response to refuse on.
* @returns true when the request was refused and the response is complete.
*/
function rejected(ctx, req, res) {
	const rejection = ctx.get("connection")?.requestRejection(req);
	if (rejection === void 0) return false;
	res.statusCode = rejection;
	res.end();
	return true;
}
/** JSON response (no-store: every answer here is a live fact). */
function sendJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(payload));
}
/** 405 with the route's supported methods. */
function sendMethodNotAllowed(res, allow) {
	res.statusCode = 405;
	res.setHeader("allow", allow);
	res.end();
}
/**
* Collect a bounded JSON object request body.
* @param req - the request to read.
* @param res - the response to answer on when the body is unusable.
* @param limit - largest accepted body, in bytes.
* @returns the parsed object, or undefined once a refusal was sent.
*/
async function readJsonObject(req, res, limit = MAX_BODY_BYTES) {
	if (text(String(req.headers["content-type"]).split(";", 1)[0]?.trim().toLowerCase()) !== "application/json") {
		sendJson(res, 415, {
			code: "unsupported-media-type",
			message: "content-type 必须是 application/json"
		});
		return;
	}
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.byteLength;
		if (size > limit) {
			req.resume();
			sendJson(res, 413, {
				code: "payload-too-large",
				message: "请求体过大"
			});
			return;
		}
		chunks.push(chunk);
	}
	let parsed;
	try {
		parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch (_error) {
		sendJson(res, 400, {
			code: "bad-request",
			message: "请求体不是合法 JSON"
		});
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		sendJson(res, 400, {
			code: "bad-request",
			message: "请求体必须是 JSON 对象"
		});
		return;
	}
	return parsed;
}
/** One non-empty string member, or undefined. */
function text(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
//#endregion
//#region src/index.ts
/**
* Host loader entry for the NearToken provider plugin: a sign-in surface for one
* New API deployment, the provider route that sign-in inserts, and the browser
* half (src/client) that renders both the settings page and the grouped model
* seat.
*
* The route is inserted only while an API key is stored — see
* {@link NearTokenProvider} — so a fresh install shows no NearToken models until
* the user signs in from the settings page.
*/
/** The single provider route this plugin owns. */
const PROVIDER = "neartoken";
/** Display name of that route wherever the application lists it. */
const DISPLAY_NAME = "NearToken";
/** Settings namespace the configurable-provider entry reports. */
const SETTINGS_NS = "ui-neartoken-provider";
/**
* The context window every model reports until something better answers.
*
* A harness model without one loses automatic compaction outright, so this
* cannot be optional. 200K is the smallest capacity among the chat models the
* site typically offers: guessing low costs an early summary, guessing high
* costs a rejected request.
*/
const DEFAULT_CONTEXT_WINDOW = 2e5;
/** One operator-stated fact about one bare model name. */
const modelOverride = z.object({
	/** Context capacity in tokens. */
	contextWindow: z.number().step(1).min(1),
	/** Output ceiling in tokens; the only source that puts `max_tokens` on the wire. */
	maxTokens: z.number().step(1).min(1),
	/** Selectable reasoning levels, for a model no catalog entry describes. */
	reasoning: z.array(z.string()),
	/** Input modalities (`text` / `image`); without `image` the harness refuses image requests. */
	input: z.array(z.string())
});
/** Configuration surface; prototype keeps every knob optional. */
const Config = z.object({
	/** Site root without a trailing slash. */
	baseURL: z.string().default("https://llm.pko.svcfusion.com"),
	/** Credential reference the sign-in writes and the adapter resolves. */
	apiKeyEnv: z.string().default("NEARTOKEN_API_KEY"),
	/** How long one pricing load stays fresh, in milliseconds. */
	catalogTtlMs: z.number().default(3e5),
	/**
	* The capacity every model reports when neither the site nor the generated
	* catalog answers. Set it below the smallest model the site offers.
	*/
	defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
	/**
	* Per-model corrections, keyed by bare model name: the way to fix a capacity
	* or teach a brand-new model its reasoning levels without publishing a new
	* plugin version. Anything here wins over both the site and the catalog.
	*/
	modelOverrides: z.dict(modelOverride).default({}),
	/**
	* The model whitelist: the catalog models the settings page keeps visible.
	* Empty means no whitelist, so every model the site offers is advertised.
	* Volatile, so the page's save reaches the running plugin through Settings
	* without remounting it.
	*/
	enabledModels: z.array(z.string()).default([]).volatile()
});
/** Required services: the LLM registry the adapter mounts into. */
const inject = ["llm"];
/**
* Register the account, the provider route, and the settings-page routes.
* @param ctx - host context.
* @param config - resolved plugin configuration.
*/
function apply(ctx, config) {
	if (!isCredentialRefName(config.apiKeyEnv)) throw new LlmError(`neartoken: apiKeyEnv "${config.apiKeyEnv}" is not a credential reference name`, "CONFIG_REFERENCE_INVALID");
	const resolveApiKey = async () => {
		const credentials = ctx.get("credentials");
		const value = (credentials === void 0 ? void 0 : await credentials.resolve(credentialRef(config.apiKeyEnv)))?.value ?? process.env[config.apiKeyEnv];
		if (typeof value !== "string" || value.length === 0) throw new LlmError(`neartoken: no API key for provider route "${PROVIDER}"; connect NearToken on the settings page (it stores ${config.apiKeyEnv} through the credentials service), or export that variable in the launching environment`, "MISSING_CREDENTIAL");
		return value;
	};
	const provider = new NearTokenProvider(ctx, {
		provider: PROVIDER,
		displayName: DISPLAY_NAME,
		settingsNs: SETTINGS_NS,
		baseURL: () => config.baseURL,
		apiKey: resolveApiKey,
		enabled: () => config.enabledModels.get(),
		catalogTtlMs: () => config.catalogTtlMs,
		defaultContextWindow: () => config.defaultContextWindow,
		modelOverride: (model) => config.modelOverrides[model]
	});
	const whitelist = new NearTokenWhitelist({
		enabled: () => config.enabledModels.get(),
		routes: () => provider.catalog(),
		entryId: SETTINGS_NS,
		settings: () => ctx.get("settings")
	});
	const account = new NearTokenAccount(ctx, {
		baseURL: () => config.baseURL,
		apiKeyRef: () => config.apiKeyEnv
	}, () => {
		provider.mount();
	});
	const sync = () => {
		account.configured().then((configured) => {
			if (configured) provider.mount();
			else provider.unmount();
		}, (error) => {
			ctx.logger.warn("neartoken: could not read the stored API key", error);
		});
	};
	sync();
	ctx.inject(["credentials"], () => {
		sync();
	});
	ctx.inject(["webServer"], (webCtx) => {
		registerNearTokenRoutes(webCtx, {
			account,
			onDisconnect: () => {
				provider.unmount();
			},
			models: () => whitelist.state(),
			saveModels: async (enabled) => {
				await whitelist.save(enabled);
				provider.refresh();
			}
		});
	});
	ctx.inject(["settings"], () => {
		const settings = ctx.get("settings");
		if (settings === void 0) return;
		ctx.effect(() => settings.configure({ auto: false }, ctx.fiber));
	});
}
//#endregion
export { Config, apply, inject };
