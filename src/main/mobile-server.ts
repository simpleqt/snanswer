import { readFileSync } from 'node:fs'
import http from 'node:http'
import { networkInterfaces } from 'node:os'
import { ipcMain } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import mobileHtmlPath from '../../resources/mobile/index.html?asset'
import markedJsPath from '../../resources/mobile/marked.min.js?asset'
import { settings, registerSettingsChangeHook } from './settings'
import { state, registerAppStateHook } from './state'
import type { MobileSolutionEvent, MobileServerInfo, MobileController } from './mobile-types'

/**
 * LAN mobile display server: serves the phone page over HTTP and mirrors the
 * solution event stream to connected phones via WebSocket. The desktop
 * renderer keeps receiving the same events over IPC, so both displays stay
 * in sync; hiding the desktop window does not affect this module.
 */

export type { MobileSolutionEvent, MobileServerInfo, MobileController } from './mobile-types'

interface SessionSnapshot {
  screenshots: string[]
  solutionText: string
  isLoading: boolean
  errorMessage: string | null
}

const emptySnapshot = (): SessionSnapshot => ({
  screenshots: [],
  solutionText: '',
  isLoading: false,
  errorMessage: null
})

let httpServer: http.Server | null = null
let wss: WebSocketServer | null = null
let controller: MobileController | null = null
const clients = new Set<WebSocket>()
let running = false
let currentPort = 0
let currentToken = ''
let serverError: string | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let snapshot: SessionSnapshot = emptySnapshot()

function sendToRenderer(channel: string, ...args: unknown[]) {
  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

/**
 * Rank a LAN IPv4 address for the phone QR code / URL list (issue #6).
 * Lower rank = shown/encoded first:
 *   0 — RFC 1918 private (10/8, 172.16/12, 192.168/16): reachable on real Wi-Fi
 *   1 — other unicast (public IPs etc.)
 *   2 — 100.64/10 CGNAT (Tailscale & co.): only usable by devices in the same
 *        virtual network, so keep them listed but never first
 *   3 — 169.254/16 link-local (APIPA): never routable to the phone, last resort
 */
function lanAddressRank(address: string): number {
  const [a = -1, b = -1] = address.split('.').map(Number)
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 0
  if (a === 100 && b >= 64 && b <= 127) return 2
  if (a === 169 && b === 254) return 3
  return 1
}

function getLanUrls(port: number): string[] {
  const entries: { url: string; rank: number }[] = []
  for (const nics of Object.values(networkInterfaces())) {
    for (const nic of nics ?? []) {
      if (nic.family === 'IPv4' && !nic.internal) {
        entries.push({ url: `http://${nic.address}:${port}`, rank: lanAddressRank(nic.address) })
      }
    }
  }
  // Stable sort keeps enumeration order within the same rank
  return entries.sort((x, y) => x.rank - y.rank).map((entry) => entry.url)
}

export function getMobileServerInfo(): MobileServerInfo {
  return {
    running,
    port: currentPort,
    token: currentToken,
    urls: running ? getLanUrls(currentPort) : [],
    clientCount: clients.size,
    error: serverError
  }
}

function pushStatus() {
  sendToRenderer('mobile-server-status', getMobileServerInfo())
}

export function setMobileController(c: MobileController) {
  controller = c
}

/** Extra init payload for phones connecting mid-session (interview assistant etc.) */
const initExtraProviders: (() => Record<string, unknown>)[] = []

export function setMobileInitExtra(provider: () => Record<string, unknown>): void {
  initExtraProviders.push(provider)
}

function collectInitExtra(): Record<string, unknown> {
  return initExtraProviders.reduce<Record<string, unknown>>(
    (extra, provider) => ({ ...extra, ...provider() }),
    {}
  )
}

// Static assets are read once and cached in memory.
let mobileHtmlCache: string | null = null
let markedJsCache: Buffer | null = null

function readMobilePage(): string {
  if (mobileHtmlCache === null) {
    mobileHtmlCache = readFileSync(mobileHtmlPath, 'utf-8')
  }
  return mobileHtmlCache
}

function readMarkedJs(): Buffer {
  if (markedJsCache === null) {
    markedJsCache = readFileSync(markedJsPath)
  }
  return markedJsCache
}

export function broadcastToMobile(type: string, payload?: unknown) {
  if (!wss) return
  const message = JSON.stringify({ type, payload: payload ?? null })
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  }
}

