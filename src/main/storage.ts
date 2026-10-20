import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AppSettings,
  AppearanceData,
  BackupPayload,
  HistoryData,
  MatchResult,
  ProfileData
} from '../shared/types'
import {
  MAX_AUTO_BACKUPS,
  addMatchToHistory,
  autoBackupFileName,
  buildBackupPayload,
  createDefaultProfile,
  isAppearance,
  normalizeAppSettings,
  normalizeHistory,
  normalizeStoredProfile,
  sanitizeProfileForSave,
  sanitizeSettingsForSave,
  validateBackupPayload
} from '../core/storageCore'

const PROFILE_FILE = 'profile.json'
const SETTINGS_FILE = 'settings.json'
const APPEARANCE_FILE = 'appearance.json'
const HISTORY_FILE = 'history.json'

/**
 * Electron file IO adapter around the platform-independent storage rules in
 * src/core/storageCore.ts. Android uses the same rules with its own sandboxed
 * file adapter.
 */
export class Storage {
  private readonly dir: string
  private profile: ProfileData | null = null
  private settings: AppSettings | null = null
  private appearance: AppearanceData | null | undefined = undefined
  private history: HistoryData | null = null
  private initialised = false
  private warnings: string[] = []

  constructor(baseDir?: string) {
    this.dir = baseDir ?? path.join(app.getPath('userData'), 'data')
  }

  getDirectory(): string {
    return this.dir
  }

  consumeWarnings(): string[] {
    const current = this.warnings
    this.warnings = []
    return current
  }

  private warn(message: string): void {
    this.warnings.push(message)
    console.warn('[storage]', message)
  }

  async init(): Promise<void> {
    if (this.initialised) return
    await fs.mkdir(this.dir, { recursive: true })
    this.initialised = true
  }

  private filePath(name: string): string {
    return path.join(this.dir, name)
  }

  private async readJson<T>(name: string): Promise<T | null> {
    const full = this.filePath(name)
    let raw: string
    try {
      raw = await fs.readFile(full, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        this.warn(`无法读取 ${name}：${error instanceof Error ? error.message : String(error)}`)
      }
      return null
    }
    try {
      return JSON.parse(raw) as T
    } catch {
      const corruptName = `${path.basename(full)}.corrupt-${Date.now()}`
      await fs.rename(full, this.filePath(corruptName)).catch(() => undefined)
      this.warn(`${name} 已损坏，原文件已保留为 ${corruptName}，本次使用默认数据。`)
      return null
    }
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    const full = this.filePath(name)
    const tmp = `${full}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    try {
      await fs.rename(tmp, full)
    } catch {
      // Windows can refuse to replace an existing file if another process
      // has it open for a moment. Fall back to remove + rename.
      await fs.rm(full, { force: true })
      await fs.rename(tmp, full)
    }
  }

  async loadProfile(): Promise<ProfileData> {
    await this.init()
    if (!this.profile) {
      const stored = await this.readJson<Partial<ProfileData>>(PROFILE_FILE)
      const normalized = normalizeStoredProfile(stored)
      this.profile = normalized ?? createDefaultProfile()
      if (!normalized) {
        await this.writeJson(PROFILE_FILE, this.profile)
      }
    }
    return this.profile
  }

  async saveProfile(profile: ProfileData): Promise<void> {
    await this.init()
    this.profile = sanitizeProfileForSave(profile)
    await this.writeJson(PROFILE_FILE, this.profile)
  }

  async loadSettings(): Promise<AppSettings> {
    await this.init()
    if (!this.settings) {
      const stored = await this.readJson<Partial<AppSettings>>(SETTINGS_FILE)
      this.settings = normalizeAppSettings(stored)
    }
    return this.settings
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.init()
    this.settings = sanitizeSettingsForSave(settings)
    await this.writeJson(SETTINGS_FILE, this.settings)
  }

  async loadAppearance(): Promise<AppearanceData | null> {
    await this.init()
    if (this.appearance === undefined) {
      const stored = await this.readJson<AppearanceData>(APPEARANCE_FILE)
      this.appearance = isAppearance(stored) ? stored : null
    }
    return this.appearance
  }

  async saveAppearance(appearance: AppearanceData | null): Promise<void> {
    await this.init()
    this.appearance = appearance
    await this.writeJson(APPEARANCE_FILE, appearance)
  }

  async loadHistory(): Promise<HistoryData> {
    await this.init()
    if (!this.history) {
      const stored = await this.readJson<HistoryData>(HISTORY_FILE)
      this.history = normalizeHistory(stored)
    }
    return this.history
  }

  async addHistory(result: MatchResult): Promise<HistoryData> {
    const history = await this.loadHistory()
    this.history = addMatchToHistory(history, result)
    await this.writeJson(HISTORY_FILE, this.history)
    return this.history
  }

  async clearHistory(): Promise<void> {
    await this.init()
    this.history = { matches: [] }
    await this.writeJson(HISTORY_FILE, this.history)
  }

  async createBackup(): Promise<BackupPayload> {
    const [profile, settings, appearance, history] = await Promise.all([
      this.loadProfile(),
      this.loadSettings(),
      this.loadAppearance(),
      this.loadHistory()
    ])
    return buildBackupPayload({ profile, settings, appearance, history })
  }

  validateBackup(value: unknown): value is BackupPayload {
    return validateBackupPayload(value)
  }

  async exportBackupTo(filePath: string): Promise<void> {
    const payload = await this.createBackup()
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
  }

  async importBackup(payload: BackupPayload): Promise<void> {
    if (!this.validateBackup(payload)) {
      throw new Error('备份文件格式不正确或版本不兼容')
    }
    await this.init()
    // Keep the current state recoverable if the user imports by mistake.
    await this.writeAutoBackup()
    await this.writeJson(PROFILE_FILE, payload.profile)
    await this.writeJson(SETTINGS_FILE, payload.settings)
    await this.writeJson(APPEARANCE_FILE, payload.appearance)
    await this.writeJson(HISTORY_FILE, payload.history)
    this.profile = null
    this.settings = null
    this.appearance = undefined
    this.history = null
    await this.loadProfile()
  }

  async writeAutoBackup(): Promise<string | null> {
    try {
      await this.init()
      const payload = await this.createBackup()
      const dir = path.join(this.dir, 'backups')
      await fs.mkdir(dir, { recursive: true })
      const file = path.join(dir, autoBackupFileName())
      await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8')
      await this.pruneBackups(dir)
      return file
    } catch (error) {
      console.warn('[storage] auto backup failed', error)
      return null
    }
  }

  private async pruneBackups(dir: string): Promise<void> {
    try {
      const names = (await fs.readdir(dir))
        .filter((name) => /^snapfire-backup-.*\.json$/.test(name))
        .sort()
      while (names.length > MAX_AUTO_BACKUPS) {
        const oldest = names.shift()
        if (oldest) await fs.rm(path.join(dir, oldest), { force: true })
      }
    } catch (error) {
      console.warn('[storage] failed to prune backups', error)
    }
  }

  async resetAll(): Promise<void> {
    await this.init()
    await Promise.all(
      [PROFILE_FILE, SETTINGS_FILE, APPEARANCE_FILE, HISTORY_FILE].map((name) =>
        fs.rm(this.filePath(name), { force: true }).catch(() => undefined)
      )
    )
    this.profile = null
    this.settings = null
    this.appearance = undefined
    this.history = null
    await this.loadProfile()
  }
}
