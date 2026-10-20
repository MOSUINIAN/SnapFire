import type { SnapFireApi } from '../shared/types'
import { createDesktopPlatform } from './desktop'
import { createBrowserPlatform } from './browser'
import type { PlatformService } from './types'

export function resolvePlatform(api?: SnapFireApi): PlatformService {
  return api ? createDesktopPlatform(api) : createBrowserPlatform()
}

const desktopApi = typeof window !== 'undefined' ? window.snapfire : undefined

/**
 * Single import point for platform-specific capabilities. Android will add its
 * own adapter here in M2; screens must not import Electron globals directly.
 */
export const platform: PlatformService = resolvePlatform(desktopApi)

export type { PlatformService, PlatformKind, PlatformCapabilities } from './types'
