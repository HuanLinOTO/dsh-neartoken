/**
 * The image-generation setting: which picture models the `generate_image` tool
 * may call, and which group each one routes through.
 *
 * The value lives in this plugin's own profile configuration, beside the model
 * whitelist, so a save is an ordinary Settings write that reaches the running
 * plugin without a remount. An empty selection is a legal state — the tool then
 * has no model to call — which is why "enabled" is stored separately rather
 * than inferred from the selection.
 *
 * @module
 */
import type { NearTokenImageModelEntry, NearTokenImagesPatch, NearTokenImagesState } from '../protocol.ts'
import { imageChannel, isImageModel } from './images.ts'
import type { NearTokenRoute } from './pricing.ts'
import type { WhitelistSettings } from './whitelist.ts'

/** Most picture models one save may enable. */
const MAX_MODELS = 200

/** Longest model or group name a save may carry, in characters. */
const MAX_NAME_LENGTH = 300

/** The ratio caption the catalog stores in a route's description (`分组倍率 0.4x`). */
const RATIO_PATTERN = /([0-9]+(?:\.[0-9]+)?)x/

/**
 * Fold the catalog's per-group routes into one entry per picture model.
 * @param routes - every catalog route, chat models included.
 * @returns one entry per picture model, in first-seen order.
 */
export function imageCatalog(routes: readonly NearTokenRoute[]): readonly NearTokenImageModelEntry[] {
  const byModel = new Map<string, { channels: string[]; groups: { group: string; ratio?: string }[] }>()
  for (const route of routes) {
    if (!isImageModel(route.model, route.endpoints)) continue
    const ratio = RATIO_PATTERN.exec(route.description)?.[1]
    const group = ratio === undefined ? { group: route.group } : { group: route.group, ratio: `${ratio}x` }
    const entry = byModel.get(route.model)
    if (entry === undefined) byModel.set(route.model, { channels: [...route.endpoints ?? []], groups: [group] })
    else {
      entry.groups.push(group)
      for (const endpoint of route.endpoints ?? []) {
        if (!entry.channels.includes(endpoint)) entry.channels.push(endpoint)
      }
    }
  }
  return [...byModel].map(([model, entry]) => {
    const cheapest = entry.groups.reduce<number | undefined>((low, group) => {
      if (group.ratio === undefined) return low
      const value = Number.parseFloat(group.ratio)
      if (!Number.isFinite(value)) return low
      return low === undefined || value < low ? value : low
    }, undefined)
    return {
      model,
      channel: imageChannel(entry.channels),
      groups: entry.groups,
      ...cheapest === undefined ? {} : { minRatio: cheapest },
    }
  })
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
export function parseImagePatch(
  value: unknown, catalog: readonly NearTokenImageModelEntry[],
): NearTokenImagesPatch | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.enabled !== 'boolean') return undefined
  const raw = record.models
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > MAX_MODELS) return undefined
  const groups = new Map(catalog.map(entry => [entry.model, new Set(entry.groups.map(group => group.group))]))
  const models: Record<string, string> = {}
  for (const [model, group] of entries) {
    if (model.length === 0 || model.length > MAX_NAME_LENGTH) return undefined
    if (typeof group !== 'string' || group.length === 0 || group.length > MAX_NAME_LENGTH) return undefined
    if (groups.get(model)?.has(group) !== true) return undefined
    models[model] = group
  }
  return { enabled: record.enabled, models }
}

/** What the image setting reads and writes. */
export interface NearTokenImageSettingsDeps {
  /** The stored value; `enabled` false until the user turns the tool on. */
  stored: () => { readonly enabled: boolean; readonly models: Readonly<Record<string, string>> }
  /** The picture models the site offers right now. */
  catalog: () => Promise<readonly NearTokenImageModelEntry[]>
  /** The profile entry id this plugin's configuration lives in. */
  entryId: string
  /** The settings service, when the composition provides one. */
  settings: () => WhitelistSettings | undefined
}

/** The image setting's read and write faces, mounted on the settings routes. */
export class NearTokenImageSettings {
  /**
   * @param deps - the stored value, the catalog, and the profile entry a save writes.
   */
  constructor(private readonly deps: NearTokenImageSettingsDeps) {}

  /**
   * Read the setting beside the site's picture models.
   * @returns the stored state plus every picture model the site offers.
   */
  async state(): Promise<NearTokenImagesState> {
    const stored = this.deps.stored()
    return { enabled: stored.enabled, models: await this.deps.catalog(), selection: { ...stored.models } }
  }

  /**
   * Persist one setting.
   * @param patch - whether the tool is enabled and the group each model routes through.
   * @returns resolution after the profile write and its live application.
   * @throws {Error} when the composition has no settings service, so nothing could persist it.
   */
  async save(patch: NearTokenImagesPatch): Promise<void> {
    const settings = this.deps.settings()
    if (settings === undefined) {
      throw new Error('neartoken: image generation needs the settings service')
    }
    await settings.update(this.deps.entryId, {
      imageGeneration: { enabled: patch.enabled, models: { ...patch.models } },
    })
  }
}
