import path from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron'
import { Engine, SafeStorageSecretStore } from '../core/index.ts'
import { SettingsFile } from './settings.ts'
import type { InitState, Settings } from '../shared/api.ts'

let win: BrowserWindow | null = null
let engine: Engine | null = null

function send (channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function forward (e: Engine) {
  e.on('contact', contact => send('whm:event', { type: 'contact', contact }))
  e.on('presence', id => send('whm:event', { type: 'presence', id }))
  e.on('message', (id, message) => send('whm:event', { type: 'message', id, message }))
  e.on('update', id => send('whm:event', { type: 'update', id }))
  e.on('status', id => send('whm:event', { type: 'status', id }))
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

  const snapshot = (): InitState => ({
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
  handle('markRead', (id: unknown) => eng.markRead(str(id)))
  handle('setTyping', (id: unknown, typing: unknown) => eng.setTyping(str(id), typing === true))
  handle('setVerified', (id: unknown, v: unknown) => eng.setVerified(str(id), v === true))
  handle('createInvite', () => eng.createInvite())
  handle('revokeInvite', (id: unknown) => eng.revokeInvite(str(id)))
  handle('listInvites', () => eng.listInvites())
  handle('acceptInvite', (input: unknown) => eng.acceptInvite(str(input), { timeout: 60000 }))
  handle('copy', (text: unknown) => clipboard.writeText(str(text)))
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
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

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
