import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type NearTokenApi } from './api.ts';
import type { GroupKey } from './locales.ts';
/** What this section receives from its registration. */
export interface NearTokenSectionInjected {
    /** The Host's four routes. */
    api: NearTokenApi;
    /** Bound translate for this plugin's dictionary. */
    t: (key: GroupKey, vars?: Record<string, string>) => string;
}
/** Full component props: the section owner share plus this section's injected face. */
export type NearTokenSectionProps = PropsRuntime<'settings.section'> & NearTokenSectionInjected;
/**
 * Render the NearToken settings page.
 * @param props - the injected route carrier and translate, plus slot owner props.
 * @returns the section element tree.
 */
export declare function NearTokenSection({ api, t }: NearTokenSectionProps): import("react").JSX.Element;
