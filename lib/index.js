import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";
import { credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import { HarnessError, LlmAdapter, LlmError, ProviderRequestId, attributionHeaders, errorChain, isContextWindowExceededError, isQuotaExceededError } from "@deepseek-ai/dsh-llm";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { brotliCompress, constants } from "node:zlib";
import { promisify } from "node:util";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { brandString } from "@deepseek-ai/dsh-brand";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
/** What is forwarded: the site's own codes are four characters, so this is slack, not a format. */
const AFFILIATE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/**
* One value accepted as an invite code.
* @param value - whatever a page or a request body offered.
* @returns the trimmed code, or undefined when the value is not one.
*/
function normalizeAffiliateCode(value) {
	if (typeof value !== "string") return void 0;
	const code = value.trim();
	return AFFILIATE_PATTERN.test(code) ? code : void 0;
}
/**
* Add the invite code to one of the site's own addresses.
* @param address - the site's confirmation page, as the site issued it.
* @param code - the invite code, when there is one.
* @returns the same address carrying `aff`, or the address unchanged when there
* is no code or the address is not one this module can parse.
*/
function withAffiliateCode(address, code) {
	if (code === void 0) return address;
	let url;
	try {
		url = new URL(address);
	} catch (_error) {
		return address;
	}
	url.searchParams.set("aff", code);
	return url.toString();
}
//#endregion
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
function asObject$2(value) {
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
	const payload = asObject$2(await response.json().catch(() => void 0));
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
function text$3(value) {
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
	* @param affiliateCode - invite code a referring page left on the browser
	* window; it rides along on the confirmation address so the site's own sign-up
	* pages can bind the inviter.
	* @returns the codes and the polling schedule.
	* @throws {NewApiError} when the site refuses or answers without a code.
	*/
	async authorize(clientName, affiliateCode) {
		const body = await callNewApiBody({
			baseURL: this.baseURL(),
			path: DEVICE_AUTHORIZE_PATH,
			method: "POST",
			body: { client_name: clientName }
		});
		if (body.success !== true) throw new NewApiError(`NearToken: 站点拒绝发起设备授权${messageOf$1(body) ? `: ${messageOf$1(body)}` : ""}`, "DEVICE_AUTHORIZE_REFUSED");
		const data = asObject$2(body.data);
		const deviceCode = text$3(data?.device_code);
		const userCode = text$3(data?.user_code);
		const verificationUri = text$3(data?.verification_uri);
		if (deviceCode === void 0 || userCode === void 0 || verificationUri === void 0) throw new NewApiError("NearToken: 设备授权应答缺少 device_code / user_code / verification_uri", "DEVICE_AUTHORIZE_INVALID");
		const expiresIn = num$1(data?.expires_in) ?? 600;
		const interval = num$1(data?.interval) ?? 5;
		return {
			deviceCode,
			userCode,
			verificationUri: withAffiliateCode(verificationUri, affiliateCode),
			verificationUriComplete: withAffiliateCode(text$3(data?.verification_uri_complete) ?? verificationUri, affiliateCode),
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
			const data = asObject$2(body.data);
			const accessToken = text$3(data?.access_token);
			if (accessToken === void 0) throw new NewApiError("NearToken: 设备授权应答缺少 access_token", "DEVICE_TOKEN_INVALID");
			return {
				status: "granted",
				accessToken,
				tokenName: text$3(data?.token_name) ?? "DSH",
				user: asObject$2(data?.user)
			};
		}
		switch (text$3(body.message)) {
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
	return text$3(body.message);
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
/** Read the long-connection switch; POST its new state. */
const LINK_PATH = "/neartoken/link";
/** Read the site's top-up offer; POST one order and open its checkout page. */
const TOPUP_PATH$1 = "/neartoken/topup";
/** How far back the usage overview looks. */
const USAGE_RANGES = [
	"day",
	"week",
	"month"
];
/**
* Whether a value names one of the three windows.
* @param value - any value, typically an untrusted request field.
* @returns true when the value is a window name.
*/
function isUsageRange(value) {
	return typeof value === "string" && USAGE_RANGES.includes(value);
}
/**
* The usage-overview path: `GET ?range=day|week|month` answers a window.
*
* A site that predates the endpoint, or one that cannot be reached, answers
* `available: false` with the reason — the page then says so in one line
* instead of drawing an empty chart that would read as "no usage".
*/
const USAGE_PATH = "/neartoken/usage";
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
	const data = asObject$2(body.data);
	if (data === void 0) return void 0;
	const methods = [];
	if (Array.isArray(data.pay_methods)) for (const entry of data.pay_methods) {
		const method = asObject$2(entry);
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
	const data = asObject$2(body.data);
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
//#region src/host/usage.ts
/** The relay-key-readable usage endpoint, below the site root. */
const DEVICE_USAGE_PATH = "/api/dsh/device/usage";
/** One non-empty string member, or undefined. */
function text$2(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** One finite, non-negative number, or undefined. */
function amount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
/**
* Print one money value the way the site's dashboard does.
* @param value - the amount in the site's display currency.
* @param symbol - the symbol the site prints it with.
* @returns the amount with its symbol.
*/
function moneyText(value, symbol) {
	return `${symbol}${value.toFixed(2)}`;
}
/**
* Read one model row.
* @param value - one member of the site's `models` array, or of a bucket's.
* @param format - how the site prints money.
* @returns the row, or undefined when it does not name a model.
*/
function asModel(value, format) {
	const record = asObject$2(value);
	const model = text$2(record?.model);
	if (model === void 0) return void 0;
	return {
		model,
		tokens: amount(record?.tokens) ?? 0,
		cost: format.value(amount(record?.quota) ?? 0)
	};
}
/**
* Read the site's list of rows, dropping the entries that are not ones.
* @param value - the site's array member.
* @param read - turns one member into a row, or undefined.
* @returns the rows, in the site's order.
*/
function asList(value, read) {
	const rows = [];
	if (!Array.isArray(value)) return rows;
	for (const item of value) {
		const row = read(item);
		if (row !== void 0) rows.push(row);
	}
	return rows;
}
/**
* Read one bucket row.
* @param value - one member of the site's `buckets` array.
* @param format - how the site prints money.
* @returns the bucket, or undefined when it does not carry a timestamp.
*/
function asBucket(value, format) {
	const record = asObject$2(value);
	const timestamp = amount(record?.timestamp);
	if (timestamp === void 0) return void 0;
	return {
		timestamp,
		models: asList(record?.models, (item) => asModel(item, format))
	};
}
/**
* Read one window of the account's usage.
* @param read - the site root, the key, the balance, and the money format.
* @param range - the window to read.
* @returns the window, or why there is none to draw.
*/
async function readUsage(read, range) {
	let body;
	try {
		body = await callNewApiBody({
			baseURL: read.baseURL,
			path: `${DEVICE_USAGE_PATH}?range=${range}`,
			method: "GET",
			sessionToken: read.apiKey
		});
	} catch (_error) {
		return {
			available: false,
			reason: "unreachable"
		};
	}
	const data = asObject$2(body.data);
	const start = amount(data?.start_timestamp);
	const end = amount(data?.end_timestamp);
	const bucketSeconds = amount(data?.bucket_seconds);
	if (body.success !== true || data === void 0 || start === void 0 || end === void 0 || bucketSeconds === void 0 || bucketSeconds <= 0) return {
		available: false,
		reason: "unsupported"
	};
	return {
		available: true,
		range,
		start,
		end,
		bucketSeconds,
		currency: read.format.symbol,
		spent: moneyText(read.format.value(amount(data.quota) ?? 0), read.format.symbol),
		balance: read.balance,
		tokens: amount(data.tokens) ?? 0,
		models: asList(data.models, (item) => asModel(item, read.format)),
		buckets: asList(data.buckets, (item) => asBucket(item, read.format))
	};
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
* The money one quota amount is worth, in the site's display currency.
* @param quota - the raw quota units.
* @param currency - the site's formatting facts.
* @returns the unrounded value.
*/
function moneyValue(quota, currency) {
	const base = currency.quotaPerUnit > 0 ? quota / currency.quotaPerUnit : quota;
	return currency.display && currency.rate > 0 ? base * currency.rate : base;
}
/**
* The symbol the site prints amounts with.
* @param currency - the site's formatting facts.
* @returns the symbol.
*/
function moneySymbol(currency) {
	return currency.display ? "￥" : "$";
}
/**
* Format one quota amount the way the site's dashboard shows it.
* @param quota - the raw quota units.
* @param currency - the site's formatting facts.
* @returns the amount with its symbol.
*/
function money(quota, currency) {
	return `${moneySymbol(currency)}${moneyValue(quota, currency).toFixed(2)}`;
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
		const credit = asObject$2(item);
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
		const data = asObject$2(body.data);
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
			const credit = asObject$2(item);
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
	* The site's money format: the symbol its amounts carry, and the value one raw
	* quota unit is worth.
	*
	* The usage endpoint answers quota units, so the overview's amounts are scaled
	* here — the same facts the wallet card prints with, so the two blocks can
	* never disagree about what a number costs.
	* @returns the symbol and the conversion.
	*/
	async moneyFormat() {
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
		return {
			symbol: moneySymbol(currency),
			value: (quota) => moneyValue(quota, currency)
		};
	}
	/**
	* Read one window of the account's usage: what it spent, how many tokens it
	* billed, and the per-model series the overview stacks by model.
	* @param range - the window to read.
	* @returns the window, or why there is none to draw.
	*/
	async usage(range) {
		const key = await this.read(this.site.apiKeyRef());
		if (key === void 0) return {
			available: false,
			reason: "unreachable"
		};
		await this.loadSummary();
		return await readUsage({
			baseURL: this.site.baseURL(),
			apiKey: key,
			balance: this.summary?.balance ?? "",
			format: await this.moneyFormat()
		}, range);
	}
	/**
	* Start an authorization, or report the one already running.
	* @param affiliateCode - invite code a referring page left on the browser
	* window; forwarded so the site's own sign-up pages can bind the inviter.
	* An authorization already running keeps the code it was started with.
	* @returns the codes the human needs, or why the site refused to issue them.
	*/
	async begin(affiliateCode) {
		const running = this.attempt;
		if (running !== void 0 && running.grant.expiresAt > Date.now()) return {
			status: "pending",
			pending: pendingOf(running.grant)
		};
		this.stop();
		this.error = void 0;
		try {
			const grant = await this.client.authorize(CLIENT_NAME, affiliateCode);
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
		const record = asObject$2(parsed);
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
		const data = asObject$2(await callNewApiBody({
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
//#region src/client-identity.ts
/**
* The plugin's own identity on every request it sends to the site.
*
* Two headers tell the gateway who spoke. `x-dsh-client` is static — the
* plugin and the version that built the request — so the site's usage log can
* mark a record as coming from DSH. `x-dsh-session-id` repeats the harness
* session, which is what lets a sticky-session rule pin one conversation to one
* upstream channel (the same reason `sessionKeyOf` repeats it in the body, see
* `host/session-key.ts`).
*
* The module sits at the package top level on purpose: `../package.json`
* resolves to the package root both from this file in the source tree and from
* the bundled `lib/index.js`, so the version can never be hand-copied and
* drift (the same arrangement as `@deepseek-ai/dsh-llm`'s attribution).
*
* @module
*/
const { version } = createRequire(import.meta.url)("../package.json");
/** The value `x-dsh-client` carries on every request. */
const CLIENT = `dsh-neartoken/${version}`;
/**
* What a legal header value looks like: printable ASCII, no control characters,
* no newlines, bounded length.
*
* A session id that fails this is dropped rather than sent: undici validates
* header values as ByteString, so one non-ASCII character throws and takes the
* whole request down with it.
*/
const HEADER_VALUE = /^[\x20-\x7E]{1,200}$/;
/**
* The identity headers one request to the site carries.
* @param sessionId - the harness session, when the call has one.
* @returns `x-dsh-client` always; `x-dsh-session-id` only for a legal session id.
*/
function clientHeaders(sessionId) {
	const headers = { "x-dsh-client": CLIENT };
	if (sessionId !== void 0 && HEADER_VALUE.test(sessionId)) headers["x-dsh-session-id"] = sessionId;
	return headers;
}
//#endregion
//#region src/host/exa-client.ts
/**
* Exa web search and page fetch over one New API deployment.
*
* The site serves Exa's own API at `/v1/exa/<endpoint>`: the request body is
* Exa's payload unchanged and the answer is Exa's answer, so this module only
* decides the two things the vendor cannot — which group pays for the call, and
* how much of one page may reach the model's context. Billing is decided by the
* endpoint: `/v1/exa/search` is priced under `exa-search`, `/v1/exa/contents`
* under `exa-contents`, and neither request carries a model name.
*
* @module
*/
/** Billing model the site prices one search under. */
const EXA_SEARCH_MODEL = "exa-search";
/** Billing model the site prices one page fetch under. */
const EXA_CONTENTS_MODEL = "exa-contents";
/** Relay path of one Exa endpoint, below the site root. */
const SEARCH_PATH = "/v1/exa/search";
const CONTENTS_PATH = "/v1/exa/contents";
/**
* Pick the catalog group one Exa call bills to.
*
* The same billing model can be offered by several groups at different prices,
* and the site routes by the group reference header, so the caller may name one;
* naming none takes the catalog's first offering rather than guessing at a price
* band.
* @param routes - the expanded catalog routes.
* @param model - the billing model this call is priced under.
* @param requested - the group the caller named, when it named one.
* @returns the chosen group and its routing reference.
* @throws {Error} when the site offers no such model, or not in that group.
*/
function resolveExaGroup(routes, model, requested) {
	const offerings = routes.filter((route) => route.model === model);
	const [first] = offerings;
	if (first === void 0) throw new Error(`this site does not offer ${model}: an administrator has to add an Exa channel serving it`);
	if (requested === void 0 || requested === "") return {
		group: first.group,
		...first.groupRef === void 0 ? {} : { groupRef: first.groupRef }
	};
	const hit = offerings.find((route) => route.group === requested);
	if (hit === void 0) {
		const groups = [...new Set(offerings.map((route) => route.group))].join(", ");
		throw new Error(`${model} is not offered in group "${requested}"; groups offering it: ${groups}`);
	}
	return {
		group: hit.group,
		...hit.groupRef === void 0 ? {} : { groupRef: hit.groupRef }
	};
}
/**
* Cut one block of page text at the character budget.
* @param value - the text as the vendor returned it.
* @param maxCharacters - longest text one page may contribute.
* @returns the text, with a marker when it was cut.
*/
function cutAt(value, maxCharacters) {
	const trimmed = value.trim();
	if (trimmed.length <= maxCharacters) return trimmed;
	return `${trimmed.slice(0, maxCharacters).trimEnd()}\n…[cut at ${String(maxCharacters)} characters]`;
}
/**
* Join the excerpt lines Exa returned for one page.
* @param value - the raw `highlights` member.
* @returns one block of excerpts, or undefined when the vendor sent none.
*/
function highlightsOf(value) {
	if (!Array.isArray(value)) return void 0;
	const lines = value.filter((line) => typeof line === "string" && line.trim().length > 0);
	return lines.length === 0 ? void 0 : lines.join("\n…\n");
}
/**
* Read one text member of a vendor object.
* @param value - the raw member.
* @returns the string, or undefined when it is not one.
*/
function textOf$4(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/**
* Read one vendor result object into the trimmed shape a tool result carries.
* @param url - the result's URL.
* @param raw - the vendor's result object.
* @param maxCharacters - longest excerpt one hit may contribute.
* @returns the hit, or undefined when the vendor sent no usable excerpt.
*/
function hitOf(url, raw, maxCharacters) {
	const excerpt = highlightsOf(raw.highlights) ?? textOf$4(raw.text) ?? textOf$4(raw.summary);
	const title = textOf$4(raw.title);
	const publishedDate = textOf$4(raw.publishedDate);
	return {
		url,
		...title === void 0 ? {} : { title },
		...publishedDate === void 0 ? {} : { publishedDate },
		...excerpt === void 0 ? {} : { snippet: cutAt(excerpt, maxCharacters) }
	};
}
/**
* Read one vendor contents result into the trimmed shape a tool result carries.
* @param url - the page's URL.
* @param raw - the vendor's result object.
* @param mode - the view that was asked for.
* @param maxCharacters - longest text one page may contribute.
* @returns the page, or undefined when the vendor answered without that view.
*/
function pageOf(url, raw, mode, maxCharacters) {
	const content = mode === "text" ? textOf$4(raw.text) : mode === "summary" ? textOf$4(raw.summary) : highlightsOf(raw.highlights);
	if (content === void 0) return void 0;
	const title = textOf$4(raw.title);
	const publishedDate = textOf$4(raw.publishedDate);
	return {
		url,
		...title === void 0 ? {} : { title },
		...publishedDate === void 0 ? {} : { publishedDate },
		content: cutAt(content, maxCharacters)
	};
}
/**
* Read the message out of a refusal, whichever envelope it uses.
*
* A gateway answers `{"error":{"message":…}}`; Exa itself answers
* `{"error":"…"}` beside its own tag. Both mean the same thing to a caller, so
* one reader serves both rather than making the shape the caller's problem.
* @param body - the parsed refusal body, when it parsed.
* @param status - the HTTP status.
* @param fallback - the raw body text, used when nothing structured was found.
* @returns the message to put in the thrown error.
*/
function refusalMessage(body, status, fallback) {
	if (typeof body === "object" && body !== null) {
		const error = body.error;
		if (typeof error === "string" && error.length > 0) return `HTTP ${String(status)}: ${error}`;
		if (typeof error === "object" && error !== null) {
			const message = textOf$4(error.message);
			if (message !== void 0) return `HTTP ${String(status)}: ${message}`;
		}
		const message = textOf$4(body.message);
		if (message !== void 0) return `HTTP ${String(status)}: ${message}`;
	}
	return `HTTP ${String(status)}: ${fallback.slice(0, 400)}`;
}
/**
* The Exa payload one search sends.
* @param args - the resolved search arguments.
* @returns the vendor body.
*/
function searchBody(args) {
	return {
		query: args.query,
		type: args.type,
		numResults: args.numResults,
		contents: { highlights: { maxCharacters: args.maxCharacters } },
		...args.includeDomains === void 0 || args.includeDomains.length === 0 ? {} : { includeDomains: [...args.includeDomains] },
		...args.excludeDomains === void 0 || args.excludeDomains.length === 0 ? {} : { excludeDomains: [...args.excludeDomains] },
		...args.startPublishedDate === void 0 ? {} : { startPublishedDate: args.startPublishedDate },
		...args.endPublishedDate === void 0 ? {} : { endPublishedDate: args.endPublishedDate }
	};
}
/**
* The Exa payload one page fetch sends.
* @param args - the resolved fetch arguments.
* @returns the vendor body.
*/
function contentsBody(args) {
	return {
		ids: [...args.urls],
		[args.mode]: { maxCharacters: args.maxCharacters }
	};
}
/** Read a parsed JSON answer as one object, or refuse it. */
function asObject$1(value) {
	return typeof value === "object" && value !== null ? value : {};
}
/**
* Read the vendor id of one result, which is its URL on this API.
* @param raw - the vendor's result object.
* @returns the URL, or undefined when the object carries none.
*/
function urlOf(raw) {
	return textOf$4(raw.url) ?? textOf$4(raw.id);
}
/**
* Ask one New API deployment to search the web through Exa.
*
* One call is one billed search: the site prices it by the search depth and the
* result count the body asks for, so the arguments decide the price before the
* request is sent.
*/
var NearTokenExaClient = class {
	deps;
	/**
	* @param deps - the site root, the key, the catalog, and the time budget.
	*/
	constructor(deps) {
		this.deps = deps;
	}
	/**
	* Search the web.
	* @param args - the query, the depth, the result count, and the caller's cancellation.
	* @returns the hits, trimmed to the character budget.
	* @throws {Error} when the site refuses the call or answers without results.
	*/
	async search(args) {
		const { group, groupRef } = resolveExaGroup(await this.deps.routes(), EXA_SEARCH_MODEL, args.group);
		const body = await this.post(SEARCH_PATH, searchBody(args), groupRef, args.signal);
		const results = [];
		const rawResults = body.results;
		if (Array.isArray(rawResults)) for (const entry of rawResults) {
			const raw = asObject$1(entry);
			const url = urlOf(raw);
			if (url === void 0) continue;
			const hit = hitOf(url, raw, args.maxCharacters);
			if (hit !== void 0) results.push(hit);
		}
		const requestId = textOf$4(body.requestId);
		return {
			group,
			...requestId === void 0 ? {} : { requestId },
			results
		};
	}
	/**
	* Fetch pages the caller already has URLs for.
	* @param args - the URLs, the view to read them as, and the caller's cancellation.
	* @returns one page per URL Exa answered, trimmed to the character budget.
	* @throws {Error} when the site refuses the call.
	*/
	async contents(args) {
		const { group, groupRef } = resolveExaGroup(await this.deps.routes(), EXA_CONTENTS_MODEL, args.group);
		const body = await this.post(CONTENTS_PATH, contentsBody(args), groupRef, args.signal);
		const pages = [];
		const rawResults = body.results;
		if (Array.isArray(rawResults)) for (const entry of rawResults) {
			const raw = asObject$1(entry);
			const url = urlOf(raw);
			if (url === void 0) continue;
			const page = pageOf(url, raw, args.mode, args.maxCharacters);
			if (page !== void 0) pages.push(page);
		}
		const requestId = textOf$4(body.requestId);
		return {
			group,
			...requestId === void 0 ? {} : { requestId },
			pages
		};
	}
	/**
	* POST one vendor body to the relay and read the answer.
	* @param path - the relay path of the Exa endpoint.
	* @param body - the vendor payload.
	* @param groupRef - the routing reference of the group that pays, when the site published one.
	* @param external - the caller's cancellation.
	* @returns the parsed answer.
	* @throws {Error} when the call fails, or the site answers something unreadable.
	*/
	async post(path, body, groupRef, external) {
		const timeoutMs = this.deps.timeoutMs();
		const budget = AbortSignal.timeout(timeoutMs);
		const signal = external === void 0 ? budget : AbortSignal.any([external, budget]);
		const key = await this.deps.apiKey();
		const response = await (this.deps.fetch ?? fetch)(`${this.deps.baseURL()}${path}`, {
			method: "POST",
			headers: {
				...attributionHeaders(),
				...clientHeaders(),
				"content-type": "application/json",
				authorization: `Bearer ${key}`,
				...groupRef === void 0 ? {} : { "x-neartoken-group": groupRef }
			},
			body: JSON.stringify(body),
			signal
		}).catch((error) => {
			if (!budget.aborted) throw error;
			throw new Error(`the site did not answer ${path} within ${String(Math.round(timeoutMs / 1e3))}s (exaTimeoutMs); a search is usually a second or two, so the site is probably overloaded`, { cause: error });
		});
		const text = await response.text();
		let parsed;
		try {
			parsed = text.length === 0 ? {} : JSON.parse(text);
		} catch {
			parsed = void 0;
		}
		if (!response.ok) throw new Error(refusalMessage(parsed, response.status, text));
		if (parsed === void 0) throw new Error(`the site answered ${path} with a body that is not JSON: ${text.slice(0, 200)}`);
		return asObject$1(parsed);
	}
};
//#endregion
//#region src/host/exa-tools.ts
/**
* Slack between the call budget and the tool-call deadline.
*
* The harness's timeout policy arms its own deadline and replaces a late result
* with a bare "tool call timed out"; staying a little under it means the model
* usually gets the useful message instead, while an upstream that ignores its
* abort is still caught.
*/
const DEADLINE_MARGIN_MS$1 = 15e3;
/** Deepest search the tool offers: the priced tiers the site's catalog names. */
const SEARCH_TYPES = [
	"auto",
	"lite",
	"deep"
];
/** The views one fetch may ask for. */
const CONTENT_MODES = [
	"highlights",
	"text",
	"summary"
];
/**
* Resolve the group one call bills to.
* @param settings - the operator's stored setting.
* @param requested - the group the caller named, when it named one.
* @returns the group to bill, or undefined to take the catalog's first offering.
*/
function pickExaGroup(settings, requested) {
	if (requested !== void 0 && requested !== "") return requested;
	return settings.group === "" ? void 0 : settings.group;
}
/**
* Bound a caller's result count by the operator's budget.
* @param settings - the operator's stored setting.
* @param requested - the count the caller asked for.
* @returns a count between one and the operator's ceiling.
*/
function boundResultCount(settings, requested) {
	const ceiling = Math.max(1, settings.maxResults);
	if (requested === void 0 || !Number.isFinite(requested)) return ceiling;
	return Math.min(ceiling, Math.max(1, Math.trunc(requested)));
}
/**
* Format one search as the model-facing envelope.
* @param value - the finished search.
* @returns the text block the tool result carries.
*/
function formatSearchOutput(value) {
	const lines = value.results.map((hit, index) => {
		return `${`${String(index + 1)}. ${hit.title ?? hit.url}`}\n   ${[hit.url, hit.publishedDate].filter((part) => part !== void 0).join(" · ")}${hit.snippet === void 0 ? "" : `\n   ${hit.snippet.replaceAll("\n", "\n   ")}`}`;
	});
	return `<group>${value.group}</group>
<results count="${String(value.results.length)}">
${lines.length === 0 ? "No page matched this query." : lines.join("\n")}
</results>`;
}
/**
* Format one page fetch as the model-facing envelope.
* @param value - the finished fetch.
* @returns the text block the tool result carries.
*/
function formatFetchOutput(value) {
	const pages = value.pages.map((page) => {
		const meta = [page.publishedDate].filter((part) => part !== void 0).join(" · ");
		return `<page url="${page.url}"${page.title === void 0 ? "" : ` title="${page.title.replaceAll("\"", "&quot;")}"`}${meta === "" ? "" : ` published="${meta}"`}>
${page.content}
</page>`;
	});
	return `<group>${value.group}</group>
${pages.length === 0 ? "The pages carried no readable content." : pages.join("\n")}`;
}
/** One text block: what both tools answer with. */
function textBlock(text) {
	return [{
		type: "text",
		text
	}];
}
/**
* Register `exa_search` and `exa_fetch`.
* @param ctx - a context carrying `tools`.
* @param deps - the stored setting and the Exa client.
* @returns the disposer that unmounts both tools.
*/
function registerExaTools(ctx, deps) {
	const search = ctx.tools.register(defineTool({
		name: "exa_search",
		description: "Search the web and get the part of each page that answers the query, with its URL. Results are excerpts, not whole pages, so this is the cheap way to find out what exists; follow up with exa_fetch on the URLs worth reading in full. Write the query as the thing you want to find, in natural language; use includeDomains/excludeDomains to pin or drop a site instead of putting site: in the query. The search depth sets the price: lite is cheapest and shallow, auto (the default) handles ordinary questions, deep spends several seconds and dollars on hard research. Each call is billed to the operator's Exa group.",
		parameters: {
			query: {
				type: "string",
				required: true,
				description: "What to find, in natural language."
			},
			numResults: {
				type: "integer",
				description: "How many pages to return; the operator sets the ceiling (default 8)."
			},
			type: {
				type: "string",
				enum: [...SEARCH_TYPES],
				description: "Search depth: lite (cheapest), auto (default, ordinary questions), deep (multi-step research)."
			},
			includeDomains: {
				type: "array",
				items: { type: "string" },
				description: "Only return pages from these domains, e.g. [\"docs.exa.ai\"]."
			},
			excludeDomains: {
				type: "array",
				items: { type: "string" },
				description: "Never return pages from these domains."
			},
			startPublishedDate: {
				type: "string",
				description: "Only pages published after this ISO 8601 date."
			},
			endPublishedDate: {
				type: "string",
				description: "Only pages published before this ISO 8601 date."
			},
			group: {
				type: "string",
				description: "Billing group to use; omit to use the operator's default group."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					group: {
						type: "string",
						required: true,
						description: "Group the call was billed to."
					},
					requestId: {
						type: "string",
						description: "Vendor request id, for tracing one call."
					},
					results: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								url: {
									type: "string",
									required: true
								},
								title: { type: "string" },
								publishedDate: { type: "string" },
								snippet: {
									type: "string",
									description: "Excerpt the vendor selected for this query."
								}
							}
						}
					}
				}
			},
			render: (_args, value) => textBlock(formatSearchOutput(value)),
			presentationMeta: (_args, value) => ({
				group: value.group,
				results: value.results.length
			})
		},
		timeoutMs: deps.timeoutMs() + DEADLINE_MARGIN_MS$1,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const settings = deps.settings();
			if (!settings.enabled) throw new Error("Exa web search is off: turn it on in Settings → NearToken → Web search");
			const group = pickExaGroup(settings, args.group);
			return await deps.client.search({
				query: args.query,
				type: SEARCH_TYPES.find((type) => type === args.type) ?? "auto",
				numResults: boundResultCount(settings, args.numResults),
				maxCharacters: settings.maxCharacters,
				...group === void 0 ? {} : { group },
				...args.includeDomains === void 0 ? {} : { includeDomains: args.includeDomains },
				...args.excludeDomains === void 0 ? {} : { excludeDomains: args.excludeDomains },
				...args.startPublishedDate === void 0 ? {} : { startPublishedDate: args.startPublishedDate },
				...args.endPublishedDate === void 0 ? {} : { endPublishedDate: args.endPublishedDate },
				signal: exec.signal
			});
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Search the web for "${args.query}"`,
				kind: "other",
				rawInput: args.query
			};
		}
	}));
	const fetchTool = ctx.tools.register(defineTool({
		name: "exa_fetch",
		description: "Read pages you already have URLs for and get their text, key excerpts, or a summary. Use it after exa_search when a result matters, or when the user pastes links. Prefer highlights for \"what does this page say about X\"; use text when the whole document matters (it is cut at the operator's character budget), and summary when it is long and only the gist is needed. Each page is billed under the operator's Exa contents group.",
		parameters: {
			urls: {
				type: "array",
				items: { type: "string" },
				required: true,
				description: "Pages to read, as absolute http(s) URLs."
			},
			mode: {
				type: "string",
				enum: [...CONTENT_MODES],
				description: "highlights (default): excerpts relevant to the task; text: the page body; summary: an AI summary."
			},
			group: {
				type: "string",
				description: "Billing group to use; omit to use the operator's default group."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					group: {
						type: "string",
						required: true,
						description: "Group the call was billed to."
					},
					requestId: {
						type: "string",
						description: "Vendor request id, for tracing one call."
					},
					pages: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								url: {
									type: "string",
									required: true
								},
								title: { type: "string" },
								publishedDate: { type: "string" },
								content: {
									type: "string",
									required: true,
									description: "The requested view of the page."
								}
							}
						}
					}
				}
			},
			render: (_args, value) => textBlock(formatFetchOutput(value)),
			presentationMeta: (_args, value) => ({
				group: value.group,
				pages: value.pages.length
			})
		},
		timeoutMs: deps.timeoutMs() + DEADLINE_MARGIN_MS$1,
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const settings = deps.settings();
			if (!settings.enabled) throw new Error("Exa web search is off: turn it on in Settings → NearToken → Web search");
			const urls = args.urls.filter((url) => /^https?:\/\//i.test(url));
			if (urls.length === 0) throw new Error("exa_fetch needs at least one absolute http(s) URL");
			const group = pickExaGroup(settings, args.group);
			return await deps.client.contents({
				urls,
				mode: CONTENT_MODES.find((mode) => mode === args.mode) ?? "highlights",
				maxCharacters: settings.maxCharacters,
				...group === void 0 ? {} : { group },
				signal: exec.signal
			});
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Read ${String(args.urls.length)} page${args.urls.length === 1 ? "" : "s"}`,
				kind: "other",
				rawInput: args.urls.join("\n")
			};
		}
	}));
	return () => {
		search();
		fetchTool();
	};
}
/** Brotli quality to encode at: past this a smaller body costs real CPU. */
const QUALITY = 5;
/** The header pair that announces a brotli body. */
const BROTLI_HEADERS = { "content-encoding": "br" };
const compress = promisify(brotliCompress);
/** One body in the clear: the shape every bail-out below returns. */
const CLEAR = {
	headers: {},
	compressed: false
};
/**
* POST one JSON body, compressed when that pays for itself.
*
* The one place a call leaves this plugin, so the threshold, the encoding, and
* the fallback below cannot drift between the chat wires and the picture
* channel.
* @param send - the HTTP carrier, so a test or a caller can substitute one.
* @param url - absolute endpoint.
* @param request - headers, body, and cancellation.
* @returns the response, compressed or not; never a response the caller has to discard.
*/
async function postJson(send, url, request) {
	const encoded = await encodeBody(request.json);
	const post = (payload, encoding) => send(url, {
		method: "POST",
		headers: {
			...request.headers,
			...encoding
		},
		body: payload,
		signal: request.signal
	});
	const response = await post(encoded.body, encoded.headers);
	if (response.status !== 400 || !encoded.compressed) return response;
	await response.body?.cancel().catch(() => {});
	return post(request.json, {});
}
/**
* Compress one request body, when that pays for itself.
*
* Compression is an optimization on top of a request that must go out either
* way, so every failure here — a runtime without brotli, a body that does not
* shrink, an encoder error — sends the body in the clear rather than failing
* the call.
* @param json - the serialized request body.
* @returns the bytes to send, the headers they need, and whether they are packed.
*/
async function encodeBody(json) {
	const bytes = Buffer.byteLength(json, "utf8");
	if (bytes < 16384) return {
		body: json,
		...CLEAR
	};
	try {
		const packed = await compress(Buffer.from(json, "utf8"), { params: { [constants.BROTLI_PARAM_QUALITY]: QUALITY } });
		if (packed.byteLength >= bytes) return {
			body: json,
			...CLEAR
		};
		return {
			body: new Uint8Array(packed),
			headers: BROTLI_HEADERS,
			compressed: true
		};
	} catch {
		return {
			body: json,
			...CLEAR
		};
	}
}
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
/** The site's durable-task surface for picture models. */
const TASKS_PATH = "/v1/images/tasks";
/** The synchronous picture surface: a site without tasks, and a site that answers one here anyway. */
const GENERATIONS_PATH = "/v1/images/generations";
/** The site's edit surface: a picture to start from and what to change about it. */
const EDITS_PATH = "/v1/images/edits";
/**
* Statuses that mean this site has no usable edit route for the request as it
* was shaped: the route does not exist (404/405) or the site will only take a
* multipart edit body (415). The reference pictures then ride the generation
* submit instead, as they did before the route existed.
*
* A 400 is deliberately absent: that is a rejected request, not a missing
* route, and replaying it on another endpoint would bill a second generation.
*/
const EDIT_UNSUPPORTED_STATUS = /* @__PURE__ */ new Set([
	404,
	405,
	415
]);
/** First poll interval, and the ceiling it backs off to (HANDOFF-new-api.md part 7). */
const POLL_FIRST_MS = 3e3;
const POLL_MAX_MS = 5e3;
/** How much each poll adds before it reaches {@link POLL_MAX_MS}. */
const POLL_STEP_MS = 1e3;
/**
* Statuses worth re-reading the same task for: a gateway's own failure says
* nothing about the task, which is still running behind it.
*/
const TRANSIENT_STATUS = /* @__PURE__ */ new Set([
	408,
	425,
	429,
	500,
	502,
	503,
	504
]);
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
			throw new Error(`the site did not return an image within ${String(Math.round(timeoutMs / 1e3))}s (imageTimeoutMs); ${request.model} can be this slow — a submitted task keeps running on the site and is billed when it finishes, so raise imageTimeoutMs or enable a faster image model`, { cause: error });
		});
	}
	/**
	* One generation under the time budget: the channel decides whether the
	* picture comes back in the answer or has to be waited for, and both shapes
	* end as one picture reference.
	* @param request - the call, already resolved to a channel and group.
	* @returns the encoded picture.
	*/
	async attempt(request) {
		const pictures = request.images ?? [];
		const reply = request.channel === "images" ? pictures.length === 0 ? await this.imagesReply(request, pictures) : await this.editReply(request, pictures) : await this.chatReply(request, pictures);
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
	/** The headers every picture call carries; only the credential header is the channel's own. */
	requestHeaders(request) {
		return {
			...attributionHeaders(),
			...clientHeaders(),
			"content-type": "application/json",
			...request.channel === "genai" ? { "x-goog-api-key": request.key } : { authorization: `Bearer ${request.key}` },
			...request.route?.groupRef === void 0 ? {} : { "x-neartoken-group": request.route.groupRef }
		};
	}
	/** The headers a poll carries: the same credential, no routing decision left to make. */
	pollHeaders(request) {
		return {
			...attributionHeaders(),
			...clientHeaders(),
			authorization: `Bearer ${request.key}`
		};
	}
	/**
	* The serialized body one channel sends.
	* @param request - the attempt.
	* @param pictures - reference pictures, already encoded.
	* @returns the JSON body.
	*/
	requestBody(request, pictures) {
		return JSON.stringify(request.channel === "images" ? {
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
		});
	}
	/**
	* The serialized body of an edit: what to change, and the pictures to change.
	*
	* `images` is the OpenAI Images edit member (a JSON body, so each picture is
	* a data URL rather than a file part); `size`, `quality`, and `background`
	* mean the same thing here as on a generation.
	* @param request - the attempt.
	* @param pictures - reference pictures, already encoded.
	* @returns the JSON body.
	*/
	editBody(request, pictures) {
		return JSON.stringify({
			model: request.model,
			prompt: request.prompt,
			n: 1,
			...request.size === void 0 ? {} : { size: request.size },
			...request.quality === void 0 ? {} : { quality: request.quality },
			...request.background === void 0 ? {} : { background: request.background },
			images: pictures.map((picture) => `data:${picture.mediaType};base64,${picture.data}`)
		});
	}
	/**
	* One refusal, carrying the status and the site's own words.
	* @param request - the attempt that was refused.
	* @param response - the site's answer.
	* @returns the error to throw.
	*/
	async refusal(request, response) {
		const detail = (await response.text()).slice(0, 400);
		return /* @__PURE__ */ new Error(`the site refused ${request.model} with HTTP ${String(response.status)}: ${detail}`);
	}
	/**
	* The chat-shaped channels: one request that answers the picture.
	* @param request - the attempt.
	* @param pictures - reference pictures, already encoded.
	* @returns the picture reference, or undefined when the answer carries none.
	*/
	async chatReply(request, pictures) {
		const path = request.channel === "genai" ? `/v1beta/models/${request.model}:generateContent` : "/v1/chat/completions";
		const response = await postJson(request.send, `${this.deps.baseURL()}${path}`, {
			headers: this.requestHeaders(request),
			json: this.requestBody(request, pictures),
			signal: request.signal
		});
		if (!response.ok) throw await this.refusal(request, response);
		return extractImageReply(await response.json());
	}
	/**
	* The edit route: reference pictures on the surface the site checks for them.
	*
	* The answer is read the same way as a generation's — a picture now, or a
	* task id to poll when the model is one a task plugin claims — because the
	* route differs, not the currency of the reply.
	* @param request - the attempt.
	* @param pictures - reference pictures, already encoded; never empty here.
	* @returns the picture reference the answer carries.
	*/
	async editReply(request, pictures) {
		const response = await postJson(request.send, `${this.deps.baseURL()}${EDITS_PATH}`, {
			headers: this.requestHeaders(request),
			json: this.editBody(request, pictures),
			signal: request.signal
		});
		if (EDIT_UNSUPPORTED_STATUS.has(response.status)) {
			await response.body?.cancel().catch(() => {});
			return this.imagesReply(request, pictures);
		}
		if (!response.ok) throw await this.refusal(request, response);
		const body = await response.json();
		const taskId = taskIdOf(body);
		if (taskId === void 0) return extractImageReply(body);
		return this.settleTask(request, taskId);
	}
	/**
	* The `images` channel: a durable task when the site runs one, the picture
	* itself when it does not.
	*
	* Which of the two an answer is, is the answer's own business — a task id
	* means polling, `data[]` means the picture is already here, and a 404 means
	* this site predates the task endpoint. Choosing by configuration would break
	* the moment the site ships or drops a task plugin.
	* @param request - the attempt.
	* @param pictures - reference pictures, already encoded.
	* @returns the picture reference the answer carries.
	*/
	async imagesReply(request, pictures) {
		const submitted = await postJson(request.send, `${this.deps.baseURL()}${TASKS_PATH}`, {
			headers: this.requestHeaders(request),
			json: this.requestBody(request, pictures),
			signal: request.signal
		});
		if (submitted.status === 404) {
			await submitted.body?.cancel().catch(() => {});
			return this.syncImagesReply(request, pictures);
		}
		if (!submitted.ok) throw await this.refusal(request, submitted);
		const body = await submitted.json();
		const taskId = taskIdOf(body);
		if (taskId === void 0) return extractImageReply(body);
		return this.settleTask(request, taskId);
	}
	/**
	* The synchronous images route, for a site that answers 404 on submit.
	* @param request - the attempt.
	* @param pictures - reference pictures, already encoded.
	* @returns the picture reference the answer carries.
	*/
	async syncImagesReply(request, pictures) {
		const response = await postJson(request.send, `${this.deps.baseURL()}${GENERATIONS_PATH}`, {
			headers: this.requestHeaders(request),
			json: this.requestBody(request, pictures),
			signal: request.signal
		});
		if (!response.ok) throw await this.refusal(request, response);
		return extractImageReply(await response.json());
	}
	/**
	* Poll one submitted task until the site reports a terminal state.
	*
	* Polling is the only retry: a transient gateway failure or a dropped
	* connection re-reads the same task, so a flaky link never submits — and
	* bills — a second generation. The caller's budget is the exit; once it
	* fires the task keeps running on the site and is billed when it finishes.
	* @param request - the attempt that submitted the task.
	* @param taskId - the id the submit answer carried.
	* @returns the picture reference the finished task carries.
	* @throws {Error} when the task fails, disappears, or the budget runs out.
	*/
	async settleTask(request, taskId) {
		const poll = this.deps.poll?.() ?? {
			firstMs: POLL_FIRST_MS,
			maxMs: POLL_MAX_MS
		};
		const url = `${this.deps.baseURL()}${TASKS_PATH}/${encodeURIComponent(taskId)}`;
		let waitMs = poll.firstMs;
		for (;;) {
			await waitFor(waitMs, request.signal);
			waitMs = Math.min(poll.maxMs, waitMs + POLL_STEP_MS);
			let response;
			try {
				response = await request.send(url, {
					headers: this.pollHeaders(request),
					signal: request.signal
				});
			} catch (error) {
				if (request.signal.aborted) throw error;
				continue;
			}
			if (response.status === 404) throw new Error(`the site no longer has task ${taskId} (HTTP 404): its result expired or the account changed; submit again`);
			if (!response.ok) {
				if (!TRANSIENT_STATUS.has(response.status) || request.signal.aborted) throw await this.refusal(request, response);
				await response.body?.cancel().catch(() => {});
				continue;
			}
			const body = await response.json();
			const status = taskStatusOf(body);
			if (status === "SUCCESS") return extractImageReply(body);
			if (status === "FAILURE") throw new Error(`the site reported task ${taskId} as FAILURE: ${taskFailureReason(body)}`);
		}
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
/**
* The task id an answer carries, when it carries one.
* @param body - the parsed answer.
* @returns the id, or undefined when this was not a task answer.
*/
function taskIdOf(body) {
	if (typeof body !== "object" || body === null) return void 0;
	const id = body.task_id;
	return typeof id === "string" && id.length > 0 ? id : void 0;
}
/**
* The task state one answer carries, upper-cased.
* @param body - the parsed answer.
* @returns the state, or an empty string when the answer names none.
*/
function taskStatusOf(body) {
	if (typeof body !== "object" || body === null) return "";
	const status = body.status;
	return typeof status === "string" ? status.toUpperCase() : "";
}
/**
* Why the site reported a task as failed.
* @param body - the parsed task answer.
* @returns the site's own reason, or a generic one when it gave none.
*/
function taskFailureReason(body) {
	const record = typeof body === "object" && body !== null ? body : {};
	const error = record.error;
	const detail = typeof error === "object" && error !== null ? error.message : void 0;
	return ((typeof record.fail_reason === "string" && record.fail_reason.length > 0 ? record.fail_reason : typeof detail === "string" && detail.length > 0 ? detail : void 0) ?? "image generation failed").slice(0, 400);
}
/**
* Wait one poll interval, ending early when the generation is cancelled.
* @param ms - how long to wait; the tests pass zero to poll without waiting.
* @param signal - the generation's cancellation and time budget.
*/
async function waitFor(ms, signal) {
	if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("the image generation was cancelled");
	if (ms <= 0) return;
	await new Promise((resolve, reject) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", cancel);
		};
		const cancel = () => {
			done();
			reject(signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("the image generation was cancelled"));
		};
		const timer = setTimeout(() => {
			done();
			resolve();
		}, ms);
		signal.addEventListener("abort", cancel, { once: true });
	});
}
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
		description: "Generate one image from a text prompt with the configured image model (the gpt-image, nano-banana, and gemini image families) and return the image itself. A call takes 20-60 seconds, and a queued or slow model can take minutes. Write the prompt as a full description of the picture you want; quoted text that must appear in the image is rendered by the model, but long lines may smear. Pass images to edit or compose from existing files and say what to keep and what to change; the first reference picture also sets the output aspect ratio. The available models are the ones the operator enabled in Settings → NearToken → Image generation.",
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
/**
* Wording the gateway uses when a functionCall turn was not answered by the same
* number of functionResponse parts.
*
* A Gemini batch lands here whenever its results were sent one user turn each;
* no retry clears it, because the conversation that produced the refusal is
* replayed unchanged.
*/
const FUNCTION_RESPONSE_MISMATCH = /number of function response parts/iu;
/** What the user can do about a refusal the plugin itself cannot repair. */
const FUNCTION_RESPONSE_MISMATCH_HINT = " 提示：Gemini 原生协议下这批工具结果与调用对不上，重试不会成功；请升级 neartoken 插件，或换用别的模型后新开会话";
/**
* Wording the gateway uses when a replayed Gemini turn lost the signature its
* function calls must carry back.
*
* Only a turn whose signature was never recorded reaches this: the plugin
* sends the value the upstream issued or nothing at all, never a substitute,
* so the conversation cannot be repaired from this side.
*/
const MISSING_THOUGHT_SIGNATURE = /thought_signature/iu;
/** What the user can do about it. */
const MISSING_THOUGHT_SIGNATURE_HINT = " 提示：这轮工具调用没有记录上游签发的 thought_signature（旧会话、或中途换过模型），回放会被 Gemini 拒绝；插件不会伪造签名，请用该模型新开会话";
/**
* The code a New API site answers with when it suspended this account's model
* access over repeated upstream content-safety rejections.
*
* The fix lives in the site console, not in the key, so the refusal text says
* which of the two it is.
*/
const MODEL_ACCESS_RESTRICTED_CODE = "model_access_restricted";
/** What the account holder can do about that suspension. */
const MODEL_ACCESS_RESTRICTED_HINT = " 提示：站点已暂停该账号的模型访问（多次上游内容安全拒绝），与 API Key 无关；请登录站点控制台提交解除申请";
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
* Codes follow the shared taxonomy: AUTH only for credentials the gateway
* refused (401, `authentication_error`, `permission_error`), QUOTA for an
* exhausted balance, RATE_LIMIT for throttling, SERVER for the gateway's own
* failures, INVALID_REQUEST for a request it will always reject, and
* `HTTP_<status>` for anything else. A 403 stays distinct: a gateway answers
* it for a policy or account suspension as readily as for a bad key, and the
* client renders AUTH as "the API key is invalid", which would report a
* suspension as a credential problem. Only RATE_LIMIT and SERVER are transient
* by default; the policy provider owns the rest.
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
	if (status === 401 || type === "authentication_error" || type === "permission_error") code = "AUTH";
	else if (isQuotaExceededError(detail) || status === 402) code = "QUOTA";
	else if (status === 429 || type === "rate_limit_error") code = "RATE_LIMIT";
	else if (isContextWindowExceededError(detail)) code = "CONTEXT_WINDOW_EXCEEDED";
	else if (status === 400 || status === 413 || type === "invalid_request_error") code = "INVALID_REQUEST";
	else if (status >= 500 || type === "api_error" || type === "overloaded_error") code = "SERVER";
	else code = `HTTP_${status}`;
	const retry = headers?.get("retry-after");
	const delay = retry == null ? NaN : /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) * 1e3 : Date.parse(retry) - Date.now();
	const id = headers?.get("request-id") ?? headers?.get("x-request-id");
	const hint = error?.code === MODEL_ACCESS_RESTRICTED_CODE ? MODEL_ACCESS_RESTRICTED_HINT : code === "INVALID_REQUEST" && MISSING_THOUGHT_SIGNATURE.test(detail) ? MISSING_THOUGHT_SIGNATURE_HINT : code === "INVALID_REQUEST" && FUNCTION_RESPONSE_MISMATCH.test(detail) ? FUNCTION_RESPONSE_MISMATCH_HINT : "";
	return new LlmError(`NearToken answered ${status}: ${(embeddedMessage(body) ?? body).slice(0, 500)}${hint}`, code, {
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
* Classify a transport-level failure: the request or its body read never
* finished.
*
* undici wraps the underlying cause in a `TypeError: fetch failed` before a
* response exists, and fails an established body read with a bare
* `TypeError: terminated` when the socket drops mid-answer; the chain is
* rendered into the message either way, so the real failure (DNS, TLS, reset,
* dropped socket) is not masked by the wrapper.
* @param error - the value the fetch or the body read rejected with.
* @returns the classified error, chained to the original.
*/
function transportFailure(error) {
	return new LlmError(`NearToken transport failed: ${errorChain(error).slice(0, 500)}`, "TRANSPORT", { cause: error });
}
//#endregion
//#region src/host/route-id.ts
/**
* The two parts of a catalog model id.
*
* A catalog id is `"<group>::<model>"`, where the group is display text that
* may itself contain `::` and the separator that matters is the one closest to
* the model. The request body carries the bare model only, so every place that
* has to compare a stored id with a sent one decodes first.
*
* @module
*/
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
//#region src/host/wire-call-id.ts
/**
* The id one tool call travels under on every model wire.
*
* The Responses wire caps `call_id` at 64 characters and chat completions caps
* `tool_call_id` the same way, while the messages API only tolerates
* `[A-Za-z0-9_-]`. The harness keeps whatever id produced its history, which
* includes composite ids such as `call_<call id>|<item id>` handed down by a
* provider that pairs its own item id with the wire call id — those run past
* the cap, and one such turn fails every request that replays it.
* @module
*/
/** The longest tool-call id the model APIs accept. */
const WIRE_CALL_ID_LIMIT = 64;
/** The characters every one of those APIs accepts in an id. */
const WIRE_CALL_ID_CHARS = /^[A-Za-z0-9_-]+$/;
/**
* Shorten one harness tool-call id to something the wire accepts.
*
* The replacement is a pure digest of the original, so a call and the result
* that answers it land on the same id without either pass carrying state: the
* assistant turn and the tool message are serialized separately.
* @param id - the harness tool-call id.
* @returns the id to send; unchanged when it is already acceptable.
*/
function wireCallId(id) {
	if (id.length <= WIRE_CALL_ID_LIMIT && WIRE_CALL_ID_CHARS.test(id)) return id;
	return `call_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
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
* Default request-image bounds.
*
* A model reads a picture through a fixed visual grid, so bytes past roughly
* 2048 pixels on the long edge buy no detail while still costing upload time and
* base64 in the prompt. 2 MiB is the ceiling the harness's own DeepSeek routes
* use for one encoded request image.
*/
const DEFAULT_IMAGE_REQUEST_POLICY = {
	maxEdge: 2048,
	maxBytes: 2097152
};
/**
* The images one block list carries, in message order.
*
* Message content is flat: a tool result keeps the blocks its tool rendered (a
* `read_image` result is a text envelope beside its image), so a picture a tool
* handed back sits at the top level exactly like a pasted screenshot.
* @param content - one message's content blocks.
* @param images - the request's inlined images.
* @returns every image in the list that carries inlined bytes, in order.
*/
function imagesIn(content, images) {
	const found = [];
	for (const block of content) {
		const image = imageOf(block, images);
		if (image !== void 0) found.push(image);
	}
	return found;
}
/**
* The request dimensions one stored image is projected onto.
*
* The long edge is what a visual encoder resamples by, so the short edge follows
* it. An image already inside the bound keeps its own dimensions and the store
* then decides from the byte ceiling whether it has to encode anything at all.
* @param reference - the stored image's intrinsic dimensions.
* @param policy - the configured bounds.
* @returns integer dimensions no larger than the source, plus the byte ceiling.
*/
function requestTargetOf(reference, policy) {
	const longEdge = Math.max(reference.width, reference.height);
	if (longEdge <= policy.maxEdge) return {
		width: reference.width,
		height: reference.height,
		maxBytes: policy.maxBytes
	};
	const scale = policy.maxEdge / longEdge;
	return {
		width: Math.max(1, Math.floor(reference.width * scale)),
		height: Math.max(1, Math.floor(reference.height * scale)),
		maxBytes: policy.maxBytes
	};
}
/**
* Whether a store refused request-image projection itself.
* @param error - value caught from `readImageRequest`.
* @returns true for the attachment service's documented unsupported code.
*/
function isProjectionUnsupported(error) {
	return typeof error === "object" && error !== null && error.code === "ATTACHMENT_PROJECTION_UNSUPPORTED";
}
/**
* Read one image as the bytes this request should carry.
*
* The request version is preferred: the store downscales and re-encodes it
* within the target, so a 4K screenshot does not travel as 8 MiB of base64. A
* store without projection still has the normalized original, which is sent
* unchanged rather than failing the request.
* @param source - the attachment service.
* @param reference - the durable reference carried by the message.
* @param policy - the configured bounds.
* @param signal - the request's cancellation.
* @returns the bytes to inline and the media type they are.
* @throws {LlmError} when the bytes cannot be read at all.
*/
async function requestBytes(source, reference, policy, signal) {
	try {
		if (source.readImageRequest !== void 0) try {
			const version = await source.readImageRequest(reference, requestTargetOf(reference, policy), signal);
			return {
				data: version.data,
				mediaType: version.mediaType
			};
		} catch (error) {
			if (!isProjectionUnsupported(error)) throw error;
		}
		return {
			data: (await source.readImage(reference, signal)).data,
			mediaType: reference.mediaType
		};
	} catch (error) {
		throw new LlmError(`cannot read attachment "${reference.attachmentId}" for this request: ${error instanceof Error ? error.message : String(error)}`, "ATTACHMENT_UNREADABLE");
	}
}
/**
* Collect every image a request's messages carry, inlined for the wires.
* @param attachments - the attachment service, when the composition has one.
* @param messages - the request's conversation messages.
* @param signal - the request's cancellation.
* @param policy - the request-image bounds every picture is encoded to.
* @returns attachment id to base64 image; empty when the request carries none.
* @throws {LlmError} when a message carries an image that cannot be inlined.
*/
async function inlineImages(attachments, messages, signal, policy = DEFAULT_IMAGE_REQUEST_POLICY) {
	const references = [];
	for (const message of messages) for (const block of message.content) {
		if (typeof block !== "object" || block === null) continue;
		const candidate = block;
		if (candidate.type !== "image" || candidate.attachment === void 0) continue;
		if (candidate.offloaded === true) continue;
		references.push(candidate.attachment);
	}
	if (references.length === 0) return /* @__PURE__ */ new Map();
	if (attachments === void 0) throw new LlmError("this request carries an image but no attachment service is mounted, so the bytes cannot be read", "ATTACHMENTS_UNAVAILABLE");
	const images = /* @__PURE__ */ new Map();
	for (const reference of references) {
		const id = String(reference.attachmentId);
		if (images.has(id)) continue;
		const bytes = await requestBytes(attachments, reference, policy, signal);
		images.set(id, {
			mediaType: bytes.mediaType,
			data: Buffer.from(bytes.data).toString("base64")
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
	if (candidate.offloaded === true) return void 0;
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
* The system prompt owns the `system` slot even when the query carries it as a
* leading system-role message, which is how a loop-built request delivers it
* (see `GenerateOptions`). Folded into the turn list instead, it would lose the
* slot the model weights as system, and its breakpoint would be the moving tail
* of the message list rather than a fixed end of the prompt prefix.
*
* @module
*/
/** The replay envelope kind this wire writes and reads. */
const REPLAY_KIND$2 = "neartoken-anthropic";
/** The only envelope version this build understands. */
const REPLAY_VERSION$2 = 1;
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
* The thinking blocks one assistant turn hands back, ready to send.
*
* Nothing is reconstructed here: each block's signature is read out of the
* turn's own replay state, and the text in front of it is the summary this
* harness already holds. An envelope this build cannot use — another wire's
* kind, another version, another provider route, another model, a signature
* that was never issued, or a count that does not match the blocks that were
* streamed — is dropped whole: a thinking block without its signature is worse
* than none at all, because the API refuses the turn outright.
* @param message - the durable assistant message.
* @param gate - the provider route and model this request asks for.
* @param content - the message's content blocks, in the order they streamed.
* @returns the thinking blocks to send ahead of the text and the calls.
*/
function replayThinking(message, gate, content) {
	const source = message.source;
	if (source?.kind !== "model" || source.replayState === void 0) return [];
	const recorded = decodeRoute(source.model ?? "").model;
	if (source.provider !== gate.provider || recorded !== gate.model) return [];
	const envelope = asObject(source.replayState);
	const response = asObject(envelope?.response);
	if (response?.kind !== REPLAY_KIND$2 || response.version !== REPLAY_VERSION$2) return [];
	const signatures = [];
	for (const raw of asArray(envelope?.blocks)) {
		const block = asObject(raw);
		if (block?.type !== "reasoning") continue;
		const signature = stringOf(block.signature);
		if (signature === void 0 || signature === "") return [];
		signatures.push(signature);
	}
	const texts = [];
	for (const block of content) {
		if (typeof block !== "object" || block === null) continue;
		const typed = block;
		if (typed.type === "reasoning") texts.push(typed.text ?? "");
	}
	if (signatures.length === 0 || signatures.length !== texts.length) return [];
	return texts.map((text, at) => ({
		type: "thinking",
		thinking: text,
		signature: signatures[at]
	}));
}
/**
* Map one harness message onto its Anthropic form.
*
* An assistant turn carries its thinking blocks back first, each with the
* signature the upstream issued: the API refuses a replayed turn whose thinking
* lost it, and a delivery of this trajectory is rejected for the same reason.
* @param message - one conversation message.
* @param gate - the provider route and model this request asks for.
* @param images - the request's inlined images.
* @returns the wire message, or undefined when it carries nothing.
*/
function serializeMessage$3(message, gate, images = /* @__PURE__ */ new Map()) {
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
			const blocks = replayThinking(message, gate, content);
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
					id: call.id === void 0 ? void 0 : wireCallId(String(call.id)),
					name: call.name,
					input
				});
			}
			return blocks.length === 0 ? void 0 : {
				role: "assistant",
				content: blocks
			};
		}
		default: return;
	}
}
/**
* What a tool call whose result is missing reads as.
*
* Every call the harness sent is answered, but a replayed log, a fork seed, or a
* compacted history can lack the result. The messages API refuses a request whose
* `tool_use` has no answer, so the call is answered here instead of dropped.
*/
const MISSING_TOOL_RESULT = "No result was recorded for this tool call.";
/**
* The block one tool message contributes to the turn that answers its call.
*
* A tool result is itself a block list, so the pictures a tool handed back
* (read_image does exactly that) travel inside the result rather than being
* flattened into its text.
* @param message - the harness tool message.
* @param images - the request's inlined images.
* @returns the `tool_result` block.
*/
function toolResultBlock(message, images = /* @__PURE__ */ new Map()) {
	const content = message.content;
	const text = textOf$3(content);
	const pictures = imagesIn(content, images);
	if (pictures.length === 0) return {
		type: "tool_result",
		tool_use_id: wireCallId(String(message.toolCallId)),
		content: text
	};
	const blocks = text === "" ? [] : [{
		type: "text",
		text
	}];
	for (const image of pictures) blocks.push({
		type: "image",
		source: {
			type: "base64",
			media_type: image.mediaType,
			data: image.data
		}
	});
	return {
		type: "tool_result",
		tool_use_id: wireCallId(String(message.toolCallId)),
		content: blocks
	};
}
/**
* The call ids one assistant turn asks the next turn to answer.
* @param turn - the serialized assistant turn.
* @returns the ids, in block order.
*/
function toolUseIds(turn) {
	const ids = [];
	for (const block of turn.content) if (block.type === "tool_use") ids.push(String(block.id));
	return ids;
}
/**
* Fold adjacent same-role turns into one.
*
* The messages API reads the conversation as one turn per role, and a gateway in
* front of it may not merge a repeated role itself. Inside a user turn the
* `tool_result` blocks come first: a result that follows text is refused.
* @param turns - the settled turns, in send order.
* @returns the merged messages, ready to send.
*/
function mergeAdjacent(turns) {
	const merged = [];
	for (const turn of turns) {
		const last = merged.at(-1);
		if (last === void 0 || last.role !== turn.role) {
			merged.push({
				role: turn.role,
				content: [...turn.content]
			});
			continue;
		}
		if (last.role === "assistant") {
			last.content.push(...turn.content);
			continue;
		}
		last.content.unshift(...turn.content.filter((block) => block.type === "tool_result"));
		last.content.push(...turn.content.filter((block) => block.type !== "tool_result"));
	}
	return merged.map((turn) => ({
		role: turn.role,
		content: turn.content
	}));
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
* The turn list is settled into the pairing the messages API checks: every
* `tool_use` of an assistant turn is answered by a `tool_result` in the single
* user turn that follows it, calls the harness never recorded a result for are
* answered with a placeholder, results are collected into one turn rather than
* one turn each (a parallel batch of calls and a split batch of results are
* refused as unpaired), and adjacent same-role turns are folded into one.
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
	const turns = [];
	const results = [];
	let open = [];
	let deferred = [];
	const settle = () => {
		if (results.length === 0 && open.length === 0) return;
		for (const id of open) results.push({
			type: "tool_result",
			tool_use_id: id,
			content: MISSING_TOOL_RESULT
		});
		for (const turn of deferred) results.push(...turn.content);
		turns.push({
			role: "user",
			content: results.splice(0, results.length)
		});
		open = [];
		deferred = [];
	};
	let system = options.system;
	const gate = {
		provider: options.provider,
		model
	};
	for (const message of options.messages) {
		if (message.role === "tool") {
			const callId = wireCallId(String(message.toolCallId));
			if (!open.includes(callId)) continue;
			results.push(toolResultBlock(message, images));
			open = open.filter((pending) => pending !== callId);
			if (open.length === 0) settle();
			continue;
		}
		if (message.role === "system" && system === void 0) {
			const text = textOf$3(message.content);
			if (text !== "") {
				system = text;
				continue;
			}
		}
		const turn = serializeMessage$3(message, gate, images);
		if (turn === void 0) continue;
		if (turn.role === "assistant") {
			settle();
			turns.push(turn);
			open = toolUseIds(turn);
			continue;
		}
		if (open.length > 0) {
			deferred.push(turn);
			continue;
		}
		turns.push(turn);
	}
	settle();
	const messages = mergeAdjacent(turns);
	const body = {
		model,
		messages,
		stream: true
	};
	const affinityKey = sessionKeyOf(options);
	if (affinityKey !== void 0) body.metadata = { user_id: affinityKey };
	if (options.reasoningEffort !== void 0) {
		body.thinking = {
			type: "adaptive",
			display: "summarized"
		};
		body.output_config = { effort: claudeEffort(options.reasoningEffort) };
	}
	if (options.maxTokens !== void 0) body.max_tokens = options.maxTokens;
	if (options.temperature !== void 0) body.temperature = options.temperature;
	if (system !== void 0 && system.length > 0) body.system = [{
		type: "text",
		text: system,
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
		if (kind === "signature_delta") {
			const signature = stringOf(delta.signature);
			if (signature !== void 0 && signature !== "") state.signatures.set(wireIndex, signature);
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
* Build the envelope this stream stores for the next turn.
*
* One entry per emitted block, in the order the wire opened them. Only the
* thinking blocks carry a signature; a turn that streamed none, or one whose
* signature never arrived, is stored as nothing at all.
* @param state - the finished assembly state.
* @returns the versioned envelope, or undefined when there is nothing to replay.
*/
function replayOf$1(state) {
	const blocks = [];
	let signed = 0;
	const ordered = [...state.blocks.entries()].sort(([left], [right]) => left - right);
	for (const [wireIndex, block] of ordered) {
		if (block.kind !== "reasoning") {
			blocks.push({ type: block.kind });
			continue;
		}
		const signature = state.signatures.get(wireIndex);
		if (signature === void 0) return void 0;
		blocks.push({
			type: "reasoning",
			signature
		});
		signed += 1;
	}
	if (signed === 0) return void 0;
	return {
		response: {
			kind: REPLAY_KIND$2,
			version: REPLAY_VERSION$2
		},
		blocks
	};
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
		signatures: /* @__PURE__ */ new Map(),
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
	const replay = replayOf$1(state);
	const finish = finishOf$3(state.finish);
	yield replay === void 0 ? {
		type: "finish",
		reason: finish
	} : {
		type: "finish",
		reason: finish,
		replayState: replay
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
/** The replay envelope kind this wire writes and reads. */
const REPLAY_KIND$1 = "neartoken-genai";
/** The only envelope version this build understands. */
const REPLAY_VERSION$1 = 1;
/**
* The signature a model turn must hand back on one of its calls.
*
* Gemini 3 and later validate every replayed model turn that called a
* function: a turn whose call parts carry no `thoughtSignature` is refused
* with 400 "Function call is missing a thought_signature in functionCall
* parts". The value is opaque and cannot be derived, so it is kept exactly as
* the upstream issued it and never synthesised.
*
* The envelope's block entries are index-aligned with the turn's content
* blocks, because the harness drops a whole envelope whose entries do not line
* up with the blocks it assembled. An entry of another wire, another version,
* or the wrong length is therefore ignored entire.
*
* The turn is deliberately not gated on provider or model, unlike the messages
* and responses wires: live probes showed one signature staying valid across
* requests and across Gemini models, while a turn that dropped a valid
* signature fails outright. Gating here would manufacture the failure the
* envelope exists to prevent.
* @param message - one conversation message.
* @returns one entry per content block, or undefined when nothing replays.
*/
function replayBlocksOf(message) {
	const source = message.source;
	if (source?.kind !== "model" || source.replayState === void 0) return void 0;
	const envelope = asObject(source.replayState);
	const response = asObject(envelope?.response);
	if (response?.kind !== REPLAY_KIND$1 || response.version !== REPLAY_VERSION$1) return void 0;
	return asArray(envelope?.blocks);
}
/**
* Put each turn's own signature back on the call part it was issued for.
*
* The signature belongs on a `functionCall` part of the turn it was issued
* for — a signature parked on a part of its own is refused, while any call
* part of the turn accepts it. Blocks pair by position, so a batch keeps its
* pairing even when two calls name the same function.
* @param message - the durable assistant turn.
* @param content - its content blocks, in the order the turn streamed them.
* @param parts - its parts, already in wire order.
* @param callSlot - part index for each tool-call, keyed by its content index.
*/
function attachSignatures(message, content, parts, callSlot) {
	const blocks = replayBlocksOf(message);
	if (blocks === void 0 || blocks.length !== content.length) return;
	for (const [index, slot] of callSlot) {
		const block = asObject(blocks[index]);
		if (block?.type !== "tool-call") continue;
		const signature = stringOf(block.signature);
		if (signature === void 0 || signature === "") continue;
		parts[slot].thoughtSignature = signature;
	}
}
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
* @param images - the request's inlined images.
* @param callIds - whether the model matches a response to its call by id.
* @returns the wire content, or undefined when it carries nothing.
*/
function serializeMessage$2(message, toolNames, images = /* @__PURE__ */ new Map(), callIds = false) {
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
			const callSlot = /* @__PURE__ */ new Map();
			const text = textOf$2(content);
			if (text !== "") parts.push({ text });
			content.forEach((raw, index) => {
				if (typeof raw !== "object" || raw === null) return;
				const call = raw;
				if (call.type !== "tool-call") return;
				let args = {};
				try {
					args = call.arguments === void 0 || call.arguments === "" ? {} : JSON.parse(call.arguments);
				} catch {
					args = {};
				}
				const functionCall = {
					name: call.name,
					args
				};
				if (callIds && call.id !== void 0) functionCall.id = wireCallId(String(call.id));
				callSlot.set(index, parts.length);
				parts.push({ functionCall });
			});
			if (callSlot.size > 0) attachSignatures(message, content, parts, callSlot);
			return parts.length === 0 ? void 0 : {
				role: "model",
				parts
			};
		}
		case "tool": return {
			role: "user",
			parts: toolPartsOf(message, toolNames, images, callIds)
		};
		default: return;
	}
}
/**
* The parts one tool result contributes to the user turn that answers a call.
*
* A functionResponse carries JSON, not bytes: a picture a tool returned follows
* as its own inlineData part in the same user turn.
* @param message - the harness tool message.
* @param toolNames - call id to function name.
* @param images - the request's inlined images.
* @param callIds - whether the model matches a response to its call by id.
* @returns the parts, starting with the functionResponse.
*/
function toolPartsOf(message, toolNames, images, callIds) {
	const content = message.content;
	const callId = String(message.toolCallId);
	const functionResponse = {
		name: toolNames.get(callId) ?? callId,
		response: { result: textOf$2(content) }
	};
	if (callIds) functionResponse.id = wireCallId(callId);
	const parts = [{ functionResponse }];
	for (const image of imagesIn(content, images)) parts.push({ inlineData: {
		mimeType: image.mediaType,
		data: image.data
	} });
	return parts;
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
* Whether a model takes an id on its function calls and responses.
*
* Gemini 3 added `id` to both, which is what tells two calls of the same
* function apart inside one batch; earlier generations match on the function
* name alone and refuse a member they do not declare. Gemma carries no version
* in its name and stays on the older form.
* @param model - the bare model id.
* @returns true for the generations that declare the field.
*/
function usesCallIds(model) {
	const major = /gemini-(\d+)/i.exec(model)?.[1];
	return major !== void 0 && Number(major) >= 3;
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
	const callIds = usesCallIds(model);
	const contents = [];
	let batch = null;
	for (const message of options.messages) {
		if (message.role === "tool") {
			if (batch === null) {
				batch = [];
				contents.push({
					role: "user",
					parts: batch
				});
			}
			batch.push(...toolPartsOf(message, toolNames, images, callIds));
			continue;
		}
		batch = null;
		const wire = serializeMessage$2(message, toolNames, images, callIds);
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
		const raw = stringOf(part.thoughtSignature);
		const issued = raw === void 0 || raw === "" ? null : raw;
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
		if (call === void 0) {
			if (issued !== null && state.pendingSignature === null) state.pendingSignature = issued;
			continue;
		}
		const name = stringOf(call.name) ?? "";
		const slot = state.toolBlocks.length;
		const id = stringOf(call.id) ?? (name === "" ? `tool_${slot}` : `tool_${name}_${slot}`);
		const args = call.args === void 0 ? "{}" : JSON.stringify(call.args);
		const bound = issued ?? state.pendingSignature;
		const block = {
			...open$1(state, "tool-call"),
			id,
			name,
			body: args
		};
		if (bound !== null) {
			block.signature = bound;
			state.pendingSignature = null;
		}
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
		finish: null,
		pendingSignature: null
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
	if (state.pendingSignature !== null && state.toolBlocks.length > 0 && state.toolBlocks[0].signature === void 0) state.toolBlocks[0].signature = state.pendingSignature;
	const reason = finishOf$2(state.finish, state.toolBlocks.length > 0);
	const replay = ordered.some((block) => block.signature !== void 0) ? {
		response: {
			kind: REPLAY_KIND$1,
			version: REPLAY_VERSION$1
		},
		blocks: ordered.map((block) => ({
			type: block.kind,
			...block.signature === void 0 ? {} : { signature: block.signature }
		}))
	} : void 0;
	yield replay === void 0 ? {
		type: "finish",
		reason
	} : {
		type: "finish",
		reason,
		replayState: replay
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
/** The replay envelope kind this wire writes and reads. */
const REPLAY_KIND = "neartoken-responses";
/** The only envelope version this build understands. */
const REPLAY_VERSION = 1;
/**
* Read one summary list off the wire or out of a stored envelope.
* @param value - the candidate summary value.
* @returns the entries, or undefined when the value is not a summary list.
*/
function summaryOf(value) {
	if (!Array.isArray(value)) return void 0;
	const summary = [];
	for (const raw of asArray(value)) {
		const entry = asObject(raw);
		const text = stringOf(entry?.text);
		if (entry?.type !== "summary_text" || text === void 0) return void 0;
		summary.push({
			type: "summary_text",
			text
		});
	}
	return summary;
}
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
* The reasoning items one assistant turn hands back, ready to send.
*
* Nothing is reconstructed here: the turn's own ciphertext is read out of its
* replay state. An envelope this build cannot use — another wire's kind,
* another version, another provider route, another model, or one whose
* ciphertext is missing — is dropped whole, because a reasoning item without
* its ciphertext is worse than none at all.
* @param message - the durable assistant message.
* @param gate - the provider route and model this request asks for.
* @returns the reasoning items in upstream order; empty when nothing replays.
*/
function replayItems(message, gate) {
	const source = message.source;
	if (source?.kind !== "model" || source.replayState === void 0) return [];
	const recorded = decodeRoute(source.model ?? "").model;
	if (source.provider !== gate.provider || recorded !== gate.model) return [];
	const envelope = asObject(source.replayState);
	const response = asObject(envelope?.response);
	if (response?.kind !== REPLAY_KIND || response.version !== REPLAY_VERSION) return [];
	const items = [];
	for (const raw of asArray(envelope?.blocks)) {
		const block = asObject(raw);
		if (block?.type !== "reasoning") continue;
		const encryptedContent = stringOf(block.encryptedContent);
		const summary = summaryOf(block.summary);
		if (encryptedContent === void 0 || encryptedContent === "" || summary === void 0) return [];
		const id = stringOf(block.id);
		items.push({
			type: "reasoning",
			...id === void 0 || id === "" ? {} : { id },
			summary,
			encrypted_content: encryptedContent
		});
	}
	return items;
}
/**
* Map one harness message onto its responses input items.
*
* An assistant turn that both speaks and calls tools expands to one message item
* followed by one `function_call` item per call. Its reasoning item goes back
* ahead of both, which is the order the upstream answered in.
* @param message - one conversation message.
* @param gate - the provider route and model this request asks for.
* @returns the items, empty when the message carries nothing.
*/
function serializeMessage$1(message, gate, images = /* @__PURE__ */ new Map()) {
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
			const turn = text === "" ? [] : [{
				role: "assistant",
				content: text
			}];
			for (const block of content) {
				if (typeof block !== "object" || block === null) continue;
				const call = block;
				if (call.type !== "tool-call") continue;
				turn.push({
					type: "function_call",
					call_id: call.id === void 0 ? void 0 : wireCallId(String(call.id)),
					name: call.name,
					arguments: call.arguments ?? ""
				});
			}
			return turn.length === 0 ? [] : [...replayItems(message, gate), ...turn];
		}
		case "tool": return [{
			type: "function_call_output",
			call_id: wireCallId(String(message.toolCallId)),
			output: textOf$1(content)
		}];
		default: return [];
	}
}
/**
* Build the user item carrying the pictures a run of tool results returned.
*
* A function_call_output holds a string only, so the pictures follow as input
* the model reads the same way it reads a pasted screenshot.
* @param pictures - the run's pictures, in tool-result order.
* @returns one user item naming them and holding their bytes.
*/
function toolImagesItem(pictures) {
	return {
		role: "user",
		content: [{
			type: "input_text",
			text: "The tool results above included these images:"
		}, ...pictures.map((image) => ({
			type: "input_image",
			image_url: dataUrlOf(image)
		}))]
	};
}
/**
* Serialize one harness request into a responses body.
* @param options - the harness request.
* @param model - the real model id the provider should route to.
* @returns the ready-to-JSON body object.
*/
function serializeRequest$1(options, model, images = /* @__PURE__ */ new Map()) {
	const input = [];
	const pending = [];
	const gate = {
		provider: options.provider,
		model
	};
	for (const message of options.messages) {
		if (pending.length > 0 && message.role !== "tool") {
			input.push(toolImagesItem(pending));
			pending.length = 0;
		}
		if (message.role === "tool") pending.push(...imagesIn(message.content, images));
		input.push(...serializeMessage$1(message, gate, images));
	}
	if (pending.length > 0) input.push(toolImagesItem(pending));
	const body = {
		model,
		input,
		stream: true,
		store: false,
		...options.reasoningEffort === void 0 ? {} : { include: ["reasoning.encrypted_content"] }
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
		summary: "concise"
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
* Read one wire reasoning item down to what a replay sends back.
* @param item - the wire's `item` or one entry of `response.output`.
* @returns the item, or undefined when it carries no ciphertext or no summary.
*/
function reasoningItemOf(item) {
	const encryptedContent = stringOf(item.encrypted_content);
	const summary = summaryOf(item.summary);
	if (encryptedContent === void 0 || encryptedContent === "" || summary === void 0) return void 0;
	const id = stringOf(item.id);
	return {
		...id === void 0 ? {} : { id },
		summary,
		encryptedContent
	};
}
/**
* Build the envelope this stream stores for the next turn.
*
* One entry per emitted block, in the same order and at the same positions, so
* assembly can prune a block and its entry together. Only the reasoning block
* carries anything the next request needs.
* @param state - the finished assembly state.
* @param item - the reasoning item the wire returned this turn.
* @returns the versioned envelope.
*/
function replayOf(state, item) {
	const blocks = /* @__PURE__ */ new Map();
	if (state.text !== null) blocks.set(state.text.index, { type: "text" });
	if (state.reasoning !== null) blocks.set(state.reasoning.index, {
		type: "reasoning",
		...item
	});
	for (const block of state.toolBlocks.values()) blocks.set(block.index, { type: "tool-call" });
	const entries = [...blocks.entries()].sort(([left], [right]) => left - right);
	if (state.reasoning === null) entries.unshift([-1, {
		type: "reasoning",
		...item
	}]);
	return {
		response: {
			kind: REPLAY_KIND,
			version: REPLAY_VERSION
		},
		blocks: entries.map(([, block]) => block)
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
			if (stringOf(item.type) === "reasoning") {
				state.reasoningItem = reasoningItemOf(item) ?? state.reasoningItem;
				return;
			}
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
		case "response.reasoning_summary_part.added": {
			const part = `${stringOf(event.item_id) ?? ""}:${numberOf(event.summary_index) ?? 0}`;
			if (state.summaryPart !== null && state.summaryPart !== part && state.reasoning !== null) {
				state.reasoning.body += "\n\n";
				yield {
					type: "reasoning-delta",
					index: state.reasoning.index,
					text: "\n\n"
				};
			}
			state.summaryPart = part;
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
			if (state.reasoningItem === null) for (const raw of asArray(response.output)) {
				const item = asObject(raw);
				if (item === void 0 || stringOf(item.type) !== "reasoning") continue;
				state.reasoningItem = reasoningItemOf(item) ?? null;
				if (state.reasoningItem !== null) break;
			}
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
		reasoningItem: null,
		summaryPart: null,
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
	const reason = finishOf$1(state);
	const replay = state.reasoningItem === null ? void 0 : replayOf(state, state.reasoningItem);
	yield replay === void 0 ? {
		type: "finish",
		reason
	} : {
		type: "finish",
		reason,
		replayState: replay
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
	const pending = [];
	for (const message of options.messages) {
		if (pending.length > 0 && message.role !== "tool") {
			messages.push(toolImagesTurn(pending));
			pending.length = 0;
		}
		if (message.role === "tool") pending.push(...imagesIn(message.content, images));
		const wire = serializeMessage(message, images);
		if (wire !== void 0) messages.push(wire);
	}
	if (pending.length > 0) messages.push(toolImagesTurn(pending));
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
/**
* Build the user turn carrying the pictures a run of tool results returned.
*
* This wire has no place for bytes inside a tool message, so the pictures follow
* as input the model reads the same way it reads a pasted screenshot.
* @param pictures - the run's pictures, in tool-result order.
* @returns one user message naming them and holding their bytes.
*/
function toolImagesTurn(pictures) {
	return {
		role: "user",
		content: [{
			type: "text",
			text: "The tool results above included these images:"
		}, ...pictures.map((image) => ({
			type: "image_url",
			image_url: { url: dataUrlOf(image) }
		}))]
	};
}
/**
* Map one harness message onto its OpenAI wire form.
* @param message - one conversation or user-input message.
* @param images - the request's inlined images.
* @returns the wire message, or undefined for a message with nothing to send.
*/
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
				id: wireCallId(String(block.id)),
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
			tool_call_id: wireCallId(String(message.toolCallId)),
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
	headers: (key, groupRef, sessionId) => ({
		authorization: `Bearer ${key}`,
		"content-type": "application/json",
		...groupHeader(groupRef),
		...clientHeaders(sessionId)
	}),
	serialize: serializeRequest,
	parse: parseSse
};
const ANTHROPIC = {
	protocol: "anthropic",
	url: (baseURL) => `${baseURL}/v1/messages`,
	headers: (key, groupRef, sessionId) => ({
		"x-api-key": key,
		authorization: `Bearer ${key}`,
		"anthropic-version": "2023-06-01",
		"content-type": "application/json",
		...groupHeader(groupRef),
		...clientHeaders(sessionId)
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
	headers: (key, groupRef, sessionId) => ({
		"x-goog-api-key": key,
		authorization: `Bearer ${key}`,
		"content-type": "application/json",
		...groupHeader(groupRef),
		...clientHeaders(sessionId)
	}),
	serialize: serializeRequest$2,
	parse: parseSse$2
};
const RESPONSES = {
	protocol: "responses",
	url: (baseURL) => `${baseURL}/v1/responses`,
	headers: (key, groupRef, sessionId) => ({
		authorization: `Bearer ${key}`,
		"content-type": "application/json",
		...groupHeader(groupRef),
		...clientHeaders(sessionId)
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
		const sessionId = sessionKeyOf(options);
		const wire = wireFor(model);
		const images = await inlineImages(this.deps.attachments(), options.messages, options.signal, this.deps.imagePolicy());
		let response;
		try {
			response = await postJson(fetch, wire.url(this.deps.baseURL(), model), {
				headers: {
					...attributionHeaders(),
					...wire.headers(key, groupRef, sessionId)
				},
				json: JSON.stringify(wire.serialize(options, model, images)),
				signal: options.signal
			});
		} catch (error) {
			if (options.signal?.aborted) throw error;
			throw transportFailure(error);
		}
		try {
			yield* wire.parse(response, options.signal);
		} catch (error) {
			if (error instanceof LlmError || options.signal?.aborted === true) throw error;
			throw transportFailure(error);
		}
	}
};
//#endregion
//#region src/host/pricing.ts
/**
* The NearToken pricing directory: one shared load of the site's catalog,
* expanded into per-(group, model) catalog routes.
*
* The payload comes from `/api/dsh/device/pricing` while a key is stored, which
* resolves the catalog for that account — a group published to it by name, and an
* internal group when the account administers the site, are published nowhere
* else — and from the public `/api/pricing` otherwise. Both answer everything
* the catalog dimension needs: the model list, each model's `enable_groups`, the `group_ratio`
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
/** The public catalog: what an anonymous visitor may buy. */
const PUBLIC_PRICING_PATH = "/api/pricing";
/**
* The same catalog resolved for one account. The public endpoint answers
* anonymously, so it can never publish a group that exists only for one account
* or an internal group; this route authenticates with the relay key.
*/
const ACCOUNT_PRICING_PATH = "/api/dsh/device/pricing";
/**
* A stable, non-secret tag for one key, used only as a cache dimension.
* @param key - the stored relay key.
* @returns a short fingerprint that never carries the key itself.
*/
function keyFingerprint(key) {
	let hash = 0;
	for (const char of key) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 4294967291;
	return hash.toString(36);
}
/** Loads and caches the pricing payload for one adapter instance. */
var PricingDirectory = class {
	ctx;
	baseURL;
	ttlMs;
	apiKey;
	cache;
	inflight;
	/**
	* @param ctx - the owning plugin context (logging only).
	* @param baseURL - the site root, e.g. `https://neartoken.cc`.
	* @param ttlMs - how long one load stays fresh.
	* @param apiKey - the stored relay key, or undefined while signed out; the key
	* is what makes the catalog say which groups this account may use.
	*/
	constructor(ctx, baseURL, ttlMs, apiKey = async () => void 0) {
		this.ctx = ctx;
		this.baseURL = baseURL;
		this.ttlMs = ttlMs;
		this.apiKey = apiKey;
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
	async catalog(force = false) {
		const key = await this.apiKey().catch(() => void 0);
		const identity = key === void 0 ? "" : keyFingerprint(key);
		const fresh = this.cache !== void 0 && this.cache.identity === identity && Date.now() - this.cache.at < this.ttlMs();
		if (!force && fresh && this.cache !== void 0) return this.cache.routes;
		if (this.inflight !== void 0 && this.inflight.identity === identity) return this.inflight.promise;
		const promise = this.readCatalog(key).then((routes) => {
			this.cache = {
				at: Date.now(),
				identity,
				routes
			};
			return routes;
		}).catch((error) => {
			this.ctx.logger.warn("neartoken: pricing load failed", error);
			return this.cache?.routes ?? [];
		}).finally(() => {
			this.inflight = void 0;
		});
		this.inflight = {
			identity,
			promise
		};
		return promise;
	}
	/**
	* Read one catalog, preferring the account's own view.
	* @param key - the stored relay key, or undefined while signed out.
	* @returns the routes the site published for this caller.
	*/
	async readCatalog(key) {
		if (key !== void 0) try {
			return await this.fetchRoutes(ACCOUNT_PRICING_PATH, {
				accept: "application/json",
				authorization: `Bearer ${key}`
			});
		} catch (error) {
			this.ctx.logger.warn("neartoken: account catalog unavailable, falling back to the public one", error);
		}
		return await this.fetchRoutes(PUBLIC_PRICING_PATH, { accept: "application/json" });
	}
	/**
	* @param path - the catalog route to read.
	* @param headers - what the route authenticates with, if anything.
	* @returns the expanded routes.
	*/
	async fetchRoutes(path, headers) {
		const response = await fetch(`${this.baseURL()}${path}`, { headers });
		if (!response.ok) throw new Error(`${path} answered ${response.status}`);
		return expandRoutes(parsePricing(await response.json()));
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
		this.pricing = new PricingDirectory(ctx, deps.baseURL, deps.catalogTtlMs, async () => {
			try {
				return await deps.apiKey();
			} catch {
				return;
			}
		});
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
			baseURL: this.deps.relayBaseURL,
			defaultContextWindow: this.deps.defaultContextWindow,
			modelOverride: this.deps.modelOverride,
			attachments: this.deps.attachments,
			imagePolicy: this.deps.imagePolicy
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
//#region src/host/relay.ts
/**
* Which origin the model-facing endpoints use.
*
* Every request that carries a conversation — chat completions, messages,
* responses, generateContent, images — goes through this origin; the dashboard
* endpoints (`/api/*`: pricing, usage, wallet, top-up) always stay on the site
* root, because the direct endpoint serves the relay only.
*
* @module
*/
/** Default host of the long-lived connection endpoint. */
const DEFAULT_DIRECT_ENDPOINT = "https://direct.neartoken.cc";
/**
* Pick the origin one `/v1` request is sent to.
* @param siteRoot - the configured site root, without a trailing slash.
* @param direct - whether the long-connection switch is on.
* @param endpoint - the configured direct endpoint, without a trailing slash.
* @returns the origin for the model-facing endpoints.
*/
function relayBaseURL(siteRoot, direct, endpoint = DEFAULT_DIRECT_ENDPOINT) {
	return direct ? endpoint.replace(/\/$/, "") : siteRoot;
}
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
		path: USAGE_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method !== "GET") {
				sendMethodNotAllowed(res, "GET");
				return;
			}
			const range = queryParam(req, "range") ?? "day";
			if (!isUsageRange(range)) {
				sendJson(res, 400, {
					code: "bad-request",
					message: "range 必须是 day / week / month"
				});
				return;
			}
			sendJson(res, 200, await deps.usage(range));
		}
	}), `neartoken: GET ${USAGE_PATH}`);
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: AUTHORIZE_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "POST");
				return;
			}
			if (!jsonBody(req)) {
				req.resume();
				sendJson(res, 200, await deps.account.begin());
				return;
			}
			const body = await readJsonObject(req, res, MAX_BODY_BYTES);
			if (body === void 0) return;
			sendJson(res, 200, await deps.account.begin(normalizeAffiliateCode(body.affCode)));
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
		path: LINK_PATH,
		handler: async (req, res) => {
			if (rejected(ctx, req, res)) return;
			if (req.method === "GET") {
				sendJson(res, 200, deps.link());
				return;
			}
			if (req.method !== "POST") {
				sendMethodNotAllowed(res, "GET, POST");
				return;
			}
			const body = await readJsonObject(req, res, MAX_BODY_BYTES);
			if (body === void 0) return;
			if (typeof body.direct !== "boolean") {
				sendJson(res, 400, {
					code: "bad-request",
					message: "direct 必须是布尔值"
				});
				return;
			}
			try {
				await deps.saveLink(body.direct);
			} catch (error) {
				sendJson(res, 500, {
					code: "save-failed",
					message: error instanceof Error ? error.message : String(error)
				});
				return;
			}
			sendJson(res, 200, { ok: true });
		}
	}), `neartoken: ${LINK_PATH}`);
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
* Whether a request declares a JSON body, i.e. whether there is anything to read.
* @param req - the request under test.
* @returns true when the body is declared as JSON.
*/
function jsonBody(req) {
	return text(String(req.headers["content-type"]).split(";", 1)[0]?.trim().toLowerCase()) === "application/json";
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
/**
* Read one query parameter off a request.
* @param req - the request to read.
* @param name - the parameter name.
* @returns the value, or undefined when the request carries none.
*/
function queryParam(req, name) {
	const url = req.url ?? "";
	const mark = url.indexOf("?");
	const search = mark === -1 ? "" : url.slice(mark + 1);
	const value = new URLSearchParams(search).get(name);
	return value === null ? void 0 : text(value);
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
	baseURL: z.string().default("https://neartoken.cc"),
	/**
	* Origin the long-connection switch moves the model-facing `/v1` family to.
	* The dashboard endpoints (`/api/*`) stay on `baseURL` either way.
	*/
	directEndpoint: z.string().default(DEFAULT_DIRECT_ENDPOINT),
	/**
	* The long-connection switch: whether `/v1` requests leave from
	* `directEndpoint` instead of the site root. Volatile, so the model picker's
	* toggle reaches this running plugin without a remount.
	*/
	directLink: z.boolean().default(false).volatile(),
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
	* Longest edge, in pixels, of one image on the wire. A model reads a picture
	* through a fixed visual grid, so detail past roughly 2048 pixels on the long
	* edge is billed and uploaded without being seen; a larger image is scaled down
	* to this bound before it is sent.
	*/
	imageMaxEdge: z.number().step(1).min(1).default(2048),
	/**
	* Encoded-byte ceiling for one request image. An image already inside both
	* bounds travels unchanged; one that is not is re-encoded down through the
	* encoder's quality ladder until it fits, converting a screenshot PNG to JPEG
	* or WebP on the way.
	*/
	imageMaxBytes: z.number().step(1).min(1024).default(2097152),
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
	}).volatile(),
	/**
	* The web-search setting: whether `exa_search` / `exa_fetch` are mounted, the
	* group they bill to, and the budgets that decide a call's cost and context.
	* On by default — a search costs a fraction of a picture, and a profile that
	* has no Exa channel simply gets a clear refusal instead of a hidden tool.
	* Volatile, so a save reaches this running plugin without a remount.
	*/
	exaSearch: z.object({
		/** Whether the tools are mounted. */
		enabled: z.boolean().default(true),
		/** Group every call bills to; empty takes the catalog's first offering. */
		group: z.string().default(""),
		/** Most results one search may return. Money and context both grow with it. */
		maxResults: z.number().step(1).min(1).max(100).default(8),
		/** Longest text one hit or page may contribute, in characters. */
		maxCharacters: z.number().step(1).min(200).default(6e3),
		/** How long one search or fetch may take, in milliseconds. */
		timeoutMs: z.number().step(1).min(1e3).default(6e4)
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
	const relayBaseURL$1 = () => relayBaseURL(config.baseURL, config.directLink.get(), config.directEndpoint);
	const provider = new NearTokenProvider(ctx, {
		provider: PROVIDER,
		displayName: DISPLAY_NAME,
		settingsNs: SETTINGS_NS,
		baseURL: () => config.baseURL,
		relayBaseURL: relayBaseURL$1,
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
		attachments: () => ctx.get("attachments"),
		imagePolicy: () => ({
			maxEdge: config.imageMaxEdge,
			maxBytes: config.imageMaxBytes
		})
	});
	const whitelist = new NearTokenWhitelist({
		enabled: () => config.enabledModels.get(),
		meta: () => config.modelMeta.get(),
		routes: () => provider.catalog(),
		entryId: SETTINGS_NS,
		settings: () => ctx.get("settings")
	});
	const images = new NearTokenImageClient({
		baseURL: relayBaseURL$1,
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
	const exa = new NearTokenExaClient({
		baseURL: relayBaseURL$1,
		apiKey: resolveApiKey,
		routes: async () => await provider.fullCatalog(),
		timeoutMs: () => config.exaSearch.get().timeoutMs
	});
	ctx.inject(["tools"], (toolCtx) => {
		let registered;
		const syncExa = () => {
			if (config.exaSearch.get().enabled) {
				if (registered !== void 0) return;
				registered = toolCtx.effect(() => registerExaTools(toolCtx, {
					settings: () => config.exaSearch.get(),
					client: exa,
					timeoutMs: () => config.exaSearch.get().timeoutMs
				}), "neartoken: exa_search and exa_fetch");
				return;
			}
			if (registered === void 0) return;
			registered();
			registered = void 0;
		};
		syncExa();
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
			usage: (range) => account.usage(range),
			topupInfo: () => account.topupInfo(),
			createTopup: (amount, paymentMethod) => account.createTopup(amount, paymentMethod),
			baseURL: () => config.baseURL,
			link: () => ({
				direct: config.directLink.get(),
				baseURL: config.baseURL,
				directBaseURL: config.directEndpoint
			}),
			saveLink: async (direct) => {
				const settings = ctx.get("settings");
				if (settings === void 0) throw new Error("neartoken: the long-connection switch needs the settings service");
				await settings.update(SETTINGS_NS, { directLink: direct });
			},
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
