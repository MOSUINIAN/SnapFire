import WebSocket from 'ws'
import type { ClientMessage, ServerMessage } from '@shared/types'

interface Waiter {
  match: (message: ServerMessage) => boolean
  resolve: (message: ServerMessage) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class TestClient {
  readonly ws: WebSocket
  private messages: ServerMessage[] = []
  private waiters: Waiter[] = []
  private readonly openPromise: Promise<void>

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.ws.once('open', () => resolve())
      this.ws.once('error', (error) => reject(error))
    })
    this.ws.on('message', (data) => {
      let message: ServerMessage
      try {
        message = JSON.parse(data.toString()) as ServerMessage
      } catch {
        return
      }
      this.messages.push(message)
      this.flush()
    })
    // Prevent unhandled 'error' events after the socket has opened; callers
    // observe failures through waitFor timeouts and close events.
    this.ws.on('error', () => undefined)
  }

  async waitForOpen(timeoutMs = 5000): Promise<void> {
    let timer: NodeJS.Timeout | null = null
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error('WebSocket open timeout')), timeoutMs)
    })
    try {
      await Promise.race([this.openPromise, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message))
  }

  async join(
    payload: Extract<ClientMessage, { type: 'join' }>
  ): Promise<Extract<ServerMessage, { type: 'welcome' }>> {
    await this.waitForOpen()
    this.send(payload)
    const message = await this.waitFor((candidate) => candidate.type === 'welcome')
    return message as Extract<ServerMessage, { type: 'welcome' }>
  }

  waitFor(
    match: (message: ServerMessage) => boolean,
    timeoutMs = 6000
  ): Promise<ServerMessage> {
    const existingIndex = this.messages.findIndex(match)
    if (existingIndex >= 0) {
      const [message] = this.messages.splice(existingIndex, 1)
      return Promise.resolve(message)
    }
    return new Promise<ServerMessage>((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter)
          reject(new Error('Timed out waiting for a server message'))
        }, timeoutMs)
      }
      this.waiters.push(waiter)
      this.flush()
    })
  }

  close(): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('Client closed'))
    }
    this.waiters = []
    try {
      this.ws.close()
    } catch {
      // ignore
    }
  }

  private flush(): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index]
      const messageIndex = this.messages.findIndex(waiter.match)
      if (messageIndex >= 0) {
        const [message] = this.messages.splice(messageIndex, 1)
        clearTimeout(waiter.timer)
        this.waiters.splice(index, 1)
        waiter.resolve(message)
      }
    }
  }
}
