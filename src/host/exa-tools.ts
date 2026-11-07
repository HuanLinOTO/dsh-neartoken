/**
 * The model-facing Exa tools: `exa_search` for finding pages and `exa_fetch`
 * for reading ones the caller already has URLs for.
 *
 * They are named after the vendor instead of `web_search` / `web_fetch`
 * because a profile may mount another search provider beside this one, and two
 * tools with one name would replace each other. Each call is billed by the site
 * under the tool's own model (`exa-search` / `exa-contents`), so the operator's
 * switch and its default group are what decide the price band.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { ExaContentMode, ExaFetchResult, ExaSearchResult, ExaSearchType, NearTokenExaClient } from './exa-client.ts'

/**
 * Slack between the call budget and the tool-call deadline.
 *
 * The harness's timeout policy arms its own deadline and replaces a late result
 * with a bare "tool call timed out"; staying a little under it means the model
 * usually gets the useful message instead, while an upstream that ignores its
 * abort is still caught.
 */
const DEADLINE_MARGIN_MS = 15_000

/** Deepest search the tool offers: the priced tiers the site's catalog names. */
const SEARCH_TYPES: readonly ExaSearchType[] = ['auto', 'lite', 'deep']

/** The views one fetch may ask for. */
const CONTENT_MODES: readonly ExaContentMode[] = ['highlights', 'text', 'summary']

/** The operator's stored setting for these tools. */
export interface ExaToolSettings {
  /** Whether the tools are mounted at all. */
  readonly enabled: boolean
  /** Group every call bills to unless the caller names one; empty means the catalog's first. */
  readonly group: string
  /** Most results one search may return. */
  readonly maxResults: number
  /** Longest text one hit or page may contribute, in characters. */
  readonly maxCharacters: number
}

/** External facts the tools read at call time. */
export interface ExaToolDeps {
  /** The stored setting: the switch, the default group, and the two budgets. */
  readonly settings: () => ExaToolSettings
  /** The client shared with the rest of the plugin. */
  readonly client: NearTokenExaClient
  /** How long one call may take, in milliseconds; also sizes the tool deadline. */
  readonly timeoutMs: () => number
}

/**
 * Resolve the group one call bills to.
 * @param settings - the operator's stored setting.
 * @param requested - the group the caller named, when it named one.
 * @returns the group to bill, or undefined to take the catalog's first offering.
 */
export function pickExaGroup(settings: ExaToolSettings, requested?: string): string | undefined {
  if (requested !== undefined && requested !== '') return requested
  return settings.group === '' ? undefined : settings.group
}

/**
 * Bound a caller's result count by the operator's budget.
 * @param settings - the operator's stored setting.
 * @param requested - the count the caller asked for.
 * @returns a count between one and the operator's ceiling.
 */
export function boundResultCount(settings: ExaToolSettings, requested?: number): number {
  const ceiling = Math.max(1, settings.maxResults)
  if (requested === undefined || !Number.isFinite(requested)) return ceiling
  return Math.min(ceiling, Math.max(1, Math.trunc(requested)))
}

/**
 * Format one search as the model-facing envelope.
 * @param value - the finished search.
 * @returns the text block the tool result carries.
 */
export function formatSearchOutput(value: ExaSearchResult): string {
  const lines = value.results.map((hit, index) => {
    const head = `${String(index + 1)}. ${hit.title ?? hit.url}`
    const meta = [hit.url, hit.publishedDate].filter((part): part is string => part !== undefined).join(' · ')
    return `${head}\n   ${meta}${hit.snippet === undefined ? '' : `\n   ${hit.snippet.replaceAll('\n', '\n   ')}`}`
  })
  return `<group>${value.group}</group>
<results count="${String(value.results.length)}">
${lines.length === 0 ? 'No page matched this query.' : lines.join('\n')}
</results>`
}

/**
 * Format one page fetch as the model-facing envelope.
 * @param value - the finished fetch.
 * @returns the text block the tool result carries.
 */
