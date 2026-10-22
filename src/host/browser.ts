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

import { spawn } from 'node:child_process'

/** Schemes a confirmation page may use; anything else is not ours to launch. */
const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:']

/**
 * How each platform hands a URL to its default browser. Every entry is a
 * command plus fixed arguments; the address is appended as the last argument,
 * so nothing is ever passed through a shell.
 */
const LAUNCHERS: Readonly<Record<string, readonly string[]>> = {
  darwin: ['open'],
  win32: ['rundll32', 'url.dll,FileProtocolHandler'],
  linux: ['xdg-open'],
}

/** Run one command without waiting for it, resolving once it has started. */
export type Launcher = (command: string, args: readonly string[]) => Promise<void>

/**
 * Start a command, detached, and resolve as soon as the process spawned. The
 * browser outlives this Host on purpose, so its output is discarded and its
 * handle is released.
 * @param command - the executable.
 * @param args - its arguments.
 */
function runDetached(command: string, args: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: 'ignore', detached: true })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/**
 * Open one address in the user's default browser.
 * @param address - the page to open; must be http(s).
 * @param platform - the platform to launch on; defaults to this process's.
 * @param launcher - the process launcher; injectable so this is testable.
 * @throws {Error} when the address is not a page or the platform has no launcher.
 */
export async function openInSystemBrowser(
  address: string, platform: string = process.platform, launcher: Launcher = runDetached,
): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(address)
  } catch {
    throw new Error(`地址不是合法 URL：${address}`)
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`只能打开 http(s) 地址，收到 ${parsed.protocol}`)
  }
  const launcherArgs = LAUNCHERS[platform]
  if (launcherArgs === undefined) throw new Error(`当前平台 ${platform} 没有已知的浏览器打开方式`)
  const [command, ...fixed] = launcherArgs
  await launcher(command as string, [...fixed, address])
}
