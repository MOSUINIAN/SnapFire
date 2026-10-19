import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  MatchResult,
  ProfileData,
  RoomPublicState
} from '@shared/types'
import { ResultsScreen } from '@renderer/screens/ResultsScreen'
import type { RoomSession } from '@renderer/types'
import type { NetClient } from '@renderer/net/NetClient'

const profile: ProfileData = {
  id: 'player-a-0001',
  name: 'Alice',
  createdAt: 1,
  updatedAt: 2
}

const result: MatchResult = {
  matchId: 'match-results-1',
  mode: 'urban',
  startedAt: Date.now() - 60_000,
  endedAt: Date.now(),
  durationMin: 5,
  killLimit: 10,
  winner: 'red',
  score: { red: 7, blue: 3 },
  players: [
    {
      id: 'player-a-0001',
      name: 'Alice',
      team: 'red',
      kills: 5,
      deaths: 1,
      shots: 10,
      hits: 6,
      accuracy: 0.6
    },
    {
      id: 'player-b-0002',
      name: 'Bob',
      team: 'blue',
      kills: 3,
      deaths: 4,
      shots: 12,
      hits: 5,
      accuracy: 0.417
    }
  ]
}

const room: RoomPublicState = {
  roomCode: '1234',
  hostId: 'player-a-0001',
  phase: 'ended',
  players: [],
  settings: { durationMin: 5, killLimit: 10 },
  score: result.score,
  matchStartedAt: result.startedAt,
  matchEndsAt: result.endedAt,
  remainingMs: 0,
  countdownEndsAt: null,
  serverNow: Date.now(),
  killFeed: [],
  result
}

const session: RoomSession = {
  net: {} as NetClient,
  room,
  gallery: [],
  selfId: profile.id,
  isHost: true,
  hostInfo: null,
  address: '127.0.0.1:17890'
}

describe('ResultsScreen', () => {
  it('renders the winner, score, personal outcome and scoreboard', () => {
    const html = renderToStaticMarkup(
      createElement(ResultsScreen, {
        session,
        profile,
        historySaved: true,
        onReturnLobby: () => undefined,
        onLeave: () => undefined
      })
    )
    expect(html).toContain('红队获胜')
    expect(html).toContain('你的结果：胜利')
    expect(html).toContain('Alice')
    expect(html).toContain('Bob')
    expect(html).toContain('60%')
    expect(html).toContain('战绩已保存到本机')
    expect(html).toContain('返回大厅')
  })

  it('renders a draw and the waiting state for guests', () => {
    const drawResult: MatchResult = {
      ...result,
      winner: 'draw',
      score: { red: 4, blue: 4 }
    }
    const drawSession: RoomSession = {
      ...session,
      isHost: false,
      room: {
        ...room,
        score: drawResult.score,
        result: drawResult
      }
    }
    const html = renderToStaticMarkup(
      createElement(ResultsScreen, {
        session: drawSession,
        profile,
        historySaved: false,
        onReturnLobby: () => undefined,
        onLeave: () => undefined
      })
    )
    expect(html).toContain('平局')
    expect(html).toContain('等待房主返回大厅')
    expect(html).toContain('正在保存战绩')
  })
})
