/**
 * NearToken provider plugin, browser half. Registers two surfaces: the NearToken
 * settings page (sign in, account facts, sign out) and a replacement for the
 * composer's model seat at priority -1, so the slot's lowest-priority
 * registration renders and the shipped picker stays in place without drawing.
 *
 * The seat shares the SAME per-session directory the built-in picker uses
 * (`ctx.modelDirectories`), so selection state, pending markers, the /model
 * popup, and Session persistence are unaffected: this plugin only changes what
 * the control looks like and adds the group level on top of it.
 *
 * The seat's declared child ('conversation.input.model.label') is owned by the
 * shipped registration, so this one declares none and renders catalog names
 * directly.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the carrier types and the ctx.modelDirectories / ctx.remote merges.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.model seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
// Type-only: pulls the settings shell's SlotMap merge ('settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createNearTokenApi } from './api.ts'
import { ModelGroupSelect } from './ModelGroupSelect.tsx'
import { NearTokenSection, type NearTokenSectionInjected } from './NearTokenSection.tsx'
import { en, zh, type GroupKey } from './locales.ts'
import type { ModelGroupSelectInjected } from './slots.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The replacement model seat's copy. */
    modelGroups: GroupKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'modelGroups'

/** Required services: the slot registry, locale, sessions, and the directory service. */
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.session']

/**
 * Client plugin body: register the dictionaries, add the NearToken settings page,
 * then shadow the composer model seat over the shared model directory.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-neartoken-provider: dictionaries')
  // One carrier for the page's whole life: the registration closure hands the
  // same object back on every render, so the section's load effect runs once.
  const api = createNearTokenApi()
  const t = ctx.locale.bind(NS) as NearTokenSectionInjected['t']
  // The near-token page sits between the account page (-10) and the general
  // page (0): both answer "who am I signed in as".
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'neartoken',
    order: -5,
    label: () => t('account.nav'),
    locale: NS,
    inject: (): NearTokenSectionInjected => ({ api, t }),
  }, NearTokenSection))

  ctx.inject(['slots', 'modelDirectories'], (scope: ClientContext) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      // Shipped seat registers at the default priority 0; lower renders.
      priority: -1,
      locale: NS,
      inject: (sessionId): ModelGroupSelectInjected => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => { /* surfaced on the store */ })
          },
          select: (selection: ModelSelection) => available
            ? directory.select(selection)
            : Promise.resolve(undefined),
        }
      },
    }, ModelGroupSelect))
  })
}
