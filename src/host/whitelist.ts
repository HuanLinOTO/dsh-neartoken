/**
 * The model whitelist: which catalog models the provider advertises, kept in
 * the plugin's own profile configuration.
 *
 * The list is a `volatile` Config field (`enabledModels`), so a save reaches
 * the running plugin through the `settings` service without remounting it: the
 * Loader commits the new value into the live fiber, and the resulting settings
 * change is what reloads every client model list. It persists in the profile
 * patch with the rest of the user's configuration.
 *
 * An empty list means "no whitelist": every model is advertised, which is the
 * behavior before the user ever opened the page and the one a save of nothing
 * restores.
 *
 * @module
 */
import type { NearTokenModelEntry, NearTokenModelsState } from '../protocol.ts'
import type { NearTokenRoute } from './pricing.ts'

/** Longest model name a save may carry, in characters. */
const MAX_MODEL_NAME = 200

/** Most model names one save may carry. */
const MAX_MODELS = 2000

/** The ratio caption the catalog stores in a route's description (`分组倍率 0.4x`). */
const RATIO_PATTERN = /([0-9]+(?:\.[0-9]+)?)x/

/** The slice of the settings service a save uses. */
export interface WhitelistSettings {
  /**
   * Merge fields into one plugin entry's configuration.
   * @param ns - the profile entry id.
   * @param patch - fields to merge.
   * @returns resolution after the profile write and its live application.
   */
  update(ns: string, patch: Record<string, unknown>): Promise<void>
}

/** What the whitelist reads and writes. */
export interface NearTokenWhitelistDeps {
  /** The stored whitelist; empty when the user never set one. */
  enabled: () => readonly string[]
  /** The full catalog, unfiltered. */
  routes: () => Promise<readonly NearTokenRoute[]>
  /** The profile entry id this plugin's configuration lives in. */
  entryId: string
  /** The settings service, when the composition provides one. */
  settings: () => WhitelistSettings | undefined
}

/**
 * Keep only the routes whose model the user left visible.
 * @param routes - the full catalog.
 * @param enabled - the stored whitelist; empty keeps every route.
 * @returns the routes the provider advertises.
 */
export function selectedRoutes(
  routes: readonly NearTokenRoute[], enabled: readonly string[],
): readonly NearTokenRoute[] {
  if (enabled.length === 0) return routes
  const allowed = new Set(enabled)
  return routes.filter(route => allowed.has(route.model))
}

/**
 * Fold the catalog's per-group routes into one entry per model.
 * @param routes - the full catalog, in endpoint order.
 * @returns one entry per model name, in first-seen order.
 */
export function summarizeModels(routes: readonly NearTokenRoute[]): readonly NearTokenModelEntry[] {
  const byModel = new Map<string, { group: string; ratio?: string }[]>()
  for (const route of routes) {
    const ratio = RATIO_PATTERN.exec(route.description)?.[1]
    const groups = byModel.get(route.model)
    const entry = ratio === undefined ? { group: route.group } : { group: route.group, ratio: `${ratio}x` }
    if (groups === undefined) byModel.set(route.model, [entry])
    else groups.push(entry)
  }
  return [...byModel].map(([model, groups]) => {
    const cheapest = groups.reduce<number | undefined>((low, group) => {
      if (group.ratio === undefined) return low
      const value = Number.parseFloat(group.ratio)
      if (!Number.isFinite(value)) return low
      return low === undefined || value < low ? value : low
    }, undefined)
    return cheapest === undefined ? { model, groups } : { model, groups, minRatio: cheapest }
  })
}

/**
 * Validate one `POST /neartoken/models` body's model list.
 * @param value - the raw `enabled` member.
 * @returns the trimmed, de-duplicated names in order, or undefined when the
 * value is not a list of short non-empty strings.
 */
export function parseEnabled(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_MODELS) return undefined
  const names: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') return undefined
    const name = entry.trim()
    if (name.length === 0 || name.length > MAX_MODEL_NAME) return undefined
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/** The whitelist's read and write faces, mounted on the settings routes. */
export class NearTokenWhitelist {
  /**
   * @param deps - the stored list, the catalog, and the profile entry a save writes.
   */
  constructor(private readonly deps: NearTokenWhitelistDeps) {}

  /**
   * Read the catalog and the stored whitelist together.
   * @returns every model the site offers, plus the list the user kept.
   */
  async state(): Promise<NearTokenModelsState> {
    return { models: summarizeModels(await this.deps.routes()), enabled: [...this.deps.enabled()] }
  }

  /**
   * Persist one whitelist.
   * @param enabled - model names to keep visible; empty restores every model.
   * @returns resolution after the profile write and its live application.
   * @throws {Error} when the composition has no settings service, so nothing
   * could persist the list.
   */
  async save(enabled: readonly string[]): Promise<void> {
    const settings = this.deps.settings()
    if (settings === undefined) {
      throw new Error('neartoken: the model whitelist needs the settings service')
    }
    await settings.update(this.deps.entryId, { enabledModels: [...enabled] })
  }
}
