/**
 * ModelGroupSelect: a drop-in replacement for the composer's model seat
 * ('conversation.input.model') that adds a THIRD level between the model and
 * the reasoning effort.
 *
 * The root menu is a row triple — Model / Group / Effort — where the Group row
 * appears only while the selected model comes from a provider whose catalog
 * names carry a group suffix (see groups.ts). The trigger states all three:
 * "GLM 5.3 · Zhang · high".
 *
 * Registered at priority -1, one step below the built-in seat, so the shipped
 * picker stays untouched and simply does not render.
 */
import { MenuGroup, MenuSurface, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconCloseFillRegular, IconDataOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelGroupSelectInjected } from './slots.ts'
import type { ModelCatalogModel } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  chooseVariant, displayModelName, foldModels, isGroupedProvider, parseGroupLabel, ratioOf,
  type ModelOption, type ModelVariant,
} from './groups.ts'
import { GroupTag, RatioChip } from './group-tags.tsx'
import css from './ModelGroupSelect.module.css'

/** Which pane the dropdown shows: the three-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'group' | 'effort'

/** Unplaced portal card: hidden but laid out at a fixed origin so offset sizes are real. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** One provider's folded rows. */
interface ProviderRows<M> {
  readonly id: string
  readonly name: string
  readonly options: readonly ModelOption<M>[]
}

/** Provider display order: account first, official next, then catalog order. */
function providerRank(id: string): number {
  return id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2
}

/**
 * Case-insensitive containment filter for the model search.
 * @param label - the row's display name.
 * @param query - the trimmed search text; empty keeps every row.
 * @returns whether the row stays visible.
 */
function matchesQuery(label: string, query: string): boolean {
  return query === '' || label.toLowerCase().includes(query.toLowerCase())
}

/**
 * Keep the effort the user already picked when the new model offers it.
 * @param model - the catalog model the selection will route to.
 * @param previous - the effort in use before the switch.
 * @returns the effort to submit, or undefined for a model without reasoning.
 */
function effortFor(model: ModelCatalogModel, previous: string | undefined): string | undefined {
  const reasoning = model.reasoning
  if (reasoning === undefined) return undefined
  if (previous !== undefined && reasoning.efforts.some(level => level.id === previous)) return previous
  return reasoning.defaultEffort
}

/**
 * Render the composer model seat with the group level.
 * @param props - owner share (locked) + injected directory face + the locale seat.
 * @returns the trigger and, while open, the three-level menu.
 */
