import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.snapfire.mobile',
  appName: 'SnapFire',
  webDir: 'dist-mobile',
  android: {
    // The LAN room protocol is ws:// on a private network. Allow it from the
    // Capacitor WebView's secure local origin; no public network is used.
    allowMixedContent: true
  }
}

export default config
