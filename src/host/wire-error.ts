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
import {
  errorChain, isContextWindowExceededError, isQuotaExceededError, LlmError, ProviderRequestId,
} from '@deepseek-ai/dsh-llm'
import { parseJsonObject } from './sse.ts'

/**
 * Wording the gateway uses when a functionCall turn was not answered by the same
 * number of functionResponse parts.
 *
 * A Gemini batch lands here whenever its results were sent one user turn each;
 * no retry clears it, because the conversation that produced the refusal is
 * replayed unchanged.
 */
const FUNCTION_RESPONSE_MISMATCH = /number of function response parts/iu

/** What the user can do about a refusal the plugin itself cannot repair. */
const FUNCTION_RESPONSE_MISMATCH_HINT =
  ' 提示：Gemini 原生协议下这批工具结果与调用对不上，重试不会成功；请升级 neartoken 插件，或换用别的模型后新开会话'

/**
 * Wording the gateway uses when a replayed Gemini turn lost the signature its
 * function calls must carry back.
 *
 * Only a turn whose signature was never recorded reaches this: the plugin
 * sends the value the upstream issued or nothing at all, never a substitute,
 * so the conversation cannot be repaired from this side.
 */
const MISSING_THOUGHT_SIGNATURE = /thought_signature/iu

/** What the user can do about it. */
const MISSING_THOUGHT_SIGNATURE_HINT =
  ' 提示：这轮工具调用没有记录上游签发的 thought_signature（旧会话、或中途换过模型），回放会被 Gemini 拒绝；插件不会伪造签名，请用该模型新开会话'

/**
 * The code a New API site answers with when it suspended this account's model
 * access over repeated upstream content-safety rejections.
 *
 * The fix lives in the site console, not in the key, so the refusal text says
 * which of the two it is.
 */
const MODEL_ACCESS_RESTRICTED_CODE = 'model_access_restricted'

/** What the account holder can do about that suspension. */
const MODEL_ACCESS_RESTRICTED_HINT =
  ' 提示：站点已暂停该账号的模型访问（多次上游内容安全拒绝），与 API Key 无关；请登录站点控制台提交解除申请'

/** The `error` object of a gateway error body, when the body carries one. */
function errorObjectOf(body: string): Record<string, unknown> | undefined {
  const parsed = parseJsonObject(body)
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const error = (parsed as Record<string, unknown>).error
  if (typeof error !== 'object' || error === null) return undefined
  return error as Record<string, unknown>
}

/**
 * The provider's own message of a refusal, when the body carries one.
 * @param body - the raw error response body.
 * @returns the embedded `error.message`, or undefined.
 */
function embeddedMessage(body: string): string | undefined {
  const message = errorObjectOf(body)?.message
  return typeof message === 'string' && message !== '' ? message : undefined
}

/**
 * Join a refusal's type, code, and message into the text the classifiers read.
 *
 * Called only after `errorObjectOf` proved the body carries one, so the
 * fallthrough to the raw body covers a gateway that answered plain text.
 * @param body - the raw error response body.
 * @returns classification text, or the raw body when it is not an error object.
 */
function detailOf(body: string): string {
  const error = errorObjectOf(body)
  return error === undefined
    ? body
    : [error.type, error.code, error.message].filter((value): value is string => typeof value === 'string').join(' ')
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
export function gatewayError(body: string, status: number, headers?: Headers): LlmError {
  const error = errorObjectOf(body)
  const type = typeof error?.type === 'string' ? error.type : ''
  const detail = detailOf(body)
  let code: string
  if (status === 401 || type === 'authentication_error' || type === 'permission_error') code = 'AUTH'
  else if (isQuotaExceededError(detail) || status === 402) code = 'QUOTA'
  else if (status === 429 || type === 'rate_limit_error') code = 'RATE_LIMIT'
  else if (isContextWindowExceededError(detail)) code = 'CONTEXT_WINDOW_EXCEEDED'
  else if (status === 400 || status === 413 || type === 'invalid_request_error') code = 'INVALID_REQUEST'
  else if (status >= 500 || type === 'api_error' || type === 'overloaded_error') code = 'SERVER'
  else code = `HTTP_${status}`
  const retry = headers?.get('retry-after')
  const delay = retry == null ? NaN : /^\d+(?:\.\d+)?$/u.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()
  const id = headers?.get('request-id') ?? headers?.get('x-request-id')
  const hint = error?.code === MODEL_ACCESS_RESTRICTED_CODE
    ? MODEL_ACCESS_RESTRICTED_HINT
    : code === 'INVALID_REQUEST' && MISSING_THOUGHT_SIGNATURE.test(detail)
      ? MISSING_THOUGHT_SIGNATURE_HINT
      : code === 'INVALID_REQUEST' && FUNCTION_RESPONSE_MISMATCH.test(detail)
        ? FUNCTION_RESPONSE_MISMATCH_HINT
        : ''
  return new LlmError(
    `NearToken answered ${status}: ${(embeddedMessage(body) ?? body).slice(0, 500)}${hint}`,
    code,
    {
      status,
      ...id == null ? {} : { requestId: ProviderRequestId(id) },
      ...Number.isFinite(delay) && delay > 0 ? { providerRetryAfterMs: delay } : {},
    },
  )
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
export function streamFailure(detail: string): LlmError {
  return new LlmError(`NearToken answered with a stream failure: ${detail.slice(0, 500)}`, 'SERVER')
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
export function transportFailure(error: unknown): LlmError {
  return new LlmError(`NearToken transport failed: ${errorChain(error).slice(0, 500)}`, 'TRANSPORT', { cause: error })
}
