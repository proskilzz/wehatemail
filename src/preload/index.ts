import { contextBridge, ipcRenderer } from 'electron'
import type { WhmApi, EngineEvent } from '../shared/api.ts'

const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke('whm:' + name, ...args)

const api: WhmApi = {
  init: () => call('init'),
  completeSetup: name => call('completeSetup', name),
  updateSettings: patch => call('updateSettings', patch),
  contacts: () => call('contacts'),
  messages: id => call('messages', id),
  send: (id, text) => call('send', id, text),
  markRead: id => call('markRead', id),
  setTyping: (id, typing) => call('setTyping', id, typing),
  setVerified: (id, verified) => call('setVerified', id, verified),
  createInvite: () => call('createInvite'),
  revokeInvite: id => call('revokeInvite', id),
  listInvites: () => call('listInvites'),
  acceptInvite: input => call('acceptInvite', input),
  copy: text => call('copy', text),
  onEvent: fn => {
    const handler = (_: unknown, e: EngineEvent) => fn(e)
    ipcRenderer.on('whm:event', handler)
    return () => { ipcRenderer.off('whm:event', handler) }
  }
}

contextBridge.exposeInMainWorld('whm', api)