export function formatFetchOutput(value: ExaFetchResult): string {
  const pages = value.pages.map((page) => {
    const meta = [page.publishedDate].filter((part): part is string => part !== undefined).join(' · ')
    return `<page url="${page.url}"${page.title === undefined ? '' : ` title="${page.title.replaceAll('"', '&quot;')}"`}${meta === '' ? '' : ` published="${meta}"`}>
${page.content}
</page>`
  })
  return `<group>${value.group}</group>
${pages.length === 0 ? 'The pages carried no readable content.' : pages.join('\n')}`
}

/** One text block: what both tools answer with. */
function textBlock(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

/**
 * Register `exa_search` and `exa_fetch`.
 * @param ctx - a context carrying `tools`.
 * @param deps - the stored setting and the Exa client.
 * @returns the disposer that unmounts both tools.
 */
export function registerExaTools(ctx: Context, deps: ExaToolDeps): () => void {
  const search = ctx.tools.register(defineTool({
    name: 'exa_search',
    description: 'Search the web and get the part of each page that answers the query, with its URL. '
      + 'Results are excerpts, not whole pages, so this is the cheap way to find out what exists; '
      + 'follow up with exa_fetch on the URLs worth reading in full. '
      + 'Write the query as the thing you want to find, in natural language; '
      + 'use includeDomains/excludeDomains to pin or drop a site instead of putting site: in the query. '
      + 'The search depth sets the price: lite is cheapest and shallow, auto (the default) handles '
      + 'ordinary questions, deep spends several seconds and dollars on hard research. '
      + 'Each call is billed to the operator\'s Exa group.',
    parameters: {
      query: { type: 'string', required: true, description: 'What to find, in natural language.' },
      numResults: { type: 'integer', description: 'How many pages to return; the operator sets the ceiling (default 8).' },
      type: {
        type: 'string',
        enum: [...SEARCH_TYPES],
        description: 'Search depth: lite (cheapest), auto (default, ordinary questions), deep (multi-step research).',
      },
      includeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only return pages from these domains, e.g. ["docs.exa.ai"].',
      },
      excludeDomains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Never return pages from these domains.',
      },
      startPublishedDate: { type: 'string', description: 'Only pages published after this ISO 8601 date.' },
      endPublishedDate: { type: 'string', description: 'Only pages published before this ISO 8601 date.' },
      group: { type: 'string', description: 'Billing group to use; omit to use the operator\'s default group.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          group: { type: 'string', required: true, description: 'Group the call was billed to.' },
          requestId: { type: 'string', description: 'Vendor request id, for tracing one call.' },
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string' },
                publishedDate: { type: 'string' },
                snippet: { type: 'string', description: 'Excerpt the vendor selected for this query.' },
              },
            },
          },
        },
      },
      render: (_args, value) => textBlock(formatSearchOutput(value)),
      presentationMeta: (_args, value) => ({ group: value.group, results: value.results.length }),
    },
    timeoutMs: deps.timeoutMs() + DEADLINE_MARGIN_MS,
    // Every call is its own request, so two searches never contend.
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<ExaSearchResult> {
      const settings = deps.settings()
      if (!settings.enabled) {
        throw new Error('Exa web search is off: turn it on in Settings → NearToken → Web search')
      }
      const group = pickExaGroup(settings, args.group)
      return await deps.client.search({
        query: args.query,
        type: SEARCH_TYPES.find(type => type === args.type) ?? 'auto',
        numResults: boundResultCount(settings, args.numResults),
        maxCharacters: settings.maxCharacters,
        ...group === undefined ? {} : { group },
        ...args.includeDomains === undefined ? {} : { includeDomains: args.includeDomains },
        ...args.excludeDomains === undefined ? {} : { excludeDomains: args.excludeDomains },
        ...args.startPublishedDate === undefined ? {} : { startPublishedDate: args.startPublishedDate },
        ...args.endPublishedDate === undefined ? {} : { endPublishedDate: args.endPublishedDate },
        signal: exec.signal,
      })
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Search the web for "${args.query}"`,
        kind: 'other',
        rawInput: args.query,
      }
    },
  }))

  const fetchTool = ctx.tools.register(defineTool({
    name: 'exa_fetch',
    description: 'Read pages you already have URLs for and get their text, key excerpts, or a summary. '
      + 'Use it after exa_search when a result matters, or when the user pastes links. '
      + 'Prefer highlights for "what does this page say about X"; use text when the whole document matters '
      + '(it is cut at the operator\'s character budget), and summary when it is long and only the gist is needed. '
      + 'Each page is billed under the operator\'s Exa contents group.',
    parameters: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Pages to read, as absolute http(s) URLs.',
      },
      mode: {
        type: 'string',
        enum: [...CONTENT_MODES],
        description: 'highlights (default): excerpts relevant to the task; text: the page body; summary: an AI summary.',
      },
      group: { type: 'string', description: 'Billing group to use; omit to use the operator\'s default group.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          group: { type: 'string', required: true, description: 'Group the call was billed to.' },
          requestId: { type: 'string', description: 'Vendor request id, for tracing one call.' },
          pages: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string' },
                publishedDate: { type: 'string' },
                content: { type: 'string', required: true, description: 'The requested view of the page.' },
              },
            },
          },
        },
      },
      render: (_args, value) => textBlock(formatFetchOutput(value)),
      presentationMeta: (_args, value) => ({ group: value.group, pages: value.pages.length }),
    },
    timeoutMs: deps.timeoutMs() + DEADLINE_MARGIN_MS,
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<ExaFetchResult> {
      const settings = deps.settings()
      if (!settings.enabled) {
        throw new Error('Exa web search is off: turn it on in Settings → NearToken → Web search')
      }
      const urls = args.urls.filter(url => /^https?:\/\//i.test(url))
      if (urls.length === 0) {
        throw new Error('exa_fetch needs at least one absolute http(s) URL')
      }
      const group = pickExaGroup(settings, args.group)
      return await deps.client.contents({
        urls,
        mode: CONTENT_MODES.find(mode => mode === args.mode) ?? 'highlights',
        maxCharacters: settings.maxCharacters,
        ...group === undefined ? {} : { group },
        signal: exec.signal,
      })
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Read ${String(args.urls.length)} page${args.urls.length === 1 ? '' : 's'}`,
        kind: 'other',
        rawInput: args.urls.join('\n'),
      }
    },
  }))

  return () => {
    search()
    fetchTool()
  }
}