/**
 * Mirror a solution event to phones while keeping a snapshot so clients that
 * connect mid-stream can catch up via the `init` message.
 */
export function emitSolutionEvent(channel: MobileSolutionEvent, payload?: unknown) {
  switch (channel) {
    case 'solution-clear':
      snapshot = emptySnapshot()
      break
    case 'screenshots-updated':
      snapshot.screenshots = (payload as string[]) ?? []
      break
    case 'ai-loading-start':
      snapshot.isLoading = true
      snapshot.errorMessage = null
      break
    case 'ai-loading-end':
      snapshot.isLoading = false
      break
    case 'solution-chunk':
      snapshot.solutionText += (payload as string) ?? ''
      break
    case 'solution-error':
      snapshot.errorMessage = (payload as string) ?? '未知错误'
      break
    default:
      break
  }
  broadcastToMobile(channel, payload)
}

function handleClientMessage(ws: WebSocket, data: WebSocket.RawData) {
  let msg: { type?: string; payload?: { question?: string } }
  try {
    msg = JSON.parse(data.toString())
  } catch {
    return
  }
  switch (msg.type) {
    case 'stop-stream':
      controller?.stopStream()
      break
    case 'follow-up': {
      const question = (msg.payload?.question ?? '').trim()
      if (!question) return
      controller
        ?.sendFollowUp(question)
        .then((result) => {
          ws.send(JSON.stringify({ type: 'follow-up-result', payload: result }))
        })
        .catch(() => {
          ws.send(
            JSON.stringify({
              type: 'follow-up-result',
              payload: { success: false, error: '请求失败' }
            })
          )
        })
      break
    }
    case 'show-window':
      controller?.showMainWindow()
      break
    case 'toggle-window':
      controller?.toggleMainWindow()
      break
    case 'take-screenshot':
      // Phone-initiated capture: desktopCapturer needs no desktop input, so
      // no keyboard events that proctoring software could detect
      controller?.takeScreenshot()
      break
    case 'append-screenshot':
      controller?.appendScreenshot()
      break
    case 'toggle-thinking': {
      settings.enableThinking = !settings.enableThinking
      // Keep the renderer store in sync too, or its next settings push would
      // silently revert the phone's toggle
      sendToRenderer('thinking-state', { enabled: settings.enableThinking })
      broadcastToMobile('thinking-state', { enabled: settings.enableThinking })
      break
    }
    case 'switch-scene':
      // Scene data lives in the renderer store; it cycles the scene and
      // pushes the new activeSceneId back, which triggers the broadcast below
      sendToRenderer('switch-prompt-scene')
      break
    case 'toggle-interview-assistant':
      controller?.toggleInterviewAssistant()
      break
    case 'toggle-double-click':
      controller?.cycleClickCaptureMode()
      break
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }))
      break
  }
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.ping()
      }
    }
  }, 30000)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

