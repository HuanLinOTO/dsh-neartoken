import z from "@deepseek-ai/schemastery";
import { credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import { HarnessError, LlmAdapter, LlmError, ProviderRequestId, attributionHeaders, errorChain, isContextWindowExceededError, isQuotaExceededError } from "@deepseek-ai/dsh-llm";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { brandString } from "@deepseek-ai/dsh-brand";
import { spawn } from "node:child_process";
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
//#region src/protocol.ts
/**
* The wire vocabulary shared by the Host routes and the browser section: the
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
/**
* Re-read the wallet right now, then answer with the same state `STATUS_PATH`
* reads. The Host already refreshes on its own cadence; this is the page asking
* for that read early, and the answer carries the fresh numbers.
*/
const REFRESH_PATH = "/neartoken/refresh";
/** Start a device authorization (the Host then polls the site). */
const AUTHORIZE_PATH = "/neartoken/authorize";
/** Abandon the authorization in progress. */
const CANCEL_PATH = "/neartoken/cancel";
/**
* Ask the Host to open the pending confirmation page in the user's own browser.
* The request carries no address: the Host opens the one it is waiting on.
*/
const OPEN_PATH = "/neartoken/open";
/** Forget the stored key and revoke it on the site. */
const LOGOUT_PATH = "/neartoken/logout";
/** Read the catalog beside the stored whitelist; POST a new whitelist. */
const MODELS_PATH = "/neartoken/models";
/** Read the picture models and the image-generation setting; POST one change to it. */
const IMAGES_PATH = "/neartoken/images";
/** Read the site's top-up offer; POST one order and open its checkout page. */
const TOPUP_PATH$1 = "/neartoken/topup";
//#endregion
//#region src/host/topup.ts
/** The site's top-up info endpoint. */
const TOPUP_INFO_PATH = "/api/dsh/device/topup/info";
/** The site's order endpoint. */
const TOPUP_PATH = "/api/dsh/device/topup";
/** A refused top-up request, tagged with the reason the page renders. */
var NearTokenTopupError = class extends Error {
	/** What the page should offer instead of a payment button. */
	reason;
	/** What the site said, when it said anything. */
	siteMessage;
	/**
	* @param reason - which failure this is.
	* @param siteMessage - the site's own wording, when it sent one.
	*/
	constructor(reason, siteMessage) {
		super(siteMessage === void 0 ? reason : siteMessage);
		this.name = "NearTokenTopupError";
		this.reason = reason;
		this.siteMessage = siteMessage;
	}
};
/**
* Read the `GET /api/dsh/device/topup/info` answer.
* @param body - the parsed JSON envelope.
* @returns the offer, or undefined when the site refused.
*/
function parseTopupInfo(body) {
	if (body.success !== true) return void 0;
	const data = asObject$1(body.data);
	if (data === void 0) return void 0;
	const methods = [];
	if (Array.isArray(data.pay_methods)) for (const entry of data.pay_methods) {
		const method = asObject$1(entry);
		const type = typeof method?.type === "string" ? method.type : void 0;
		const name = typeof method?.name === "string" ? method.name : void 0;
		if (type !== void 0 && name !== void 0) methods.push({
			type,
			name
		});
	}
	const options = [];
	if (Array.isArray(data.amount_options)) {
		for (const option of data.amount_options) if (typeof option === "number") options.push(option);
	}
	return {
		enabled: data.enable_online_topup === true,
		minTopup: typeof data.min_topup === "number" ? data.min_topup : 0,
		amountOptions: options,
		methods
	};
}
/**
* Read one order answer.
* @param body - the parsed JSON envelope.
* @returns the order number and the site-relative checkout link.
*/
function parseTopupOrder(body) {
	if (body.success !== true) return void 0;
	const data = asObject$1(body.data);
	const tradeNo = typeof data?.trade_no === "string" ? data.trade_no : void 0;
	const payUrl = typeof data?.pay_url === "string" ? data.pay_url : void 0;
	if (tradeNo === void 0 || payUrl === void 0) return void 0;
	return {
		tradeNo,
		payUrl
	};
}
/**
* Turn a refused envelope into the error the page renders.
* @param body - the parsed JSON envelope that carried success: false.
* @returns the tagged refusal.
*/
function refusal(body) {
	const code = typeof body.code === "string" ? body.code : "";
	const message = typeof body.message === "string" ? body.message : void 0;
	if (code === "DSH_TOKEN_REQUIRED") return new NearTokenTopupError("not-dsh", message);
	if (body.success === void 0) return new NearTokenTopupError("unavailable", message);
	return new NearTokenTopupError("refused", message);
}
/**
* Ask the site what it offers.
* @param baseURL - site root without a trailing slash.
* @param key - the stored relay key.
* @returns the offer.
* @throws {NearTokenTopupError} when the site refused or could not be reached.
*/
async function nearTokenTopupInfo(baseURL, key) {
	let body;
	try {
		body = await callNewApiBody({
			baseURL,
			sessionToken: key,
			path: TOPUP_INFO_PATH,
			method: "GET"
		});
	} catch (error) {
		throw new NearTokenTopupError("unreachable", error instanceof NewApiError ? error.message : void 0);
	}
	const info = parseTopupInfo(body);
	if (info === void 0) throw refusal(body);
	return info;
}
/**
* Start one order.
* @param baseURL - site root without a trailing slash.
* @param key - the stored relay key.
* @param amount - the amount the user picked.
* @param paymentMethod - one method type from {@link NearTokenTopupInfo}.
* @returns the order number and the site-relative checkout link.
* @throws {NearTokenTopupError} when the site refused or could not be reached.
*/
async function nearTokenCreateTopup(baseURL, key, amount, paymentMethod) {
	let body;
	try {
		body = await callNewApiBody({
			baseURL,
			sessionToken: key,
			path: TOPUP_PATH,
			method: "POST",
			body: {
				amount,
				payment_method: paymentMethod
			}
		});
	} catch (error) {
		throw new NearTokenTopupError("unreachable", error instanceof NewApiError ? error.message : void 0);
	}
	const order = parseTopupOrder(body);
	if (order === void 0) throw refusal(body);
	return order;
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
/**
* How often the wallet facts are re-read while a key is stored. Five minutes
* matches how stale the card's money numbers may look on an open settings page.
*/
const WALLET_REFRESH_MS = 3e5;
/** The live wallet read: quota, spent quota, and the per-group vouchers. */
const DEVICE_WALLET_PATH = "/api/dsh/device/wallet";
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
	const summary = {
		username,
		displayName,
		group,
		balance,
		used
	};
	const vouchers = asVouchers(record.vouchers);
	return vouchers === void 0 ? summary : {
		...summary,
		vouchers
	};
}
/**
* Read stored vouchers back, dropping every entry that is not one.
* @param value - the snapshot's `vouchers` member.
* @returns the vouchers, or undefined when the snapshot carries none (a grant
* wrote it, or an older plugin version did).
*/
function asVouchers(value) {
	if (!Array.isArray(value)) return void 0;
	const vouchers = [];
	for (const item of value) {
		const credit = asObject$1(item);
		const group = text$1(credit?.group);
		const amount = text$1(credit?.amount);
		if (group === void 0 || amount === void 0) continue;
		vouchers.push({
			group,
			groupId: num(credit?.groupId) ?? 0,
			amount
		});
	}
	return vouchers;
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
	/** The last snapshot write, so two of them never race on one file. */
	summaryWrite = Promise.resolve();
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
	* Read the site's top-up offer with the stored key.
	*
	* The site answers this only for a key its own device-authorization flow
	* minted, so a key pasted in from elsewhere is a reason the page can act on
	* rather than a bug.
	* @returns the amount ladder, the floor and the enabled gateway methods.
	* @throws {NearTokenTopupError} when the key is missing, refused, or the site is unreachable.
	*/
	async topupInfo() {
		const key = await this.read(this.site.apiKeyRef());
		if (key === void 0) throw new NearTokenTopupError("not-dsh");
		return await nearTokenTopupInfo(this.site.baseURL(), key);
	}
	/**
	* Start one top-up order.
	* @param amount - the amount the user picked, in the site's display currency.
	* @param paymentMethod - one gateway type from {@link topupInfo}.
	* @returns the order number and the site-relative checkout link.
	* @throws {NearTokenTopupError} when the key is missing, refused, or the site is unreachable.
	*/
	async createTopup(amount, paymentMethod) {
		const key = await this.read(this.site.apiKeyRef());
		if (key === void 0) throw new NearTokenTopupError("not-dsh");
		return await nearTokenCreateTopup(this.site.baseURL(), key, amount, paymentMethod);
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
	* Keep the card's money facts live: while a key is stored, re-read the site's
	* wallet endpoint on a fixed cadence, starting immediately.
	*
	* The grant that minted the key carried the account facts exactly once, and
	* wallet balances move with every billed request and every rebate — without
	* this the card would freeze at the moment of authorization forever.
	* @param intervalMs - cadence of one wallet read.
	*/
	startWalletRefresh(intervalMs = WALLET_REFRESH_MS) {
		this.ctx.effect(() => {
			const timer = setInterval(() => {
				this.refreshWallet();
			}, intervalMs);
			return () => {
				clearInterval(timer);
			};
		}, "neartoken: wallet refresh");
		this.refreshWallet();
	}
	/**
	* Read the wallet once: balance, spent quota, and every per-group voucher,
	* formatted in the site's own display currency.
	*
	* A site that does not serve the endpoint yet (or one that cannot be reached)
	* keeps the last known facts: a refresh must never cost the card its numbers.
	* @returns after the read settles, either way.
	*/
	async refreshWallet() {
		const key = await this.read(this.site.apiKeyRef());
		if (key === void 0) return;
		let body;
		try {
			body = await callNewApiBody({
				baseURL: this.site.baseURL(),
				path: DEVICE_WALLET_PATH,
				method: "GET",
				sessionToken: key
			});
		} catch (_error) {
			return;
		}
		if (body.success !== true) return;
		const data = asObject$1(body.data);
		const quota = num(data?.quota);
		const used = num(data?.used_quota);
		const credits = Array.isArray(data?.group_credits) ? data.group_credits : [];
		if (quota === void 0 && used === void 0 && credits.length === 0) return;
		await this.loadSummary();
		const summary = this.summary;
		if (summary === void 0) return;
		let currency;
		try {
			currency = await this.currencyInfo();
		} catch (_error) {
			currency = {
				quotaPerUnit: 1,
				rate: 1,
				display: false
			};
		}
		const vouchers = [];
		for (const item of credits) {
			const credit = asObject$1(item);
			const group = text$1(credit?.group);
			const amount = num(credit?.amount);
			if (group === void 0 || amount === void 0 || amount <= 0) continue;
			vouchers.push({
				group,
				groupId: num(credit?.group_id) ?? 0,
				amount: money(amount, currency)
			});
		}
		this.summary = {
			...summary,
			...quota !== void 0 ? { balance: money(quota, currency) } : {},
			...used !== void 0 ? { used: money(used, currency) } : {},
			vouchers
		};
		await this.persistSummary();
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
	/**
	* Record the facts a grant carried, so they outlive this process.
	*
	* A grant and a wallet read can both want to store the card within the same
	* tick, so writes are queued behind one another and each lands atomically: a
	* reader (a restarted process) must never open a half-written file.
	* @returns after this write landed, or was found unnecessary.
	*/
	persistSummary() {
		const write = this.summaryWrite.then(async () => {
			const path = this.snapshotPath();
			const summary = this.summary;
			if (path === void 0 || summary === void 0) return;
			const staging = `${path}.tmp`;
			try {
				await writeFile(staging, JSON.stringify(summary), "utf8");
				await rename(staging, path);
			} catch (error) {
				this.ctx.logger.warn("neartoken: could not store the account facts", error);
			}
		});
		this.summaryWrite = write;
		return write;
	}
	/**
	* Drop the snapshot once the key it describes is gone.
	* @returns after the file is gone, behind any write still queued.
	*/
	forgetSummary() {
		const remove = this.summaryWrite.then(async () => {
			const path = this.snapshotPath();
			if (path === void 0) return;
			try {
				await unlink(path);
			} catch (error) {
				if (error.code !== "ENOENT") this.ctx.logger.warn("neartoken: could not remove the stored account facts", error);
			}
		});
		this.summaryWrite = remove;
		return remove;
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
//#region src/host/images.ts
/** Model names that generate pictures on this kind of site, in or out of the catalog's endpoint list. */
const IMAGE_NAME = /image|imagine|nano-banana|imagen|flux|seedream|dall-?e|midjourney|recraft|ideogram/i;
/**
* Media models that are not picture generators. A catalog shares one namespace,
* so a speech or video route whose name mentions images still must not appear as
* a picture model.
*/
const NON_IMAGE_NAME = /tts|transcri|\basr\b|speech|embed|rerank|veo|video|lyria|music|sora|whisper/i;
/**
* Whether a catalog route is a picture generator.
* @param model - the bare model name.
* @param endpoints - the surfaces the site declares for it, when it declares any.
* @returns true when the model generates pictures.
*/
function isImageModel(model, endpoints) {
	if (NON_IMAGE_NAME.test(model)) return false;
	if (endpoints?.includes("image-generation") === true) return true;
	return IMAGE_NAME.test(model);
}
/**
* Which request shape one image model speaks.
*
* The Gemini family declares `gemini` and a compatible `openai` surface; the
* native one answers the picture as a structured `inlineData` part, where the
* compatible one wraps it in assistant text as a data URL. Native measured 74 s
* against chat's 110 s for the same model and prompt, and it does not depend on
* a gateway conversion, so it is the route when the site declares it.
* @param endpoints - the surfaces the site declares for the model.
* @returns `images` for an `image-generation` model, `genai` for a Gemini one, `chat` otherwise.
*/
function imageChannel(endpoints) {
	if (endpoints?.includes("image-generation") === true) return "images";
	if (endpoints?.includes("gemini") === true) return "genai";
	return "chat";
}
/** The request members only the images endpoint understands. */
const IMAGES_ONLY_PARAMETERS = [
	"size",
	"quality",
	"background"
];
/**
* Refuse a parameter the model's channel cannot carry.
*
* A chat-completions picture model accepts none of these: the site would either
* reject the body or silently drop the member, and a silently dropped size looks
* exactly like the model ignoring the instruction. One clear refusal teaches the
* caller more than a request that half-works.
* @param channel - the request shape the model speaks.
* @param request - the requested members.
*/
function assertChannelParameters(channel, request) {
	if (channel === "images") return;
	const unsupported = IMAGES_ONLY_PARAMETERS.filter((name) => request[name] !== void 0);
	if (unsupported.length === 0) return;
	throw new Error(`${unsupported.join(", ")} can only be sent to an image-generation model; ${request.model} answers ${channel === "genai" ? "Gemini generateContent" : "chat completions"}, so drop ${unsupported.length === 1 ? "it" : "them"} or enable a model such as gpt-image-2.5-flare for these settings`);
}
/** An inline picture inside a chat answer. */
const DATA_URL = /data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)/i;
/** A picture link inside a chat answer: markdown first, then a bare URL the extensions identify. */
const IMAGE_LINK = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)"']+?\.(?:png|jpe?g|webp|gif))/i;
/**
* Read a gateway's answer as one picture, whatever shape that gateway used.
* @param body - the parsed JSON answer.
* @returns the picture reference, or undefined when the answer carries none.
*/
function extractImageReply(body) {
	if (typeof body !== "object" || body === null) return void 0;
	const root = body;
	for (const entry of Array.isArray(root.data) ? root.data : []) {
		if (typeof entry !== "object" || entry === null) continue;
		const row = entry;
		if (typeof row.b64_json === "string" && row.b64_json.length > 0) return {
			kind: "base64",
			data: row.b64_json
		};
		if (typeof row.url === "string" && row.url.length > 0) return {
			kind: "url",
			url: row.url
		};
	}
	for (const choice of Array.isArray(root.choices) ? root.choices : []) {
		if (typeof choice !== "object" || choice === null) continue;
		const message = choice.message;
		if (typeof message !== "object" || message === null) continue;
		const reply = replyFromMessage(message);
		if (reply !== void 0) return reply;
	}
	for (const candidate of Array.isArray(root.candidates) ? root.candidates : []) {
		if (typeof candidate !== "object" || candidate === null) continue;
		const content = candidate.content;
		if (typeof content !== "object" || content === null) continue;
		const parts = content.parts;
		if (!Array.isArray(parts)) continue;
		for (const part of parts) {
			if (typeof part !== "object" || part === null) continue;
			const inline = part.inlineData ?? part.inline_data;
			if (typeof inline !== "object" || inline === null) continue;
			const data = inline.data;
			if (typeof data === "string" && data.length > 0) return {
				kind: "base64",
				data
			};
		}
	}
}
/**
* Read one chat message as a picture: its text may embed a data URL or link it.
* @param message - the chat message object.
* @returns the picture reference, or undefined when the message carries none.
*/
function replyFromMessage(message) {
	const text = messageText(message.content);
	const inline = DATA_URL.exec(text);
	if (inline?.[2] !== void 0) return {
		kind: "base64",
		data: inline[2]
	};
	const link = IMAGE_LINK.exec(text);
	const url = link?.[1] ?? link?.[2];
	if (url !== void 0) return {
		kind: "url",
		url
	};
	return replyFromImages(message.images);
}
/**
* Flatten a chat message's content into the text its picture would be in.
* @param content - the message's `content` member, a string or a part list.
* @returns the concatenated text.
*/
function messageText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const part of content) {
		if (typeof part !== "object" || part === null) continue;
		const text = part.text;
		if (typeof text === "string") parts.push(text);
	}
	return parts.join("\n");
}
/**
* Read the alternate chat convention, where pictures ride an `images` member.
* @param images - the message's `images` member.
* @returns the first picture reference, or undefined.
*/
function replyFromImages(images) {
	if (!Array.isArray(images)) return void 0;
	for (const image of images) {
		if (typeof image === "string") {
			if (image.startsWith("data:image/")) {
				const inline = DATA_URL.exec(image);
				if (inline?.[2] !== void 0) return {
					kind: "base64",
					data: inline[2]
				};
			}
			if (image.startsWith("http")) return {
				kind: "url",
				url: image
			};
			continue;
		}
		if (typeof image !== "object" || image === null) continue;
		const row = image;
		const nested = row.image_url;
		const candidate = typeof row.url === "string" ? row.url : typeof nested === "object" && nested !== null && typeof nested.url === "string" ? nested.url : void 0;
		if (candidate !== void 0) return {
			kind: "url",
			url: candidate
		};
	}
}
const PNG_SIGNATURE = [
	137,
	80,
	78,
	71,
	13,
	10,
	26,
	10
];
const JPEG_SIGNATURE = [
	255,
	216,
	255
];
/**
* Read an image's media type from its own bytes.
* @param data - the encoded picture.
* @returns the media type, or undefined when the bytes are not a supported image.
*/
function sniffImageMediaType(data) {
	const starts = (offset, expected) => expected.every((byte, index) => data[offset + index] === byte);
	const ascii = (offset, value) => {
		for (let index = 0; index < value.length; index += 1) if (data[offset + index] !== value.charCodeAt(index)) return false;
		return true;
	};
	if (data.byteLength >= PNG_SIGNATURE.length && starts(0, PNG_SIGNATURE)) return "image/png";
	if (data.byteLength >= JPEG_SIGNATURE.length && starts(0, JPEG_SIGNATURE)) return "image/jpeg";
	if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
	if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
}
/**
* Ask the site for one picture and return its bytes.
*
* The group matters as much as the model: the same model can be offered by
* several groups at different prices, and the site routes by the group
* reference header, so the caller names both.
*/
var NearTokenImageClient = class {
	deps;
	/**
	* @param deps - the site root, the key, the catalog, and the time budget.
	*/
	constructor(deps) {
		this.deps = deps;
	}
	/**
	* Generate one picture.
	* @param request - model, group, prompt, optional size, and the caller's cancellation.
	* @returns the encoded picture.
	* @throws {Error} when the site refuses the request or answers without a picture.
	*/
	async generate(request) {
		const route = (await this.deps.routes()).find((entry) => entry.model === request.model && entry.group === request.group);
		const channel = imageChannel(route?.endpoints);
		assertChannelParameters(channel, request);
		const timeoutMs = this.deps.timeoutMs();
		const budget = AbortSignal.timeout(timeoutMs);
		const signal = request.signal === void 0 ? budget : AbortSignal.any([request.signal, budget]);
		const key = await this.deps.apiKey();
		const send = this.deps.fetch ?? fetch;
		return await this.attempt({
			...request,
			channel,
			route,
			key,
			signal,
			send,
			timeoutMs
		}).catch((error) => {
			if (!budget.aborted) throw error;
			throw new Error(`the site did not return an image within ${String(Math.round(timeoutMs / 1e3))}s (imageTimeoutMs); ${request.model} can be this slow — retry, raise imageTimeoutMs, or enable a faster image model`, { cause: error });
		});
	}
	/**
	* One request, one answer: the parts of a generation that the time budget wraps.
	* @param request - the call, already resolved to a channel and group.
	* @returns the encoded picture.
	*/
	async attempt(request) {
		const pictures = request.images ?? [];
		const path = request.channel === "images" ? "/v1/images/generations" : request.channel === "genai" ? `/v1beta/models/${request.model}:generateContent` : "/v1/chat/completions";
		const response = await request.send(`${this.deps.baseURL()}${path}`, {
			method: "POST",
			headers: {
				...attributionHeaders(),
				"content-type": "application/json",
				...request.channel === "genai" ? { "x-goog-api-key": request.key } : { authorization: `Bearer ${request.key}` },
				...request.route?.groupRef === void 0 ? {} : { "x-neartoken-group": request.route.groupRef }
			},
			body: JSON.stringify(request.channel === "images" ? {
				model: request.model,
				prompt: request.prompt,
				n: 1,
				...request.size === void 0 ? {} : { size: request.size },
				...request.quality === void 0 ? {} : { quality: request.quality },
				...request.background === void 0 ? {} : { background: request.background },
				...pictures.length === 0 ? {} : { image: pictures.map((picture) => `data:${picture.mediaType};base64,${picture.data}`) }
			} : request.channel === "genai" ? { contents: [{
				role: "user",
				parts: [{ text: request.prompt }, ...pictures.map((picture) => ({ inlineData: {
					mimeType: picture.mediaType,
					data: picture.data
				} }))]
			}] } : {
				model: request.model,
				messages: [{
					role: "user",
					content: pictures.length === 0 ? request.prompt : [{
						type: "text",
						text: request.prompt
					}, ...pictures.map((picture) => ({
						type: "image_url",
						image_url: { url: `data:${picture.mediaType};base64,${picture.data}` }
					}))]
				}],
				stream: false
			}),
			signal: request.signal
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 400);
			throw new Error(`the site refused ${request.model} with HTTP ${String(response.status)}: ${detail}`);
		}
		const reply = extractImageReply(await response.json());
		if (reply === void 0) throw new Error(`${request.model} answered without an image; the model may not generate pictures on this site`);
		const bytes = reply.kind === "base64" ? Uint8Array.from(Buffer.from(reply.data, "base64")) : await this.download(reply.url, request.signal, request.send);
		const mediaType = sniffImageMediaType(bytes);
		if (mediaType === void 0) throw new Error(`${request.model} returned ${String(bytes.byteLength)} bytes that are not a PNG/JPEG/WebP/GIF image`);
		return {
			model: request.model,
			group: request.group,
			mediaType,
			bytes
		};
	}
	/**
	* Fetch a generated picture from the short-lived URL some gateways answer with.
	* @param url - the site's result URL.
	* @param signal - the generation's cancellation and time budget.
	* @param send - the HTTP carrier the request used.
	* @returns the encoded picture.
	* @throws {Error} when the URL cannot be read.
	*/
	async download(url, signal, send) {
		const response = await send(url, { signal });
		if (!response.ok) throw new Error(`the generated image URL answered HTTP ${String(response.status)}`);
		return new Uint8Array(await response.arrayBuffer());
	}
};
//#endregion
//#region src/host/image-settings.ts
/** Most picture models one save may enable. */
const MAX_MODELS$1 = 200;
/** Longest model or group name a save may carry, in characters. */
const MAX_NAME_LENGTH = 300;
/** The ratio caption the catalog stores in a route's description (`分组倍率 0.4x`). */
const RATIO_PATTERN$1 = /([0-9]+(?:\.[0-9]+)?)x/;
/**
* Fold the catalog's per-group routes into one entry per picture model.
* @param routes - every catalog route, chat models included.
* @returns one entry per picture model, in first-seen order.
*/
function imageCatalog(routes) {
	const byModel = /* @__PURE__ */ new Map();
	for (const route of routes) {
		if (!isImageModel(route.model, route.endpoints)) continue;
		const ratio = RATIO_PATTERN$1.exec(route.description)?.[1];
		const group = ratio === void 0 ? { group: route.group } : {
			group: route.group,
			ratio: `${ratio}x`
		};
		const entry = byModel.get(route.model);
		if (entry === void 0) byModel.set(route.model, {
			channels: [...route.endpoints ?? []],
			groups: [group]
		});
		else {
			entry.groups.push(group);
			for (const endpoint of route.endpoints ?? []) if (!entry.channels.includes(endpoint)) entry.channels.push(endpoint);
		}
	}
	return [...byModel].map(([model, entry]) => {
		const cheapest = entry.groups.reduce((low, group) => {
			if (group.ratio === void 0) return low;
			const value = Number.parseFloat(group.ratio);
			if (!Number.isFinite(value)) return low;
			return low === void 0 || value < low ? value : low;
		}, void 0);
		return {
			model,
			channel: imageChannel(entry.channels),
			groups: entry.groups,
			...cheapest === void 0 ? {} : { minRatio: cheapest }
		};
	});
}
/**
* Validate one `POST /neartoken/images` body against the catalog it must refer to.
*
* A model the site stopped offering, and a group that model no longer has, are
* both refusals: storing either would leave the tool pointing at a route the
* next call cannot use.
* @param value - the parsed request body.
* @param catalog - the picture models the site offers now.
* @returns the normalized patch, or undefined when the body cannot be stored.
*/
function parseImagePatch(value, catalog) {
	if (typeof value !== "object" || value === null) return void 0;
	const record = value;
	if (typeof record.enabled !== "boolean") return void 0;
	const raw = record.models;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return void 0;
	const entries = Object.entries(raw);
	if (entries.length > MAX_MODELS$1) return void 0;
	const groups = new Map(catalog.map((entry) => [entry.model, new Set(entry.groups.map((group) => group.group))]));
	const models = {};
	for (const [model, group] of entries) {
		if (model.length === 0 || model.length > MAX_NAME_LENGTH) return void 0;
		if (typeof group !== "string" || group.length === 0 || group.length > MAX_NAME_LENGTH) return void 0;
		if (groups.get(model)?.has(group) !== true) return void 0;
		models[model] = group;
	}
	return {
		enabled: record.enabled,
		models
	};
}
/** The image setting's read and write faces, mounted on the settings routes. */
var NearTokenImageSettings = class {
	deps;
	/**
	* @param deps - the stored value, the catalog, and the profile entry a save writes.
	*/
	constructor(deps) {
		this.deps = deps;
	}
	/**
	* Read the setting beside the site's picture models.
	* @returns the stored state plus every picture model the site offers.
	*/
	async state() {
		const stored = this.deps.stored();
		return {
			enabled: stored.enabled,
			models: await this.deps.catalog(),
			selection: { ...stored.models }
		};
	}
	/**
	* Persist one setting.
	* @param patch - whether the tool is enabled and the group each model routes through.
	* @returns resolution after the profile write and its live application.
	* @throws {Error} when the composition has no settings service, so nothing could persist it.
	*/
	async save(patch) {
		const settings = this.deps.settings();
		if (settings === void 0) throw new Error("neartoken: image generation needs the settings service");
		await settings.update(this.deps.entryId, { imageGeneration: {
			enabled: patch.enabled,
			models: { ...patch.models }
		} });
	}
};
//#endregion
//#region src/host/image-tool.ts
/**
* The model-facing `generate_image` tool: one picture from a prompt, through
* whichever picture model and group the operator enabled.
*
* The choice of model belongs to the operator, not to the caller: a profile
* bills one group per model, and which group a picture costs from is a
* deployment decision. So the tool advertises no model list of its own — it
* calls the first enabled model unless the caller names one, and refuses a name
* outside the enabled set with the enabled set spelled out.
*
* The result is the image itself, committed to the attachment store first: a
* tool result must reference a durable object by the time the call is logged,
* and the bytes only exist in this process until then.
*
* @module
*/
/** File extension per accepted media type, so a stored picture has a name that matches its bytes. */
const EXTENSIONS = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif"
};
/**
* Slack between the generation budget and the tool-call deadline.
*
* The harness's timeout policy arms `timeoutMs` on `exec.signal` and, when it
* fires, replaces the result with a bare "tool call timed out". Keeping our own
* budget slightly shorter means the model usually gets the useful message — how
* long it waited, and that `imageTimeoutMs` is the knob — while the policy still
* catches a generation that ignores its abort.
*/
const DEADLINE_MARGIN_MS = 3e4;
/** Most reference pictures one call may carry: each rides the prompt as base64. */
const MAX_REFERENCE_IMAGES = 4;
/** Largest reference picture read from disk, before base64 expansion. */
const MAX_REFERENCE_BYTES = 20971520;
/**
* Choose the model and group one call uses.
* @param selection - the enabled models and their groups.
* @param requested - the model the caller named, when it named one.
* @returns the model and group to call.
* @throws {Error} when nothing is enabled, or the named model is not among them.
*/
function resolveImageModel(selection, requested) {
	const entries = Object.entries(selection);
	const [first] = entries;
	if (first === void 0) throw new Error("no image model is enabled: turn one on in Settings → NearToken → Image generation");
	const hit = requested === void 0 ? first : entries.find(([model]) => model === requested);
	if (hit === void 0) throw new Error(`"${String(requested)}" is not an enabled image model; enabled models: ${entries.map(([model]) => model).join(", ")}`);
	return {
		model: hit[0],
		group: hit[1]
	};
}
/**
* Format a generated picture as the model-facing envelope beside its image block.
* @param value - the generated image outcome.
* @returns the model-facing envelope; the picture itself rides the adjacent image block.
*/
function formatGenerateImageOutput(value) {
	return `<model>${value.model}</model>
<group>${value.group}</group>${value.path === void 0 ? "" : `
<path>${value.path}</path>`}
<type>image</type>
<content>
${value.image.mediaType} image, ${String(value.image.width)}x${String(value.image.height)} px, ${String(value.image.bytes)} bytes, generated from the prompt
</content>`;
}
/**
* Project one generated picture into its model-facing envelope and image.
* @param value - the generated image outcome.
* @returns the two content blocks a tool result carries.
*/
function generateImageContent(value) {
	return [{
		type: "text",
		text: formatGenerateImageOutput(value)
	}, {
		type: "image",
		attachment: {
			attachmentId: AttachmentId(value.image.attachmentId),
			mediaType: value.image.mediaType,
			bytes: value.image.bytes,
			width: value.image.width,
			height: value.image.height,
			name: value.image.name
		}
	}];
}
/**
* Resolve options for a filesystem call in the session's current directory.
* @param ctx - a context that may carry the working-directory service.
* @param exec - the current tool execution.
* @returns the resolution options, with no cwd when the service is absent.
*/
async function resolveOptions(ctx, exec) {
	const workingDirectory = ctx.get("workingDirectory");
	const cwd = workingDirectory === void 0 || exec.agent === void 0 ? void 0 : await workingDirectory.ensure(exec.agent, exec.signal);
	return {
		...cwd === void 0 ? {} : { cwd },
		signal: exec.signal
	};
}
/**
* Read the caller's reference pictures as data URLs, in the order given.
* @param ctx - a context carrying `fs`.
* @param exec - the current tool execution.
* @param paths - model-supplied file paths.
* @returns one payload per picture.
* @throws {Error} when a path cannot be read as a supported image.
*/
async function readReferences(ctx, exec, paths) {
	if (paths.length === 0) return [];
	if (paths.length > MAX_REFERENCE_IMAGES) throw new Error(`at most ${String(MAX_REFERENCE_IMAGES)} reference images per call; ${String(paths.length)} were given`);
	const fs = ctx.get("fs");
	if (fs === void 0) throw new Error("cannot read reference images: no filesystem service is mounted");
	const options = await resolveOptions(ctx, exec);
	const pictures = [];
	for (const requested of paths) {
		const target = await fs.resolve(requested, options);
		const info = await fs.stat(target, exec.signal);
		if (info === void 0) throw new Error(`cannot use "${target.displayPath}" as a reference image: not found`);
		if (info.type !== "file") throw new Error(`cannot use "${target.displayPath}" as a reference image: not a regular file`);
		const bytes = await fs.readBytes(target, exec.signal, MAX_REFERENCE_BYTES);
		const mediaType = sniffImageMediaType(bytes);
		if (mediaType === void 0) throw new Error(`cannot use "${target.displayPath}" as a reference image: not a PNG/JPEG/WebP/GIF file`);
		pictures.push({
			mediaType,
			data: Buffer.from(bytes).toString("base64")
		});
	}
	return pictures;
}
/**
* Write a generated picture beside the transcript copy.
*
* The file is created exclusively: an existing path is a refusal, never an
* overwrite, because the caller cannot see what it would destroy. Only a local
* backend can receive bytes — `ctx.fs` writes text, so the bytes go through the
* host's own file API against the path the backend resolved.
* @param ctx - a context carrying `fs`.
* @param exec - the current tool execution.
* @param requested - the model-supplied destination path.
* @param bytes - the picture to write.
* @returns the resolved display path the file was written to.
* @throws {Error} when the destination exists or cannot hold bytes.
*/
async function writePicture(ctx, exec, requested, bytes) {
	const fs = ctx.get("fs");
	if (fs === void 0) throw new Error("cannot write the picture: no filesystem service is mounted");
	const target = await fs.resolve(requested, await resolveOptions(ctx, exec));
	if (await fs.stat(target, exec.signal) !== void 0) throw new Error(`cannot write "${target.displayPath}": the path already exists; name a new file`);
	if (!fs.fileUrl(target).startsWith("file:")) throw new Error(`cannot write "${target.displayPath}": this filesystem backend does not accept a local file; the picture stays in the transcript as an attachment`);
	await writeFile(fs.processPath(target), bytes, { flag: "wx" });
	const written = await fs.stat(target, exec.signal);
	if (written !== void 0) ctx.emit("fs/observed", target, {
		kind: "present",
		version: written.version
	}, exec);
	return target.displayPath;
}
/**
* Register the `generate_image` tool.
* @param ctx - a context carrying `tools` and `attachments`.
* @param deps - the stored setting and the generation client.
* @returns the registration's disposer.
*/
function registerGenerateImageTool(ctx, deps) {
	return ctx.tools.register(defineTool({
		name: "generate_image",
		description: "Generate one image from a text prompt with the configured image model (the gpt-image, nano-banana, and gemini image families) and return the image itself. One call takes 20-60 seconds. Write the prompt as a full description of the picture you want; quoted text that must appear in the image is rendered by the model, but long lines may smear. Pass images to edit or compose from existing files and say what to keep and what to change; the first reference picture also sets the output aspect ratio. The available models are the ones the operator enabled in Settings → NearToken → Image generation.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "What the picture should show. Detailed prompts work better than short ones."
			},
			model: {
				type: "string",
				description: "Enabled image model to use; omit to use the first enabled model."
			},
			size: {
				type: "string",
				description: "Requested size such as \"1024x1024\". Image-generation models only; a chat-completions model refuses it."
			},
			quality: {
				type: "string",
				enum: [
					"low",
					"medium",
					"high",
					"auto"
				],
				description: "Rendering quality: low is faster and cheaper, high costs more. Image-generation models only."
			},
			background: {
				type: "string",
				enum: [
					"transparent",
					"opaque",
					"auto"
				],
				description: "Transparent output is for logos and cut-outs. Image-generation models only."
			},
			images: {
				type: "array",
				items: { type: "string" },
				description: "Reference pictures to edit or compose from, as file paths read through the workspace. Put the picture that should set the aspect ratio first."
			},
			path: {
				type: "string",
				description: "Also write the picture to this path (relative to the workspace or absolute). The file must not exist yet. Omit to keep the image only in the transcript."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					model: {
						type: "string",
						required: true,
						description: "Bare model name that drew the picture."
					},
					group: {
						type: "string",
						required: true,
						description: "Catalog group the request routed through."
					},
					image: {
						type: "object",
						additionalProperties: false,
						required: true,
						properties: {
							attachmentId: {
								type: "string",
								required: true
							},
							mediaType: {
								type: "string",
								enum: [
									"image/png",
									"image/jpeg",
									"image/webp",
									"image/gif"
								],
								required: true
							},
							bytes: {
								type: "integer",
								required: true
							},
							width: {
								type: "integer",
								required: true
							},
							height: {
								type: "integer",
								required: true
							},
							name: {
								type: "string",
								required: true
							}
						}
					},
					path: {
						type: "string",
						description: "Where the picture was also written, when the caller named a path."
					}
				}
			},
			render: (_args, value) => generateImageContent(value),
			presentationMeta: (_args, value) => ({
				model: value.model,
				group: value.group
			})
		},
		timeoutMs: deps.timeoutMs() + DEADLINE_MARGIN_MS,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const settings = deps.settings();
			if (!settings.enabled) throw new Error("image generation is off: turn it on in Settings → NearToken → Image generation");
			const { model, group } = resolveImageModel(settings.models, args.model);
			const attachments = ctx.get("attachments");
			if (attachments === void 0) throw new Error("cannot generate an image: no attachment service is mounted");
			const references = await readReferences(ctx, exec, args.images ?? []);
			const generated = await deps.client.generate({
				model,
				group,
				prompt: args.prompt,
				...args.size === void 0 ? {} : { size: args.size },
				...args.quality === void 0 ? {} : { quality: args.quality },
				...args.background === void 0 ? {} : { background: args.background },
				...references.length === 0 ? {} : { images: references },
				signal: exec.signal
			});
			const name = `${model}.${EXTENSIONS[generated.mediaType]}`;
			const ref = await attachments.saveImage({
				data: generated.bytes,
				mediaType: generated.mediaType,
				name
			});
			const written = args.path === void 0 ? void 0 : await writePicture(ctx, exec, args.path, generated.bytes);
			return {
				model: generated.model,
				group: generated.group,
				image: {
					attachmentId: ref.attachmentId,
					mediaType: ref.mediaType,
					bytes: ref.bytes,
					width: ref.width,
					height: ref.height,
					name: ref.name ?? name
				},
				...written === void 0 ? {} : { path: written }
			};
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Generate image${args.model === void 0 ? "" : ` with ${args.model}`}`,
				kind: "other",
				rawInput: args.prompt
			};
		}
	}));
}
//#endregion
//#region src/host/model-caps.ts
/**
* What one site model name can actually do: whether it answers chat at all, and
* how much context it holds.
*
* The site is the only authority. `/api/pricing` answers everything an operator
* maintains in the New API console: `supported_endpoint_types` says which
* downstream surfaces the model serves, and `context_window` / `max_tokens` /
* `input_modalities` / `reasoning_levels` are the facts behind the picker (see
* the capacity section of `HANDOFF-new-api.md`). This plugin ships no model
* table of its own: a model the console does not describe is offered bare —
* configured context window, text-only input, no effort selector — instead of
* with capabilities nothing declared.
*
* The plugin configuration still sits on top (`modelOverrides` per bare model
* name, `defaultContextWindow` for everything else), so a value the console gets
* wrong can be corrected without publishing a new plugin version.
*
* @module
*/
/**
* Variants the site marks as unfit for coding: it pairs every such name with a
* twin that lacks the suffix, so offering both only invites a wrong pick.
*/
const CODING_VARIANT = /-c$/i;
/**
* Routes that carry a model name but never answer a chat request.
*
* A name convention, not capability metadata, and the only judge available: the
* site files its image, embedding, music, and video models under the same
* `openai` / `gemini` surfaces a chat model uses, because that is genuinely the
* path they are called on. So `supported_endpoint_types` cannot tell a chat
* model from a media model that shares the surface, and a model the console
* does not describe has no other declaration to read. Delete this pattern the
* day the site publishes the model's kind.
*/
const NON_TEXT = /(image|tts|transcribe|asr|embedding|lyria|midjourney|nano-banana|veo|imagen|dall-e|^sd\d)/i;
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
/** Display spelling of each level the site may declare. */
const LEVEL_LABELS = {
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "XHigh",
	max: "Max"
};
/**
* Whether the catalog should offer this model at all.
*
* The site's declared endpoint types decide it. A model declared without any is
* a media route whatever its name looks like; a model whose declaration is
* missing entirely is offered, because a site too old to declare surfaces must
* not lose its whole catalog over it. Two name rules outlive every declaration:
* a media route filed under a chat surface (see {@link NON_TEXT}), and a
* coding-suffixed twin.
* @param model - a bare model name from the pricing endpoint.
* @param endpoints - the site's declared downstream surfaces, if any.
* @returns whether the model stays in the catalog.
*/
function isChatOffering(model, endpoints) {
	if (NON_TEXT.test(model) || CODING_VARIANT.test(model)) return false;
	if (endpoints === void 0 || endpoints.length === 0) return true;
	return endpoints.some((endpoint) => CHAT_ENDPOINTS.has(endpoint));
}
/**
* The input modalities one model accepts.
*
* The harness treats a declared modality list as the only permission a request
* has: the `read_image` tool refuses to load a file for a model without
* `image`, and a request carrying an image is rejected before it is sent. So
* this answers for every model — a model the site does not describe is stated as
* text-only rather than left unknown, which keeps an image out of a request that
* would fail.
*
* Priority: operator configuration, then the site's own statement, then text.
* @param sources - the two candidates supplied at call time.
* @returns the modalities, always including `text`.
*/
function inputModalitiesOf(sources = {}) {
	if (sources.declared !== void 0 && sources.declared.length > 0) return sources.declared;
	if (sources.reported !== void 0 && sources.reported.length > 0) return sources.reported;
	return ["text"];
}
/**
* The selectable reasoning levels for one model.
*
* Only an explicit answer counts. The site is where an operator declares which
* effort names a model takes; a model without that declaration is offered with
* no selector at all, because a level the upstream rejects turns every request
* into a 400.
* @param sources - the two candidates supplied at call time.
* @returns the level names in the site's order, or undefined when nothing names any.
*/
function reasoningLevels(sources = {}) {
	if (sources.declared !== void 0 && sources.declared.length > 0) return sources.declared;
	if (sources.reported !== void 0 && sources.reported.length > 0) return sources.reported;
}
/**
* Resolve one model's context window.
*
* A harness model without a context window loses automatic compaction entirely
* — the compaction backend refuses to size a summary budget it cannot bound —
* so this always answers, falling back to the configured capacity rather than
* declining. Priority: operator override, then the site's own declaration, then
* the configured fallback.
* @param sources - the three candidate answers.
* @returns a positive token count.
*/
function contextWindowOf(sources) {
	return sources.override ?? sources.reported ?? sources.fallback;
}
/**
* Resolve one model's maximum output tokens.
*
* Only an explicit answer counts: the site may route a name to a channel with a
* lower ceiling than the vendor states, so a guessed value would trade a
* truncated reply for a rejected request. Without an explicit answer the request
* omits the field and the upstream default applies.
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
* @param level - a level id declared by the site.
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
//#region src/host/wire-error.ts
/**
* Provider-neutral classification of a gateway refusal or transport failure.
*
* The retry plugin (dsh-llm-retry, shipped in the base bundle) executes the
* route's policy on every failed model request, and the default policy retries
* only the shared transient codes: RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, and
* EMPTY_RESPONSE. A refusal thrown as PROVIDER_ERROR matches none of them, so
* a single transient gateway hiccup ended the whole turn — the "stops on the
* first error, never retries" behavior. Every refusal here is mapped onto the
* shared taxonomy instead, mirroring llm-deepseek's transport classification,
* so the retry policy sees the failure class it already knows how to wait out.
*
* @module
*/
/** The `error` object of a gateway error body, when the body carries one. */
function errorObjectOf(body) {
	const parsed = parseJsonObject(body);
	if (typeof parsed !== "object" || parsed === null) return void 0;
	const error = parsed.error;
	if (typeof error !== "object" || error === null) return void 0;
	return error;
}
/**
* The provider's own message of a refusal, when the body carries one.
* @param body - the raw error response body.
* @returns the embedded `error.message`, or undefined.
*/
function embeddedMessage(body) {
	const message = errorObjectOf(body)?.message;
	return typeof message === "string" && message !== "" ? message : void 0;
}
/**
* Join a refusal's type, code, and message into the text the classifiers read.
*
* Called only after `errorObjectOf` proved the body carries one, so the
* fallthrough to the raw body covers a gateway that answered plain text.
* @param body - the raw error response body.
* @returns classification text, or the raw body when it is not an error object.
*/
function detailOf(body) {
	const error = errorObjectOf(body);
	return error === void 0 ? body : [
		error.type,
		error.code,
		error.message
	].filter((value) => typeof value === "string").join(" ");
}
/**
* Classify one gateway refusal (a non-2xx answer or a rejected body).
*
* Codes follow the shared taxonomy: AUTH for credentials the gateway refused,
* QUOTA for an exhausted balance, RATE_LIMIT for throttling, SERVER for the
* gateway's own failures, INVALID_REQUEST for a request it will always
* reject, and `HTTP_<status>` for anything else. Only RATE_LIMIT and SERVER
* are transient by default; the policy provider owns the rest.
* @param body - the raw error response body.
* @param status - the HTTP status the gateway answered with.
* @param headers - the response headers, for `retry-after` and request identity.
* @returns the classified error; never retry-after longer than the caller is told about.
*/
function gatewayError(body, status, headers) {
	const error = errorObjectOf(body);
	const type = typeof error?.type === "string" ? error.type : "";
	const detail = detailOf(body);
	let code;
	if (status === 401 || status === 403 || type === "authentication_error" || type === "permission_error") code = "AUTH";
	else if (isQuotaExceededError(detail) || status === 402) code = "QUOTA";
	else if (status === 429 || type === "rate_limit_error") code = "RATE_LIMIT";
	else if (isContextWindowExceededError(detail)) code = "CONTEXT_WINDOW_EXCEEDED";
	else if (status === 400 || status === 413 || type === "invalid_request_error") code = "INVALID_REQUEST";
	else if (status >= 500 || type === "api_error" || type === "overloaded_error") code = "SERVER";
	else code = `HTTP_${status}`;
	const retry = headers?.get("retry-after");
	const delay = retry == null ? NaN : /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) * 1e3 : Date.parse(retry) - Date.now();
	const id = headers?.get("request-id") ?? headers?.get("x-request-id");
	return new LlmError(`NearToken answered ${status}: ${(embeddedMessage(body) ?? body).slice(0, 500)}`, code, {
		status,
		...id == null ? {} : { requestId: ProviderRequestId(id) },
		...Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {}
	});
}
/**
* Classify a failure that arrived mid-stream, after the body was accepted.
*
* A stream that dies after a healthy start is a gateway-side failure: the
* request itself was valid, so the shared taxonomy carries it as SERVER and
* the default retry policy waits it out.
* @param detail - the failure text the stream carried.
* @returns the classified error.
*/
function streamFailure(detail) {
	return new LlmError(`NearToken answered with a stream failure: ${detail.slice(0, 500)}`, "SERVER");
}
/**
* Classify a transport-level failure: the request never produced a response.
*
* undici wraps the underlying cause in a `TypeError: fetch failed`; the chain
* is rendered into the message so the real failure (DNS, TLS, reset) is not
* masked by the wrapper.
* @param error - the value the fetch rejected with.
* @returns the classified error, chained to the original.
*/
function transportFailure(error) {
	return new LlmError(`NearToken could not be reached: ${errorChain(error).slice(0, 500)}`, "TRANSPORT", { cause: error });
}
//#endregion
//#region src/host/session-key.ts
/**
* Derive the key one request should present for channel affinity.
* @param options - the harness request.
* @returns the session identity, or undefined when the request carries none.
*/
function sessionKeyOf(options) {
	const sessionId = options.sessionId;
	return sessionId === void 0 || sessionId === "" ? void 0 : sessionId;
}
//#endregion
//#region src/host/wire-images.ts
/**
* Images inlined for one wire request.
*
* A harness message carries an image as a durable attachment reference, while
* every upstream protocol wants the bytes themselves — base64 in the body or a
* data URL. This module is the one place that reads them, so a wire never talks
* to the attachment store and cannot silently drop a picture it does not
* understand.
*
* Dropping was the previous behavior: the wires only flattened text blocks, so a
* pasted screenshot reached the model as nothing at all. A missing service or an
* unreadable attachment is now a failed request instead.
*
* @module
*/
/**
* Collect every image a request's messages carry, inlined for the wires.
* @param attachments - the attachment service, when the composition has one.
* @param messages - the request's conversation messages.
* @param signal - the request's cancellation.
* @returns attachment id to base64 image; empty when the request carries none.
* @throws {LlmError} when a message carries an image that cannot be inlined.
*/
async function inlineImages(attachments, messages, signal) {
	const references = [];
	for (const message of messages) for (const block of message.content) {
		if (typeof block !== "object" || block === null) continue;
		const candidate = block;
		if (candidate.type !== "image" || candidate.attachment === void 0) continue;
		references.push(candidate.attachment);
	}
	if (references.length === 0) return /* @__PURE__ */ new Map();
	if (attachments === void 0) throw new LlmError("this request carries an image but no attachment service is mounted, so the bytes cannot be read", "ATTACHMENTS_UNAVAILABLE");
	const images = /* @__PURE__ */ new Map();
	for (const reference of references) {
		const id = String(reference.attachmentId);
		if (images.has(id)) continue;
		let data;
		try {
			data = (await attachments.readImage(reference, signal)).data;
		} catch (error) {
			throw new LlmError(`cannot read attachment "${id}" for this request: ${error instanceof Error ? error.message : String(error)}`, "ATTACHMENT_UNREADABLE");
		}
		images.set(id, {
			mediaType: reference.mediaType,
			data: Buffer.from(data).toString("base64")
		});
	}
	return images;
}
/**
* Find the inlined bytes behind one message block.
* @param block - one content block, of any type.
* @param images - the request's inlined images.
* @returns the image, or undefined when the block is not an inlined image.
*/
function imageOf(block, images) {
	if (typeof block !== "object" || block === null) return void 0;
	const candidate = block;
	if (candidate.type !== "image" || candidate.attachment?.attachmentId === void 0) return void 0;
	return images.get(String(candidate.attachment.attachmentId));
}
/**
* Render one image as the data URL every HTTP-shaped wire accepts.
* @param image - the inlined image.
* @returns the data URL.
*/
function dataUrlOf(image) {
	return `data:${image.mediaType};base64,${image.data}`;
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
* Prompt caching is explicit on this wire: Anthropic writes a cache entry only
* where a `cache_control` breakpoint marks the end of a prefix, and charges the
* whole prompt as fresh input without one. The harness replays the conversation
* on every call, so the breakpoints are placed once per request over the bytes
* the next call will reuse (see `serializeRequest`).
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
function serializeMessage$3(message, images = /* @__PURE__ */ new Map()) {
	const content = message.content;
	switch (message.role) {
		case "user":
		case "system": {
			const text = textOf$3(content);
			const blocks = [];
			if (text !== "") blocks.push({
				type: "text",
				text
			});
			for (const block of content) {
				const image = imageOf(block, images);
				if (image !== void 0) blocks.push({
					type: "image",
					source: {
						type: "base64",
						media_type: image.mediaType,
						data: image.data
					}
				});
			}
			return blocks.length === 0 ? void 0 : {
				role: "user",
				content: blocks
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
* The breakpoint that marks a cacheable prefix end.
* @returns a fresh `cache_control` value; a new object each time, so no caller
* can mutate another block's mark through the shared one.
*/
function cacheBreakpoint() {
	return { type: "ephemeral" };
}
/**
* Mark the last block of the trailing messages as the end of a cacheable prefix.
*
* The next call replays every message this one sent, so the longest prefix the
* two share ends inside the final message. The message before it is marked as
* well: a turn that ends with a fresh user message leaves the previous call's
* trailing breakpoint on the second-to-last message, and a mark that misses
* costs a cache write rather than nothing.
* @param messages - the serialized conversation, in send order.
*/
function markTailBreakpoints(messages) {
	for (const message of messages.slice(-2)) {
		const blocks = message.content;
		if (!Array.isArray(blocks) || blocks.length === 0) continue;
		const last = blocks[blocks.length - 1];
		if (typeof last !== "object" || last === null) continue;
		last.cache_control = cacheBreakpoint();
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
function serializeRequest$3(options, model, images = /* @__PURE__ */ new Map()) {
	const messages = [];
	for (const message of options.messages) {
		const wire = serializeMessage$3(message, images);
		if (wire !== void 0) messages.push(wire);
	}
	const body = {
		model,
		messages,
		stream: true
	};
	const affinityKey = sessionKeyOf(options);
	if (affinityKey !== void 0) body.metadata = { user_id: affinityKey };
	if (options.reasoningEffort !== void 0) {
		body.thinking = { type: "adaptive" };
		body.output_config = { effort: claudeEffort(options.reasoningEffort) };
	}
	if (options.maxTokens !== void 0) body.max_tokens = options.maxTokens;
	if (options.temperature !== void 0) body.temperature = options.temperature;
	if (options.system !== void 0 && options.system.length > 0) body.system = [{
		type: "text",
		text: options.system,
		cache_control: cacheBreakpoint()
	}];
	if (options.tools !== void 0 && options.tools.length > 0) {
		const tools = options.tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			input_schema: tool.parameters
		}));
		const lastTool = tools[tools.length - 1];
		if (lastTool !== void 0) lastTool.cache_control = cacheBreakpoint();
		body.tools = tools;
	}
	if (options.stop !== void 0 && options.stop.length > 0) body.stop_sequences = options.stop;
	markTailBreakpoints(messages);
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
	if (!response.ok || response.body === null) throw gatewayError(await response.text().catch(() => ""), response.status, response.headers);
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
function serializeMessage$2(message, toolNames, images = /* @__PURE__ */ new Map()) {
	const content = message.content;
	switch (message.role) {
		case "user":
		case "system":
		case "developer": {
			const text = textOf$2(content);
			const parts = [];
			if (text !== "") parts.push({ text });
			for (const block of content) {
				const image = imageOf(block, images);
				if (image !== void 0) parts.push({ inlineData: {
					mimeType: image.mediaType,
					data: image.data
				} });
			}
			return parts.length === 0 ? void 0 : {
				role: "user",
				parts
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
function serializeRequest$2(options, model, images = /* @__PURE__ */ new Map()) {
	const toolNames = toolNamesOf(options.messages);
	const contents = [];
	for (const message of options.messages) {
		const wire = serializeMessage$2(message, toolNames, images);
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
	if (!response.ok || response.body === null) throw gatewayError(await response.text().catch(() => ""), response.status, response.headers);
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
function serializeMessage$1(message, images = /* @__PURE__ */ new Map()) {
	const content = message.content;
	switch (message.role) {
		case "user":
		case "system":
		case "developer": {
			const text = textOf$1(content);
			const parts = [];
			if (text !== "") parts.push({
				type: "input_text",
				text
			});
			for (const block of content) {
				const image = imageOf(block, images);
				if (image !== void 0) parts.push({
					type: "input_image",
					image_url: dataUrlOf(image)
				});
			}
			const hasImage = parts.some((part) => part.type === "input_image");
			return parts.length === 0 ? [] : [{
				role: "user",
				content: hasImage ? parts : text
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
function serializeRequest$1(options, model, images = /* @__PURE__ */ new Map()) {
	const input = [];
	for (const message of options.messages) input.push(...serializeMessage$1(message, images));
	const body = {
		model,
		input,
		stream: true
	};
	const affinityKey = sessionKeyOf(options);
	if (affinityKey !== void 0) body.prompt_cache_key = affinityKey;
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
			throw streamFailure(stringOf((asObject(event.error) ?? asObject(response?.error))?.message) ?? stringOf(response?.status) ?? "responses stream failed");
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
	if (!response.ok || response.body === null) throw gatewayError(await response.text().catch(() => ""), response.status, response.headers);
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
* into `StreamChunk`s. Text, images, and tool calls round-trip; files do not
* (a file block contributes no wire member).
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
function serializeRequest(options, model, images = /* @__PURE__ */ new Map()) {
	const messages = [];
	if (options.system !== void 0 && options.system.length > 0) messages.push({
		role: "system",
		content: options.system
	});
	for (const message of options.messages) {
		const wire = serializeMessage(message, images);
		if (wire !== void 0) messages.push(wire);
	}
	const body = {
		model,
		messages,
		stream: true,
		stream_options: { include_usage: true }
	};
	const affinityKey = sessionKeyOf(options);
	if (affinityKey !== void 0) body.prompt_cache_key = affinityKey;
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
/**
* Build one user turn's content: plain text when it carries only text, a part
* list once a picture has to ride along.
* @param content - the message's content blocks.
* @param images - the request's inlined images.
* @returns the wire content member.
*/
function userContentOf(content, images) {
	const text = textOf(content);
	const parts = [];
	if (text !== "") parts.push({
		type: "text",
		text
	});
	for (const block of content) {
		const image = imageOf(block, images);
		if (image !== void 0) parts.push({
			type: "image_url",
			image_url: { url: dataUrlOf(image) }
		});
	}
	return parts.some((part) => part.type === "image_url") ? parts : text;
}
function serializeMessage(message, images) {
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
			content: userContentOf(content, images)
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
	if (!response.ok || response.body === null) throw gatewayError(await response.text().catch(() => ""), response.status, response.headers);
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
	const declared = /* @__PURE__ */ new Map();
	for (const route of routes) {
		const ratio = RATIO_PATTERN.exec(route.description)?.[1];
		const groups = byModel.get(route.model);
		const entry = ratio === void 0 ? { group: route.group } : {
			group: route.group,
			ratio: `${ratio}x`
		};
		if (groups === void 0) byModel.set(route.model, [entry]);
		else groups.push(entry);
		const facts = declared.get(route.model) ?? {};
		declared.set(route.model, {
			...facts,
			...facts.contextWindow === void 0 && route.contextWindow !== void 0 ? { contextWindow: route.contextWindow } : {},
			...facts.maxTokens === void 0 && route.maxTokens !== void 0 ? { maxTokens: route.maxTokens } : {},
			...facts.input === void 0 && route.input !== void 0 && route.input.length > 0 ? { input: route.input } : {}
		});
	}
	return [...byModel].map(([model, groups]) => {
		const cheapest = groups.reduce((low, group) => {
			if (group.ratio === void 0) return low;
			const value = Number.parseFloat(group.ratio);
			if (!Number.isFinite(value)) return low;
			return low === void 0 || value < low ? value : low;
		}, void 0);
		const facts = declared.get(model) ?? {};
		return {
			model,
			groups,
			...cheapest === void 0 ? {} : { minRatio: cheapest },
			...facts.contextWindow === void 0 ? {} : { contextWindow: facts.contextWindow },
			...facts.maxTokens === void 0 ? {} : { maxTokens: facts.maxTokens },
			...facts.input === void 0 ? {} : { input: facts.input }
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
/**
* Validate one `POST /neartoken/models` body's meta overrides.
*
* A model whose value carries no member is dropped: an empty entry would read
* as an override while overriding nothing, and the page's "clear this model's
* override" action is exactly a value that ends up empty.
* @param value - the raw `meta` member.
* @returns the cleaned overrides keyed by model name, or undefined when the
* value is not an object of well-formed per-model facts.
*/
function parseMeta(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const entries = Object.entries(value);
	if (entries.length > MAX_MODELS) return void 0;
	const meta = {};
	for (const [model, raw] of entries) {
		const name = model.trim();
		if (name.length === 0 || name.length > MAX_MODEL_NAME) return void 0;
		if (typeof raw !== "object" || raw === null) return void 0;
		const facts = {};
		for (const [key, member] of Object.entries(raw)) {
			if (key === "contextWindow" || key === "maxTokens") {
				if (typeof member !== "number" || !Number.isSafeInteger(member) || member <= 0) return void 0;
				facts[key] = member;
				continue;
			}
			if (key !== "input") return void 0;
			if (!Array.isArray(member) || member.length === 0) return void 0;
			const modalities = [];
			for (const item of member) {
				if (item !== "text" && item !== "image") return void 0;
				if (!modalities.includes(item)) modalities.push(item);
			}
			facts[key] = modalities;
		}
		if (Object.keys(facts).length > 0) meta[name] = facts;
	}
	return meta;
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
	* Read the catalog, the stored whitelist, and the stored meta overrides.
	* @returns every model the site offers, plus the list and meta the user kept.
	*/
	async state() {
		return {
			models: summarizeModels(await this.deps.routes()),
			enabled: [...this.deps.enabled()],
			meta: { ...this.deps.meta() }
		};
	}
	/**
	* Persist one whitelist, and the meta overrides when the save names them.
	* @param enabled - model names to keep visible; empty restores every model.
	* @param meta - the complete meta overrides; absent keeps the stored ones.
	* @returns resolution after the profile write and its live application.
	* @throws {Error} when the composition has no settings service, so nothing
	* could persist the list.
	*/
	async save(enabled, meta) {
		const settings = this.deps.settings();
		if (settings === void 0) throw new Error("neartoken: the model whitelist needs the settings service");
		await settings.update(this.deps.entryId, {
			enabledModels: [...enabled],
			...meta === void 0 ? {} : { modelMeta: meta }
		});
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
* The configured or declared modalities as the harness vocabulary.
* @param sources - the site's statement and the operator's configuration.
* @returns only the modalities this harness version understands.
*/
function modalitiesOf(sources) {
	return inputModalitiesOf(sources).filter((modality) => modality === "text" || modality === "image");
}
/**
* The reasoning offering for one model, or nothing.
*
* Configured levels win; otherwise they are the ones the site declares. A model
* neither source describes is advertised without any, rather than with levels it
* may not have.
* @param sources - the site's statement and the operator's configuration.
* @returns the reasoning metadata, or undefined for a model without levels.
*/
function reasoningOf(sources) {
	const levels = reasoningLevels(sources);
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
			inputModalities: modalitiesOf({
				...route.input === void 0 ? {} : { reported: route.input },
				...this.deps.modelOverride(route.model)?.input === void 0 ? {} : { declared: this.deps.modelOverride(route.model)?.input }
			})
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
		const reasoning = reasoningOf({
			...route?.reasoning === void 0 ? {} : { reported: route.reasoning },
			...override?.reasoning === void 0 ? {} : { declared: override.reasoning }
		});
		const contextWindow = contextWindowOf({
			...override?.contextWindow === void 0 ? {} : { override: override.contextWindow },
			...route?.contextWindow === void 0 ? {} : { reported: route.contextWindow },
			fallback: this.deps.defaultContextWindow()
		});
		const maxTokens = maxTokensOf(route?.maxTokens, override?.maxTokens);
		const facts = {
			context: { contextWindow },
			inputModalities: modalitiesOf({
				...route?.input === void 0 ? {} : { reported: route.input },
				...override?.input === void 0 ? {} : { declared: override.input }
			}),
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
		const images = await inlineImages(this.deps.attachments(), options.messages, options.signal);
		let response;
		try {
			response = await fetch(wire.url(this.deps.baseURL(), model), {
				method: "POST",
				headers: {
					...attributionHeaders(),
					...wire.headers(key, groupRef)
				},
				body: JSON.stringify(wire.serialize(options, model, images)),
				signal: options.signal
			});
		} catch (error) {
			if (options.signal?.aborted) throw error;
			throw transportFailure(error);
		}
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
* `context_window` / `max_tokens` / `input_modalities` / `reasoning_levels`
* facts. Group names carry their own badge
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
* Read one model's declared input modalities.
* @param value - the raw `input_modalities` member.
* @returns the modalities this harness understands, or undefined when the site declared none.
*/
function inputModalities(value) {
	if (!Array.isArray(value)) return void 0;
	const names = value.filter((entry) => entry === "text" || entry === "image");
	return names.length === 0 ? void 0 : names;
}
/**
* Read one model's declared thinking-effort names.
* @param value - the raw `reasoning_levels` member.
* @returns the declared names in the site's order, or undefined when the site declared none.
*/
function reasoningLevelNames(value) {
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
			...model.endpoints === void 0 ? {} : { endpoints: model.endpoints },
			...model.input === void 0 ? {} : { input: model.input },
			...model.reasoning === void 0 ? {} : { reasoning: model.reasoning }
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
		const input = inputModalities(row.input_modalities);
		const reasoning = reasoningLevelNames(row.reasoning_levels);
		models.push({
			model_name: name,
			enable_groups: groups.filter((group) => typeof group === "string"),
			...contextWindow === void 0 ? {} : { contextWindow },
			...maxTokens === void 0 ? {} : { maxTokens },
			...endpoints === void 0 ? {} : { endpoints },
			...input === void 0 ? {} : { input },
			...reasoning === void 0 ? {} : { reasoning }
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
	* Return the routes a chat request can use, reloading when the cache is
	* older than the TTL.
	* @param force - bypass the TTL and reload now.
	* @returns one route per (group, model); empty when the endpoint is unreachable.
	*/
	async load(force = false) {
		return (await this.catalog(force)).filter((route) => isChatOffering(route.model, route.endpoints));
	}
	/**
	* Return every route the site publishes, picture models included. The model
	* seat drops them; the image-generation setting is what needs them.
	* @param force - bypass the TTL and reload now.
	* @returns one route per (group, model); empty when the endpoint is unreachable.
	*/
	catalog(force = false) {
		const fresh = this.cache !== void 0 && Date.now() - this.cache.at < this.ttlMs();
		if (!force && fresh && this.cache !== void 0) return Promise.resolve(this.cache.routes);
		if (this.inflight !== void 0) return this.inflight;
		const operation = fetch(`${this.baseURL()}/api/pricing`, { headers: { accept: "application/json" } }).then(async (response) => {
			if (!response.ok) throw new Error(`pricing endpoint answered ${response.status}`);
			return expandRoutes(parsePricing(await response.json()));
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
	* Read every route the site publishes, picture models included. The model
	* seat and the adapter only ever see the chat routes.
	* @returns one route per (group, model), from the shared load.
	*/
	async fullCatalog() {
		return await this.pricing.catalog();
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
			modelOverride: this.deps.modelOverride,
			attachments: this.deps.attachments
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
//#region src/host/browser.ts
/**
* Hand one address to the operating system's own browser.
*
* A page cannot do this itself: `window.open` stays inside whatever shell hosts
* the settings page, so on a desktop build it opens another application window
* instead of the user's browser — and on macOS a refused launch does nothing at
* all. The Host is an ordinary process on the user's machine, so it can ask the
* platform's own launcher, which is what the user expects.
*
* @module
*/
/** Schemes a confirmation page may use; anything else is not ours to launch. */
const ALLOWED_PROTOCOLS = ["http:", "https:"];
/**
* How each platform hands a URL to its default browser. Every entry is a
* command plus fixed arguments; the address is appended as the last argument,
* so nothing is ever passed through a shell.
*/
const LAUNCHERS = {
	darwin: ["open"],
	win32: ["rundll32", "url.dll,FileProtocolHandler"],
	linux: ["xdg-open"]
};
/**
* Start a command, detached, and resolve as soon as the process spawned. The
* browser outlives this Host on purpose, so its output is discarded and its
* handle is released.
* @param command - the executable.
* @param args - its arguments.
*/
function runDetached(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			stdio: "ignore",
			detached: true
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}
/**
* Open one address in the user's default browser.
* @param address - the page to open; must be http(s).
* @param platform - the platform to launch on; defaults to this process's.
* @param launcher - the process launcher; injectable so this is testable.
* @throws {Error} when the address is not a page or the platform has no launcher.
*/
async function openInSystemBrowser(address, platform = process.platform, launcher = runDetached) {
	let parsed;
	try {
		parsed = new URL(address);
	} catch {
		throw new Error(`地址不是合法 URL：${address}`);
	}
	if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) throw new Error(`只能打开 http(s) 地址，收到 ${parsed.protocol}`);
	const launcherArgs = LAUNCHERS[platform];
	if (launcherArgs === void 0) throw new Error(`当前平台 ${platform} 没有已知的浏览器打开方式`);
	const [command, ...fixed] = launcherArgs;
	await launcher(command, [...fixed, address]);
}
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
		path: REFRESH_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			req.resume();
			await deps.account.refreshWallet();
			sendJson(res, 200, await deps.account.status());
		}
	}), `neartoken: POST ${REFRESH_PATH}`);
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
		path: OPEN_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			req.resume();
			const { pending } = await deps.account.status();
			if (pending === void 0) {
				sendJson(res, 409, {
					code: "no-authorization",
					message: "没有正在进行的授权"
				});
				return;
			}
			try {
				await deps.openInBrowser(pending.verificationUriComplete);
			} catch (error) {
				sendJson(res, 500, {
					code: "open-failed",
					message: error instanceof Error ? error.message : String(error)
				});
				return;
			}
			sendJson(res, 200, { ok: true });
		}
	}), `neartoken: POST ${OPEN_PATH}`);
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
			let meta;
			if (body.meta !== void 0) {
				meta = parseMeta(body.meta);
				if (meta === void 0) {
					sendJson(res, 400, {
						code: "bad-request",
						message: "meta 必须是每模型的 { contextWindow?, maxTokens?, input? }"
					});
					return;
				}
			}
			try {
				await deps.saveModels(enabled, meta);
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
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: IMAGES_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method === "GET") {
				sendJson(res, 200, await deps.images());
				return;
			}
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "GET, POST");
				return;
			}
			const body = await readJsonObject(req, res, MAX_WHITELIST_BODY_BYTES);
			if (body === void 0) return;
			let refusal;
			try {
				refusal = await deps.saveImages(body);
			} catch (error) {
				sendJson(res, 500, {
					code: "save-failed",
					message: error instanceof Error ? error.message : String(error)
				});
				return;
			}
			if (refusal !== void 0) {
				sendJson(res, 400, {
					code: "bad-request",
					message: refusal.message
				});
				return;
			}
			sendJson(res, 200, { ok: true });
		}
	}), `neartoken: ${IMAGES_PATH}`);
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: TOPUP_PATH$1,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method === "GET") {
				try {
					sendJson(res, 200, await deps.topupInfo());
				} catch (error) {
					sendJson(res, 409, refusalOf(error));
				}
				return;
			}
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "GET, POST");
				return;
			}
			const body = await readJsonObject(req, res, MAX_BODY_BYTES);
			if (body === void 0) return;
			const amount = typeof body.amount === "number" ? body.amount : void 0;
			const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : void 0;
			if (amount === void 0 || paymentMethod === void 0) {
				sendJson(res, 400, {
					code: "bad-request",
					message: "amount 与 paymentMethod 为必填"
				});
				return;
			}
			let order;
			try {
				order = await deps.createTopup(amount, paymentMethod);
			} catch (error) {
				sendJson(res, 409, refusalOf(error));
				return;
			}
			try {
				await deps.openInBrowser(deps.baseURL().replace(/\/$/, "") + order.payUrl);
			} catch (error) {
				sendJson(res, 500, {
					code: "open-failed",
					message: error instanceof Error ? error.message : String(error)
				});
				return;
			}
			sendJson(res, 200, {
				ok: true,
				tradeNo: order.tradeNo
			});
		}
	}), `neartoken: ${TOPUP_PATH$1}`);
}
/**
* Turn a top-up failure into the body the page acts on.
* @param error - whatever the account threw.
* @returns the status-free refusal body.
*/
function refusalOf(error) {
	const reason = error instanceof NearTokenTopupError ? error.reason : "refused";
	return {
		code: reason === "not-dsh" ? "not-dsh" : reason,
		message: error instanceof Error ? error.message : String(error)
	};
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
	* The capacity every model reports when the site does not declare one. Set it
	* below the smallest model the site offers.
	*/
	defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
	/**
	* Per-model corrections, keyed by bare model name: the way to fix a capacity
	* or teach a brand-new model its reasoning levels without publishing a new
	* plugin version. Anything here wins over the site.
	*/
	modelOverrides: z.dict(modelOverride).default({}),
	/**
	* The model whitelist: the catalog models the settings page keeps visible.
	* Empty means no whitelist, so every model the site offers is advertised.
	* Volatile, so the page's save reaches the running plugin through Settings
	* without remounting it.
	*/
	enabledModels: z.array(z.string()).default([]).volatile(),
	/**
	* Per-model meta overrides the settings page edits beside the whitelist,
	* keyed by bare model name. Each member wins over the operator's
	* `modelOverrides` entry and the site's declaration alike; omitted members
	* fall through. Volatile like the whitelist, so the page's save reaches the
	* running plugin without a remount.
	*/
	modelMeta: z.dict(z.object({
		contextWindow: z.number().step(1).min(1),
		maxTokens: z.number().step(1).min(1),
		input: z.array(z.union([z.const("text"), z.const("image")]))
	})).default({}).volatile(),
	/**
	* How long one picture may take. The site's image models routinely need
	* 25-60 seconds, and a discounted group measured 114 seconds on a good day, so
	* the default leaves room for that rather than sitting just above the median.
	*/
	imageTimeoutMs: z.number().step(1).min(5e3).default(3e5),
	/**
	* The image-generation setting: whether the `generate_image` tool is mounted
	* for this profile, and the group each enabled picture model bills to. Off by
	* default — a profile that never draws pays for no tool row. Volatile like the
	* whitelist, so the settings page's save reaches the running plugin without a
	* remount.
	*/
	imageGeneration: z.object({
		/** Whether the tool is mounted. */
		enabled: z.boolean().default(false),
		/** Bare model name to the group name its requests route through. */
		models: z.dict(z.string()).default({})
	}).volatile()
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
		modelOverride: (model) => {
			const base = config.modelOverrides[model];
			const page = config.modelMeta.get()[model];
			if (base === void 0 && page === void 0) return void 0;
			return {
				...base,
				...page
			};
		},
		attachments: () => ctx.get("attachments")
	});
	const whitelist = new NearTokenWhitelist({
		enabled: () => config.enabledModels.get(),
		meta: () => config.modelMeta.get(),
		routes: () => provider.catalog(),
		entryId: SETTINGS_NS,
		settings: () => ctx.get("settings")
	});
	const images = new NearTokenImageClient({
		baseURL: () => config.baseURL,
		apiKey: resolveApiKey,
		routes: async () => await provider.fullCatalog(),
		timeoutMs: () => config.imageTimeoutMs
	});
	const imageSettings = new NearTokenImageSettings({
		stored: () => config.imageGeneration.get(),
		catalog: async () => imageCatalog(await provider.fullCatalog()),
		entryId: SETTINGS_NS,
		settings: () => ctx.get("settings")
	});
	let syncImageTool = () => {};
	ctx.inject(["tools", "attachments"], (toolCtx) => {
		let registered;
		const sync = () => {
			if (config.imageGeneration.get().enabled) {
				if (registered !== void 0) return;
				registered = toolCtx.effect(() => registerGenerateImageTool(toolCtx, {
					settings: () => config.imageGeneration.get(),
					client: images,
					timeoutMs: () => config.imageTimeoutMs
				}), "neartoken: generate_image");
				return;
			}
			if (registered === void 0) return;
			registered();
			registered = void 0;
		};
		syncImageTool = sync;
		sync();
	});
	const account = new NearTokenAccount(ctx, {
		baseURL: () => config.baseURL,
		apiKeyRef: () => config.apiKeyEnv
	}, () => {
		provider.mount();
	});
	account.startWalletRefresh();
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
			openInBrowser: openInSystemBrowser,
			models: () => whitelist.state(),
			saveModels: async (enabled, meta) => {
				await whitelist.save(enabled, meta);
				provider.refresh();
			},
			topupInfo: () => account.topupInfo(),
			createTopup: (amount, paymentMethod) => account.createTopup(amount, paymentMethod),
			baseURL: () => config.baseURL,
			images: () => imageSettings.state(),
			saveImages: async (body) => {
				const patch = parseImagePatch(body, (await imageSettings.state()).models);
				if (patch === void 0) return { message: "图像模型或分组不在站点当前的图像清单里" };
				await imageSettings.save(patch);
				syncImageTool();
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
