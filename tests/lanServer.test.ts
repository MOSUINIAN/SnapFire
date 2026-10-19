import { afterEach, describe, expect, it } from 'vitest'
import type { RoomPublicState, ServerMessage } from '@shared/types'
import { LanServer } from '../src/main/lanServer'
import { TestClient } from './helpers/TestClient'
import { makeAppearance } from './helpers/fixtures'

type ShotResult = Extract<ServerMessage, { type: 'shot-result' }>
type RoomMessage = Extract<ServerMessage, { type: 'room' }>
type MatchEndMessage = Extract<ServerMessage, { type: 'match-end' }>
type ErrorMessage = Extract<ServerMessage, { type: 'error' }>

let server: LanServer | null = null
let clients: TestClient[] = []

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function nextPort(): number {
  return 28000 + Math.floor(Math.random() * 2000)
}

async function startServer(): Promise<{
  server: LanServer
  url: string
  roomCode: string
  hostToken: string
}> {
  const instance = new LanServer()
  const info = await instance.start(nextPort())
  server = instance
  return {
    server: instance,
    url: `ws://127.0.0.1:${info.port}`,
    roomCode: info.roomCode,
    hostToken: info.hostToken
  }
}

function makeClient(url: string): TestClient {
  const client = new TestClient(url)
  clients.push(client)
  return client
}

function isRoomWith(
  predicate: (room: RoomPublicState) => boolean
): (message: ServerMessage) => boolean {
  return (message) => message.type === 'room' && predicate(message.room)
}

afterEach(async () => {
  if (server) {
    await server.stop()
    server = null
  }
  for (const client of clients) client.close()
  clients = []
})

describe('LanServer match rules', () => {
  it('runs a match: damage, friendly fire, death, respawn protection and results', async () => {
    const host = await startServer()
    const a = makeClient(host.url)
    const b = makeClient(host.url)
    const c = makeClient(host.url)

    const welcomeA = await a.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-a-0001',
      name: 'Alice',
      hostToken: host.hostToken
    })
    const welcomeB = await b.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-b-0002',
      name: 'Bob'
    })
    const welcomeC = await c.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-c-0003',
      name: 'Carol'
    })

    expect(welcomeA.isHost).toBe(true)
    expect(welcomeB.isHost).toBe(false)
    expect(welcomeC.isHost).toBe(false)

    await a.waitFor(isRoomWith((room) => room.players.length === 3))

    a.send({ type: 'set-team', team: 'blue' })
    b.send({ type: 'set-team', team: 'blue' })
    c.send({ type: 'set-team', team: 'red' })
    await a.waitFor(
      isRoomWith(
        (room) =>
          room.players.filter((player) => player.team === 'blue').length === 2 &&
          room.players.filter((player) => player.team === 'red').length === 1
      )
    )

    a.send({ type: 'set-appearance', appearance: makeAppearance() })
    b.send({ type: 'set-appearance', appearance: makeAppearance() })
    c.send({ type: 'set-appearance', appearance: makeAppearance() })
    await a.waitFor(
      isRoomWith((room) => room.players.every((player) => player.appearanceReady))
    )

    b.send({ type: 'set-ready', ready: true })
    c.send({ type: 'set-ready', ready: true })
    await a.waitFor(
      isRoomWith((room) =>
        room.players
          .filter((player) => player.id !== welcomeA.selfId)
          .every((player) => player.ready)
      )
    )

    a.send({ type: 'start-match' })
    const started = await a.waitFor((message) => message.type === 'match-start')
    expect(started.type).toBe('match-start')
    await a.waitFor(isRoomWith((room) => room.phase === 'playing'), 9000)

    const victimId = welcomeC.selfId
    const teammateId = welcomeB.selfId

    for (let shot = 1; shot <= 4; shot += 1) {
      await sleep(170)
      b.send({ type: 'shot', targetId: victimId })
      const result = (await b.waitFor(
        (message) => message.type === 'shot-result'
      )) as ShotResult
      expect(result.hit).toBe(true)
      expect(result.targetId).toBe(victimId)
      expect(result.hp).toBe(100 - shot * 25)
      if (shot === 4) expect(result.killed).toBe(true)
    }

    const afterKill = (await a.waitFor(
      isRoomWith((room) => room.score.blue === 1)
    )) as RoomMessage
    const victim = afterKill.room.players.find((player) => player.id === victimId)
    expect(victim?.alive).toBe(false)
    expect(victim?.hp).toBe(0)
    expect(victim?.deaths).toBe(1)

    await sleep(170)
    a.send({ type: 'shot', targetId: teammateId })
    const friendly = (await a.waitFor(
      (message) => message.type === 'shot-result'
    )) as ShotResult
    expect(friendly.hit).toBe(false)
    expect(friendly.reason).toBe('friendly')

    await sleep(170)
    b.send({ type: 'shot', targetId: teammateId })
    const selfShot = (await b.waitFor(
      (message) => message.type === 'shot-result'
    )) as ShotResult
    expect(selfShot.hit).toBe(false)
    expect(selfShot.reason).toBe('invalid-target')

    await a.waitFor(
      (message) => message.type === 'respawn' && message.playerId === victimId,
      9000
    )
    await sleep(30)
    b.send({ type: 'shot', targetId: victimId })
    const protectedShot = (await b.waitFor(
      (message) => message.type === 'shot-result'
    )) as ShotResult
    expect(protectedShot.hit).toBe(false)
    expect(protectedShot.reason).toBe('invulnerable')

    const internals = server as unknown as { endMatch: () => void }
    internals.endMatch()
    const matchEnd = (await a.waitFor(
      (message) => message.type === 'match-end'
    )) as MatchEndMessage
    expect(matchEnd.result.winner).toBe('blue')
    expect(matchEnd.result.score.blue).toBe(1)
    expect(matchEnd.result.score.red).toBe(0)
    expect(matchEnd.result.players).toHaveLength(3)

    a.send({ type: 'return-lobby' })
    const lobby = (await a.waitFor(
      isRoomWith((room) => room.phase === 'lobby')
    )) as RoomMessage
    expect(lobby.room.score).toEqual({ red: 0, blue: 0 })
    expect(lobby.room.players.every((player) => player.hp === 100)).toBe(true)
  })
})

