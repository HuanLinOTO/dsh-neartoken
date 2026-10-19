/**
 * The injected business face of the replacement model seat. It mirrors the
 * built-in seat's face so both read the SAME per-session directory: a switch
 * made here is what the /model popup shows next, and vice versa.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
/** Injected face of the composer model seat. */
export interface ModelGroupSelectInjected {
    /** Whether this session supports Agent-bound model inspection and selection. */
    available: boolean;
    /** The session's shared directory store (same instance the /model popup reads). */
    directory: SnapshotStore<ModelDirectoryState>;
    /** Ensure the shared advisory catalog is loaded (errors land on the store). */
    load: () => void;
    /**
     * Select a complete provider/model/reasoning selection.
     * @param selection - model selection and optional adapter-owned effort.
     * @returns the Host outcome, or undefined when this Session cannot select a model.
     */
    select: (selection: ModelSelection) => Promise<RemoteResult<void> | undefined>;
}
