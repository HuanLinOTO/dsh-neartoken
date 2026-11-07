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
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { clientHeaders } from '../client-identity.ts'
import type { NearTokenRoute } from './pricing.ts'

/** Billing model the site prices one search under. */
export const EXA_SEARCH_MODEL = 'exa-search'

/** Billing model the site prices one page fetch under. */
export const EXA_CONTENTS_MODEL = 'exa-contents'

/** Relay path of one Exa endpoint, below the site root. */
const SEARCH_PATH = '/v1/exa/search'
const CONTENTS_PATH = '/v1/exa/contents'

/** Search depths the site prices: everything up to ten results costs the same. */
export type ExaSearchType = 'auto' | 'lite' | 'deep'

/** Which view of a page a fetch asks Exa for. */
export type ExaContentMode = 'text' | 'highlights' | 'summary'

/** One search hit as the model sees it, already trimmed to its budget. */
export interface ExaSearchHit {
  readonly url: string
  readonly title?: string
  readonly publishedDate?: string
  /** Page excerpt Exa selected for this query, cut at the character budget. */
  readonly snippet?: string
}

/** One finished search. */
export interface ExaSearchResult {
  readonly group: string
  readonly requestId?: string
  readonly results: ExaSearchHit[]
}

/** One page a fetch returned. */
export interface ExaFetchedPage {
  readonly url: string
  readonly title?: string
  readonly publishedDate?: string
  /** The requested view of the page, cut at the character budget. */
  readonly content: string
}

/** One finished page fetch. */
export interface ExaFetchResult {
  readonly group: string
  readonly requestId?: string
  readonly pages: ExaFetchedPage[]
}

/** What one search call asks for. */
export interface ExaSearchArgs {
  readonly query: string
  readonly type: ExaSearchType
  readonly numResults: number
  readonly maxCharacters: number
  readonly group?: string
  readonly includeDomains?: readonly string[]
  readonly excludeDomains?: readonly string[]
  readonly startPublishedDate?: string
  readonly endPublishedDate?: string
  readonly signal?: AbortSignal
}

/** What one page fetch asks for. */
export interface ExaFetchArgs {
  readonly urls: readonly string[]
  readonly mode: ExaContentMode
  readonly maxCharacters: number
  readonly group?: string
  readonly signal?: AbortSignal
}

/** External facts the client reads at call time. */
export interface ExaClientDeps {
  /** Origin the model-facing endpoints use, without a trailing slash. */
  readonly baseURL: () => string
  /** The stored site key. */
  readonly apiKey: () => Promise<string>
  /** The catalog routes, for the group a call bills to. */
  readonly routes: () => Promise<readonly NearTokenRoute[]>
  /** How long one call may take, in milliseconds. */
  readonly timeoutMs: () => number
  /** HTTP carrier, so a test can substitute one. */
  readonly fetch?: typeof fetch
}

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
export function resolveExaGroup(
  routes: readonly NearTokenRoute[], model: string, requested?: string,
): { readonly group: string, readonly groupRef?: string } {
  const offerings = routes.filter(route => route.model === model)
  const [first] = offerings
  if (first === undefined) {
    throw new Error(
      `this site does not offer ${model}: an administrator has to add an Exa channel serving it`,
    )
  }
  if (requested === undefined || requested === '') {
    return { group: first.group, ...first.groupRef === undefined ? {} : { groupRef: first.groupRef } }
  }
  const hit = offerings.find(route => route.group === requested)
  if (hit === undefined) {
    const groups = [...new Set(offerings.map(route => route.group))].join(', ')
    throw new Error(`${model} is not offered in group "${requested}"; groups offering it: ${groups}`)
  }
  return { group: hit.group, ...hit.groupRef === undefined ? {} : { groupRef: hit.groupRef } }
}

/**
 * Cut one block of page text at the character budget.
 * @param value - the text as the vendor returned it.
 * @param maxCharacters - longest text one page may contribute.
 * @returns the text, with a marker when it was cut.
 */
export function cutAt(value: string, maxCharacters: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxCharacters) return trimmed
  return `${trimmed.slice(0, maxCharacters).trimEnd()}\n…[cut at ${String(maxCharacters)} characters]`
}

