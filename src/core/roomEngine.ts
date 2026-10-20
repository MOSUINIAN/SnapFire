import {
  COUNTDOWN_MS,
  DAMAGE_PER_HIT,
  DEFAULT_ROOM_SETTINGS,
  DURATION_MAX,
  DURATION_MIN,
  INVULNERABLE_MS,
  KILL_LIMIT_MAX,
  KILL_LIMIT_MIN,
  MAX_HP,
  MAX_PLAYERS,
  MAX_TEAM_SIZE,
  RESPAWN_MS,
  type AppearanceData,
  type ClientMessage,
  type GalleryEntry,
  type KillFeedEntry,
  type MatchPhase,
  type MatchResult,
  type MatchScore,
  type PlayerPublic,
  type RoomPublicState,
  type RoomSettings,
  type ServerMessage,
  type Team
} from '../shared/types'

const FIRE_COOLDOWN_MS = 120
const KILL_FEED_SIZE = 6

export interface RoomEngineTransport {
  /** Send a message to one transport connection. */
  send(connectionId: string, message: ServerMessage): void
  /** Send a message to every transport connection. */
  broadcast(message: ServerMessage): void
  /** Close one transport connection with a WebSocket-style code and reason. */
  closeConnection(connectionId: string, code: number, reason: string): void
  /** The host has gone away and the owning adapter should stop the room. */
  requestStop(): void
}

export interface RoomEngineOptions {
  roomCode: string
  hostToken: string
  now?: () => number
  createId?: () => string
}

interface InternalPlayer {
  id: string
  name: string
  team: Team | null
  ready: boolean
  connected: boolean
  appearance: AppearanceData | null
  connectionId: string | null
  joinedAt: number
  hp: number
  alive: boolean
  kills: number
  deaths: number
  shots: number
  hits: number
  respawnAt: number | null
  invulnerableUntil: number | null
  lastShotAt: number
}

function sanitizeName(input: unknown): string {
  if (typeof input !== 'string') return '玩家'
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16)
  return cleaned || '玩家'
}

function isFiniteNumberArray(value: unknown, maxLength: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  )
}

function sanitizeAppearance(value: unknown): AppearanceData | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AppearanceData>
  if (candidate.version !== 1) return null
  if (!Array.isArray(candidate.faceEmbeddings) || !Array.isArray(candidate.clothing)) return null
  if (candidate.faceEmbeddings.length > 16 || candidate.clothing.length > 12) return null

  const faceEmbeddings: number[][] = []
  for (const embedding of candidate.faceEmbeddings) {
    if (!isFiniteNumberArray(embedding, 4096) || embedding.length < 32) return null
    faceEmbeddings.push(embedding.map((n) => Number(n.toFixed(5))))
  }

  const clothing: AppearanceData['clothing'] = []
  for (const descriptor of candidate.clothing) {
    if (!descriptor || typeof descriptor !== 'object') return null
    if (
      descriptor.version !== 1 ||
      typeof descriptor.aspect !== 'number' ||
      !Number.isFinite(descriptor.aspect) ||
      !isFiniteNumberArray(descriptor.histogram, 512) ||
      !isFiniteNumberArray(descriptor.grid, 64)
    ) {
      return null
    }
    clothing.push({
      version: 1,
      view: descriptor.view ?? 'other',
      histogram: descriptor.histogram.map((n) => Number(n.toFixed(5))),
      grid: descriptor.grid.map((n) => Number(n.toFixed(5))),
      aspect: Number(descriptor.aspect.toFixed(4)),
      capturedAt: Number(descriptor.capturedAt) || Date.now()
    })
  }

  return {
    version: 1,
    faceEmbeddings,
    clothing,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now()
    // Deliberately no thumbnail: photos stay on the player's own device.
  }
}

