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
import type { NearTokenModelEntry, NearTokenModelMeta, NearTokenModelsState } from '../protocol.ts'
import type { NearTokenRoute } from './pricing.ts'

/** Longest model name a save may carry, in characters. */
const MAX_MODEL_NAME = 200

/** Most model names one save may carry. */
const MAX_MODELS = 2000

/** The ratio caption the catalog stores in a route's description (`分组倍率 0.4x`). */
const RATIO_PATTERN = /([0-9]+(?:\.[0-9]+)?)x/

/** The modality names a meta override may state. */
const MODALITIES = ['text', 'image'] as const

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
  /** The stored per-model meta overrides; empty when the user never set one. */
  meta: () => Readonly<Record<string, NearTokenModelMeta>>
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
  const declared = new Map<string, { contextWindow?: number; maxTokens?: number; input?: readonly string[] }>()
  for (const route of routes) {
    const ratio = RATIO_PATTERN.exec(route.description)?.[1]
    const groups = byModel.get(route.model)
    const entry = ratio === undefined ? { group: route.group } : { group: route.group, ratio: `${ratio}x` }
    if (groups === undefined) byModel.set(route.model, [entry])
    else groups.push(entry)
    // The site states one capacity per model, but a group can under-declare;
    // the first declaration that answers wins, so the page shows what the
    // adapter would fall back to.
    const facts = declared.get(route.model) ?? {}
    declared.set(route.model, {
      ...facts,
      ...facts.contextWindow === undefined && route.contextWindow !== undefined ? { contextWindow: route.contextWindow } : {},
      ...facts.maxTokens === undefined && route.maxTokens !== undefined ? { maxTokens: route.maxTokens } : {},
      ...facts.input === undefined && route.input !== undefined && route.input.length > 0 ? { input: route.input } : {},
    })
  }
  return [...byModel].map(([model, groups]) => {
    const cheapest = groups.reduce<number | undefined>((low, group) => {
      if (group.ratio === undefined) return low
      const value = Number.parseFloat(group.ratio)
      if (!Number.isFinite(value)) return low
      return low === undefined || value < low ? value : low
    }, undefined)
    const facts = declared.get(model) ?? {}
    return {
      model,
      groups,
      ...cheapest === undefined ? {} : { minRatio: cheapest },
      ...facts.contextWindow === undefined ? {} : { contextWindow: facts.contextWindow },
      ...facts.maxTokens === undefined ? {} : { maxTokens: facts.maxTokens },
      ...facts.input === undefined ? {} : { input: facts.input },
    }
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
export function parseMeta(value: unknown): Record<string, NearTokenModelMeta> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_MODELS) return undefined
  const meta: Record<string, NearTokenModelMeta> = {}
  for (const [model, raw] of entries) {
    const name = model.trim()
    if (name.length === 0 || name.length > MAX_MODEL_NAME) return undefined
    if (typeof raw !== 'object' || raw === null) return undefined
    const facts: NearTokenModelMeta = {}
    for (const [key, member] of Object.entries(raw as Record<string, unknown>)) {
      // Unknown keys are refused rather than dropped: a typo like
      // "contextWindows" would otherwise save clean and change nothing.
      if (key === 'contextWindow' || key === 'maxTokens') {
        if (typeof member !== 'number' || !Number.isSafeInteger(member) || member <= 0) return undefined
        ;(facts as Record<string, unknown>)[key] = member
        continue
      }
      if (key !== 'input') return undefined
      if (!Array.isArray(member) || member.length === 0) return undefined
      const modalities: ('text' | 'image')[] = []
      for (const item of member) {
        if (item !== 'text' && item !== 'image') return undefined
        if (!modalities.includes(item)) modalities.push(item)
      }
      ;(facts as Record<string, unknown>)[key] = modalities
    }
    // An empty fact set is a removal, not an entry.
    if (Object.keys(facts).length > 0) meta[name] = facts
  }
  return meta
}

/** The whitelist's read and write faces, mounted on the settings routes. */
export class NearTokenWhitelist {
  /**
   * @param deps - the stored list, the catalog, and the profile entry a save writes.
   */
  constructor(private readonly deps: NearTokenWhitelistDeps) {}

  /**
   * Read the catalog, the stored whitelist, and the stored meta overrides.
   * @returns every model the site offers, plus the list and meta the user kept.
   */
  async state(): Promise<NearTokenModelsState> {
    return {
      models: summarizeModels(await this.deps.routes()),
      enabled: [...this.deps.enabled()],
      meta: { ...this.deps.meta() },
    }
  }

  /**
   * Persist one whitelist, and the meta overrides when the save names them.
   * @param enabled - model names to keep visible; empty restores every model.
   * @param meta - the complete meta overrides; absent keeps the stored ones.
   * @returns resolution after the profile write and its live application.
   * @throws {Error} when the composition has no settings service, so nothing
   * could persist the list.
   */
  async save(enabled: readonly string[], meta: Readonly<Record<string, NearTokenModelMeta>> | undefined): Promise<void> {
    const settings = this.deps.settings()
    if (settings === undefined) {
      throw new Error('neartoken: the model whitelist needs the settings service')
    }
    await settings.update(this.deps.entryId, {
      enabledModels: [...enabled],
      ...meta === undefined ? {} : { modelMeta: meta },
    })
  }
}
