export const isMac = navigator.userAgent.includes('Mac')
export const isWindows = navigator.userAgent.includes('Windows')

/** Alt on macOS, CommandOrControl (i.e. Ctrl) on Windows/Linux */
export const platformAlt = isMac ? 'Alt' : 'CommandOrControl'
