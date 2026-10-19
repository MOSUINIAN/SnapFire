/// <reference types="vite/client" />

import type { SnapFireApi } from '../../shared/types'

declare global {
  interface Window {
    snapfire: SnapFireApi
  }
}

export {}
