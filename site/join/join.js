// Logic for the join page. Plain ES module so the browser and the tests both load it.
// The invite lives after the # in the address, so it is never sent to any server.

export const RELEASES = 'https://github.com/proskilzz/wehatemail/releases/latest'

/** "mac" | "windows" | "linux" | "mobile" | "other" from the browser's platform strings. */
export function detectOS (platform = '', userAgent = '') {
  const p = (platform + ' ' + userAgent).toLowerCase()
  if (/android|iphone|ipad|ipod/.test(p)) return 'mobile'
  if (/mac/.test(p)) return 'mac'
  if (/win/.test(p)) return 'windows'
  if (/linux|x11|cros/.test(p)) return 'linux'
  return 'other'
}

/** The invite code from "#<code>" (letters and digits only), or null. */
export function inviteFromHash (hash = '') {
  const code = hash.replace(/^#/, '').trim()
  return /^[a-z0-9]{10,200}$/i.test(code) ? code : null
}

export const appLink = code => 'wehatemail://join/' + code

export const DOWNLOADS = {
  mac: { label: 'Download for macOS', file: '.dmg', how: 'Open the .dmg and drag We Hate Mail to Applications. The first time, right-click the app and choose Open, then Open again. macOS warns because the app is not signed yet.' },
  windows: { label: 'Download for Windows', file: '.exe', how: 'Run the installer. If Windows SmartScreen says "Windows protected your PC", click More info, then Run anyway. It warns because the app is not signed yet.' },
  linux: { label: 'Download for Linux', file: '.AppImage or .deb', how: 'Download the .AppImage, make it executable (chmod +x), and run it. Or install the .deb with your package manager.' }
}
