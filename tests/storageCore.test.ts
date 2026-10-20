import { describe, expect, it } from 'vitest'
import {
  addMatchToHistory,
  autoBackupFileName,
  buildBackupPayload,
  createDefaultProfile,
  normalizeAppSettings,
  normalizeHistory,
  normalizeStoredProfile,
  sanitizeProfileForSave,
  validateBackupPayload
} from '../src/core/storageCore'
import { DEFAULT_APP_SETTINGS, type BackupPayload } from '../src/shared/types'
import { makeAppearance, makeMatchResult } from './helpers/fixtures'

describe('storage core profile and settings', () => {
  it('creates a deterministic default profile with injected id and time', () => {
    const profile = createDefaultProfile(12345, () => 'abcd-efgh-ijkl')
    expect(profile).toEqual({
      id: 'abcd-efgh-ijkl',
      name: '玩家ABCD',
      createdAt: 12345,
      updatedAt: 12345
    })
  })

  it('normalizes stored profile fields and rejects an empty id', () => {
    expect(
      normalizeStoredProfile(
        { id: 'player-1', name: '  Alice  ', createdAt: 10, updatedAt: 11 },
        99
      )
    ).toEqual({ id: 'player-1', name: 'Alice', createdAt: 10, updatedAt: 11 })
    expect(normalizeStoredProfile({ id: '', name: 'Nobody' }, 99)).toBeNull()
    expect(normalizeStoredProfile(null, 99)).toBeNull()
    expect(normalizeStoredProfile({ id: 'player-2' }, 99)?.name).toBe('玩家')
  })

  it('caps profile name on save and refreshes updatedAt', () => {
    const result = sanitizeProfileForSave(
      {
        id: 'player-1',
        name: ' 12345678901234567890 ',
        createdAt: 1,
        updatedAt: 2
      },
      777
    )
    expect(result.name).toBe('1234567890123456')
    expect(result.createdAt).toBe(1)
    expect(result.updatedAt).toBe(777)
  })

  it('clamps settings and restores defaults for invalid values', () => {
    expect(normalizeAppSettings({ volume: 2, detectionQuality: 'invalid' })).toEqual({
      ...DEFAULT_APP_SETTINGS,
      volume: 1,
      cameraDeviceId: null,
      showDebug: false
    })
    expect(normalizeAppSettings({ volume: -1 }).volume).toBe(0)
    expect(normalizeAppSettings({ detectionQuality: 'accurate' }).detectionQuality).toBe('accurate')
  })
})

describe('storage core history and backups', () => {
  it('deduplicates match ids, keeps newest first, and caps history', () => {
    const first = makeMatchResult('match-1')
    let history = addMatchToHistory({ matches: [] }, first)
    history = addMatchToHistory(history, makeMatchResult('match-1'))
    expect(history.matches).toHaveLength(1)

    for (let index = 0; index < 60; index += 1) {
      history = addMatchToHistory(history, makeMatchResult(`match-${index + 2}`))
    }
    expect(history.matches).toHaveLength(50)
    expect(history.matches[0].matchId).toBe('match-61')
  })

  it('normalizes malformed history containers', () => {
    expect(normalizeHistory(null)).toEqual({ matches: [] })
    expect(normalizeHistory({ matches: 'not-an-array' })).toEqual({ matches: [] })
    expect(normalizeHistory({ matches: [] })).toEqual({ matches: [] })
  })

  it('validates the complete backup envelope', () => {
    const profile = createDefaultProfile(1, () => 'player-1')
    const payload = buildBackupPayload({
      profile,
      settings: DEFAULT_APP_SETTINGS,
      appearance: makeAppearance(),
      history: { matches: [makeMatchResult('match-1')] },
      createdAt: 42
    })
    expect(validateBackupPayload(payload)).toBe(true)
    expect(validateBackupPayload({ ...payload, formatVersion: 999 })).toBe(false)
    expect(validateBackupPayload({ ...payload, profile: null })).toBe(false)
    expect(
      validateBackupPayload({
        ...payload,
        history: { matches: 'broken' }
      })
    ).toBe(false)
    expect(validateBackupPayload(null)).toBe(false)
    expect(validateBackupPayload({ ...(payload as BackupPayload), appearance: {} })).toBe(false)
  })

  it('creates a stable automatic backup file name from local time', () => {
    const name = autoBackupFileName(new Date(2026, 9, 20, 21, 5, 7, 42))
    expect(name).toBe('snapfire-backup-20261020-210507-042.json')
  })
})
