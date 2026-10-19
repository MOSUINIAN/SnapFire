import { describe, expect, it } from 'vitest'
import { DEFAULT_PORT } from '@shared/types'
import { normalizeHostAddress } from '@renderer/net/NetClient'

describe('normalizeHostAddress', () => {
  it('adds the ws scheme and default port to a bare IP', () => {
    expect(normalizeHostAddress('192.168.1.5')).toBe(`ws://192.168.1.5:${DEFAULT_PORT}`)
  })

  it('keeps an explicit port', () => {
    expect(normalizeHostAddress('192.168.1.5:18888')).toBe('ws://192.168.1.5:18888')
  })

  it('maps HTTP URLs to ws and strips paths', () => {
    expect(normalizeHostAddress('http://192.168.1.5:18888/lobby')).toBe(
      'ws://192.168.1.5:18888'
    )
  })

  it('maps HTTPS URLs to wss', () => {
    expect(normalizeHostAddress('https://snapfire.local')).toBe(
      `wss://snapfire.local:${DEFAULT_PORT}`
    )
  })

  it('rejects empty input', () => {
    expect(() => normalizeHostAddress('   ')).toThrow('请输入房主电脑的地址')
  })

  it('rejects malformed input', () => {
    expect(() => normalizeHostAddress('::::')).toThrow()
  })
})
