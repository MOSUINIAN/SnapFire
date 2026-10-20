import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppearanceData,
  type BackupPayload,
  type HistoryData,
  type MatchResult,
  type ProfileData
} from '../shared/types'

export const MAX_HISTORY = 50
export const MAX_AUTO_BACKUPS = 10

export function createDefaultProfile(
  now = Date.now(),
  createId: () => string = () => crypto.randomUUID()
): ProfileData {
  const id = createId()
  return {
    id,
    name: `玩家${id.slice(0, 4).toUpperCase()}`,
    createdAt: now,
    updatedAt: now
  }
}

export function normalizeStoredProfile(
  value: unknown,
  now = Date.now()
): ProfileData | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as Partial<ProfileData>
  if (typeof stored.id !== 'string' || stored.id.length === 0) return null
  return {
    id: stored.id,
    name: typeof stored.name === 'string' && stored.name.trim() ? stored.name.trim() : '玩家',
    createdAt: typeof stored.createdAt === 'number' ? stored.createdAt : now,
    updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : now
  }
}

export function sanitizeProfileForSave(
  profile: ProfileData,
  now = Date.now()
): ProfileData {
  return {
    ...profile,
    name: profile.name.trim().slice(0, 16) || '玩家',
    updatedAt: now
  }
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const stored = (value ?? {}) as Partial<AppSettings>
  return {
    volume:
      typeof stored.volume === 'number'
        ? Math.min(1, Math.max(0, stored.volume))
        : DEFAULT_APP_SETTINGS.volume,
    detectionQuality:
      stored.detectionQuality === 'performance' ||
      stored.detectionQuality === 'balanced' ||
      stored.detectionQuality === 'accurate'
        ? stored.detectionQuality
        : DEFAULT_APP_SETTINGS.detectionQuality,
    cameraDeviceId:
      typeof stored.cameraDeviceId === 'string' ? stored.cameraDeviceId : null,
    showDebug: Boolean(stored.showDebug)
  }
}

export function sanitizeSettingsForSave(settings: AppSettings): AppSettings {
  return {
    ...settings,
    volume: Math.min(1, Math.max(0, settings.volume))
  }
}

export function isAppearance(value: unknown): value is AppearanceData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AppearanceData>
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.faceEmbeddings) &&
    Array.isArray(candidate.clothing)
  )
}

export function normalizeHistory(value: unknown): HistoryData {
  if (!value || typeof value !== 'object') return { matches: [] }
  const stored = value as Partial<HistoryData>
  return Array.isArray(stored.matches) ? { matches: stored.matches } : { matches: [] }
}

export function addMatchToHistory(
  history: HistoryData,
  result: MatchResult,
  maxHistory = MAX_HISTORY
): HistoryData {
  const filtered = history.matches.filter((match) => match.matchId !== result.matchId)
  return {
    matches: [result, ...filtered].slice(0, maxHistory)
  }
}

export function buildBackupPayload(input: {
  profile: ProfileData
  settings: AppSettings
  appearance: AppearanceData | null
  history: HistoryData
  createdAt?: number
}): BackupPayload {
  return {
    formatVersion: 1,
    createdAt: input.createdAt ?? Date.now(),
    profile: input.profile,
    settings: input.settings,
    appearance: input.appearance,
    history: input.history
  }
}

export function validateBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BackupPayload>
  if (candidate.formatVersion !== 1) return false
  if (typeof candidate.createdAt !== 'number') return false
  const profile = candidate.profile
  if (
    !profile ||
    typeof profile !== 'object' ||
    typeof profile.id !== 'string' ||
    typeof profile.name !== 'string'
  ) {
    return false
  }
  const settings = candidate.settings
  if (
    !settings ||
    typeof settings !== 'object' ||
    typeof settings.volume !== 'number' ||
    (settings.detectionQuality !== 'performance' &&
      settings.detectionQuality !== 'balanced' &&
      settings.detectionQuality !== 'accurate')
  ) {
    return false
  }
  if (candidate.appearance !== null && !isAppearance(candidate.appearance)) {
    return false
  }
  const history = candidate.history
  if (!history || typeof history !== 'object' || !Array.isArray(history.matches)) {
    return false
  }
  return true
}

export function backupStamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}-${ms}`
}

export function autoBackupFileName(date = new Date()): string {
  return `snapfire-backup-${backupStamp(date)}.json`
}
