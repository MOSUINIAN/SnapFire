import { describe, expect, it } from 'vitest'
import type {
  ClientMessage,
  RoomPublicState,
  ServerMessage
} from '../src/shared/types'
import {
  RoomEngine,
  type RoomEngineTransport
} from '../src/core/roomEngine'
import { makeAppearance } from './helpers/fixtures'

class RecordingTransport implements RoomEngineTransport {
  readonly sent: Array<{ connectionId: string; message: ServerMessage }> = []
  readonly broadcasts: ServerMessage[] = []
  readonly closed: Array<{ connectionId: string; code: number; reason: string }> = []
  stopRequested = false

  send(connectionId: string, message: ServerMessage): void {
    this.sent.push({ connectionId, message })
  }

  broadcast(message: ServerMessage): void {
    this.broadcasts.push(message)
  }

  closeConnection(connectionId: string, code: number, reason: string): void {
    this.closed.push({ connectionId, code, reason })
  }

  requestStop(): void {
    this.stopRequested = true
  }

  latestRoom(): RoomPublicState {
    const rooms = this.broadcasts.filter(
      (message): message is Extract<ServerMessage, { type: 'room' }> => message.type === 'room'
    )
    const room = rooms.at(-1)
    if (!room) throw new Error('no room broadcast')
    return room.room
  }

  messagesOf(type: ServerMessage['type']): ServerMessage[] {
    return [
      ...this.broadcasts,
      ...this.sent.map((entry) => entry.message)
    ].filter((message) => message.type === type)
  }
}

function join(
  engine: RoomEngine,
  connectionId: string,
  playerId: string,
  name: string,
  hostToken?: string
): void {
  const message: ClientMessage = {
    type: 'join',
    roomCode: '4821',
    playerId,
    name,
    ...(hostToken ? { hostToken } : {})
  }
  engine.handleRaw(connectionId, JSON.stringify(message))
}

function createEngine(): {
  engine: RoomEngine
  transport: RecordingTransport
  clock: { now: number }
} {
  const transport = new RecordingTransport()
  const clock = { now: 1_000_000 }
  let nextId = 0
  const engine = new RoomEngine(transport, {
    roomCode: '4821',
    hostToken: 'host-secret',
    now: () => clock.now,
    createId: () => `test-id-${(nextId += 1)}`
  })
  return { engine, transport, clock }
}

describe('RoomEngine transport-independent rules', () => {
  it('runs a real-time-free match using injected time and a fake transport', () => {
    const { engine, transport, clock } = createEngine()
    join(engine, 'host-connection', 'player-host-0001', 'Host', 'host-secret')
    join(engine, 'guest-connection', 'player-guest-0002', 'Guest')

    engine.handleRaw('host-connection', JSON.stringify({ type: 'set-team', team: 'red' }))
    engine.handleRaw('guest-connection', JSON.stringify({ type: 'set-team', team: 'blue' }))
    engine.handleRaw(
      'host-connection',
      JSON.stringify({ type: 'set-appearance', appearance: makeAppearance() })
    )
    engine.handleRaw(
      'guest-connection',
      JSON.stringify({ type: 'set-appearance', appearance: makeAppearance() })
    )
    engine.handleRaw('guest-connection', JSON.stringify({ type: 'set-ready', ready: true }))
    engine.handleRaw('host-connection', JSON.stringify({ type: 'start-match' }))

    expect(transport.latestRoom().phase).toBe('countdown')
    clock.now += 3000
    engine.tick()
    expect(transport.latestRoom().phase).toBe('playing')
    expect(transport.latestRoom().matchEndsAt).toBe(clock.now + 5 * 60_000)

    clock.now += 200
    engine.handleRaw(
      'host-connection',
      JSON.stringify({ type: 'shot', targetId: 'player-guest-0002' })
    )
    const damageMessages = transport.messagesOf('damage')
    expect(damageMessages).toHaveLength(1)
    const damage = damageMessages[0]
    if (damage.type !== 'damage') throw new Error('unexpected message')
    expect(damage.hp).toBe(75)
    expect(transport.latestRoom().players.find((p) => p.id === 'player-guest-0002')?.hp).toBe(75)

    for (let round = 0; round < 3; round += 1) {
      clock.now += 200
      engine.handleRaw(
        'host-connection',
        JSON.stringify({ type: 'shot', targetId: 'player-guest-0002' })
      )
    }
    const victim = transport
      .latestRoom()
      .players.find((player) => player.id === 'player-guest-0002')
    expect(victim?.alive).toBe(false)
    expect(victim?.hp).toBe(0)
    expect(transport.latestRoom().score.red).toBe(1)

    clock.now += 5000
    engine.tick()
    expect(transport.messagesOf('respawn')).toHaveLength(1)
    const revived = transport
      .latestRoom()
      .players.find((player) => player.id === 'player-guest-0002')
    expect(revived?.hp).toBe(100)
    expect(revived?.alive).toBe(true)
    expect(revived?.invulnerableUntil).toBe(clock.now + 2000)

    clock.now += 200
    engine.handleRaw(
      'host-connection',
      JSON.stringify({ type: 'shot', targetId: 'player-guest-0002' })
    )
    const shotResult = transport.sent
      .filter((entry) => entry.connectionId === 'host-connection')
      .map((entry) => entry.message)
      .filter((message): message is Extract<ServerMessage, { type: 'shot-result' }> =>
        message.type === 'shot-result'
      )
      .at(-1)
    expect(shotResult?.hit).toBe(false)
    expect(shotResult?.reason).toBe('invulnerable')

    clock.now = transport.latestRoom().matchEndsAt as number
    engine.tick()
    const ended = transport.latestRoom()
    expect(ended.phase).toBe('ended')
    expect(ended.result?.score.red).toBe(1)
    expect(transport.messagesOf('match-end')).toHaveLength(1)
  })

  it('keeps transport connections isolated for direct messages', () => {
    const { engine, transport } = createEngine()
    join(engine, 'host-connection', 'player-host-0001', 'Host', 'host-secret')
    join(engine, 'guest-connection', 'player-guest-0002', 'Guest')
    engine.handleRaw('guest-connection', JSON.stringify({ type: 'ping', t: 1234 }))

    const pong = transport.sent.find(
      (entry) => entry.connectionId === 'guest-connection' && entry.message.type === 'pong'
    )
    expect(pong?.message).toEqual({ type: 'pong', t: 1234 })
    expect(
      transport.sent.some(
        (entry) =>
          entry.connectionId === 'host-connection' && entry.message.type === 'pong'
      )
    ).toBe(false)
  })

  it('closes an invalid room code without admitting a player', () => {
    const { engine, transport } = createEngine()
    engine.handleRaw(
      'intruder',
      JSON.stringify({
        type: 'join',
        roomCode: '0000',
        playerId: 'player-bad-0001',
        name: 'Bad'
      })
    )
    expect(transport.closed).toEqual([
      { connectionId: 'intruder', code: 4001, reason: 'bad room code' }
    ])
    expect(transport.messagesOf('welcome')).toHaveLength(0)
    expect(transport.messagesOf('room')).toHaveLength(0)
  })

  it('requests room shutdown when the host connection closes', () => {
    const { engine, transport } = createEngine()
    join(engine, 'host-connection', 'player-host-0001', 'Host', 'host-secret')
    engine.handleClose('host-connection')
    expect(transport.stopRequested).toBe(true)
    expect(
      transport.broadcasts.some(
        (message) =>
          message.type === 'error' && message.message.includes('房主已离开房间')
      )
    ).toBe(true)
  })
})