/**
 * Join the excerpt lines Exa returned for one page.
 * @param value - the raw `highlights` member.
 * @returns one block of excerpts, or undefined when the vendor sent none.
 */
function highlightsOf(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const lines = value.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
  return lines.length === 0 ? undefined : lines.join('\n…\n')
}

/**
 * Read one text member of a vendor object.
 * @param value - the raw member.
 * @returns the string, or undefined when it is not one.
 */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read one vendor result object into the trimmed shape a tool result carries.
 * @param url - the result's URL.
 * @param raw - the vendor's result object.
 * @param maxCharacters - longest excerpt one hit may contribute.
 * @returns the hit, or undefined when the vendor sent no usable excerpt.
 */
function hitOf(url: string, raw: Record<string, unknown>, maxCharacters: number): ExaSearchHit | undefined {
  const excerpt = highlightsOf(raw.highlights) ?? textOf(raw.text) ?? textOf(raw.summary)
  const title = textOf(raw.title)
  const publishedDate = textOf(raw.publishedDate)
  return {
    url,
    ...title === undefined ? {} : { title },
    ...publishedDate === undefined ? {} : { publishedDate },
    ...excerpt === undefined ? {} : { snippet: cutAt(excerpt, maxCharacters) },
  }
}

/**
 * Read one vendor contents result into the trimmed shape a tool result carries.
 * @param url - the page's URL.
 * @param raw - the vendor's result object.
 * @param mode - the view that was asked for.
 * @param maxCharacters - longest text one page may contribute.
 * @returns the page, or undefined when the vendor answered without that view.
 */
