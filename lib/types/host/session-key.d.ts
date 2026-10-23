/**
 * The session-stable key a request carries to the gateway.
 *
 * The site picks the upstream account for a request from this value: New API's
 * channel-affinity rule for `^gpt-.*$` on `/v1/responses` reads
 * `prompt_cache_key` and skips itself when the field is absent, so a request
 * without it is routed to a random channel on every call. The provider's prompt
 * cache lives per upstream account, so random routing turns a repeated prefix
 * into fresh input every time. Repeating one key per session keeps the session
 * on one channel and the cache hitting.
 *
 * @module
 */
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
/**
 * Derive the key one request should present for channel affinity.
 * @param options - the harness request.
 * @returns the session identity, or undefined when the request carries none.
 */
export declare function sessionKeyOf(options: GenerateOptions): string | undefined;
