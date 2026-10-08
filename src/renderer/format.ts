import type { Contact } from '../shared/api.ts'

export function time (ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function connection (c: Contact) {
  if (c.presence.status === 'online') return c.presence.via === 'relay' ? 'Connected via relay' : 'Connected · direct'
  return c.presence.lastSeen ? 'Offline: last seen ' + new Date(c.presence.lastSeen).toLocaleString() : 'Offline'
}