function pageOf(
  url: string, raw: Record<string, unknown>, mode: ExaContentMode, maxCharacters: number,
): ExaFetchedPage | undefined {
  const content = mode === 'text'
    ? textOf(raw.text)
    : mode === 'summary' ? textOf(raw.summary) : highlightsOf(raw.highlights)
  if (content === undefined) return undefined
  const title = textOf(raw.title)
  const publishedDate = textOf(raw.publishedDate)
  return {
    url,
    ...title === undefined ? {} : { title },
    ...publishedDate === undefined ? {} : { publishedDate },
    content: cutAt(content, maxCharacters),
  }
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
export function refusalMessage(body: unknown, status: number, fallback: string): string {
  if (typeof body === 'object' && body !== null) {
    const error = (body as Record<string, unknown>).error
    if (typeof error === 'string' && error.length > 0) return `HTTP ${String(status)}: ${error}`
    if (typeof error === 'object' && error !== null) {
      const message = textOf((error as Record<string, unknown>).message)
      if (message !== undefined) return `HTTP ${String(status)}: ${message}`
    }
    const message = textOf((body as Record<string, unknown>).message)
    if (message !== undefined) return `HTTP ${String(status)}: ${message}`
  }
  return `HTTP ${String(status)}: ${fallback.slice(0, 400)}`
}

/**
 * The Exa payload one search sends.
 * @param args - the resolved search arguments.
 * @returns the vendor body.
 */
export function searchBody(args: ExaSearchArgs): Record<string, unknown> {
  return {
    query: args.query,
    type: args.type,
    numResults: args.numResults,
    // Excerpts, not full pages: Exa selects the part of each page that answers
    // the query, which is what a model can act on without the context cost of
    // the whole document.
    contents: { highlights: { maxCharacters: args.maxCharacters } },
    ...args.includeDomains === undefined || args.includeDomains.length === 0
      ? {}
      : { includeDomains: [...args.includeDomains] },
    ...args.excludeDomains === undefined || args.excludeDomains.length === 0
      ? {}
      : { excludeDomains: [...args.excludeDomains] },
    ...args.startPublishedDate === undefined ? {} : { startPublishedDate: args.startPublishedDate },
    ...args.endPublishedDate === undefined ? {} : { endPublishedDate: args.endPublishedDate },
  }
}

/**
 * The Exa payload one page fetch sends.
 * @param args - the resolved fetch arguments.
 * @returns the vendor body.
 */
export function contentsBody(args: ExaFetchArgs): Record<string, unknown> {
  return {
    ids: [...args.urls],
    [args.mode]: { maxCharacters: args.maxCharacters },
  }
}

/** Read a parsed JSON answer as one object, or refuse it. */
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

/**
 * Read the vendor id of one result, which is its URL on this API.
 * @param raw - the vendor's result object.
 * @returns the URL, or undefined when the object carries none.
 */
function urlOf(raw: Record<string, unknown>): string | undefined {
  return textOf(raw.url) ?? textOf(raw.id)
}

/**
 * Ask one New API deployment to search the web through Exa.
 *
 * One call is one billed search: the site prices it by the search depth and the
 * result count the body asks for, so the arguments decide the price before the
 * request is sent.
 */
export class NearTokenExaClient {
  /**
   * @param deps - the site root, the key, the catalog, and the time budget.
   */
  constructor(private readonly deps: ExaClientDeps) {}

  /**
   * Search the web.
   * @param args - the query, the depth, the result count, and the caller's cancellation.
   * @returns the hits, trimmed to the character budget.
   * @throws {Error} when the site refuses the call or answers without results.
   */
  async search(args: ExaSearchArgs): Promise<ExaSearchResult> {
    const { group, groupRef } = resolveExaGroup(await this.deps.routes(), EXA_SEARCH_MODEL, args.group)
    const body = await this.post(SEARCH_PATH, searchBody(args), groupRef, args.signal)
    const results: ExaSearchHit[] = []
    const rawResults = body.results
    if (Array.isArray(rawResults)) {
      for (const entry of rawResults) {
        const raw = asObject(entry)
        const url = urlOf(raw)
        if (url === undefined) continue
        const hit = hitOf(url, raw, args.maxCharacters)
        if (hit !== undefined) results.push(hit)
      }
    }
    const requestId = textOf(body.requestId)
    return { group, ...requestId === undefined ? {} : { requestId }, results }
  }

  /**
   * Fetch pages the caller already has URLs for.
   * @param args - the URLs, the view to read them as, and the caller's cancellation.
   * @returns one page per URL Exa answered, trimmed to the character budget.
   * @throws {Error} when the site refuses the call.
   */
  async contents(args: ExaFetchArgs): Promise<ExaFetchResult> {
    const { group, groupRef } = resolveExaGroup(await this.deps.routes(), EXA_CONTENTS_MODEL, args.group)
    const body = await this.post(CONTENTS_PATH, contentsBody(args), groupRef, args.signal)
    const pages: ExaFetchedPage[] = []
    const rawResults = body.results
    if (Array.isArray(rawResults)) {
      for (const entry of rawResults) {
        const raw = asObject(entry)
        const url = urlOf(raw)
        if (url === undefined) continue
        const page = pageOf(url, raw, args.mode, args.maxCharacters)
        if (page !== undefined) pages.push(page)
      }
    }
    const requestId = textOf(body.requestId)
    return { group, ...requestId === undefined ? {} : { requestId }, pages }
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
  private async post(
    path: string, body: Record<string, unknown>, groupRef: string | undefined, external: AbortSignal | undefined,
  ): Promise<Record<string, unknown>> {
    const timeoutMs = this.deps.timeoutMs()
    // The budget is its own signal so a timeout can be told apart from the
    // caller's cancellation: one deserves an explanation of the knob, the other
    // is the turn being stopped.
    const budget = AbortSignal.timeout(timeoutMs)
    const signal = external === undefined ? budget : AbortSignal.any([external, budget])
    const key = await this.deps.apiKey()
    const send = this.deps.fetch ?? fetch
    const response = await send(`${this.deps.baseURL()}${path}`, {
      method: 'POST',
      headers: {
        ...attributionHeaders(),
        ...clientHeaders(),
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        ...groupRef === undefined ? {} : { 'x-neartoken-group': groupRef },
      },
      body: JSON.stringify(body),
      signal,
    }).catch((error: unknown) => {
      if (!budget.aborted) throw error
      throw new Error(
        `the site did not answer ${path} within ${String(Math.round(timeoutMs / 1_000))}s (exaTimeoutMs);`
        + ' a search is usually a second or two, so the site is probably overloaded',
        { cause: error },
      )
    })
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text.length === 0 ? {} : JSON.parse(text)
    } catch {
      parsed = undefined
    }
    if (!response.ok) throw new Error(refusalMessage(parsed, response.status, text))
    if (parsed === undefined) {
      throw new Error(`the site answered ${path} with a body that is not JSON: ${text.slice(0, 200)}`)
    }
    return asObject(parsed)
  }
}
