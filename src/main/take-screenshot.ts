import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { desktopCapturer, screen } from 'electron'

const execFileAsync = promisify(execFile)

/**
 * desktopCapturer can hang indefinitely or resolve with empty thumbnails when
 * another client (proctoring / meeting / security software) blocks screen
 * capture (issue #4). Bound each attempt with a timeout, retry, and fall back
 * to an OS-level capture command before surfacing an error.
 */
const CAPTURE_TIMEOUT_MS = 3000
const CAPTURE_ATTEMPTS = 2
const RETRY_DELAY_MS = 300
const FALLBACK_TIMEOUT_MS = 8000
const FALLBACK_MAX_BUFFER = 64 * 1024 * 1024

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} (${ms}ms)`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function isMeaningfulError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

async function captureViaDesktopCapturer(): Promise<string> {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size

  let lastError: unknown
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt++) {
    try {
      const sources = await withTimeout(
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } }),
        CAPTURE_TIMEOUT_MS,
        'desktopCapturer.getSources 超时'
      )
      // Prefer the source matching the primary display; fall back to the first
      const source =
        sources.find((s) => s.display_id && s.display_id === String(primaryDisplay.id)) ??
        sources[0]
      if (!source) throw new Error('没有可用的屏幕采集源')
      // Blocked captures resolve with an empty thumbnail instead of failing
      if (source.thumbnail.isEmpty()) throw new Error('屏幕采集返回了空画面')
      return source.thumbnail.toPNG().toString('base64')
    } catch (error) {
      lastError = error
      console.warn(
        `[screenshot] desktopCapturer attempt ${attempt}/${CAPTURE_ATTEMPTS} failed:`,
        isMeaningfulError(error).message
      )
      if (attempt < CAPTURE_ATTEMPTS) await delay(RETRY_DELAY_MS)
    }
  }
  throw lastError
}

// GDI capture in a child process: still works when DXGI desktop duplication
// (used by desktopCapturer) is blocked by anti-capture clients on Windows.
// The DPI-aware flag is required to get physical pixel bounds on scaled displays.
const WINDOWS_GDI_SCRIPT = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -Name Native -Namespace Snap
[Snap.Native]::SetProcessDPIAware() | Out-Null
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save([Console]::OpenStandardOutput(), [System.Drawing.Imaging.ImageFormat]::Png)
`

function assertPngData(data: Buffer, label: string): void {
  // Guard against non-image output (e.g. script errors printed to stdout)
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]
  if (!data || data.length < 8 || !PNG_SIGNATURE.every((byte, i) => data[i] === byte)) {
    throw new Error(`${label}没有返回有效画面`)
  }
}

async function captureViaWindowsGdi(): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_GDI_SCRIPT],
    {
      encoding: 'buffer',
      maxBuffer: FALLBACK_MAX_BUFFER,
      timeout: FALLBACK_TIMEOUT_MS,
      windowsHide: true
    }
  )
  assertPngData(stdout, '备用截屏（GDI）')
  return stdout.toString('base64')
}

// screencapture CLI: same TCC screen-recording permission as the app itself,
// and still excludes windows protected via setContentProtection.
async function captureViaMacScreencapture(): Promise<string> {
  const outPath = join(tmpdir(), `snanswer-capture-${Date.now()}.png`)
  try {
    await execFileAsync('/usr/sbin/screencapture', ['-x', '-m', '-t', 'png', outPath], {
      timeout: FALLBACK_TIMEOUT_MS
    })
    const data = await readFile(outPath)
    assertPngData(data, '备用截屏（screencapture）')
    return data.toString('base64')
  } finally {
    rm(outPath, { force: true }).catch(() => {})
  }
}

function formatCaptureFailure(cause: unknown): Error {
  return new Error(
    `截屏失败：屏幕采集可能被其他客户端占用或阻止（已自动重试并尝试备用截屏方式）。` +
      `请退出可能拦截屏幕采集的客户端（如监考、安全或会议软件）后重试，` +
      `或开启「手机显示模式」改用手机端截屏。原因：${isMeaningfulError(cause).message}`
  )
}

async function captureScreenshot(): Promise<string> {
  try {
    return await captureViaDesktopCapturer()
  } catch (primaryError) {
    console.warn(
      '[screenshot] desktopCapturer failed, trying OS fallback:',
      isMeaningfulError(primaryError).message
    )
    try {
      if (process.platform === 'win32') return await captureViaWindowsGdi()
      if (process.platform === 'darwin') return await captureViaMacScreencapture()
      throw primaryError
    } catch (fallbackError) {
      console.error('[screenshot] OS fallback failed:', isMeaningfulError(fallbackError).message)
      throw formatCaptureFailure(primaryError)
    }
  }
}

// Deduplicate concurrent captures: repeated shortcut presses while a blocked
// capture is retrying share the same in-flight promise instead of piling up.
let inFlightCapture: Promise<string> | null = null

export function takeScreenshot(): Promise<string | void> {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve()
  if (!inFlightCapture) {
    inFlightCapture = captureScreenshot().finally(() => {
      inFlightCapture = null
    })
  }
  return inFlightCapture
}
