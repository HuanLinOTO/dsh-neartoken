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

import { isChatOffering } from './model-caps.ts'

/**
 * The reference grammar the dispatch header accepts: `#` and the site's own
 * numeric id. A value outside it is not a reference, and sending a group NAME
 * in the header is what the site's HTTP layer rejects.
 */
const GROUP_REF_PATTERN = /^#[0-9]+$/

/** One model row from `/api/pricing`. */
interface PricingModel {
  readonly model_name: string
  readonly enable_groups: readonly string[]
  /** Capacity an operator maintained for this model; absent when unmaintained. */
  readonly contextWindow?: number
  readonly maxTokens?: number
  /** Downstream surfaces the site declares for this model; absent when it declares none. */
  readonly endpoints?: readonly string[]
}

/** The parts of `/api/pricing` this adapter consumes. */
export interface NearTokenPricing {
  readonly models: readonly PricingModel[]
  readonly groupRatio: Readonly<Record<string, number>>
  readonly groupDescription: Readonly<Record<string, string>>
  /** Opaque, ASCII-only routing reference per group name (`"#3"`). */
  readonly groupRefs: Readonly<Record<string, string>>
}

/** One expanded catalog route: one group's take on one model. */
export interface NearTokenRoute {
  /** Catalog model id: `"<group>::<model>"`. */
  readonly id: string
  /** Display name: `"<model> @ <group>"`. */
  readonly name: string
  /** Ratio caption carried through the catalog's description field. */
  readonly description: string
  readonly group: string
  /**
   * The group's routing reference (`"#3"`), sent as the dispatch header value.
   * Absent when the site published no reference for this group, in which case
   * the request carries no group intent at all.
   */
  readonly groupRef?: string
  readonly model: string
  /** Context window the site declared for this model, in tokens. */
  readonly contextWindow?: number
  /** Output ceiling the site declared for this model, in tokens. */
  readonly maxTokens?: number
  /** Downstream surfaces the site declared for this model. */
  readonly endpoints?: readonly string[]
}

/**
 * Read a positive token count from an endpoint field.
 * @param value - the raw JSON member.
 * @returns the count, or undefined when the field is absent or not a positive integer.
 */
function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/**
 * Read one model's declared endpoint types.
 * @param value - the raw `supported_endpoint_types` member.
 * @returns the declared names, or undefined when the site declared none.
 */
function endpointTypes(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  return names.length === 0 ? undefined : names
}

/**
 * Expand one pricing payload into one route per (group, model) pair.
 * @param pricing - the loaded endpoint payload.
 * @returns routes in endpoint order, group order preserved per model.
 */
export function expandRoutes(pricing: NearTokenPricing): readonly NearTokenRoute[] {
  const routes: NearTokenRoute[] = []
  for (const model of pricing.models) {
    for (const group of model.enable_groups) {
      const ratio = pricing.groupRatio[group]
      const groupRef = pricing.groupRefs[group]
      routes.push({
        id: `${group}::${model.model_name}`,
        name: `${model.model_name} @ ${group}`,
        description: ratio === undefined ? '分组倍率 1x' : `分组倍率 ${ratio}x`,
        group,
        ...groupRef === undefined ? {} : { groupRef },
        model: model.model_name,
        ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
        ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
        ...model.endpoints === undefined ? {} : { endpoints: model.endpoints },
      })
    }
  }
  return routes
}

/**
 * Parse the endpoint's JSON into the consumed shape; unknown extra fields are
 * ignored so the New API side can evolve.
 * @param value - the parsed JSON body.
 * @returns the normalized payload.
 */
export function parsePricing(value: unknown): NearTokenPricing {
  if (typeof value !== 'object' || value === null) throw new Error('neartoken: pricing payload is not an object')
  const record = value as Record<string, unknown>
  const models: PricingModel[] = []
  for (const entry of Array.isArray(record.data) ? record.data : []) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const name = row.model_name
    const groups = row.enable_groups
    if (typeof name !== 'string' || !Array.isArray(groups)) continue
    const contextWindow = tokenCount(row.context_window)
    const maxTokens = tokenCount(row.max_tokens)
    const endpoints = endpointTypes(row.supported_endpoint_types)
    models.push({
      model_name: name,
      enable_groups: groups.filter((group): group is string => typeof group === 'string'),
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      ...endpoints === undefined ? {} : { endpoints },
    })
  }
  const ratio: Record<string, number> = {}
  if (typeof record.group_ratio === 'object' && record.group_ratio !== null) {
    for (const [group, value] of Object.entries(record.group_ratio as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) ratio[group] = value
    }
  }
  const description: Record<string, string> = {}
  if (typeof record.usable_group === 'object' && record.usable_group !== null) {
    for (const [group, value] of Object.entries(record.usable_group as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > 0) description[group] = value
    }
  }
  const refs: Record<string, string> = {}
  if (typeof record.group_refs === 'object' && record.group_refs !== null) {
    for (const [group, value] of Object.entries(record.group_refs as Record<string, unknown>)) {
      // Only a reference-shaped value routes: the group name itself travels in
      // the same field family and must never be sent as a header value.
      if (typeof value === 'string' && GROUP_REF_PATTERN.test(value)) refs[group] = value
    }
  }
  return { models, groupRatio: ratio, groupDescription: description, groupRefs: refs }
}

/** Loads and caches the pricing payload for one adapter instance. */
export class PricingDirectory {
  private cache: { at: number; routes: readonly NearTokenRoute[] } | undefined
  private inflight: Promise<readonly NearTokenRoute[]> | undefined

  /**
   * @param ctx - the owning plugin context (logging only).
   * @param baseURL - the site root, e.g. `https://llm.pko.svcfusion.com`.
   * @param ttlMs - how long one load stays fresh.
   */
  constructor(
    private readonly ctx: { logger: { warn: (message: string, ...args: unknown[]) => void } },
    private readonly baseURL: () => string,
    private readonly ttlMs: () => number,
  ) {}

  /**
   * Return the expanded routes, reloading when the cache is older than the TTL.
   * @param force - bypass the TTL and reload now.
   * @returns one route per (group, model); empty when the endpoint is unreachable.
   */
  load(force = false): Promise<readonly NearTokenRoute[]> {
    const fresh = this.cache !== undefined && Date.now() - this.cache.at < this.ttlMs()
    if (!force && fresh && this.cache !== undefined) return Promise.resolve(this.cache.routes)
    if (this.inflight !== undefined) return this.inflight
    const operation = fetch(`${this.baseURL()}/api/pricing`, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`pricing endpoint answered ${response.status}`)
        // The site publishes every route it knows; the provider only offers the
        // ones that answer a chat request (see isChatOffering).
        return expandRoutes(parsePricing(await response.json()))
          .filter(route => isChatOffering(route.model, route.endpoints))
      })
      .then((routes) => {
        this.cache = { at: Date.now(), routes }
        return routes
      })
      .catch((error: unknown) => {
        this.ctx.logger.warn('neartoken: pricing load failed', error)
        // Serve the last good load on failure; an empty catalog otherwise.
        return this.cache?.routes ?? []
      })
      .finally(() => { this.inflight = undefined })
    this.inflight = operation
    return operation
  }
}
