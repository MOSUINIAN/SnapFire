import { describe, expect, it, vi } from 'vitest'
import type { SnapFireApi } from '../src/shared/types'
import { createDesktopPlatform } from '../src/platform/desktop'
import { createBrowserPlatform } from '../src/platform/browser'
import { resolvePlatform } from '../src/platform'

function makeApi(): SnapFireApi {
  return {
    storage: {
      loadProfile: vi.fn(),
      saveProfile: vi.fn(),
      loadSettings: vi.fn(),
      saveSettings: vi.fn(),
      loadAppearance: vi.fn(),
      saveAppearance: vi.fn(),
      loadHistory: vi.fn(),
      addHistory: vi.fn(),
      clearHistory: vi.fn(),
      resetAll: vi.fn(),
      consumeWarnings: vi.fn()
    },
    backup: {
      export: vi.fn(),
      import: vi.fn()
    },
    host: {
      start: vi.fn(),
      stop: vi.fn(),
      status: vi.fn()
    },
    app: {
      info: vi.fn()
    }
  }
}

describe('platform service boundary', () => {
  it('wraps the Electron preload API without changing its calls', async () => {
    const api = makeApi()
    vi.mocked(api.storage.loadProfile).mockResolvedValue({
      id: 'player-1',
      name: 'Alice',
      createdAt: 1,
      updatedAt: 1
    })
    const service = createDesktopPlatform(api)
    expect(service.kind).toBe('desktop')
    expect(service.isNative).toBe(true)
    expect(service.capabilities.lanHosting).toBe(true)
    expect(service.capabilities.qrScanning).toBe(false)
    await expect(service.storage.loadProfile()).resolves.toMatchObject({ name: 'Alice' })
    expect(api.storage.loadProfile).toHaveBeenCalledOnce()
  })

  it('prefers the desktop API when one is supplied', () => {
    const api = makeApi()
    const service = resolvePlatform(api)
    expect(service.kind).toBe('desktop')
    expect(service.storage).toBe(api.storage)
  })

  it('constructs a non-native browser development adapter', () => {
    const service = createBrowserPlatform()
    expect(service.kind).toBe('web')
    expect(service.isNative).toBe(false)
    expect(service.capabilities.lanHosting).toBe(false)
    expect(service.capabilities.nativeFilePicker).toBe(false)
  })
})
