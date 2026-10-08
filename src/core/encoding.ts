import c from 'compact-encoding'

/** Version of the event and signal formats below. See docs/PROTOCOL.md. */
export const PROTOCOL_VERSION = 1

export const EventType = {
  TEXT: 1,
  MEDIA: 2, // one or more images/videos (an album)
  FILE: 3, // one plain file
  EDIT: 4,
  DELETE: 5
} as const

/** What kind of thing an attachment is. Images and videos form albums. */
export const AttachmentKind = { IMAGE: 0, VIDEO: 1, FILE: 2 } as const

/** A reference to bytes in the author's blob log, plus what the recipient needs for an instant preview. */
export interface AttachmentRef {
  kind: number
  name: string
  mime: string
  size: number
  sha256: Buffer
  /** Where the bytes live in the author's blob log (a Hyperblobs id). */
  blockOffset: number
  blockLength: number
  byteOffset: number
  byteLength: number
  width: number
  height: number
  /** Video length in ms. 0 for everything else. */
  duration: number
  blurhash: string
  /** Small JPEG preview (poster frame for video). Empty for plain files. */
  thumb: Buffer
}

export type ChatEvent =
  | { version: number, type: typeof EventType.TEXT, timestamp: number, text: string }
  | { version: number, type: typeof EventType.MEDIA | typeof EventType.FILE, timestamp: number, text: string, items: AttachmentRef[] }
  | { version: number, type: typeof EventType.EDIT, timestamp: number, target: number, text: string }
  | { version: number, type: typeof EventType.DELETE, timestamp: number, target: number }
  | { version: number, type: number, timestamp: number, unknown: true }

const attachmentRef = {
  preencode (state: any, a: AttachmentRef) {
    c.uint.preencode(state, a.kind)
    c.string.preencode(state, a.name)
    c.string.preencode(state, a.mime)
    c.uint.preencode(state, a.size)
    c.fixed32.preencode(state, a.sha256)
    c.uint.preencode(state, a.blockOffset)
    c.uint.preencode(state, a.blockLength)
    c.uint.preencode(state, a.byteOffset)
    c.uint.preencode(state, a.byteLength)
    c.uint.preencode(state, a.width)
    c.uint.preencode(state, a.height)
    c.uint.preencode(state, a.duration)
    c.string.preencode(state, a.blurhash)
    c.buffer.preencode(state, a.thumb)
  },
  encode (state: any, a: AttachmentRef) {
    c.uint.encode(state, a.kind)
    c.string.encode(state, a.name)
    c.string.encode(state, a.mime)
    c.uint.encode(state, a.size)
    c.fixed32.encode(state, a.sha256)
    c.uint.encode(state, a.blockOffset)
    c.uint.encode(state, a.blockLength)
    c.uint.encode(state, a.byteOffset)
    c.uint.encode(state, a.byteLength)
    c.uint.encode(state, a.width)
    c.uint.encode(state, a.height)
    c.uint.encode(state, a.duration)
    c.string.encode(state, a.blurhash)
    c.buffer.encode(state, a.thumb)
  },
  decode (state: any): AttachmentRef {
    return {
      kind: c.uint.decode(state),
      name: c.string.decode(state),
      mime: c.string.decode(state),
      size: c.uint.decode(state),
      sha256: c.fixed32.decode(state),
      blockOffset: c.uint.decode(state),
      blockLength: c.uint.decode(state),
      byteOffset: c.uint.decode(state),
      byteLength: c.uint.decode(state),
      width: c.uint.decode(state),
      height: c.uint.decode(state),
      duration: c.uint.decode(state),
      blurhash: c.string.decode(state),
      thumb: c.buffer.decode(state) ?? Buffer.alloc(0)
    }
  }
}
const attachmentList = c.array(attachmentRef)
const hasItems = (t: number) => t === EventType.MEDIA || t === EventType.FILE

/** One block in a person's per-conversation Hypercore. */
export const chatEvent = {
  preencode (state: any, m: any) {
    c.uint.preencode(state, m.version)
    c.uint.preencode(state, m.type)
    c.uint.preencode(state, m.timestamp)
    if (m.type === EventType.EDIT || m.type === EventType.DELETE) c.uint.preencode(state, m.target)
    if (m.type === EventType.TEXT || m.type === EventType.EDIT || hasItems(m.type)) c.string.preencode(state, m.text)
    if (hasItems(m.type)) attachmentList.preencode(state, m.items)
  },
  encode (state: any, m: any) {
    c.uint.encode(state, m.version)
    c.uint.encode(state, m.type)
    c.uint.encode(state, m.timestamp)
    if (m.type === EventType.EDIT || m.type === EventType.DELETE) c.uint.encode(state, m.target)
    if (m.type === EventType.TEXT || m.type === EventType.EDIT || hasItems(m.type)) c.string.encode(state, m.text)
    if (hasItems(m.type)) attachmentList.encode(state, m.items)
  },
  decode (state: any): ChatEvent {
    const version = c.uint.decode(state)
    const type = c.uint.decode(state)
    const timestamp = c.uint.decode(state)
    switch (type) {
      case EventType.TEXT:
        return { version, type, timestamp, text: c.string.decode(state) }
      case EventType.MEDIA:
      case EventType.FILE: {
        const text = c.string.decode(state)
        return { version, type, timestamp, text, items: attachmentList.decode(state) }
      }
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

export interface Hello { coreKey: Buffer, blobsKey: Buffer, receivedLength: number, readLength: number, blobsLength: number }

/** First signal on every connection: my chat log and blob log, and how much of yours I have. */
export const hello = {
  preencode (state: any, m: Hello) {
    c.fixed32.preencode(state, m.coreKey)
    c.fixed32.preencode(state, m.blobsKey)
    c.uint.preencode(state, m.receivedLength)
    c.uint.preencode(state, m.readLength)
    c.uint.preencode(state, m.blobsLength)
  },
  encode (state: any, m: Hello) {
    c.fixed32.encode(state, m.coreKey)
    c.fixed32.encode(state, m.blobsKey)
    c.uint.encode(state, m.receivedLength)
    c.uint.encode(state, m.readLength)
    c.uint.encode(state, m.blobsLength)
  },
  decode (state: any): Hello {
    return {
      coreKey: c.fixed32.decode(state),
      blobsKey: c.fixed32.decode(state),
      receivedLength: c.uint.decode(state),
      readLength: c.uint.decode(state),
      blobsLength: c.uint.decode(state)
    }
  }
}

export const encode = (enc: any, m: any): Buffer => c.encode(enc, m)
export const decode = <T>(enc: any, buf: Buffer): T => c.decode(enc, buf)
export { c }
