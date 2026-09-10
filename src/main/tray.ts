import { Tray, Menu, nativeImage, app } from 'electron'
import icon from '../../resources/icon.png?asset'

/**
 * Tray icon (Windows/macOS): the overlay window is frameless, taskbar-less
 * and can be soft-hidden (transparent + offscreen). Without a tray there is
 * no way to recover it if global shortcuts fail to register (e.g. another
 * instance held them).
 */
let tray: Tray | null = null

export function createTray(showMainWindow: () => void): void {
  if (process.platform === 'linux') return
  if (tray) return

  const image = nativeImage.createFromPath(icon)
  const sized = image.isEmpty() ? image : image.resize({ width: 16, height: 16 })
  tray = new Tray(sized)
  tray.setToolTip('截屏解题助手')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showMainWindow() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  )
  tray.on('click', () => showMainWindow())
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
