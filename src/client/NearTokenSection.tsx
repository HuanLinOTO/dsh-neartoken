/**
 * The NearToken settings page: connect the plugin to the site's account through
 * the site's own device-authorization flow, show whose account is connected, and
 * disconnect.
 *
 * The page never asks for a password. It shows the short code the site issued,
 * offers the site's confirmation page, and re-reads the Host while the Host polls
 * — the key and the provider insertion both happen on the Host side of a grant.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconChevronDownOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  NearTokenImageModelEntry, NearTokenImagesState, NearTokenModelEntry, NearTokenModelsState, NearTokenStatus,
} from '../protocol.ts'
import type { NearTokenApi } from './api.ts'
import { parseGroupLabel } from './groups.ts'
import { GroupTag, RatioChip } from './group-tags.tsx'
import type { GroupKey } from './locales.ts'
import css from './NearTokenSection.module.css'

/** How often the page re-reads the Host while an authorization is pending. */
const PENDING_REFRESH_MS = 1_500

/**
 * How often the page re-reads the Host while connected, so the card shows the
 * wallet numbers the Host re-reads at the same cadence.
 */
const CONNECTED_REFRESH_MS = 300_000

/** How long a burst of checkbox clicks waits before one save is written. */
const AUTOSAVE_DELAY_MS = 400

/** How long the copy button acknowledges a copied address before resetting. */
const COPIED_RESET_MS = 2_000

/** What this section receives from its registration. */
export interface NearTokenSectionInjected {
  /** The Host's four routes. */
  api: NearTokenApi
  /** Bound translate for this plugin's dictionary. */
  t: (key: GroupKey, vars?: Record<string, string>) => string
}

/** Full component props: the section owner share plus this section's injected face. */
export type NearTokenSectionProps = PropsRuntime<'settings.section'> & NearTokenSectionInjected

/**
 * Render the NearToken settings page.
 * @param props - the injected route carrier and translate, plus slot owner props.
 * @returns the section element tree.
 */
