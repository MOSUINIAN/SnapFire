import { describe, expect, it } from 'vitest'
import {
  clothingSimilarity,
  matchIdentity
} from '@renderer/vision/descriptors'
import { makeClothing, makeGalleryEntry } from './helpers/fixtures'

const noFace = (): number => 0

describe('clothingSimilarity', () => {
  it('scores an identical descriptor close to 1', () => {
    const a = makeClothing({ hue: 0.05 })
    const b = makeClothing({ hue: 0.05 })
    expect(clothingSimilarity(a, b)).toBeGreaterThan(0.98)
  })

  it('scores clearly different clothing colours much lower', () => {
    const red = makeClothing({ hue: 0.0 })
    const blue = makeClothing({ hue: 0.58 })
    expect(clothingSimilarity(red, blue)).toBeLessThan(0.5)
  })

  it('is tolerant to moderate brightness changes', () => {
    const bright = makeClothing({ hue: 0.08, value: 1 })
    const dark = makeClothing({ hue: 0.08, value: 0.55 })
    expect(clothingSimilarity(bright, dark)).toBeGreaterThan(0.85)
  })
})

describe('matchIdentity', () => {
  it('selects the player whose clothing matches', () => {
    const target = makeClothing({ hue: 0.0 })
    const gallery = [
      makeGalleryEntry('player-a-0001', 'Alice', 'red', makeClothing({ hue: 0.0 })),
      makeGalleryEntry('player-b-0002', 'Bob', 'blue', makeClothing({ hue: 0.58 }))
    ]
    const result = matchIdentity(null, target, gallery, 'self-player', noFace)
    expect(result?.playerId).toBe('player-a-0001')
    expect(result?.team).toBe('red')
    expect(result?.source).toBe('clothing')
  })

  it('never matches the local player', () => {
    const target = makeClothing({ hue: 0.0 })
    const gallery = [
      makeGalleryEntry('self-player', 'Me', 'red', makeClothing({ hue: 0.0 })),
      makeGalleryEntry('player-b-0002', 'Bob', 'blue', makeClothing({ hue: 0.58 }))
    ]
    expect(matchIdentity(null, target, gallery, 'self-player', noFace)).toBeNull()
  })

  it('returns null when two players look identical (ambiguous)', () => {
    const target = makeClothing({ hue: 0.0 })
    const gallery = [
      makeGalleryEntry('player-a-0001', 'Alice', 'red', makeClothing({ hue: 0.0 })),
      makeGalleryEntry('player-b-0002', 'Bob', 'blue', makeClothing({ hue: 0.0 }))
    ]
    expect(matchIdentity(null, target, gallery, 'self-player', noFace)).toBeNull()
  })

  it('uses the face signal when clothing is not distinctive', () => {
    const target = makeClothing({ hue: 0.3 })
    const aliceFace = new Array<number>(128).fill(0.5)
    const bobFace = new Array<number>(128).fill(0.9)
    const gallery = [
      makeGalleryEntry('player-a-0001', 'Alice', 'red', makeClothing({ hue: 0.58 }), [aliceFace]),
      makeGalleryEntry('player-b-0002', 'Bob', 'blue', makeClothing({ hue: 0.0 }), [bobFace])
    ]
    const queryFace = new Array<number>(128).fill(0.5)
    const faceSimilarity = (_query: number[], enrolled: number[]): number =>
      enrolled[0] === 0.5 ? 0.9 : 0.1
    const result = matchIdentity(queryFace, target, gallery, 'self-player', faceSimilarity)
    expect(result?.playerId).toBe('player-a-0001')
    expect(result?.source === 'face' || result?.source === 'combined').toBe(true)
  })

  it('returns null when only an unenrolled/targetless scene is available', () => {
    const target = makeClothing({ hue: 0.25 })
    expect(matchIdentity(null, target, [], 'self-player', noFace)).toBeNull()
  })
})
