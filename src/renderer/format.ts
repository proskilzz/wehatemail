import type { Contact } from '../shared/api.ts'

export function time (ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Short name of the network path: "same network", "internet" or "relay". */
export function pathLabel (path: 'lan' | 'internet' | 'relay' | null) {
  return path === 'lan' ? 'direct · same network' : path === 'internet' ? 'direct · internet' : path === 'relay' ? 'via relay' : 'direct'
}

export function connection (c: Contact) {
  if (c.presence.status === 'online') return c.presence.via === 'relay' ? 'Connected via relay' : 'Connected · ' + pathLabel(c.presence.path)
  return c.presence.lastSeen ? 'Offline: last seen ' + new Date(c.presence.lastSeen).toLocaleString() : 'Offline'
}