export function NearTokenSection({ api, t }: NearTokenSectionProps) {
  const [status, setStatus] = useState<NearTokenStatus | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  /**
   * Whether the card's money facts are being re-read right now. Kept apart from
   * `busy`: a balance read must not disable the buttons beside it.
   */
  const [walletBusy, setWalletBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  /** Whether the confirmation address was just copied to the clipboard. */
  const [copied, setCopied] = useState(false)

  /** Re-read the Host state and publish it. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api.status())
    } catch (failure: unknown) {
      setError(t('account.failed', { message: messageOf(failure) }))
    }
  }, [api, t])

  // The page opens on whatever the Host already knows, so a reload neither
  // restarts a pending authorization nor forgets a finished one.
  useEffect(() => {
    void refresh()
  }, [refresh])

  const pendingCode = status?.pending?.userCode
  const waiting = pendingCode !== undefined
  // A new attempt offers a new address, so the copy acknowledgement starts over.
  useEffect(() => { setCopied(false) }, [pendingCode])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => { setCopied(false) }, COPIED_RESET_MS)
    return () => { clearTimeout(timer) }
  }, [copied])
  // While the Host polls the site, the page polls the Host: the grant, the
  // refusal, and the expiry all arrive as a changed status.
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => { void refresh() }, PENDING_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [waiting, pendingCode, refresh])

  // While connected, the Host refreshes the wallet on its own cadence; the
  // page re-reads the status at the same rate so those numbers reach the card.
  const connected = status?.configured === true
  useEffect(() => {
    if (!connected) return
    const timer = setInterval(() => { void refresh() }, CONNECTED_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [connected, refresh])

  /** Run one Host call with the busy flag and the error channel wired. */
  const run = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (failure: unknown) {
      setError(t('account.failed', { message: messageOf(failure) }))
    } finally {
      setBusy(false)
    }
  }, [t])

  const connect = (): void => {
    void run(async () => {
      const outcome = await api.begin()
      if (outcome.status === 'failed') setError(t('account.failed', { message: outcome.message }))
      await refresh()
    })
  }
  const cancel = (): void => {
    void run(async () => {
      await api.cancel()
      await refresh()
    })
  }

  /**
   * Hand the confirmation page to the user's own browser, through the Host: a
   * window the page opens stays inside the shell hosting it — a desktop build
   * shows another application window, and macOS may refuse outright. The
   * address is printed below as well, for a machine with no launcher at all.
   */
  const openAddress = (): void => {
    void (async (): Promise<void> => {
      setError(undefined)
      try {
        await api.openBrowser()
      } catch (failure: unknown) {
        setError(t('account.openFailed', { message: messageOf(failure) }))
      }
    })()
  }

  /**
   * Copy the confirmation address, for a machine where nothing can be launched.
   */
  const copyAddress = (): void => {
    const address = status?.pending?.verificationUriComplete
    if (address === undefined) return
    void (async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(address)
        setCopied(true)
      } catch {
        setError(t('account.copyFailed'))
      }
    })()
  }
  const signOut = (): void => {
    void run(async () => {
      await api.signOut()
      await refresh()
    })
  }

  /**
   * Ask the Host to re-read the wallet now, and publish the state it answers
   * with: the same read the Host runs on its own cadence, taken early.
   */
  const refreshWallet = (): void => {
    void (async (): Promise<void> => {
      setWalletBusy(true)
      setError(undefined)
      try {
        setStatus(await api.refreshAccount())
      } catch (failure: unknown) {
        setError(t('account.failed', { message: messageOf(failure) }))
      } finally {
        setWalletBusy(false)
      }
    })()
  }

  const account = status?.account
  const pending = status?.pending
  // The empty-voucher sentence owns the link position, so a language that puts
  // it elsewhere only edits its own dictionary entry.
  const [vouchersBefore = '', vouchersAfter = ''] = t('account.vouchersEmpty').split('{link}')
  const minutes = pending === undefined ? 0 : Math.max(1, Math.round((pending.expiresAt - Date.now()) / 60_000))
  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('account.title')}</h2>
      {status === undefined
        ? <p className={css.hint}>{t('account.loading')}</p>
        : status.configured
          ? (
            <section className={css.card}>
              <div className={css.cardHead}>
                <span className={css.name}>{account?.displayName ?? 'NearToken'}</span>
                {account === undefined ? null : <span className={css.handle}>@{account.username}</span>}
                <span className={`${css.badge} ${css.badgeOn}`}>{t('account.connected')}</span>
              </div>
              <dl className={css.facts}>
                <div className={css.fact}>
                  <dt className={css.factLabel}>{t('account.group')}</dt>
                  <dd className={css.factValue}>{account?.group ?? '—'}</dd>
                </div>
                <div className={css.fact}>
                  <dt className={css.factLabel}>{t('account.balance')}</dt>
                  <dd className={`${css.factValue} ${css.valueRow}`}>
                    <span>{account?.balance ?? '—'}</span>
                    <button
                      type="button"
                      className={css.refresh}
                      disabled={walletBusy}
                      onClick={refreshWallet}
                      title={walletBusy ? t('account.refreshing') : t('account.refresh')}
                      aria-label={walletBusy ? t('account.refreshing') : t('account.refresh')}
                    >
                      <IconRefreshOutlineRegular size={13} />
                    </button>
                  </dd>
                </div>
                <div className={css.fact}>
                  <dt className={css.factLabel}>{t('account.used')}</dt>
                  <dd className={css.factValue}>{account?.used ?? '—'}</dd>
                </div>
                <div className={css.fact}>
                  <dt className={css.factLabel}>{t('account.token')}</dt>
                  <dd className={css.factValue}>{status.tokenName}</dd>
                </div>
                {account !== undefined && (account.vouchers?.length ?? 0) > 0
                  ? (
                    <div className={`${css.fact} ${css.voucherFact}`}>
                      <dt className={css.factLabel}>{t('account.vouchers')}</dt>
                      <dd className={css.voucherList}>
                        {account.vouchers?.map(voucher => (
                          <span key={`${voucher.groupId}:${voucher.group}`} className={css.voucherRow}>
                            <span className={css.voucherGroup}>{voucher.group}</span>
                            <span className={css.voucherAmount}>{voucher.amount}</span>
                          </span>
                        ))}
                      </dd>
                    </div>
                  )
                  : account !== undefined
                    ? (
                      <div className={`${css.fact} ${css.voucherFact}`}>
                        <dt className={css.factLabel}>{t('account.vouchers')}</dt>
                        <dd className={css.voucherEmpty}>
                          {vouchersBefore}
                          <a className={css.invite} href={`${status.baseURL}/wallet`} target="_blank" rel="noreferrer">
                            {t('account.vouchersInvite')}
                          </a>
                          {vouchersAfter}
                        </dd>
                      </div>
                    )
                    : null}
              </dl>
              <div className={css.actions}>
                <button type="button" className={css.button} disabled={busy} onClick={signOut}>
                  {busy ? t('account.signingOut') : t('account.signOut')}
                </button>
              </div>
            </section>
          )
          : (
            <section className={css.card}>
              <div className={css.cardHead}>
                <span className={css.name}>{t('account.title')}</span>
                <span className={css.badge}>{t('account.disconnected')}</span>
              </div>
              <p className={css.hint}>{t('account.site')}：{status.baseURL}</p>
              {pending === undefined
                ? (
                  <div className={css.actions}>
                    <button
                      type="button" className={`${css.button} ${css.buttonPrimary}`} disabled={busy} onClick={connect}
                    >
                      {busy ? t('account.connecting') : t('account.connect')}
                    </button>
                  </div>
                )
                : (
                  <div className={css.form}>
                    <p className={css.hint}>{t('account.waiting')}</p>
                    <div className={css.codeRow}>
                      <span className={css.label}>{t('account.userCode')}</span>
                      <code className={css.code}>{pending.userCode}</code>
                    </div>
                    <div className={css.actions}>
                      <button
                        type="button" className={`${css.button} ${css.buttonPrimary}`}
                        onClick={openAddress}
                      >
                        {t('account.openBrowser')}
                      </button>
                      <button type="button" className={css.button} disabled={busy} onClick={cancel}>
                        {busy ? t('account.cancelling') : t('account.cancel')}
                      </button>
                    </div>
                    {/* Some platforms (macOS among them) let the automatic
                        browser launch do nothing, so the address is also handed
                        over as selectable text that can be copied by hand. */}
                    <div className={css.linkRow}>
                      <span className={css.label}>{t('account.manualLink')}</span>
                      <div className={css.linkLine}>
                        <a
                          className={css.link} href={pending.verificationUriComplete}
                          target="_blank" rel="noopener noreferrer"
                        >
                          {pending.verificationUriComplete}
                        </a>
                        <button type="button" className={css.button} onClick={copyAddress}>
                          {copied ? t('account.copied') : t('account.copyLink')}
                        </button>
                      </div>
                    </div>
                    <p className={css.hint}>{t('account.expiresIn', { minutes: String(minutes) })}</p>
                  </div>
                )}
            </section>
          )}
      {error === undefined ? null : <p className={css.notice}>{error}</p>}
      {status?.error === undefined ? null : <p className={css.notice}>{t('account.failed', { message: status.error })}</p>}
      {status?.configured === true ? <ModelWhitelist api={api} t={t} /> : null}
      {status?.configured === true ? <ImageGeneration api={api} t={t} /> : null}
    </div>
  )
}

