import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BackupPayload } from '@shared/types'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'snapfire-mock-userdata')
  }
}))

import { Storage } from '../src/main/storage'
import { makeAppearance, makeMatchResult } from './helpers/fixtures'

let dir: string
let storage: Storage

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapfire-test-'))
  storage = new Storage(dir)
  await storage.init()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('Storage profile and settings', () => {
  it('creates a default profile and persists edits across instances', async () => {
    const profile = await storage.loadProfile()
    expect(profile.id).toBeTruthy()
    profile.name = '测试玩家'
    await storage.saveProfile(profile)

    const loaded = await new Storage(dir).loadProfile()
    expect(loaded.name).toBe('测试玩家')
    expect(loaded.id).toBe(profile.id)
    expect(await fs.readdir(dir)).toContain('profile.json')
  })

  it('persists settings', async () => {
    const settings = await storage.loadSettings()
    settings.volume = 0.35
    settings.detectionQuality = 'accurate'
    settings.showDebug = true
    await storage.saveSettings(settings)

    const loaded = await new Storage(dir).loadSettings()
    expect(loaded.volume).toBeCloseTo(0.35)
    expect(loaded.detectionQuality).toBe('accurate')
    expect(loaded.showDebug).toBe(true)
  })

  it('persists appearance and history, and deduplicates match ids', async () => {
    await storage.saveAppearance(makeAppearance())
    const appearance = await new Storage(dir).loadAppearance()
    expect(appearance?.faceEmbeddings[0]).toHaveLength(128)

    await storage.addHistory(makeMatchResult('match-1'))
    await storage.addHistory(makeMatchResult('match-1'))
    let history = await storage.loadHistory()
    expect(history.matches).toHaveLength(1)

    await storage.addHistory(makeMatchResult('match-2'))
    history = await storage.loadHistory()
    expect(history.matches).toHaveLength(2)
    expect(history.matches[0].matchId).toBe('match-2')
  })

  it('caps history at 50 matches', async () => {
    for (let index = 0; index < 55; index += 1) {
      await storage.addHistory(makeMatchResult(`match-${index}`))
    }
    const history = await storage.loadHistory()
    expect(history.matches).toHaveLength(50)
    expect(history.matches[0].matchId).toBe('match-54')
  })
})

describe('Storage backups', () => {
  it('writes a timestamped automatic backup with the expected shape', async () => {
    const profile = await storage.loadProfile()
    const file = await storage.writeAutoBackup()
    expect(file).toBeTruthy()
    const raw = JSON.parse(await fs.readFile(file as string, 'utf8')) as BackupPayload
    expect(raw.formatVersion).toBe(1)
    expect(raw.profile.id).toBe(profile.id)
    expect(raw.settings.detectionQuality).toBe('balanced')
    expect(Array.isArray(raw.history.matches)).toBe(true)

    const backups = await fs.readdir(path.join(dir, 'backups'))
    expect(backups.some((name) => /^snapfire-backup-.*\.json$/.test(name))).toBe(true)
  })

  it('exports and imports a backup, creating a pre-restore backup', async () => {
    const profile = await storage.loadProfile()
    profile.name = '备份前'
    await storage.saveProfile(profile)

    const exportPath = path.join(dir, 'manual.snapfire-backup.json')
    await storage.exportBackupTo(exportPath)

    const changed = await storage.loadProfile()
    changed.name = '备份后'
    await storage.saveProfile(changed)

    const raw = JSON.parse(await fs.readFile(exportPath, 'utf8')) as BackupPayload
    await storage.importBackup(raw)

    const restored = await new Storage(dir).loadProfile()
    expect(restored.name).toBe('备份前')
    expect(restored.id).toBe(profile.id)

    const backups = await fs.readdir(path.join(dir, 'backups'))
    expect(backups.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects malformed backups without changing data', async () => {
    const profile = await storage.loadProfile()
    profile.name = '保持原样'
    await storage.saveProfile(profile)

    await expect(
      storage.importBackup({ formatVersion: 999 } as unknown as BackupPayload)
    ).rejects.toThrow('备份文件格式不正确或版本不兼容')

    const after = await new Storage(dir).loadProfile()
    expect(after.name).toBe('保持原样')
  })

  it('prunes automatic backups to the newest 10', async () => {
    const backupsDir = path.join(dir, 'backups')
    await fs.mkdir(backupsDir, { recursive: true })
    for (let index = 0; index < 12; index += 1) {
      const name = `snapfire-backup-20200101-000000-${String(index).padStart(3, '0')}.json`
      await fs.writeFile(path.join(backupsDir, name), '{}', 'utf8')
    }
    await storage.writeAutoBackup()
    const names = (await fs.readdir(backupsDir)).filter((name) => name.endsWith('.json'))
    expect(names).toHaveLength(10)
  })
})

describe('Storage recovery and reset', () => {
  it('renames a corrupt file, reports a warning, and falls back to defaults', async () => {
    await fs.writeFile(path.join(dir, 'profile.json'), '{ definitely-not-json', 'utf8')
    const recovered = new Storage(dir)
    const profile = await recovered.loadProfile()
    expect(profile.id).toBeTruthy()
    expect(profile.name).toBeTruthy()

    const warnings = recovered.consumeWarnings()
    expect(warnings.join(' ')).toContain('profile.json')

    const files = await fs.readdir(dir)
    expect(files.some((name) => name.startsWith('profile.json.corrupt-'))).toBe(true)
  })

  it('clears local data and regenerates a profile identity', async () => {
    const before = await storage.loadProfile()
    await storage.saveAppearance(makeAppearance())
    await storage.addHistory(makeMatchResult('match-before-reset'))

    await storage.resetAll()

    const after = await storage.loadProfile()
    expect(after.id).not.toBe(before.id)
    expect(await storage.loadAppearance()).toBeNull()
    expect((await storage.loadHistory()).matches).toHaveLength(0)
  })
})
