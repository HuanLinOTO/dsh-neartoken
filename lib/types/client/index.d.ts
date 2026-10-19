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
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type GroupKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The replacement model seat's copy. */
        modelGroups: GroupKey;
    }
}
/** Required services: the slot registry, locale, sessions, and the directory service. */
export declare const inject: string[];
/**
 * Client plugin body: register the dictionaries, add the NearToken settings page,
 * then shadow the composer model seat over the shared model directory.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
