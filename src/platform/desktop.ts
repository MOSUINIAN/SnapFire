import type { SnapFireApi } from '../shared/types'
import type { PlatformService } from './types'

export function createDesktopPlatform(api: SnapFireApi): PlatformService {
  return {
    ...api,
    kind: 'desktop',
    isNative: true,
    capabilities: {
      cameraSelection: true,
      qrScanning: false,
      nativeFilePicker: true,
      screenOrientationLock: false,
      keepAwake: false,
      haptics: false,
      lanHosting: true
    }
  }
}