export function ModelGroupSelect(
  { locked, available, directory, load, select, t }:
  ModelGroupSelectInjected & Pick<PropsRuntime<'conversation.input.model'>, 'locked'> & PropsLocale<'modelGroups'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const id = useId()

  const accountName = t('provider.account')
  const providers = useMemo<ProviderRows<ModelCatalogModel>[]>(() => state.groups
    .map(group => ({
      id: group.id,
      name: group.id === 'deepseek-account' ? accountName : group.name,
      options: foldModels(group.id, group.models),
    }))
    .toSorted((left, right) => providerRank(left.id) - providerRank(right.id)), [state.groups, accountName])

  const current = state.current
  const located = useMemo(() => {
    for (const provider of providers) {
      for (const option of provider.options) {
        for (const variant of option.variants) {
          if (variant.provider === current?.provider && variant.model.id === current.model) {
            return { provider, option, variant }
          }
        }
      }
    }
    return undefined
  }, [providers, current])

  const reasoning = located?.variant.model.reasoning
  const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = located === undefined
    ? undefined
    : reasoning === undefined
      ? state.retainedEffort
      : effectiveEffort === undefined
        ? t('effort.providerDefault')
        : reasoning.efforts.find((level: ModelReasoningEffort) => level.id === effectiveEffort)?.name ?? effectiveEffort

  const currentGroup = located?.variant.group
  const groupChoices = useMemo(() => located === undefined || currentGroup === undefined
    ? []
    : located.option.variants.filter(variant => variant.provider === located.provider.id
      && variant.group !== undefined), [located, currentGroup])

  const filteredProviders = useMemo(() => {
    const trimmed = query.trim()
    return providers
      .map(provider => ({
        ...provider,
        options: provider.options.filter(option => matchesQuery(option.label, trimmed)),
      }))
      .filter(provider => provider.options.length > 0)
  }, [providers, query])

  const visibleOptions = useMemo(() => filteredProviders.flatMap(provider =>
    provider.options.map(option => ({ provider, option }))), [filteredProviders])
  const showSearch = providers.reduce((total, provider) => total + provider.options.length, 0) > 4
  const activeIndex = Math.min(highlighted, Math.max(0, visibleOptions.length - 1))
  const { pending } = state
  const busy = pending !== null
  const waiting = located === undefined && state.status === 'loading'

  const show = (): void => {
    triggerRef.current?.focus()
    setQuery('')
    setHighlighted(0)
    setPane(located === undefined ? 'model' : 'root')
    setOpen(true)
    load()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node) === true) return
      if (menuRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
      setPane('root')
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  useLayoutEffect(() => {
    if (!available || !open) { setMenuPos(null); return }
    const place = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const MARGIN = 12
      const width = menuRef.current?.offsetWidth ?? 0
      const height = menuRef.current?.offsetHeight ?? 0
      let x = rect.right - width
      let y = rect.top - 8 - height
      if (width > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - width - MARGIN)
      if (height > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - height - MARGIN)
      setMenuPos({ left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [available, open, pane, state, query])

  useLayoutEffect(() => {
    if (open && pane === 'model' && showSearch) searchRef.current?.focus()
  }, [open, pane, showSearch])

  if (!available) return null

  const settle = (result: Awaited<ReturnType<ModelGroupSelectInjected['select']>>): void => {
    if (result === undefined) return
    if (result.ok) {
      setOpen(false)
      setPane('root')
      return
    }
    const { error } = result
    setToast(error.code === 'session/writer-held'
      ? t('error.sessionInUse')
      : t('error.action', { message: `${error.code}: ${error.message}` }))
  }

  const submit = (selection: ModelSelection): void => {
    triggerRef.current?.focus()
    void select(selection).then(settle)
  }

  const chooseOption = (option: ModelOption<ModelCatalogModel>): void => {
    const variant = chooseVariant(option, current?.provider, currentGroup)
    if (variant === undefined) return
    if (current?.provider === variant.provider && current.model === variant.model.id) {
      close(true)
      return
    }
    const effort = effortFor(variant.model, effectiveEffort)
    submit({
      provider: variant.provider,
      model: variant.model.id,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
  }

  const chooseGroup = (variant: ModelVariant<ModelCatalogModel>): void => {
    if (current === null) return
    if (variant.model.id === current.model) {
      close(true)
      return
    }
    const effort = effortFor(variant.model, effectiveEffort)
    submit({
      provider: variant.provider,
      model: variant.model.id,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    submit({
      provider: current.provider,
      model: current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      if (pane !== 'root' && located !== undefined) setPane('root')
      else close(true)
      return
    }
    if (!open || pane !== 'root') return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setPane('root')
    }
  }

  // Only this plugin's own provider gets the rewritten name: every other
  // provider's models are the application's own catalog entries, so the seat
  // must keep showing them exactly as the built-in seat does. The group is a
  // routing dimension and is never spelled out here.
  const ownProvider = located !== undefined && isGroupedProvider(located.provider.id)
  const modelLabel = waiting
    ? t('trigger.loading')
    : located === undefined
      ? t('trigger.fallback')
      : ownProvider
        ? `${displayModelName(located.option.label)} @ ${located.provider.name}`
        : located.option.label
  const triggerParts = [modelLabel, effortLabel].filter(part => part !== undefined && part !== '')
  const triggerLabel = triggerParts.join(' · ')
  const triggerAria = waiting
    ? t('trigger.loading')
    : located === undefined
      ? t('trigger.selectAria')
      : t('trigger.aria', { model: modelLabel })

  let optionIndex = 0

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        aria-busy={busy}
        disabled={locked}
        onClick={() => { if (open) close(true); else show() }}
      >
        <IconDataOutlineRegular className={css.triggerIcon} size={16} />
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        {busy
          ? <StateDot state="ongoing" />
          : <IconChevronDownOutlineRegular className={css.chevron} />}
      </button>

      {open && createPortal(
        <MenuSurface
          ref={menuRef}
          id={`${id}-menu`}
          className={css.menu}
          style={menuPos ?? MEASURE_STYLE}
          role={pane === 'model' || pane === 'group' ? 'group' : 'menu'}
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutlineRegular className={css.cellChevron} />
              </button>
              {currentGroup !== undefined && (
                <button
                  type="button"
                  role="menuitem"
                  className={css.cell}
                  disabled={groupChoices.length < 2}
                  onClick={() => { setPane('group') }}
                >
                  <span className={css.cellLabel}>{t('menu.group')}</span>
                  <span className={css.cellValue}>
                    <GroupInline group={currentGroup} description={located?.variant.model.description} showRatio />
                  </span>
                  {groupChoices.length > 1 && <IconChevronRightOutlineRegular className={css.cellChevron} />}
                </button>
              )}
              {reasoning !== undefined && (
                <button type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutlineRegular className={css.cellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              {showSearch && (
                <div className={css.searchRow}>
                  <Input
                    ref={searchRef}
                    className={css.search}
                    type="text"
                    role="searchbox"
                    aria-label={t('search.placeholder')}
                    placeholder={t('search.placeholder')}
                    value={query}
                    readOnly={busy}
                    onChange={(event) => { setQuery(event.target.value); setHighlighted(0) }}
                  />
                  {query !== '' && (
                    <button
                      type="button"
                      className={css.searchClear}
                      aria-label={t('search.clear')}
                      disabled={busy}
                      onClick={() => { setQuery(''); searchRef.current?.focus() }}
                    >
                      <IconCloseFillRegular />
                    </button>
                  )}
                </div>
              )}
              {state.status === 'loading' && <div className={css.status}>{t('status.loading')}</div>}
              {state.error !== null && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={load}>{t('action.reload')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.id === 'deepseek-account' ? accountName : failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={load}>{t('action.reload')}</button>
                </div>
              ))}
              <div className={css.groups} role="menu" aria-label={t('menu.model')} hidden={filteredProviders.length === 0}>
                {filteredProviders.map(provider => (
                  <MenuGroup key={provider.id} label={provider.name}>
                    {provider.options.map(option => {
                      const index = optionIndex++
                      const isCurrent = located !== undefined && located.option.key === option.key
                        && located.provider.id === provider.id
                      const groups = option.variants.filter(variant => variant.group !== undefined)
                      return (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={isCurrent}
                          id={`${id}-model-${index}`}
                          tabIndex={showSearch ? -1 : 0}
                          onFocus={() => { setHighlighted(index) }}
                          data-highlighted={index === activeIndex ? '' : undefined}
                          className={css.option + ' ' + css.modelOption + ' ' + (index === activeIndex ? css.optionActive : '')}
                          key={option.key}
                          title={option.label}
                          disabled={busy}
                          onMouseMove={() => { setHighlighted(index) }}
                          onClick={() => { chooseOption(option) }}
                        >
                          <span className={css.optionCopy}>
                            <span className={css.modelName}>
                              {isGroupedProvider(provider.id) ? displayModelName(option.label) : option.label}
                            </span>

                          </span>
                          <span className={css.optionTrailing}>
                            {groups.length > 1 && <span className={css.variantCount}>{groups.length}</span>}
                            <span className={css.check}>
                              {isCurrent ? <IconCheckOutlineRegular /> : null}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </MenuGroup>
                ))}
              </div>
              {state.status === 'ready' && filteredProviders.length === 0 && (
                <div className={css.empty} role="status">
                  {t(providers.length === 0 ? 'empty.models' : 'search.empty')}
                </div>
              )}
            </>
          )}

          {pane === 'group' && (
            <>
              {groupChoices.length === 0
                ? <div className={css.empty}>{t('empty.groups')}</div>
                : groupChoices.map((variant) => {
                  const isCurrent = variant.model.id === current?.model
                  return (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={isCurrent}
                      className={css.option + (isCurrent ? ' ' + css.selected : '')}
                      key={variant.model.id}
                      disabled={busy}
                      onClick={() => { chooseGroup(variant) }}
                    >
                      <span className={css.optionCopy}>
                        <span className={css.groupOptionLabel}>
                          <GroupInline group={variant.group ?? ''} description={variant.model.description} showRatio />
                        </span>
                      </span>
                      <span className={css.check}>
                        {isCurrent ? <IconCheckOutlineRegular /> : null}
                      </span>
                    </button>
                  )
                })}
            </>
          )}

          {pane === 'effort' && (
            <>
              {(reasoning?.efforts.length ?? 0) === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : [
                  ...reasoning?.defaultEffort === undefined
                    ? [{ id: undefined as string | undefined, name: t('effort.providerDefault') }]
                    : [],
                  ...(reasoning?.efforts ?? []).map((level: ModelReasoningEffort) => ({ id: level.id as string | undefined, name: level.name })),
                ].map(level => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.id}
                    className={css.option + (effectiveEffort === level.id ? ' ' + css.selected : '')}
                    key={level.id ?? 'provider-default'}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.id) }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{level.name}</span>
                    </span>
                    <span className={css.check}>
                      {effectiveEffort === level.id ? <IconCheckOutlineRegular /> : null}
                    </span>
                  </button>
                ))}
            </>
          )}
        </MenuSurface>,
        document.body,
      )}
      {toast !== null && <div className={css.toast} role="status">{toast}</div>}
    </div>
  )
}

/**
 * One group's inline rendering: badge capsules, its own name, and optionally the
 * ratio badge.
 * @param props - the group key, its hardcoded style, and whether to show the ratio.
 * @returns the inline group value.
 */
function GroupInline(
  { group, description, showRatio = false }: { group: string; description?: string; showRatio?: boolean },
) {
  const { badges, label } = parseGroupLabel(group)
  const ratio = showRatio ? ratioOf(description) : undefined
  return (
    <span className={css.groupInline}>
      {badges.map(badge => <GroupTag key={badge.text} text={badge.text} tone={badge.tone} />)}
      <span className={css.groupName}>{label}</span>
      {ratio !== undefined && <RatioChip ratio={ratio} />}
    </span>
  )
}


