import path from 'node:path'
import { Readable } from 'node:stream'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, protocol, safeStorage, shell } from 'electron'
import { Engine, SafeStorageSecretStore, findInviteLink } from '../core/index.ts'
import { SettingsFile } from './settings.ts'
import type { InitState, SendFile, Settings } from '../shared/api.ts'

// whm-media://<contact id>/<message id>/<attachment index>: finished files, for <img>, <video> and downloads.
protocol.registerSchemesAsPrivileged([
  { scheme: 'whm-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

// wehatemail://join/<code> links: the OS starts (or tells) the app, we hand the link to the
// window, which shows it in the connect box for the person to confirm.
let pendingLink: string | null = null
let rendererReady = false

function deliverLink (link: string | null) {
  if (!link) return
  pendingLink = link
  if (rendererReady) send('whm:event', { type: 'link', input: link })
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}

let win: BrowserWindow | null = null
let engine: Engine | null = null

function send (channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function forward (e: Engine) {
  e.on('contact', (contact, joined) => {
    send('whm:event', { type: 'contact', contact, joined: joined === true })
    // Someone used my invite while the window is in the background.
    if (joined && win && !win.isFocused() && Notification.isSupported()) {
      new Notification({ title: 'We Hate Mail', body: `${contact.name} joined using your invite` }).show()
    }
  })
  e.on('presence', id => send('whm:event', { type: 'presence', id }))
  e.on('message', (id, message) => send('whm:event', { type: 'message', id, message }))
  e.on('update', id => send('whm:event', { type: 'update', id }))
  e.on('status', id => send('whm:event', { type: 'status', id }))
  e.on('transfer', id => send('whm:event', { type: 'transfer', id }))
  e.on('typing', (id, typing) => send('whm:event', { type: 'typing', id, typing }))
  e.on('invites', () => send('whm:event', { type: 'invites' }))
  e.on('warning', (id, text) => send('whm:event', { type: 'warning', id, text }))
}

async function start () {
  const data = app.getPath('userData')
  const settings = new SettingsFile(path.join(data, 'settings.json'))
  await settings.load()

  engine = new Engine({
    storage: path.join(data, 'engine'),
    secrets: new SafeStorageSecretStore(path.join(data, 'secrets.bin'), safeStorage)
  })
  const eng = engine
  await eng.ready()
  forward(eng)

  serveMedia(eng)

  const snapshot = (): InitState => ({
    id: eng.id,
    name: eng.name,
    settings: settings.get(),
    contacts: eng.contacts(),
    invites: eng.listInvites()
  })
  const handle = (name: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle('whm:' + name, (_e, ...args) => fn(...args))
  }
  const str = (v: unknown) => {
    if (typeof v !== 'string') throw new Error('Bad request')
    return v
  }

  handle('init', snapshot)
  handle('completeSetup', async (name: unknown) => {
    await eng.setName(str(name))
    await settings.update({ acknowledged: true })
    return snapshot()
  })
  handle('updateSettings', (patch: Partial<Settings>) => settings.update(patch))
  handle('contacts', () => eng.contacts())
  handle('messages', (id: unknown) => eng.messages(str(id)))
  handle('send', (id: unknown, text: unknown) => eng.sendText(str(id), str(text)))
  handle('sendFiles', (id: unknown, files: unknown, text: unknown) => eng.sendFiles(str(id), cleanFiles(files), typeof text === 'string' ? text : ''))
  handle('transfers', (id: unknown) => eng.transfers(str(id)))
  handle('retryTransfer', (id: unknown, messageId: unknown, index: unknown) => eng.retryTransfer(str(id), str(messageId), Number(index)))
  handle('saveAttachment', async (id: unknown, messageId: unknown, index: unknown, name: unknown) => {
    const chosen = await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath('downloads'), path.basename(str(name))) })
    if (chosen.canceled || !chosen.filePath) return false
    await eng.saveAttachment(str(id), str(messageId), Number(index), chosen.filePath)
    return true
  })
  handle('markRead', (id: unknown) => eng.markRead(str(id)))
  handle('setTyping', (id: unknown, typing: unknown) => eng.setTyping(str(id), typing === true))
  handle('setVerified', (id: unknown, v: unknown) => eng.setVerified(str(id), v === true))
  handle('createInvite', () => eng.createInvite())
  handle('revokeInvite', (id: unknown) => eng.revokeInvite(str(id)))
  handle('listInvites', () => eng.listInvites())
  handle('acceptInvite', (input: unknown) => eng.acceptInvite(str(input), { timeout: 60000 }))
  handle('copy', (text: unknown) => clipboard.writeText(str(text)))
  handle('takeLink', () => {
    rendererReady = true
    const link = pendingLink
    pendingLink = null
    return link
  })
}

/** Validate what the renderer sends before it reaches the file system. */
function cleanFiles (files: unknown): (SendFile)[] {
  if (!Array.isArray(files)) throw new Error('Bad request')
  return files.map((f: any) => {
    if (typeof f?.path !== 'string' || !path.isAbsolute(f.path) || typeof f.mime !== 'string') throw new Error('Bad request')
    return { path: f.path, name: typeof f.name === 'string' ? f.name : path.basename(f.path), mime: f.mime, preview: f.preview, clean: f.clean === true }
  })
}

function serveMedia (eng: Engine) {
  protocol.handle('whm-media', async request => {
    try {
      const url = new URL(request.url)
      const [messageId, index] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const contactId = url.hostname
      const att = eng.attachmentInfo(contactId, messageId, Number(index))
      // Only allowlisted image/video types whose bytes match are shown inline. Anything
      // else is a generic, download-only file that the browser must not sniff or render.
      const serving = await eng.attachmentServing(contactId, messageId, Number(index))
      const headers: Record<string, string> = {
        'Content-Type': serving.mime,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Accept-Ranges': 'bytes'
      }
      if (!serving.inline) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`
      // Video needs byte ranges to seek.
      const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
      let start: number | undefined
      let end: number | undefined
      if (m && att.size > 0) {
        start = m[1] ? Number(m[1]) : Math.max(0, att.size - Number(m[2]))
        end = m[1] && m[2] ? Math.min(Number(m[2]), att.size - 1) : att.size - 1
        if (!m[1] && !m[2] || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${att.size}` } })
        headers['Content-Range'] = `bytes ${start}-${end}/${att.size}`
      }
      const body = Readable.toWeb(Readable.from(eng.readAttachment(contactId, messageId, Number(index), { start, end }))) as ReadableStream
      headers['Content-Length'] = String(start === undefined ? att.size : end! - start + 1)
      return new Response(body, { status: start === undefined ? 200 : 206, headers })
    } catch {
      return new Response('Not ready', { status: 404 })
    }
  })
}

function createWindow () {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0b0d10',
    title: 'We Hate Mail',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)
  // Never navigate the app window away, and open links in the real browser.
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) win.loadURL(dev)
  else win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Windows and Linux start a second copy with the link in its arguments; macOS uses open-url.
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    deliverLink(findInviteLink(argv))
  })
  app.on('open-url', (e, url) => {
    e.preventDefault()
    deliverLink(findInviteLink([url]))
  })

  // In dev (`npm run dev`) Electron is the default app, so the OS needs the script path too.
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient('wehatemail', process.execPath, [path.resolve(process.argv[1])])
  else app.setAsDefaultProtocolClient('wehatemail')
  pendingLink = findInviteLink(process.argv)

  app.whenReady().then(async () => {
    try {
      await start()
    } catch (err: any) {
      dialog.showErrorBox('We Hate Mail could not start', String(err?.message ?? err))
      app.quit()
      return
    }
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())

  let closing = false
  app.on('before-quit', e => {
    if (closing || !engine) return
    e.preventDefault()
    closing = true
    engine.close().catch(() => {}).finally(() => app.quit())
  })
}
