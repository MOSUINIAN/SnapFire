import type { SnapFireApi } from '../shared/types'

export type PlatformKind = 'desktop' | 'android' | 'web'

export interface PlatformCapabilities {
  cameraSelection: boolean
  qrScanning: boolean
  nativeFilePicker: boolean
  screenOrientationLock: boolean
  keepAwake: boolean
  haptics: boolean
  lanHosting: boolean
}

/**
 * Renderer-facing platform boundary. Existing storage/backup/host APIs are
 * shared; future mobile capabilities are added here and implemented by the
 * Android adapter without leaking Electron preload details into screens.
 */
export interface PlatformService extends SnapFireApi {
  readonly kind: PlatformKind
  readonly isNative: boolean
  readonly capabilities: PlatformCapabilities
}