describe('LanServer room limits', () => {
  it('enforces the 3-player team limit and the 6-player room limit', async () => {
    const host = await startServer()
    const a = makeClient(host.url)
    const b = makeClient(host.url)
    const c = makeClient(host.url)
    const d = makeClient(host.url)

    await a.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-a-0001',
      name: 'A',
      hostToken: host.hostToken
    })
    await b.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-b-0002',
      name: 'B'
    })
    await c.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-c-0003',
      name: 'C'
    })
    await d.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-d-0004',
      name: 'D'
    })

    a.send({ type: 'set-team', team: 'red' })
    b.send({ type: 'set-team', team: 'red' })
    c.send({ type: 'set-team', team: 'red' })
    await a.waitFor(
      isRoomWith((room) => room.players.filter((player) => player.team === 'red').length === 3)
    )

    d.send({ type: 'set-team', team: 'red' })
    const teamError = (await d.waitFor(
      (message) => message.type === 'error'
    )) as ErrorMessage
    expect(teamError.message).toContain('该队伍已满')

    const e = makeClient(host.url)
    const f = makeClient(host.url)
    await e.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-e-0005',
      name: 'E'
    })
    await f.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-f-0006',
      name: 'F'
    })
    await a.waitFor(isRoomWith((room) => room.players.length === 6))

    const g = makeClient(host.url)
    await g.waitForOpen()
    g.send({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-g-0007',
      name: 'G'
    })
    const roomError = (await g.waitFor(
      (message) => message.type === 'error'
    )) as ErrorMessage
    expect(roomError.message).toContain('房间已满')
  })
})

describe('LanServer validation', () => {
  it('clamps settings and refuses to start before everyone is enrolled', async () => {
    const host = await startServer()
    const a = makeClient(host.url)
    const b = makeClient(host.url)

    await a.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-a-0001',
      name: 'A',
      hostToken: host.hostToken
    })
    await b.join({
      type: 'join',
      roomCode: host.roomCode,
      playerId: 'player-b-0002',
      name: 'B'
    })

    a.send({ type: 'update-settings', settings: { durationMin: 99, killLimit: 1 } })
    const clamped = (await a.waitFor(
      isRoomWith(
        (room) => room.settings.durationMin === 10 && room.settings.killLimit === 10
      )
    )) as RoomMessage
    expect(clamped.room.settings).toEqual({ durationMin: 10, killLimit: 10 })

    a.send({ type: 'set-team', team: 'red' })
    b.send({ type: 'set-team', team: 'blue' })
    await a.waitFor(
      isRoomWith(
        (room) =>
          room.players.some((player) => player.team === 'red') &&
          room.players.some((player) => player.team === 'blue')
      )
    )

    a.send({ type: 'start-match' })
    const startError = (await a.waitFor(
      (message) => message.type === 'error'
    )) as ErrorMessage
    expect(startError.message).toContain('建档')

    a.send({ type: 'set-appearance', appearance: makeAppearance() })
    b.send({ type: 'set-appearance', appearance: makeAppearance() })
    await a.waitFor(
      isRoomWith((room) => room.players.every((player) => player.appearanceReady))
    )
    b.send({ type: 'set-ready', ready: true })
    await a.waitFor(
      isRoomWith((room) =>
        room.players
          .filter((player) => player.id !== room.hostId)
          .every((player) => player.ready)
      )
    )

    a.send({ type: 'start-match' })
    const started = await a.waitFor((message) => message.type === 'match-start')
    expect(started.type).toBe('match-start')
  })
})
