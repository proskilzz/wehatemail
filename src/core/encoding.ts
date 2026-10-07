import c from 'compact-encoding'

/** Version of the event and signal formats below. See docs/PROTOCOL.md. */
export const PROTOCOL_VERSION = 1

export const EventType = {
  TEXT: 1,
  MEDIA: 2, // M3
  FILE: 3, // M3
  EDIT: 4,
  DELETE: 5
} as const

export type ChatEvent =
  | { version: number, type: typeof EventType.TEXT, timestamp: number, text: string }
  | { version: number, type: typeof EventType.EDIT, timestamp: number, target: number, text: string }
  | { version: number, type: typeof EventType.DELETE, timestamp: number, target: number }
  | { version: number, type: number, timestamp: number, unknown: true }

/** One block in a person's per-conversation Hypercore. */
export const chatEvent = {
  preencode (state: any, m: any) {
    c.uint.preencode(state, m.version)
    c.uint.preencode(state, m.type)
    c.uint.preencode(state, m.timestamp)
    if (m.type === EventType.EDIT || m.type === EventType.DELETE) c.uint.preencode(state, m.target)
    if (m.type === EventType.TEXT || m.type === EventType.EDIT) c.string.preencode(state, m.text)
  },
  encode (state: any, m: any) {
    c.uint.encode(state, m.version)
    c.uint.encode(state, m.type)
    c.uint.encode(state, m.timestamp)
    if (m.type === EventType.EDIT || m.type === EventType.DELETE) c.uint.encode(state, m.target)
    if (m.type === EventType.TEXT || m.type === EventType.EDIT) c.string.encode(state, m.text)
  },
  decode (state: any): ChatEvent {
    const version = c.uint.decode(state)
    const type = c.uint.decode(state)
    const timestamp = c.uint.decode(state)
    switch (type) {
      case EventType.TEXT:
        return { version, type, timestamp, text: c.string.decode(state) }
      case EventType.EDIT: {
        const target = c.uint.decode(state)
        return { version, type, timestamp, target, text: c.string.decode(state) }
      }
      case EventType.DELETE:
        return { version, type, timestamp, target: c.uint.decode(state) }
      default:
        // Newer event types are kept (so seq numbers line up) but not shown.
        state.start = state.end
        return { version, type, timestamp, unknown: true }
    }
  }
}

export interface PeerInfo { version: number, publicKey: Buffer, name: string }

/** What each side sends the other during pairing. */
export const peerInfo = {
  preencode (state: any, m: PeerInfo) {
    c.uint.preencode(state, m.version)
    c.fixed32.preencode(state, m.publicKey)
    c.string.preencode(state, m.name)
  },
  encode (state: any, m: PeerInfo) {
    c.uint.encode(state, m.version)
    c.fixed32.encode(state, m.publicKey)
    c.string.encode(state, m.name)
  },
  decode (state: any): PeerInfo {
    return {
      version: c.uint.decode(state),
      publicKey: c.fixed32.decode(state),
      name: c.string.decode(state)
    }
  }
}

export interface Hello { coreKey: Buffer, receivedLength: number, readLength: number }

/** First signal on every connection: my log for our chat, and how much of yours I have. */
export const hello = {
  preencode (state: any, m: Hello) {
    c.fixed32.preencode(state, m.coreKey)
    c.uint.preencode(state, m.receivedLength)
    c.uint.preencode(state, m.readLength)
  },
  encode (state: any, m: Hello) {
    c.fixed32.encode(state, m.coreKey)
    c.uint.encode(state, m.receivedLength)
    c.uint.encode(state, m.readLength)
  },
  decode (state: any): Hello {
    return {
      coreKey: c.fixed32.decode(state),
      receivedLength: c.uint.decode(state),
      readLength: c.uint.decode(state)
    }
  }
}

export const encode = (enc: any, m: any): Buffer => c.encode(enc, m)
export const decode = <T>(enc: any, buf: Buffer): T => c.decode(enc, buf)
export { c }
