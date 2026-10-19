import type {
  AppearanceData,
  ClothingDescriptor,
  GalleryEntry,
  MatchResult,
  Team
} from '@shared/types'

export function makeClothing(options?: {
  hue?: number
  saturation?: number
  value?: number
  view?: ClothingDescriptor['view']
  aspect?: number
}): ClothingDescriptor {
  const hue = options?.hue ?? 0
  const saturation = options?.saturation ?? 1
  const value = options?.value ?? 1
  const hueBin = Math.min(11, Math.max(0, Math.round(hue * 12) % 12))
  const satBin = Math.min(3, Math.max(0, Math.floor(saturation * 4)))
  const histogram = new Array<number>(48).fill(0)
  histogram[hueBin * 4 + satBin] = 1
  const grid: number[] = []
  for (let cell = 0; cell < 9; cell += 1) {
    grid.push(hue, saturation, value)
  }
  return {
    version: 1,
    view: options?.view ?? 'front',
    histogram,
    grid,
    aspect: options?.aspect ?? 0.6,
    capturedAt: Date.now()
  }
}

export function makeAppearance(seed = 0.1): AppearanceData {
  return {
    version: 1,
    faceEmbeddings: [new Array<number>(128).fill(seed)],
    clothing: [makeClothing()],
    updatedAt: Date.now()
  }
}

export function makeGalleryEntry(
  id: string,
  name: string,
  team: Team,
  clothing: ClothingDescriptor,
  faceEmbeddings: number[][] = []
): GalleryEntry {
  return {
    id,
    name,
    team,
    appearance: {
      version: 1,
      faceEmbeddings,
      clothing: [clothing],
      updatedAt: Date.now()
    }
  }
}

export function makeMatchResult(matchId: string): MatchResult {
  const now = Date.now()
  return {
    matchId,
    mode: 'urban',
    startedAt: now - 60_000,
    endedAt: now,
    durationMin: 5,
    killLimit: 10,
    winner: 'red',
    score: { red: 3, blue: 1 },
    players: [
      {
        id: 'player-test-1',
        name: '测试玩家',
        team: 'red',
        kills: 3,
        deaths: 0,
        shots: 10,
        hits: 6,
        accuracy: 0.6
      }
    ]
  }
}