export async function startMobileServer(port: number, token: string): Promise<void> {
  if (running && currentPort === port && currentToken === token) return

  const safePort = Math.trunc(port)
  if (!Number.isInteger(safePort) || safePort < 1024 || safePort > 65535) {
    serverError = `端口无效：${port}（需在 1024-65535 之间）`
    pushStatus()
    return
  }

  // Restart path: tear down the previous server without touching the window
  stopMobileServer({ showWindow: false })
  serverError = null

  const server = http.createServer((req, res) => {
    const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '/'
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      })
      res.end(readMobilePage())
    } else if (req.method === 'GET' && pathname === '/marked.min.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache'
      })
      res.end(readMarkedJs())
    } else if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
    }
  })

  const socketServer = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (!currentTokenIs(url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    socketServer.handleUpgrade(req, socket, head, (ws) => {
      socketServer.emit('connection', ws, req)
    })
  })

  socketServer.on('connection', (ws: WebSocket) => {
    clients.add(ws)
    ws.send(
      JSON.stringify({
        type: 'init',
        payload: {
          ...snapshot,
          enableThinking: settings.enableThinking,
          sceneName: getCurrentSceneName(),
          clickCapture: { mode: settings.clickCaptureMode },
          ...collectInitExtra()
        }
      })
    )
    pushStatus()
    ws.on('message', (data) => handleClientMessage(ws, data))
    ws.on('close', () => {
      clients.delete(ws)
      pushStatus()
    })
    ws.on('error', () => {
      /* close event follows */
    })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(safePort, '0.0.0.0', () => resolve())
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    server.close()
    socketServer.close()
    serverError = `端口 ${safePort} 监听失败（${message}），请检查端口是否被占用`
    console.error('Mobile server failed to start:', error)
    pushStatus()
    return
  }

  // Prevent a later runtime socket error from crashing the process
  server.on('error', (error) => {
    console.error('Mobile server error:', error)
  })

  httpServer = server
  wss = socketServer
  running = true
  currentPort = safePort
  currentToken = token
  startHeartbeat()
  pushStatus()

  // Mobile display mode takes over only on the coder page; while the user is
  // in settings (scanning the QR code) the desktop window stays visible
  if (state.inCoderPage) {
    controller?.hideMainWindow()
  }
}

function currentTokenIs(candidate: string | null): boolean {
  return !!currentToken && candidate === currentToken
}

export function stopMobileServer(options: { showWindow?: boolean } = {}): void {
  const showWindow = options.showWindow !== false
  stopHeartbeat()

  if (wss) {
    for (const client of clients) {
      client.terminate()
    }
    wss.close()
    wss = null
  }
  if (httpServer) {
    const server = httpServer
    httpServer = null
    server.closeAllConnections?.()
    server.close(() => {})
  }
  clients.clear()

  const wasRunning = running
  running = false
  currentPort = 0
  currentToken = ''
  serverError = null
  snapshot = emptySnapshot()

  if (wasRunning) {
    pushStatus()
    if (showWindow) {
      controller?.showMainWindow()
    }
  }
}

ipcMain.handle('getMobileServerInfo', () => getMobileServerInfo())

/** Scene names live in the renderer store and arrive via settings sync (runtime fields) */
function getCurrentSceneName(): string {
  const s = settings as typeof settings & {
    scenes?: { id: string; name: string }[]
    activeSceneId?: string
  }
  return s.scenes?.find((scene) => scene.id === s.activeSceneId)?.name ?? ''
}

/** Start/stop/restart the LAN mobile server according to current settings. */
function syncMobileServer(): void {
  if (settings.mobileDisplayEnabled) {
    startMobileServer(settings.mobileServerPort, settings.mobilePairingToken).catch((error) => {
      console.error('Failed to sync mobile server:', error)
    })
  } else {
    stopMobileServer()
  }
}

registerSettingsChangeHook((changed) => {
  if (
    'mobileDisplayEnabled' in changed ||
    'mobileServerPort' in changed ||
    'mobilePairingToken' in changed
  ) {
    syncMobileServer()
  }
})

// Mirror the active prompt scene to phones whenever the renderer pushes one
registerSettingsChangeHook((changed) => {
  if ('activeSceneId' in changed) {
    broadcastToMobile('scene-state', { sceneName: getCurrentSceneName() })
  }
})

// Mirror helper toggles (click capture etc.) to phones and the renderer
registerSettingsChangeHook((changed) => {
  if ('clickCaptureMode' in changed) {
    sendToRenderer('double-click-state', { mode: settings.clickCaptureMode })
    broadcastToMobile('double-click-state', { mode: settings.clickCaptureMode })
  }
})

// Entering the coder page with mobile mode on hands the display over to the
// phone: the overlay hides itself so only the phone shows the solution.
registerAppStateHook((changed) => {
  if (changed.inCoderPage === true && settings.mobileDisplayEnabled) {
    controller?.hideMainWindow()
  }
})
