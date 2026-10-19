import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelGroupSelectInjected } from './slots.ts';
/**
 * Render the composer model seat with the group level.
 * @param props - owner share (locked) + injected directory face + the locale seat.
 * @returns the trigger and, while open, the three-level menu.
 */
export declare function ModelGroupSelect({ locked, available, directory, load, select, t }: ModelGroupSelectInjected & Pick<PropsRuntime<'conversation.input.model'>, 'locked'> & PropsLocale<'modelGroups'>): import("react").JSX.Element | null;
