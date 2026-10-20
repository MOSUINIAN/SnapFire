import { WebSocketServer, WebSocket } from 'ws'
import { networkInterfaces } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { DEFAULT_PORT, PORT_ATTEMPTS, type HostInfo, type ServerMessage } from '../shared/types'
import { RoomEngine, type RoomEngineTransport } from '../core/roomEngine'

function getLanIps(): string[] {
  const result: string[] = []
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address)
    }
  }
  const rank = (ip: string): number => {
    if (ip.startsWith('192.168.')) return 0
    if (ip.startsWith('10.')) return 1
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2
    return 3
  }
  return result.sort((a, b) => rank(a) - rank(b))
}

function makeRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

/**
 * Electron transport adapter for the platform-independent RoomEngine.
 *
 * The adapter owns WebSocket sockets, port binding, LAN address discovery and
 * the room clock. All gameplay rules live in src/core/roomEngine.ts so the
 * Android host can reuse them through a native socket bridge.
 */
export class LanServer {
  private wss: WebSocketServer | null = null
  private port: number | null = null
  private roomCode = ''
  private hostToken = ''
  private engine: RoomEngine | null = null
  private readonly sockets = new Map<string, WebSocket>()
  private tickTimer: NodeJS.Timeout | null = null
  private stopTimer: NodeJS.Timeout | null = null

  private readonly transport: RoomEngineTransport = {
    send: (connectionId, message) => {
      const socket = this.sockets.get(connectionId)
      this.sendRaw(socket, message)
    },
    broadcast: (message) => {
      const wss = this.wss
      if (!wss) return
      const payload = JSON.stringify(message)
      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue
        try {
          client.send(payload)
        } catch {
          // ignore individual send failures
        }
      }
    },
    closeConnection: (connectionId, code, reason) => {
      const socket = this.sockets.get(connectionId)
      if (!socket) return
      try {
        socket.close(code, reason)
      } catch {
        // ignore
      }
    },
    requestStop: () => {
      if (this.stopTimer) return
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null
        void this.stop()
      }, 80)
    }
  }

  isRunning(): boolean {
    return this.wss !== null && this.engine !== null
  }

  getInfo(): HostInfo | null {
    if (!this.wss || this.port === null) return null
    return {
      port: this.port,
      roomCode: this.roomCode,
      lanIps: getLanIps(),
      hostToken: this.hostToken
    }
  }

  /**
   * Test-only hook used by the Electron smoke test to finish a match without
   * waiting for the real timer. It is never exposed to renderers unless the
   * main process was started with SNAPFIRE_TEST=1.
   */
  endMatchForTest(): void {
    this.engine?.endMatchForTest()
  }

  async start(startPort = DEFAULT_PORT): Promise<HostInfo> {
    if (this.wss && this.port !== null) {
      const existing = this.getInfo()
      if (existing) return existing
    }
    this.resetTransportState()
    const wss = await this.listenOnFreePort(startPort)
    this.wss = wss
    this.hostToken = randomBytes(16).toString('hex')
    this.roomCode = makeRoomCode()
    this.engine = new RoomEngine(this.transport, {
      roomCode: this.roomCode,
      hostToken: this.hostToken
    })
    this.tickTimer = setInterval(() => this.engine?.tick(), 100)

    wss.on('connection', (socket) => {
      const connectionId = randomUUID()
      this.sockets.set(connectionId, socket)
      socket.on('message', (raw) => this.engine?.handleRaw(connectionId, raw.toString()))
      socket.on('close', () => {
        this.sockets.delete(connectionId)
        this.engine?.handleClose(connectionId)
      })
      socket.on('error', (error) => {
        console.warn('[lan] socket error', error)
      })
    })
    wss.on('error', (error) => {
      console.error('[lan] server error', error)
    })

    console.log(`[lan] SnapFire room ${this.roomCode} listening on 0.0.0.0:${this.port}`)
    return this.getInfo() as HostInfo
  }

  async stop(): Promise<void> {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    const engine = this.engine
    this.engine = null
    const wss = this.wss
    this.wss = null
    if (wss) {
      for (const client of wss.clients) {
        try {
          client.close(1001, 'room closed')
        } catch {
          // ignore
        }
      }
      await new Promise<void>((resolve) => {
        wss.close(() => resolve())
      })
    }
    engine?.dispose()
    this.sockets.clear()
    this.port = null
    this.resetTransportState()
    console.log('[lan] server stopped')
  }

  private sendRaw(socket: WebSocket | undefined, message: ServerMessage): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // ignore individual send failures
    }
  }

  private resetTransportState(): void {
    this.hostToken = ''
    this.roomCode = ''
    this.sockets.clear()
  }

  private async listenOnFreePort(startPort: number): Promise<WebSocketServer> {
    let lastError: unknown = null
    for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
      const port = startPort + attempt
      try {
        const wss = await new Promise<WebSocketServer>((resolve, reject) => {
          const server = new WebSocketServer({
            host: '0.0.0.0',
            port,
            maxPayload: 2 * 1024 * 1024
          })
          const onError = (error: unknown) => {
            server.removeListener('listening', onListening)
            reject(error)
          }
          const onListening = () => {
            server.removeListener('error', onError)
            resolve(server)
          }
          server.once('error', onError)
          server.once('listening', onListening)
        })
        this.port = port
        return wss
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(
      `无法在 ${startPort}~${startPort + PORT_ATTEMPTS - 1} 端口启动房间服务：${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    )
  }
}