/**
 * The model whitelist block: which of the site's models the provider keeps in
 * the model picker, edited through the same-origin models carrier.
 *
 * An empty stored list means "no whitelist", so the boxes start all checked —
 * that is what the picker currently shows. Saving an empty list is refused
 * here, because it would read as the same "no whitelist" state; "Show all"
 * (which saves exactly that) is the explicit way back to the whole catalog.
 * @param props - the injected route carrier and translate.
 * @returns the whitelist block.
 */
function ModelWhitelist({ api, t }: NearTokenSectionInjected) {
  const [state, setState] = useState<NearTokenModelsState | undefined>(undefined)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  /** Why the last edit could not be applied; cleared by the next one. */
  const [notice, setNotice] = useState<string | undefined>(undefined)
  /** Whether the list itself is showing; the card opens collapsed. */
  const [open, setOpen] = useState(false)
  /** The queued save, while a burst of clicks is still settling. */
  const pending = useRef<number | undefined>(undefined)
  // The row whose group detail is showing, positioned in viewport coordinates:
  // the list scrolls, so the panel must escape its clip box rather than live in
  // the row's flow.
  const [tip, setTip] = useState<{ entry: NearTokenModelEntry; top: number; left: number } | undefined>(undefined)

  /** Publish one host answer: the boxes show the stored list, or all when none is stored. */
  const adopt = useCallback((next: NearTokenModelsState): void => {
    setState(next)
    setSelected(new Set(next.enabled.length === 0 ? next.models.map(entry => entry.model) : next.enabled))
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      adopt(await api.models())
    } catch (failure: unknown) {
      setError(t('whitelist.failed', { message: messageOf(failure) }))
    }
  }, [adopt, api, t])

  useEffect(() => { void load() }, [load])

  const models = state?.models ?? []
  const needle = query.trim().toLowerCase()
  const visible = needle === ''
    ? models
    : models.filter(entry => entry.model.toLowerCase().includes(needle))

  /** Cancel the pending save, if one is queued. */
  const cancelPending = useCallback((): void => {
    if (pending.current === undefined) return
    window.clearTimeout(pending.current)
    pending.current = undefined
  }, [])

  // A queued save must not outlive the page it belongs to.
  useEffect(() => cancelPending, [cancelPending])

  /**
   * Apply an edit to the boxes and queue one save.
   *
   * The list is stored as it is edited — there is no Save button to forget —
   * so the delay only coalesces a burst of clicks into one profile write.
   */
  const edit = (next: ReadonlySet<string>): void => {
    setSaved(false)
    setNotice(undefined)
    setSelected(next)
    cancelPending()
    // Catalog order, not click order: the stored list reads like the picker.
    const enabled = models.filter(entry => next.has(entry.model)).map(entry => entry.model)
    pending.current = window.setTimeout(() => {
      pending.current = undefined
      void persist(enabled)
    }, AUTOSAVE_DELAY_MS)
  }

  const toggle = (model: string): void => {
    const next = new Set(selected)
    if (next.has(model)) next.delete(model)
    else next.add(model)
    // An empty list means "no whitelist", i.e. show everything — the opposite
    // of what unchecking the last box asks for.
    if (next.size === 0) {
      setNotice(t('whitelist.keepOne'))
      return
    }
    edit(next)
  }
  /** Show one row's groups just below it, above it when there is no room. */
  const showTip = (entry: NearTokenModelEntry, anchor: HTMLElement): void => {
    const rect = anchor.getBoundingClientRect()
    const height = Math.min(240, 34 + entry.groups.length * 20)
    const below = rect.bottom + 6
    setTip({
      entry,
      top: below + height > window.innerHeight ? Math.max(12, rect.top - height - 6) : below,
      left: Math.max(12, Math.min(rect.left + 24, window.innerWidth - 292)),
    })
  }
  const checkVisible = (): void => {
    edit(new Set([...selected, ...visible.map(entry => entry.model)]))
  }
  /**
   * Empty the boxes the filter is showing.
   *
   * An emptied selection cannot be saved as such: an empty stored list means
   * "no whitelist", i.e. show every model, which is the opposite of the click.
   * So the boxes empty at once and the saved list is left alone; the next check
   * box saves the set the user actually wants, and "Show all" is the way back.
   */
  const uncheckVisible = (): void => {
    const hidden = new Set(visible.map(entry => entry.model))
    const next = new Set([...selected].filter(model => !hidden.has(model)))
    if (next.size > 0) {
      edit(next)
      return
    }
    cancelPending()
    setSaved(false)
    setSelected(next)
    setNotice(t('whitelist.cleared'))
  }

  /**
   * Write one list to the Host, which re-declares the provider route so the
   * model picker refetches without a page reload.
   * @param enabled - the model names to keep visible; empty restores everything.
   */
  const persist = useCallback(async (enabled: readonly string[]): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      await api.saveModels(enabled)
      setSaved(true)
    } catch (failure: unknown) {
      setError(t('whitelist.failed', { message: messageOf(failure) }))
    } finally {
      setSaving(false)
    }
  }, [api, t])

  /** Restore the whole catalog: nothing hidden, nothing stored. */
  const showEverything = (): void => {
    cancelPending()
    setSelected(new Set(models.map(entry => entry.model)))
    void persist([])
  }

  return (
    <section className={css.card}>
      <button
        type="button"
        className={css.cardToggle}
        aria-expanded={open}
        aria-label={t(open ? 'card.collapse' : 'card.expand')}
        onClick={() => { setOpen((current) => !current) }}
      >
        <span className={css.name}>{t('whitelist.title')}</span>
        <span className={css.count}>
          <span className={css.countTotal}>{t('whitelist.count', { total: String(models.length) })}</span>
          <span className={css.countDot} aria-hidden="true" />
          <span className={css.countPicked}>{t('whitelist.picked', { selected: String(selected.size) })}</span>
        </span>
        <IconChevronDownOutlineRegular
          className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron}
          size={14}
        />
      </button>
      {!open ? null : <>
      <p className={css.intro}>{t('whitelist.intro')}</p>
      {state === undefined
        ? (error === undefined ? <p className={css.hint}>{t('whitelist.loading')}</p> : null)
        : (
          <div className={css.form}>
            <input
              className={css.search}
              type="search"
              value={query}
              placeholder={t('whitelist.search')}
              aria-label={t('whitelist.search')}
              onChange={(event) => { setQuery(event.target.value) }}
            />
            <div className={css.toolbar}>
              <button type="button" className={css.button} disabled={saving || visible.length === 0} onClick={checkVisible}>
                {t('whitelist.selectAll')}
              </button>
              <button type="button" className={css.button} disabled={saving || visible.length === 0} onClick={uncheckVisible}>
                {t('whitelist.clear')}
              </button>
              <button type="button" className={css.button} disabled={saving} onClick={showEverything}>
                {t('whitelist.reset')}
              </button>
              <span className={css.autosave} aria-live="polite">
                {saving ? t('whitelist.saving') : saved ? t('whitelist.autoSaved') : ''}
              </span>
            </div>
            {models.length === 0
              ? <p className={css.hint}>{t('whitelist.empty')}</p>
              : (
                <div className={css.list} onScroll={() => { setTip(undefined) }}>
                  {visible.length === 0
                    ? <p className={css.hint}>{t('whitelist.noMatch')}</p>
                    : visible.map(entry => (
                      <label
                        key={entry.model}
                        className={css.row}
                        onMouseEnter={(event) => { showTip(entry, event.currentTarget) }}
                        onMouseLeave={() => { setTip(undefined) }}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(entry.model)}
                          onChange={() => { toggle(entry.model) }}
                        />
                        <span className={css.rowName}>{entry.model}</span>
                        <span className={css.rowMeta}>
                          {entry.groups.length === 0 ? null : (
                            <span>{t('whitelist.groupsCount', { count: String(entry.groups.length) })}</span>
                          )}
                          {entry.minRatio === undefined ? null : (
                            <>
                              <span className={css.rowRatio}>{t('whitelist.minRatio')}</span>
                              <RatioChip ratio={String(entry.minRatio) + 'x'} />
                            </>
                          )}
                        </span>
                      </label>
                    ))}
                  {tip === undefined ? null : (
                    <div className={css.tip} style={{ top: tip.top, left: tip.left }} role="tooltip">
                      <span className={css.tipTitle}>{t('whitelist.groupsTitle')}</span>
                      {tip.entry.groups.map(group => {
                        const parsed = parseGroupLabel(group.group)
                        return (
                          <span key={group.group} className={css.tipRow}>
                            <span className={css.tipGroup}>
                              {parsed.badges.map(badge => (
                                <GroupTag key={badge.text} text={badge.text} tone={badge.tone} />
                              ))}
                              <span className={css.tipGroupName}>{parsed.label}</span>
                            </span>
                            {group.ratio === undefined ? null : <RatioChip ratio={group.ratio} />}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            <p className={css.hint}>{t('whitelist.hint')}</p>
            {notice === undefined ? null : <p className={css.notice}>{notice}</p>}
          </div>
        )}
      {error === undefined ? null : <p className={css.notice}>{error}</p>}
      </>}
    </section>
  )
}

/**
 * The image-generation card: the `generate_image` tool's switch and, per picture
 * model, the group its requests route through.
 *
 * Unlike the whitelist this block saves on a button, not on every click: the two
 * members describe one setting, and a group choice made before the model is
 * checked would otherwise be written as nothing.
 * @param props - the injected route carrier and translate.
 * @returns the image-generation block.
 */
function ImageGeneration({ api, t }: NearTokenSectionInjected) {
  const [state, setState] = useState<NearTokenImagesState | undefined>(undefined)
  const [enabled, setEnabled] = useState(false)
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>({})
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  /** Whether the controls are showing; the card opens collapsed. */
  const [open, setOpen] = useState(false)

  /** Publish one host answer into the controls. */
  const adopt = useCallback((next: NearTokenImagesState): void => {
    setState(next)
    setEnabled(next.enabled)
    setSelection({ ...next.selection })
    setDirty(false)
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      adopt(await api.images())
    } catch (failure: unknown) {
      setError(t('images.failed', { message: messageOf(failure) }))
    }
  }, [adopt, api, t])

  useEffect(() => { void load() }, [load])

  const models = state?.models ?? []
  const enabledCount = Object.keys(selection).length

  /** Check or uncheck one model; the first group of a newly checked model is its route. */
  const toggle = (model: string, groups: NearTokenImageModelEntry['groups']): void => {
    setSaved(false)
    setDirty(true)
    setSelection((current) => {
      if (current[model] !== undefined) {
        const next = { ...current }
        delete next[model]
        return next
      }
      const first = groups[0]?.group
      return first === undefined ? current : { ...current, [model]: first }
    })
  }

  const chooseGroup = (model: string, group: string): void => {
    setSaved(false)
    setDirty(true)
    setSelection(current => ({ ...current, [model]: group }))
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setSaved(false)
    try {
      await api.saveImages({ enabled, models: selection })
      setSaved(true)
      setDirty(false)
    } catch (failure: unknown) {
      setError(t('images.failed', { message: messageOf(failure) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={css.card}>
      <button
        type="button"
        className={css.cardToggle}
        aria-expanded={open}
        aria-label={t(open ? 'card.collapse' : 'card.expand')}
        onClick={() => { setOpen((current) => !current) }}
      >
        <span className={css.name}>{t('images.title')}</span>
        <span className={css.count}>
          <span className={css.countTotal}>{t('images.count', { total: String(models.length) })}</span>
          <span className={css.countDot} aria-hidden="true" />
          <span className={css.countPicked}>{t('images.picked', { selected: String(enabledCount) })}</span>
        </span>
        <IconChevronDownOutlineRegular
          className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron}
          size={14}
        />
      </button>
      {!open ? null : <>
      <p className={css.intro}>{t('images.intro')}</p>
      {state === undefined
        ? (error === undefined ? <p className={css.hint}>{t('images.loading')}</p> : null)
        : (
          <div className={css.form}>
            <label className={css.row}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => { setSaved(false); setDirty(true); setEnabled(event.target.checked) }}
              />
              <span className={css.rowName}>{t('images.enable')}</span>
            </label>
            {models.length === 0
              ? <p className={css.hint}>{t('images.empty')}</p>
              : (
                <div className={css.list}>
                  {models.map(entry => (
                    <label key={entry.model} className={css.row}>
                      <input
                        type="checkbox"
                        checked={selection[entry.model] !== undefined}
                        onChange={() => { toggle(entry.model, entry.groups) }}
                      />
                      <span className={css.rowName}>{entry.model}</span>
                      <select
                        className={css.select}
                        aria-label={t('images.groupAria', { model: entry.model })}
                        disabled={selection[entry.model] === undefined}
                        value={selection[entry.model] ?? entry.groups[0]?.group ?? ''}
                        onChange={(event) => { chooseGroup(entry.model, event.target.value) }}
                      >
                        {entry.groups.map(group => (
                          <option key={group.group} value={group.group}>
                            {group.group}{group.ratio === undefined ? '' : ` · ${group.ratio}`}
                          </option>
                        ))}
                      </select>
                      <span className={css.rowMeta}>
                        {t(entry.channel === 'images'
                          ? 'images.channel.images'
                          : entry.channel === 'genai' ? 'images.channel.genai' : 'images.channel.chat')}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            <div className={css.toolbar}>
              <button type="button" className={css.button} disabled={busy || !dirty} onClick={() => { void save() }}>
                {busy ? t('images.saving') : t('images.save')}
              </button>
              <span className={css.autosave} aria-live="polite">
                {dirty ? t('images.dirty') : saved ? t('images.saved') : ''}
              </span>
            </div>
            <p className={css.hint}>{t('images.hint')}</p>
            {error === undefined ? null : <p className={css.notice}>{error}</p>}
          </div>
        )}
      </>}
    </section>
  )
}

/**
 * Render one thrown value as the message the page shows.
 * @param error - whatever the call threw.
 * @returns the error's message, or its text.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}