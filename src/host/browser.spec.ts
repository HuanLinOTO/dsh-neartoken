/**
 * The launcher: one address, one platform command, no shell in between.
 *
 * The interesting cases are the refusals — an address that is not a page, and a
 * platform with no known launcher — because this is the one place the plugin
 * starts a process of its own.
 */
import { describe, expect, it } from 'vitest'
import { openInSystemBrowser } from './browser.ts'
import type { Launcher } from './browser.ts'

/** The address a device authorization hands out. */
const PAGE = 'https://site/device?code=ABCD-EFGH'

/**
 * Record the launches instead of starting them.
 * @returns the recorder and what it saw.
 */
function recorder(): { calls: [string, readonly string[]][]; launch: Launcher } {
  const calls: [string, readonly string[]][] = []
  return {
    calls,
    launch: async (command, args) => { calls.push([command, args]) },
  }
}

describe('openInSystemBrowser', () => {
  it('asks the macOS launcher for the page', async () => {
    const { calls, launch } = recorder()
    await openInSystemBrowser(PAGE, 'darwin', launch)
    expect(calls).toEqual([['open', [PAGE]]])
  })

  it('hands a Windows page to the URL handler as one argument, never through a shell', async () => {
    const { calls, launch } = recorder()
    await openInSystemBrowser(PAGE, 'win32', launch)
    expect(calls).toEqual([['rundll32', ['url.dll,FileProtocolHandler', PAGE]]])
  })

  it('uses xdg-open on Linux', async () => {
    const { calls, launch } = recorder()
    await openInSystemBrowser(PAGE, 'linux', launch)
    expect(calls).toEqual([['xdg-open', [PAGE]]])
  })

  it('refuses an address that is not a page', async () => {
    const { calls, launch } = recorder()
    await expect(openInSystemBrowser('file:///etc/passwd', 'darwin', launch)).rejects.toThrow('http(s)')
    expect(calls).toEqual([])
  })

  it('refuses an address that is not a URL at all', async () => {
    const { calls, launch } = recorder()
    await expect(openInSystemBrowser('not a url', 'darwin', launch)).rejects.toThrow('不是合法 URL')
    expect(calls).toEqual([])
  })

  it('refuses a platform it has no launcher for', async () => {
    const { calls, launch } = recorder()
    await expect(openInSystemBrowser(PAGE, 'aix', launch)).rejects.toThrow('aix')
    expect(calls).toEqual([])
  })

  it('reports a launcher that could not start', async () => {
    const launch: Launcher = async () => { throw new Error('spawn xdg-open ENOENT') }
    await expect(openInSystemBrowser(PAGE, 'linux', launch)).rejects.toThrow('ENOENT')
  })
})
