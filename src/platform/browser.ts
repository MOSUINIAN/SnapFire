import type {
  AppSettings,
  AppearanceData,
  BackupResult,
  HistoryData,
  MatchResult,
  ProfileData
} from '../shared/types'
import {
  addMatchToHistory,
  createDefaultProfile,
  isAppearance,
  normalizeAppSettings,
  normalizeHistory,
  normalizeStoredProfile,
  sanitizeProfileForSave,
  sanitizeSettingsForSave
} from '../core/storageCore'
import type { PlatformService } from './types'

const PREFIX = 'snapfire.web.'

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // The browser preview is a development aid; failed persistence is surfaced
    // by the eventual caller's error state where applicable.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}

/**
 * Development-only browser adapter. It allows the shared React UI to boot and
 * exercise local screens without Electron or Android. Native features return
 * explicit errors instead of silently pretending to work.
 */
export function createBrowserPlatform(): PlatformService {
  return {
    kind: 'web',
    isNative: false,
    capabilities: {
      cameraSelection: true,
      qrScanning: false,
      nativeFilePicker: false,
      screenOrientationLock: false,
      keepAwake: false,
      haptics: false,
      lanHosting: false
    },
    storage: {
      loadProfile: async (): Promise<ProfileData> => {
        const stored = readJson<Partial<ProfileData>>('profile')
        const normalized = normalizeStoredProfile(stored)
        if (normalized) return normalized
        const created = createDefaultProfile()
        writeJson('profile', created)
        return created
      },
      saveProfile: async (profile: ProfileData): Promise<void> => {
        writeJson('profile', sanitizeProfileForSave(profile))
      },
      loadSettings: async (): Promise<AppSettings> => {
        return normalizeAppSettings(readJson<Partial<AppSettings>>('settings'))
      },
      saveSettings: async (settings: AppSettings): Promise<void> => {
        writeJson('settings', sanitizeSettingsForSave(settings))
      },
      loadAppearance: async (): Promise<AppearanceData | null> => {
        const stored = readJson<AppearanceData>('appearance')
        return isAppearance(stored) ? stored : null
      },
      saveAppearance: async (appearance: AppearanceData | null): Promise<void> => {
        writeJson('appearance', appearance)
      },
      loadHistory: async (): Promise<HistoryData> => {
        return normalizeHistory(readJson<HistoryData>('history'))
      },
      addHistory: async (result: MatchResult): Promise<HistoryData> => {
        const next = addMatchToHistory(normalizeHistory(readJson('history')), result)
        writeJson('history', next)
        return next
      },
      clearHistory: async (): Promise<void> => {
        writeJson('history', { matches: [] })
      },
      resetAll: async (): Promise<void> => {
        for (const key of ['profile', 'settings', 'appearance', 'history']) {
          remove(key)
        }
      },
      consumeWarnings: async (): Promise<string[]> => []
    },
    backup: {
      export: async (): Promise<BackupResult> => ({
        ok: false,
        error: '浏览器预览模式不支持系统文件对话框'
      }),
      import: async (): Promise<BackupResult> => ({
        ok: false,
        error: '浏览器预览模式不支持系统文件对话框'
      })
    },
    host: {
      start: async () => {
        throw new Error('浏览器预览模式不能创建房间，请使用桌面应用或安卓应用')
      },
      stop: async (): Promise<void> => {
        // no room in browser preview
      },
      status: async () => null
    },
    app: {
      info: async () => ({
        version: 'web-preview',
        userDataPath: 'localStorage（浏览器预览）',
        platform: 'web'
      })
    }
  }
}
