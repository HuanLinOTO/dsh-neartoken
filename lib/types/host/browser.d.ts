/**
 * Hand one address to the operating system's own browser.
 *
 * A page cannot do this itself: `window.open` stays inside whatever shell hosts
 * the settings page, so on a desktop build it opens another application window
 * instead of the user's browser — and on macOS a refused launch does nothing at
 * all. The Host is an ordinary process on the user's machine, so it can ask the
 * platform's own launcher, which is what the user expects.
 *
 * @module
 */
/** Run one command without waiting for it, resolving once it has started. */
export type Launcher = (command: string, args: readonly string[]) => Promise<void>;
/**
 * Open one address in the user's default browser.
 * @param address - the page to open; must be http(s).
 * @param platform - the platform to launch on; defaults to this process's.
 * @param launcher - the process launcher; injectable so this is testable.
 * @throws {Error} when the address is not a page or the platform has no launcher.
 */
export declare function openInSystemBrowser(address: string, platform?: string, launcher?: Launcher): Promise<void>;