function sanitizeSettings(value: unknown): RoomSettings | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RoomSettings>
  if (typeof candidate.durationMin !== 'number' || typeof candidate.killLimit !== 'number') {
    return null
  }
  return {
    durationMin: Math.round(Math.min(DURATION_MAX, Math.max(DURATION_MIN, candidate.durationMin))),
    killLimit: Math.round(Math.min(KILL_LIMIT_MAX, Math.max(KILL_LIMIT_MIN, candidate.killLimit)))
  }
}

/**
 * Platform-independent authoritative room and match rules.
 *
 * It deliberately knows nothing about WebSockets, Electron, Android, file
 * storage, or network interfaces. Adapters provide a transport and clock.
 */
export class RoomEngine {
  private readonly transport: RoomEngineTransport
  private readonly now: () => number
  private readonly createId: () => string
  readonly roomCode: string
  readonly hostToken: string

  private hostId = ''
  private players = new Map<string, InternalPlayer>()
  private settings: RoomSettings = { ...DEFAULT_ROOM_SETTINGS }
  private phase: MatchPhase = 'lobby'
  private score: MatchScore = { red: 0, blue: 0 }
  private matchStartedAt: number | null = null
  private matchEndsAt: number | null = null
  private countdownEndsAt: number | null = null
  private killFeed: KillFeedEntry[] = []
  private result: MatchResult | null = null
  private lastRoomBroadcast = 0
  private stopped = false

  constructor(transport: RoomEngineTransport, options: RoomEngineOptions) {
    this.transport = transport
    this.now = options.now ?? (() => Date.now())
    this.createId = options.createId ?? (() => crypto.randomUUID())
    this.roomCode = options.roomCode
    this.hostToken = options.hostToken
  }

  get isStopped(): boolean {
    return this.stopped
  }

  getHostId(): string {
    return this.hostId
  }

  getRoomState(): RoomPublicState {
    return this.roomState()
  }

  endMatchForTest(): void {
    this.endMatch()
  }

  handleRaw(connectionId: string, raw: string): void {
    let message: ClientMessage
    try {
      message = JSON.parse(raw) as ClientMessage
    } catch {
      this.sendError(connectionId, '消息格式错误')
      return
    }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      this.sendError(connectionId, '消息格式错误')
      return
    }

    if (message.type === 'ping') {
      this.send(connectionId, { type: 'pong', t: message.t })
      return
    }

    const player = this.findByConnection(connectionId)
    if (!player) {
      if (message.type === 'join') {
        this.handleJoin(connectionId, message)
      } else {
        this.sendError(connectionId, '请先加入房间')
      }
      return
    }

    switch (message.type) {
      case 'join':
        this.sendError(connectionId, '已经在房间中')
        break
      case 'set-name':
        if (this.phase !== 'lobby') {
          this.sendError(connectionId, '比赛开始后不能修改昵称')
          break
        }
        player.name = sanitizeName(message.name)
        this.broadcastRoom()
        this.broadcastGallery()
        break
      case 'set-team':
        this.handleSetTeam(connectionId, player, message.team)
        break
      case 'set-ready':
        if (this.phase !== 'lobby') {
          this.sendError(connectionId, '比赛开始后不能修改准备状态')
          break
        }
        player.ready = Boolean(message.ready)
        this.broadcastRoom()
        break
      case 'set-appearance': {
        const appearance = sanitizeAppearance(message.appearance)
        if (!appearance) {
          this.sendError(connectionId, '建档数据无效，请重新采集')
          break
        }
        player.appearance = appearance
        player.ready = false
        this.broadcastRoom()
        this.broadcastGallery()
        break
      }
      case 'update-settings':
        this.handleUpdateSettings(connectionId, player, message.settings)
        break
      case 'start-match':
        this.handleStartMatch(connectionId, player)
        break
      case 'shot':
        this.handleShot(connectionId, player, message.targetId)
        break
      case 'return-lobby':
        this.handleReturnLobby(connectionId, player)
        break
      case 'leave':
        this.handleClose(connectionId)
        this.transport.closeConnection(connectionId, 1000, 'left room')
        break
      default:
        this.sendError(connectionId, '未知消息类型')
        break
    }
  }

  handleClose(connectionId: string): void {
    if (this.stopped) return
    const player = this.findByConnection(connectionId)
    if (!player) return
    player.connected = false
    player.connectionId = null
    player.ready = false

    // The host owns the room. If the host's client goes away, the room can no
    // longer be managed, so close it for everyone.
    if (player.id === this.hostId) {
      this.transport.broadcast({ type: 'error', message: '房主已离开房间，房间已关闭' })
      this.stopped = true
      this.transport.requestStop()
      return
    }

    if (this.phase === 'lobby') {
      this.players.delete(player.id)
    } else if (this.phase === 'countdown' || this.phase === 'playing') {
      player.alive = false
      player.respawnAt = null
    }
    this.broadcastRoom()
    this.broadcastGallery()
  }

  tick(): void {
    if (this.stopped) return
    const now = this.now()
    if (this.phase === 'countdown') {
      if (this.countdownEndsAt && now >= this.countdownEndsAt) {
        this.phase = 'playing'
        this.matchStartedAt = now
        this.matchEndsAt = now + this.settings.durationMin * 60_000
        this.countdownEndsAt = null
        this.broadcastRoom()
      } else if (now - this.lastRoomBroadcast >= 500) {
        this.broadcastRoom()
      }
      return
    }

    if (this.phase === 'playing') {
      let changed = false
      for (const player of this.players.values()) {
        if (!player.alive && player.respawnAt !== null && now >= player.respawnAt) {
          player.hp = MAX_HP
          player.alive = true
          player.respawnAt = null
          player.invulnerableUntil = now + INVULNERABLE_MS
          this.transport.broadcast({ type: 'respawn', playerId: player.id })
          changed = true
        }
      }
      if (this.matchEndsAt && now >= this.matchEndsAt) {
        this.endMatch()
        return
      }
      if (changed || now - this.lastRoomBroadcast >= 500) {
        this.broadcastRoom()
      }
    }
  }

  dispose(): void {
    this.stopped = true
    this.players.clear()
    this.killFeed = []
    this.result = null
  }

  private handleJoin(
    connectionId: string,
    message: Extract<ClientMessage, { type: 'join' }>
  ): void {
    if (typeof message.roomCode !== 'string' || message.roomCode.trim() !== this.roomCode) {
      this.sendError(connectionId, '房间号不正确')
      this.transport.closeConnection(connectionId, 4001, 'bad room code')
      return
    }
    if (typeof message.playerId !== 'string' || message.playerId.length < 8) {
      this.sendError(connectionId, '玩家标识无效')
      this.transport.closeConnection(connectionId, 4002, 'bad player id')
      return
    }

    const isHostJoin =
      typeof message.hostToken === 'string' && message.hostToken === this.hostToken
    let player = this.players.get(message.playerId)
    if (player) {
      if (
        player.connectionId &&
        player.connectionId !== connectionId
      ) {
        this.transport.closeConnection(player.connectionId, 4000, 'replaced by a new connection')
      }
      player.connectionId = connectionId
      player.connected = true
      player.name = sanitizeName(message.name)
    } else {
      if (this.phase !== 'lobby') {
        this.sendError(connectionId, '比赛已经开始，无法加入')
        this.transport.closeConnection(connectionId, 4003, 'match already started')
        return
      }
      if (this.players.size >= MAX_PLAYERS) {
        this.sendError(connectionId, `房间已满（最多 ${MAX_PLAYERS} 人）`)
        this.transport.closeConnection(connectionId, 4004, 'room full')
        return
      }
      player = {
        id: message.playerId,
        name: sanitizeName(message.name),
        team: null,
        ready: false,
        connected: true,
        appearance: null,
        connectionId,
        joinedAt: this.now(),
        hp: MAX_HP,
        alive: true,
        kills: 0,
        deaths: 0,
        shots: 0,
        hits: 0,
        respawnAt: null,
        invulnerableUntil: null,
        lastShotAt: 0
      }
      this.players.set(player.id, player)
    }

    if (isHostJoin) {
      this.hostId = player.id
      player.ready = true
    }

    this.send(connectionId, {
      type: 'welcome',
      selfId: player.id,
      isHost: player.id === this.hostId,
      room: this.roomState(),
      gallery: this.gallery()
    })
    this.broadcastRoom()
    this.broadcastGallery()
  }

  private handleSetTeam(
    connectionId: string,
    player: InternalPlayer,
    team: Team
  ): void {
    if (this.phase !== 'lobby') {
      this.sendError(connectionId, '比赛开始后不能更换队伍')
      return
    }
    if (team !== 'red' && team !== 'blue') {
      this.sendError(connectionId, '队伍无效')
      return
    }
    if (player.team === team) return
    const count = [...this.players.values()].filter(
      (candidate) => candidate.id !== player.id && candidate.team === team
    ).length
    if (count >= MAX_TEAM_SIZE) {
      this.sendError(connectionId, `该队伍已满（最多 ${MAX_TEAM_SIZE} 人）`)
      return
    }
    player.team = team
    player.ready = false
    this.broadcastRoom()
    this.broadcastGallery()
  }

  private handleUpdateSettings(
    connectionId: string,
    player: InternalPlayer,
    settings: RoomSettings
  ): void {
    if (player.id !== this.hostId) {
      this.sendError(connectionId, '只有房主可以修改比赛设置')
      return
    }
    if (this.phase !== 'lobby') {
      this.sendError(connectionId, '比赛开始后不能修改设置')
      return
    }
    const clean = sanitizeSettings(settings)
    if (!clean) {
      this.sendError(connectionId, '比赛设置无效')
      return
    }
    this.settings = clean
    this.broadcastRoom()
  }

  private handleStartMatch(connectionId: string, player: InternalPlayer): void {
    if (player.id !== this.hostId) {
      this.sendError(connectionId, '只有房主可以开始比赛')
      return
    }
    if (this.phase !== 'lobby') {
      this.sendError(connectionId, '比赛已经在进行中')
      return
    }
    const connected = [...this.players.values()].filter((candidate) => candidate.connected)
    if (connected.length < 2) {
      this.sendError(connectionId, '至少需要 2 名玩家才能开始')
      return
    }
    if (
      !connected.some((candidate) => candidate.team === 'red') ||
      !connected.some((candidate) => candidate.team === 'blue')
    ) {
      this.sendError(connectionId, '红队和蓝队都至少需要 1 名玩家')
      return
    }
    if (connected.some((candidate) => !candidate.team)) {
      this.sendError(connectionId, '还有玩家没有选择队伍')
      return
    }
    if (connected.some((candidate) => !candidate.appearance)) {
      this.sendError(connectionId, '还有玩家未完成人脸与衣着建档')
      return
    }
    if (connected.some((candidate) => candidate.id !== this.hostId && !candidate.ready)) {
      this.sendError(connectionId, '还有玩家没有准备')
      return
    }

    const now = this.now()
    this.phase = 'countdown'
    this.score = { red: 0, blue: 0 }
    this.killFeed = []
    this.result = null
    this.countdownEndsAt = now + COUNTDOWN_MS
    this.matchStartedAt = null
    this.matchEndsAt = null
    for (const candidate of connected) {
      candidate.hp = MAX_HP
      candidate.alive = true
      candidate.kills = 0
      candidate.deaths = 0
      candidate.shots = 0
      candidate.hits = 0
      candidate.respawnAt = null
      candidate.invulnerableUntil = null
      candidate.lastShotAt = 0
    }
    this.broadcast({ type: 'match-start', room: this.roomState() })
    this.broadcastRoom()
  }

  private handleShot(
    connectionId: string,
    shooter: InternalPlayer,
    targetId: string | null
  ): void {
    if (this.phase !== 'playing') {
      this.send(connectionId, { type: 'shot-result', hit: false, reason: 'not-playing' })
      return
    }
    if (!shooter.alive || !shooter.connected) {
      this.send(connectionId, { type: 'shot-result', hit: false, reason: 'dead' })
      return
    }
    const now = this.now()
    if (now - shooter.lastShotAt < FIRE_COOLDOWN_MS) {
      return
    }
    shooter.lastShotAt = now
    shooter.shots += 1

    if (!targetId || typeof targetId !== 'string') {
      this.send(connectionId, { type: 'shot-result', hit: false, reason: 'no-target' })
      this.broadcastRoom()
      return
    }
    if (targetId === shooter.id) {
      this.send(connectionId, { type: 'shot-result', hit: false, reason: 'invalid-target' })
      this.broadcastRoom()
      return
    }
    const target = this.players.get(targetId)
    if (!target) {
      this.send(connectionId, { type: 'shot-result', hit: false, reason: 'invalid-target' })
      this.broadcastRoom()
      return
    }
    if (!target.team || !shooter.team || target.team === shooter.team) {
      this.send(connectionId, {
        type: 'shot-result',
        hit: false,
        targetId,
        reason: 'friendly'
      })
      this.broadcastRoom()
      return
    }
    if (!target.alive || !target.connected) {
      this.send(connectionId, {
        type: 'shot-result',
        hit: false,
        targetId,
        reason: 'target-dead'
      })
      this.broadcastRoom()
      return
    }
    if (target.invulnerableUntil && now < target.invulnerableUntil) {
      this.send(connectionId, {
        type: 'shot-result',
        hit: false,
        targetId,
        reason: 'invulnerable'
      })
      this.broadcastRoom()
      return
    }

    shooter.hits += 1
    target.hp = Math.max(0, target.hp - DAMAGE_PER_HIT)
    const killed = target.hp <= 0
    if (killed) {
      target.alive = false
      target.deaths += 1
      target.respawnAt = now + RESPAWN_MS
      target.invulnerableUntil = null
      shooter.kills += 1
      this.score[shooter.team] += 1
      const entry: KillFeedEntry = {
        id: this.createId(),
        killerId: shooter.id,
        killerName: shooter.name,
        killerTeam: shooter.team,
        victimId: target.id,
        victimName: target.name,
        victimTeam: target.team,
        at: now
      }
      this.killFeed = [entry, ...this.killFeed].slice(0, KILL_FEED_SIZE)
    }

    this.send(connectionId, {
      type: 'shot-result',
      hit: true,
      targetId,
      hp: target.hp,
      killed
    })
    this.broadcast({
      type: 'damage',
      shooterId: shooter.id,
      targetId,
      amount: DAMAGE_PER_HIT,
      hp: target.hp,
      killed
    })
    this.broadcastRoom()

    if (killed && this.score[shooter.team] >= this.settings.killLimit) {
      this.endMatch()
    }
  }

  private handleReturnLobby(connectionId: string, player: InternalPlayer): void {
    if (player.id !== this.hostId) {
      this.sendError(connectionId, '只有房主可以返回房间')
      return
    }
    if (this.phase !== 'ended') {
      this.sendError(connectionId, '比赛还没有结束')
      return
    }
    for (const [id, candidate] of this.players) {
      if (!candidate.connected) this.players.delete(id)
    }
    this.phase = 'lobby'
    this.score = { red: 0, blue: 0 }
    this.killFeed = []
    this.result = null
    this.matchStartedAt = null
    this.matchEndsAt = null
    this.countdownEndsAt = null
    for (const candidate of this.players.values()) {
      candidate.hp = MAX_HP
      candidate.alive = true
      candidate.kills = 0
      candidate.deaths = 0
      candidate.shots = 0
      candidate.hits = 0
      candidate.respawnAt = null
      candidate.invulnerableUntil = null
      candidate.ready = candidate.id === this.hostId
    }
    this.broadcastRoom()
    this.broadcastGallery()
  }

  private findByConnection(connectionId: string): InternalPlayer | null {
    for (const player of this.players.values()) {
      if (player.connectionId === connectionId) return player
    }
    return null
  }

  private endMatch(): void {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return
    const now = this.now()
    const winner: MatchResult['winner'] =
      this.score.red > this.score.blue
        ? 'red'
        : this.score.blue > this.score.red
          ? 'blue'
          : 'draw'
    const result: MatchResult = {
      matchId: this.createId(),
      mode: 'urban',
      startedAt: this.matchStartedAt ?? now,
      endedAt: now,
      durationMin: this.settings.durationMin,
      killLimit: this.settings.killLimit,
      winner,
      score: { ...this.score },
      players: [...this.players.values()]
        .filter((player) => player.team !== null)
        .map((player) => ({
          id: player.id,
          name: player.name,
          team: player.team as Team,
          kills: player.kills,
          deaths: player.deaths,
          shots: player.shots,
          hits: player.hits,
          accuracy: player.shots > 0 ? Number((player.hits / player.shots).toFixed(3)) : 0
        }))
    }
    this.phase = 'ended'
    this.matchEndsAt = now
    this.countdownEndsAt = null
    this.result = result
    this.broadcast({ type: 'match-end', result })
    this.broadcastRoom()
  }

  private roomState(): RoomPublicState {
    const now = this.now()
    return {
      roomCode: this.roomCode,
      hostId: this.hostId,
      phase: this.phase,
      players: this.sortedPlayers().map((player) => this.publicPlayer(player)),
      settings: { ...this.settings },
      score: { ...this.score },
      matchStartedAt: this.matchStartedAt,
      matchEndsAt: this.matchEndsAt,
      remainingMs: this.matchEndsAt !== null ? Math.max(0, this.matchEndsAt - now) : null,
      countdownEndsAt: this.countdownEndsAt,
      serverNow: now,
      killFeed: this.killFeed.map((entry) => ({ ...entry })),
      result: this.result
    }
  }

  private sortedPlayers(): InternalPlayer[] {
    const teamRank = (team: Team | null): number =>
      team === 'red' ? 0 : team === 'blue' ? 1 : 2
    return [...this.players.values()].sort((a, b) => {
      if (a.id === this.hostId) return -1
      if (b.id === this.hostId) return 1
      const rankDiff = teamRank(a.team) - teamRank(b.team)
      if (rankDiff !== 0) return rankDiff
      return a.joinedAt - b.joinedAt
    })
  }

  private publicPlayer(player: InternalPlayer): PlayerPublic {
    return {
      id: player.id,
      name: player.name,
      team: player.team,
      ready: player.ready,
      connected: player.connected,
      appearanceReady: player.appearance !== null,
      isHost: player.id === this.hostId,
      hp: player.hp,
      alive: player.alive,
      kills: player.kills,
      deaths: player.deaths,
      shots: player.shots,
      hits: player.hits,
      respawnAt: player.respawnAt,
      invulnerableUntil: player.invulnerableUntil
    }
  }

  private gallery(): GalleryEntry[] {
    return [...this.players.values()]
      .filter((player) => player.appearance !== null)
      .map((player) => ({
        id: player.id,
        name: player.name,
        team: player.team,
        appearance: player.appearance as AppearanceData
      }))
  }

  private broadcastRoom(): void {
    this.lastRoomBroadcast = this.now()
    this.broadcast({ type: 'room', room: this.roomState() })
  }

  private broadcastGallery(): void {
    this.broadcast({ type: 'gallery', gallery: this.gallery() })
  }

  private broadcast(message: ServerMessage): void {
    this.transport.broadcast(message)
  }

  private send(connectionId: string, message: ServerMessage): void {
    this.transport.send(connectionId, message)
  }

  private sendError(connectionId: string, message: string): void {
    this.send(connectionId, { type: 'error', message })
  }
}
