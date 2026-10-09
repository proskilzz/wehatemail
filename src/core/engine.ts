import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Hyperswarm from 'hyperswarm'
import HyperDHT from 'hyperdht'
import Corestore from 'corestore'
import Hyperblobs from 'hyperblobs'
import { DOWNLOAD_TYPE, isInlineType, servedType } from './media-type.ts'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import Protomux from 'protomux'
import BlindPairing from 'blind-pairing'
import { createInvite, decodeInvite } from 'blind-pairing-core'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import type { SecretStore } from './secrets.ts'
import {
  PROTOCOL_VERSION, EventType, AttachmentKind, chatEvent, peerInfo, hello, encode, decode, c,
  type ChatEvent, type PeerInfo, type Hello, type AttachmentRef
} from './encoding.ts'
import { canStrip, stripMetadata } from './strip-metadata.ts'
import { dmTopic, safetyCode } from './keys.ts'
import { inviteToCode, inviteLinks, parseInvite } from './invite-link.ts'

const INVITE_TTL = 24 * 60 * 60 * 1000
const TYPING_TIMEOUT = 6000
const SIGNALS_PROTOCOL = 'wehatemail/v1/signals'
const PAIRING_GRACE = 30000
const TRANSFER_TICK = 250
const SPEED_WINDOW = 3000
/** A connection that should be moving file data but hasn't for this long is dropped and redialled. */
const STALL_MS = 6000
const STALL_AFTER_NETWORK_CHANGE_MS = 3000
const STALL_CHECK = 1000
// Files are stored in the blob log one block per chunk read. 64 KB blocks capped the
// sender copy at ~32 MB/s (per-block hashing and signing); 256 KB doubles it (npm run bench).
const BLOB_CHUNK = 256 * 1024
const VERIFY_BATCH = 16

export interface EngineOptions {
  /** Folder for this device's data (logs and state). */
  storage: string
  /** Where secrets go. The desktop app passes an OS-keychain store. */
  secrets: SecretStore
  /** DHT bootstrap nodes. Leave unset for the public DHT; tests pass a testnet. */
  bootstrap?: unknown[]
  /** Address to bind the DHT socket to. Use '127.0.0.1' with a local testnet. */
  host?: string
  /** A ready-made HyperDHT node (tests use `testnet.createNode()`). Overrides `bootstrap` and `host`. */
  dht?: unknown
  /** How often pairing polls the DHT, in ms. Lower in tests. */
  pairingPoll?: number
  /** How long invites live, in ms. Default 24 h. */
  inviteTtl?: number
  /** Block requests kept in flight while downloading attachments, `[min, max]`. Hypercore's default is [16, 512]. */
  inflightRange?: [number, number]
  /** How long a connection may sit idle while file data is due before it is redialled, in ms. Default 6000. Lower in tests. */
  stallMs?: number
  /** Test hook: runs before each file starts copying into the blob log (simulates slow hashing/planning). */
  beforeCopy?: () => Promise<void>
}

export type PresenceStatus = 'online' | 'offline'

export interface Presence {
  status: PresenceStatus
  /** How we're connected. Relays are not configured in M1, so always "direct". */
  via: 'direct' | 'relay' | null
  /** Where the direct connection goes: same network (`lan`) or across the internet. */
  path: ConnectionPath | null
  /** The other device's address on that path. Shown in Info, never logged. */
  address: string | null
  lastSeen: number | null
}

export type ConnectionPath = 'lan' | 'internet'

export interface Contact {
  id: string
  name: string
  addedAt: number
  verified: boolean
  safetyCode: string
  presence: Presence
  unread: number
}

export type MessageStatus = 'waiting' | 'delivered' | 'read'

export interface Attachment {
  index: number
  kind: 'image' | 'video' | 'file'
  name: string
  mime: string
  size: number
  width: number
  height: number
  /** Video length in ms. */
  duration: number
  blurhash: string
  /** Small JPEG, ready to show before the full file has arrived. */
  thumb: Uint8Array | null
}

/** Sender-made preview of a picture or video. The engine can't decode media itself. */
export interface Preview {
  width: number
  height: number
  duration?: number
  blurhash?: string
  thumb?: Uint8Array
}

export interface OutgoingFile {
  /** Absolute path of the file to send. */
  path: string
  /** Name shown to the other person. Defaults to the file's own name. */
  name?: string
  mime: string
  preview?: Preview
  /**
   * Strip location, camera and date metadata first (pictures and videos only) and rename to
   * `photo-N.ext` / `video-N.ext`. Leave unset to send the file exactly as it is.
   */
  clean?: boolean
}

/**
 * `active`: moving (or about to). `paused`: the other side is offline, it
 * picks up where it stopped. `done`, `failed`: final (failed = the bytes that
 * arrived don't match the sender's checksum; retry downloads them again).
 */
export type TransferState = 'active' | 'paused' | 'done' | 'failed'

export interface Transfer {
  messageId: string
  index: number
  direction: 'out' | 'in'
  state: TransferState
  /** Bytes moved so far. */
  done: number
  total: number
  /** Bytes per second right now. 0 when idle. */
  speed: number
  /** When the first bytes of this attachment moved (ms since epoch), 0 if none yet. */
  startedAt: number
  /** When it finished, 0 while unfinished (and after a restart, for received files). */
  finishedAt: number
  /** Time spent idle while bytes were due, and how many times the connection was redialled. */
  stalledMs: number
  reconnects: number
  /** The network path the bytes take right now. */
  path: ConnectionPath | null
}

export interface Message {
  /** `<author id>:<seq>`. Stable across both devices. */
  id: string
  author: string
  fromMe: boolean
  seq: number
  timestamp: number
  /** The text, or the caption of an album or file. */
  text: string
  kind: 'text' | 'media' | 'file'
  attachments: Attachment[]
  edited: boolean
  deleted: boolean
  /** Only set on my own messages. */
  status?: MessageStatus
  /** When it was delivered / seen (ms). Set along with `status`. */
  deliveredAt?: number
  readAt?: number
}

export interface Invite {
  id: string
  code: string
  link: string
  appLink: string
  createdAt: number
  expiresAt: number
}

interface ContactRecord {
  publicKey: string
  name: string
  addedAt: number
  verified: boolean
  theirCoreKey: string | null
  theirBlobsKey: string | null
  /** How many blocks of my blob log they have (upload progress). */
  blobsDelivered: number
  /** When my events were delivered / read: `[count, time]` checkpoints, newest last. */
  deliveredTimes: [number, number][]
  readTimes: [number, number][]
  /** Final result per received attachment, `<message id>#<index>`. */
  transfers: Record<string, 'done' | 'failed'>
  /** How many of my events they have. */
  delivered: number
  /** How many of my events they've read. */
  read: number
  /** How many of their events I've read. */
  myRead: number
  lastSeen: number | null
}

interface InviteRecord {
  id: string
  publicKey: string
  discoveryKey: string
  code: string
  createdAt: number
  expiresAt: number
}

interface State {
  name: string | null
  contacts: ContactRecord[]
  invites: InviteRecord[]
}

interface Item {
  mine: boolean
  messageId: string
  index: number
  ref: AttachmentRef
  /** Blocks of this attachment that are in my copy of their blob log (incoming only). */
  held: number
  /** Timings for the transfer card and logs. */
  stats: { startedAt: number, finishedAt: number, stalledMs: number, reconnects: number }
  /** One flag per block of the range: already counted in `held`. */
  seen: Uint8Array
  /** Outgoing only: the copy into my blob log failed or was cut short, so the blocks are missing. */
  broken: boolean
  /** The linear download of this attachment's block range, once requested. */
  range: any | null
}

interface Conversation {
  record: ContactRecord
  publicKey: Buffer
  convKey: Buffer
  mine: any
  mineBlobs: any
  theirs: any | null
  theirBlobs: any | null
  items: Item[]
  verifying: boolean
  /** Running checksum of the attachment being received, advanced as blocks arrive. */
  hashing: { item: Item, at: number, hash: ReturnType<typeof createHash> } | null
  traffic: { at: number, bytes: number }[]
  tick: NodeJS.Timeout | null
  tickDirty: boolean
  /** When bytes last moved for this contact, and when the connection last began wanting them. */
  lastBytes: number
  wantingSince: number
  sentBlobs: number
  /** Runs file sends one after another: the block numbers of a send are worked out up front. */
  sends: Promise<void>
  processed: number
  processing: Promise<void> | null
  discovery: any
  conn: any | null
  channel: any | null
  messages: { hello: any, typing: any, received: any, read: any, blobs: any } | null
  online: boolean
  typingTimer: NodeJS.Timeout | null
}

/**
 * The headless P2P engine: identity, invites, contacts, chat logs and
 * signals. No Electron imports here, so it runs in tests and the CLI.
 *
 * Events:
 *   'contact'  (contact, joined?)           a contact was added or changed. `joined` is true when
 *                                           they were added by pairing (through my invite)
 *   'presence' (contactId, presence)
 *   'message'  (contactId, message)         a new text message arrived (or I sent one)
 *   'update'   (contactId, messageId)       a message was edited or deleted
 *   'status'   (contactId)                  delivery/read state of my messages changed
 *   'transfer' (contactId)                  progress or state of an attachment changed (throttled)
 *   'typing'   (contactId, isTyping)
 *   'invites'  ()                           the invite list changed
 */
export class Engine extends EventEmitter {
  private opts: EngineOptions
  private state: State = { name: null, contacts: [], invites: [] }
  private saving: Promise<void> = Promise.resolve()
  private conversations = new Map<string, Conversation>()
  private members = new Map<string, any>()
  private usedInvites = new Set<string>()
  private candidates = 0
  private attached = new WeakSet<any>()
  private keyPair: { publicKey: Buffer, secretKey: Buffer } | null = null
  private store: any = null
  private swarm: any = null
  private pairing: any = null
  private opening: Promise<void> | null = null
  private networkChangedAt = 0
  private stallTimer: ReturnType<typeof setInterval> | null = null
  private closed = false

  constructor (opts: EngineOptions) {
    super()
    this.opts = opts
  }

  /** This device's public key, hex. */
  get id (): string {
    return this.requireKeyPair().publicKey.toString('hex')
  }

  get name (): string | null {
    return this.state.name
  }

  ready (): Promise<void> {
    if (!this.opening) this.opening = this.open()
    return this.opening
  }

  private async open () {
    const { storage, secrets } = this.opts
    await fs.mkdir(storage, { recursive: true, mode: 0o700 })
    await this.loadState()

    let seed = await secrets.get('identity.seed')
    if (!seed) {
      seed = crypto.randomBytes(32) as Buffer
      await secrets.set('identity.seed', seed)
    }
    this.keyPair = crypto.keyPair(seed)

    this.store = new Corestore(path.join(storage, 'cores'))
    await this.store.ready()

    this.swarm = new Hyperswarm({
      keyPair: this.keyPair,
      dht: this.opts.dht ?? new HyperDHT({ bootstrap: this.opts.bootstrap, host: this.opts.host }),
      // Only contacts may connect, except while a pairing is in progress.
      firewall: (remotePublicKey: Buffer) => !this.mayConnect(remotePublicKey)
    })
    this.swarm.on('connection', (conn: any) => this.onconnection(conn))
    // Wi-Fi to hotspot and back: Hyperswarm probes the old connections and refreshes
    // the DHT announces. We also tighten the stall watchdog so a dead path is dropped fast.
    this.swarm.dht.on('network-change', () => { this.networkChangedAt = Date.now() })
    this.stallTimer = setInterval(() => this.checkStalls(), STALL_CHECK)
    this.stallTimer.unref?.()
    this.pairing = new BlindPairing(this.swarm, { poll: this.opts.pairingPoll })

    for (const record of this.state.contacts) await this.openConversation(record)

    this.pruneInvites()
    for (const invite of this.state.invites) await this.listenForInvite(invite)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    if (this.stallTimer) clearInterval(this.stallTimer)
    await this.opening?.catch(() => {})
    for (const conv of this.conversations.values()) {
      if (conv.typingTimer) clearTimeout(conv.typingTimer)
      if (conv.tick) clearTimeout(conv.tick)
    }
    for (const conv of this.conversations.values()) await conv.sends.catch(() => {})
    if (this.pairing) await this.pairing.close()
    if (this.swarm) await this.swarm.destroy()
    if (this.store) await this.store.close()
    await this.saving
  }

  async setName (name: string) {
    name = name.trim()
    if (!name) throw new Error('Name cannot be empty')
    this.state.name = name
    await this.save()
  }

  // ---- Invites ------------------------------------------------------------

  /** A single-use invite that expires after 24 h (or `inviteTtl`). */
  async createInvite (): Promise<Invite> {
    await this.ready()
    this.requireName()
    const now = Date.now()
    const expiresAt = now + (this.opts.inviteTtl ?? INVITE_TTL)
    const seed = crypto.randomBytes(32)
    // `key` is what the invite "unlocks". We don't need it for anything, so
    // each invite gets a random one; the real payload travels in `additional`.
    const pairingKey = crypto.randomBytes(32)
    const inv = createInvite(pairingKey, { seed, expires: expiresAt })
    const record: InviteRecord = {
      id: b4a.toString(inv.id, 'hex'),
      publicKey: b4a.toString(inv.publicKey, 'hex'),
      discoveryKey: b4a.toString(inv.discoveryKey, 'hex'),
      code: inviteToCode(inv.invite),
      createdAt: now,
      expiresAt
    }
    await this.opts.secrets.set('invite.' + record.id, b4a.concat([seed, pairingKey]))
    this.state.invites.push(record)
    await this.save()
    const member = await this.listenForInvite(record)
    // Make sure we're findable before anyone can use the link.
    await member.flushed()
    this.emit('invites')
    return toInvite(record)
  }

  listInvites (): Invite[] {
    this.pruneInvites()
    const now = Date.now()
    return this.state.invites.filter(i => !this.usedInvites.has(i.id) && i.expiresAt >= now).map(toInvite)
  }

  async revokeInvite (id: string) {
    await this.dropInvite(id)
    this.emit('invites')
  }

  /**
   * Use someone's invite (link, wehatemail:// link or bare code). Resolves
   * with the new contact once pairing is done.
   */
  async acceptInvite (input: string, { timeout = 0 } = {}): Promise<Contact> {
    await this.ready()
    this.requireName()
    const invite = parseInvite(input)
    let info: any
    try {
      info = decodeInvite(invite)
    } catch {
      throw new Error('That does not look like a We Hate Mail invite')
    }
    if (info.expires && info.expires < Date.now()) throw new Error('This invite has expired')

    const userData = encode(peerInfo, {
      version: PROTOCOL_VERSION,
      publicKey: this.requireKeyPair().publicKey,
      name: this.state.name!
    })
    this.candidates++
    let candidate: any = null
    let timer: NodeJS.Timeout | null = null
    try {
      return await new Promise<Contact>((resolve, reject) => {
        if (timeout) timer = setTimeout(() => reject(new Error('Pairing timed out')), timeout)
        candidate = this.pairing.addCandidate({
          invite,
          userData,
          onadd: async (result: any) => {
            try {
              if (!result.data || !result.encryptionKey) throw new Error('Invalid pairing response')
              const peer = decode<PeerInfo>(peerInfo, result.data)
              resolve(await this.addContact(peer, result.encryptionKey))
            } catch (err) {
              reject(err)
            }
          }
        })
        candidate.request.on('rejected', (err: any) => reject(friendlyPairingError(err)))
      })
    } finally {
      if (timer) clearTimeout(timer)
      this.candidates--
      if (candidate) candidate.close().catch(() => {})
    }
  }

  private async listenForInvite (record: InviteRecord) {
    const member = this.pairing.addMember({
      discoveryKey: b4a.from(record.discoveryKey, 'hex'),
      onadd: (request: any) => this.onpairingrequest(record, request)
    })
    this.members.set(record.id, member)
    await member.ready()
    return member
  }

  private async onpairingrequest (record: InviteRecord, request: any) {
    const inviteId = b4a.toString(request.inviteId, 'hex')
    if (inviteId !== record.id) return
    // Single use: claim it before any await so two requests can't both win.
    if (this.usedInvites.has(record.id) || !this.state.invites.includes(record)) {
      return request.deny({ status: 2 })
    }
    if (record.expiresAt < Date.now()) return request.deny({ status: 3 })

    let peer: PeerInfo
    try {
      peer = decode<PeerInfo>(peerInfo, request.open(b4a.from(record.publicKey, 'hex')))
    } catch {
      return request.deny()
    }
    if (b4a.equals(peer.publicKey, this.requireKeyPair().publicKey)) return request.deny()
    this.usedInvites.add(record.id)

    const secret = await this.opts.secrets.get('invite.' + record.id)
    if (!secret) return request.deny()
    const seed = secret.subarray(0, 32)
    const pairingKey = secret.subarray(32)

    const existing = this.conversations.get(peer.publicKey.toString('hex'))
    const convKey = existing ? existing.convKey : crypto.randomBytes(32)
    const data = encode(peerInfo, {
      version: PROTOCOL_VERSION,
      publicKey: this.requireKeyPair().publicKey,
      name: this.state.name!
    })
    const signature = crypto.sign(data, crypto.keyPair(seed).secretKey)

    await this.addContact(peer, convKey, true)
    request.confirm({ key: pairingKey, encryptionKey: convKey, additional: { data, signature } })
    // Let the reply go out before we stop listening on this invite.
    setTimeout(() => { this.dropInvite(record.id).then(() => this.emit('invites'), () => {}) }, 0)
  }

  private async dropInvite (id: string) {
    const member = this.members.get(id)
    this.members.delete(id)
    this.state.invites = this.state.invites.filter(i => i.id !== id)
    await this.opts.secrets.delete('invite.' + id)
    await this.save()
    if (member) await member.close().catch(() => {})
  }

  private pruneInvites () {
    const now = Date.now()
    for (const inv of this.state.invites) {
      if (inv.expiresAt < now) this.dropInvite(inv.id).catch(() => {})
    }
  }

  // ---- Contacts -----------------------------------------------------------

  contacts (): Contact[] {
    return [...this.conversations.values()].map(conv => this.toContact(conv))
  }

  contact (id: string): Contact {
    return this.toContact(this.conv(id))
  }

  async setVerified (id: string, verified: boolean) {
    const conv = this.conv(id)
    conv.record.verified = verified
    await this.save()
    this.emit('contact', this.toContact(conv), false)
  }

  private async addContact (peer: PeerInfo, convKey: Buffer, viaMyInvite = false): Promise<Contact> {
    const id = peer.publicKey.toString('hex')
    const existing = this.conversations.get(id)
    if (existing) {
      existing.record.name = peer.name
      await this.save()
      return this.toContact(existing)
    }
    const record: ContactRecord = {
      publicKey: id,
      name: peer.name,
      addedAt: Date.now(),
      verified: false,
      theirCoreKey: null,
      theirBlobsKey: null,
      blobsDelivered: 0,
      deliveredTimes: [],
      readTimes: [],
      transfers: {},
      delivered: 0,
      read: 0,
      myRead: 0,
      lastSeen: null
    }
    await this.opts.secrets.set('conv.' + id, convKey)
    this.state.contacts.push(record)
    await this.save()
    const conv = await this.openConversation(record)
    // We may already be connected through the pairing.
    for (const conn of this.swarm.connections) {
      if (b4a.equals(conn.remotePublicKey, conv.publicKey)) this.attach(conn, conv)
    }
    const contact = this.toContact(conv)
    this.emit('contact', contact, viaMyInvite)
    return contact
  }

  private async openConversation (record: ContactRecord): Promise<Conversation> {
    const convKey = await this.opts.secrets.get('conv.' + record.publicKey)
    if (!convKey) throw new Error('Missing conversation key for a contact')
    const publicKey = b4a.from(record.publicKey, 'hex')
    const mine = this.store.get({ name: 'dm/' + record.publicKey, encryption: { key: convKey } })
    await mine.ready()
    // Attachments live in a second log of mine (Hyperblobs), encrypted the same way.
    const mineBlobsCore = this.store.get({ name: 'blobs/' + record.publicKey, encryption: { key: convKey } })
    await mineBlobsCore.ready()

    const conv: Conversation = {
      record,
      publicKey,
      convKey,
      mine,
      mineBlobs: new Hyperblobs(mineBlobsCore),
      theirs: null,
      theirBlobs: null,
      items: [],
      verifying: false,
      hashing: null,
      traffic: [],
      tick: null,
      tickDirty: false,
      lastBytes: 0,
      wantingSince: 0,
      sentBlobs: -1,
      sends: Promise.resolve(),
      processed: 0,
      processing: null,
      discovery: null,
      conn: null,
      channel: null,
      messages: null,
      online: false,
      typingTimer: null
    }
    this.conversations.set(record.publicKey, conv)
    mineBlobsCore.on('upload', (_i: number, bytes: number) => { this.noteBytes(conv, bytes) })
    await this.scanItems(conv, mine, true, 0, mine.length)
    // A send that was cut short (app closed mid-copy) posted its message but never wrote all its blocks.
    for (const item of conv.items) {
      if (item.mine && item.ref.blockOffset + item.ref.blockLength > mineBlobsCore.length) item.broken = true
    }
    if (record.theirCoreKey) await this.openTheirs(conv, b4a.from(record.theirCoreKey, 'hex'))
    if (record.theirBlobsKey) await this.openTheirBlobs(conv, b4a.from(record.theirBlobsKey, 'hex'))

    conv.discovery = this.swarm.join(dmTopic(this.requireKeyPair().publicKey, publicKey), { server: true, client: true })
    // Also dial the contact's key directly. Hyperswarm keeps retrying this
    // with backoff, so we reconnect within seconds of them coming back
    // instead of waiting for the next topic refresh.
    this.swarm.joinPeer(publicKey)
    return conv
  }

  private async openTheirs (conv: Conversation, key: Buffer) {
    const theirs = this.store.get({ key, encryption: { key: conv.convKey } })
    await theirs.ready()
    conv.theirs = theirs
    conv.processed = theirs.contiguousLength
    await this.scanItems(conv, theirs, false, 0, conv.processed)
    theirs.download({ start: 0, end: -1 })
    const onchange = () => { this.processTheirs(conv).catch(err => this.emit('warning', conv.record.publicKey, String(err?.message ?? err))) }
    theirs.on('append', onchange)
    theirs.on('download', onchange)
  }

  private async openTheirBlobs (conv: Conversation, key: Buffer) {
    const core = this.store.get({ key, encryption: { key: conv.convKey }, inflightRange: this.opts.inflightRange })
    await core.ready()
    conv.theirBlobs = new Hyperblobs(core)
    core.on('download', (index: number, bytes: number) => {
      this.noteBytes(conv, bytes)
      this.markHeld(conv, index)
      this.verifyArrived(conv)
    })
    for (const item of conv.items) if (!item.mine) this.requestItem(conv, item)
    this.verifyArrived(conv)
  }

  /**
   * Ask for one attachment's blocks in order. A plain `download({ start: 0, end: -1 })`
   * fetches blocks in random order, so nothing can be checked or counted until the end.
   * Also counts the blocks of this attachment we already hold (after a restart).
   */
  private requestItem (conv: Conversation, item: Item) {
    const core = conv.theirBlobs?.core
    if (!core || item.range) return
    const { blockOffset, blockLength } = item.ref
    if (conv.record.transfers[item.messageId + '#' + item.index] === 'done') {
      item.held = blockLength
      item.seen.fill(1)
      return
    }
    item.range = core.download({ start: blockOffset, end: blockOffset + blockLength, linear: true })
    ;(async () => {
      for (let i = 0; i < blockLength && !this.closed; i++) {
        if (!item.seen[i] && await core.has(blockOffset + i)) this.markHeld(conv, blockOffset + i)
      }
      this.scheduleTransfer(conv)
    })().catch(() => {})
  }

  private markHeld (conv: Conversation, index: number) {
    for (const item of conv.items) {
      if (item.mine) continue
      const at = index - item.ref.blockOffset
      if (at < 0 || at >= item.ref.blockLength) continue
      if (!item.seen[at]) { item.seen[at] = 1; item.held++ }
      item.stats.startedAt ||= Date.now()
      return
    }
  }

  /** Remember which attachments a log holds, so progress and checks don't re-read it. */
  private async scanItems (conv: Conversation, core: any, mine: boolean, from: number, to: number) {
    for (let seq = from; seq < to; seq++) {
      const event = decode<ChatEvent>(chatEvent, await core.get(seq))
      this.addItems(conv, mine, seq, event)
    }
  }

  private addItems (conv: Conversation, mine: boolean, seq: number, event: ChatEvent) {
    if (event.type !== EventType.MEDIA && event.type !== EventType.FILE) return
    const messageId = (mine ? this.id : conv.record.publicKey) + ':' + seq
    ;(event as any).items.forEach((ref: AttachmentRef, index: number) => {
      const item: Item = { mine, messageId, index, ref, held: 0, stats: { startedAt: mine ? Date.now() : 0, finishedAt: 0, stalledMs: 0, reconnects: 0 }, seen: new Uint8Array(mine ? 0 : ref.blockLength), broken: false, range: null }
      conv.items.push(item)
      if (!mine) this.requestItem(conv, item)
    })
    this.verifyArrived(conv)
  }

  private async processTheirs (conv: Conversation) {
    if (conv.processing) return conv.processing
    conv.processing = (async () => {
      const theirs = conv.theirs
      const id = conv.record.publicKey
      while (conv.processed < theirs.contiguousLength) {
        const seq = conv.processed
        const event = decode<ChatEvent>(chatEvent, await theirs.get(seq))
        conv.processed++
        if (event.type === EventType.TEXT || event.type === EventType.MEDIA || event.type === EventType.FILE) {
          this.addItems(conv, false, seq, event)
          this.emit('message', id, this.toMessage(conv, false, seq, event))
          this.scheduleTransfer(conv)
        } else if (event.type === EventType.EDIT || event.type === EventType.DELETE) {
          this.emit('update', id, conv.record.publicKey + ':' + (event as any).target)
        }
      }
      conv.messages?.received.send(conv.processed)
    })()
    try {
      await conv.processing
    } finally {
      conv.processing = null
    }
    // Something may have arrived while we were finishing.
    if (conv.theirs && conv.processed < conv.theirs.contiguousLength) await this.processTheirs(conv)
  }

  // ---- Messages -----------------------------------------------------------

  async sendText (contactId: string, text: string): Promise<Message> {
    if (!text) throw new Error('Message is empty')
    const conv = this.conv(contactId)
    const event = { version: PROTOCOL_VERSION, type: EventType.TEXT, timestamp: Date.now(), text } as const
    const { length } = await conv.mine.append(encode(chatEvent, event))
    const message = this.toMessage(conv, true, length - 1, event)
    this.emit('message', contactId, message)
    return message
  }

  /**
   * Send pictures, videos and files. Images and videos go together as one
   * album message; every other file is its own message. `text` is the caption
   * of the first message. Resolves once the messages are in my chat log; the
   * bytes are still being copied into my blob log then, and the other person
   * (if online) starts downloading them straight away.
   */
  async sendFiles (contactId: string, files: OutgoingFile[], text = ''): Promise<Message[]> {
    if (!files.length) throw new Error('No files to send')
    const conv = this.conv(contactId)
    let posted!: (m: Message[]) => void
    let failed!: (err: unknown) => void
    const result = new Promise<Message[]>((resolve, reject) => { posted = resolve; failed = reject })
    const run = async () => {
      let copies: (() => Promise<void>)[]
      let tmp: string | null = null
      try {
        const prepared = await this.cleanFiles(conv, files)
        tmp = prepared.dir
        const plan = await this.planFiles(conv, prepared.files)
        copies = plan.copies
        const media = plan.refs.filter(r => r.kind !== AttachmentKind.FILE)
        const others = plan.refs.filter(r => r.kind === AttachmentKind.FILE)
        const events: { type: typeof EventType.MEDIA | typeof EventType.FILE, items: AttachmentRef[] }[] = []
        if (media.length) events.push({ type: EventType.MEDIA, items: media })
        for (const ref of others) events.push({ type: EventType.FILE, items: [ref] })

        const out: Message[] = []
        for (const [i, e] of events.entries()) {
          const event = { version: PROTOCOL_VERSION, timestamp: Date.now(), text: i === 0 ? text : '', ...e }
          const { length } = await conv.mine.append(encode(chatEvent, event))
          this.addItems(conv, true, length - 1, event)
          const message = this.toMessage(conv, true, length - 1, event)
          out.push(message)
          this.emit('message', contactId, message)
        }
        this.scheduleTransfer(conv)
        posted(out)
      } catch (err) {
        if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
        failed(err)
        return
      }
      // Copy the bytes in, one file after another, in the order the block numbers were planned.
      try {
        for (const [i, copy] of copies.entries()) {
          try {
            await this.opts.beforeCopy?.()
            await copy()
          } catch (err: any) {
            this.markBroken(conv, copies.length - i)
            this.emit('warning', conv.record.publicKey, 'Could not copy a file to send: ' + String(err?.message ?? err))
            return
          }
        }
      } finally {
        if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
      }
    }
    conv.sends = conv.sends.then(run, run)
    return result
  }

  /**
   * Make cleaned copies (no location or camera metadata) of the files marked `clean`, in a private
   * temp folder the caller deletes. Types we can't clean are sent as they are, with a warning.
   */
  private async cleanFiles (conv: Conversation, files: OutgoingFile[]): Promise<{ files: OutgoingFile[], dir: string | null }> {
    if (!files.some(f => f.clean)) return { files, dir: null }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-clean-'))
    const counts = { photo: 0, video: 0 }
    const out: OutgoingFile[] = []
    try {
      for (const [i, file] of files.entries()) {
        const video = file.mime.toLowerCase().startsWith('video/')
        if (!file.clean || !(video || file.mime.toLowerCase().startsWith('image/'))) { out.push(file); continue }
        const kind = video ? 'video' : 'photo'
        const dest = path.join(dir, String(i))
        if (!canStrip(file.mime) || !await stripMetadata(file.path, dest, file.mime)) {
          this.emit('warning', conv.record.publicKey, `Could not remove metadata from ${(file.name ?? path.basename(file.path)).slice(0, 80)}; sent as it is`)
          out.push(file)
          continue
        }
        const ext = path.extname(file.name ?? file.path).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8)
        out.push({ ...file, path: dest, name: `${kind}-${++counts[kind]}${ext}` })
      }
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
    return { files: out, dir }
  }

  /** Mark the newest `n` outgoing attachments that aren't fully in the blob log as broken. */
  private markBroken (conv: Conversation, n: number) {
    const mine = conv.items.filter(i => i.mine)
    for (const item of mine.slice(-n)) {
      if (item.ref.blockOffset + item.ref.blockLength > conv.mineBlobs.core.length) item.broken = true
    }
    this.scheduleTransfer(conv)
  }

  /**
   * Hash each file and work out where its blocks will land in my blob log (one block per
   * BLOB_CHUNK read), so the message can be posted before the copy is done.
   */
  private async planFiles (conv: Conversation, files: OutgoingFile[]) {
    await conv.mineBlobs.ready()
    let blockOffset = conv.mineBlobs.core.length
    let byteOffset = conv.mineBlobs.core.byteLength
    const refs: AttachmentRef[] = []
    const copies: (() => Promise<void>)[] = []
    for (const file of files) {
      const st = await fs.stat(file.path)
      if (!st.isFile()) throw new Error('Not a file: ' + path.basename(file.path))
      const size = st.size
      const sha256 = await hashFile(file.path, size)
      const blockLength = Math.ceil(size / BLOB_CHUNK)
      const p = file.preview
      refs.push({
        kind: !isInlineType(file.mime) ? AttachmentKind.FILE : file.mime.startsWith('image/') ? AttachmentKind.IMAGE : AttachmentKind.VIDEO,
        name: (file.name ?? path.basename(file.path)).slice(0, 255),
        mime: file.mime.slice(0, 127),
        size,
        sha256,
        blockOffset,
        blockLength,
        byteOffset,
        byteLength: size,
        width: p?.width ?? 0,
        height: p?.height ?? 0,
        duration: Math.round(p?.duration ?? 0),
        blurhash: p?.blurhash ?? '',
        thumb: p?.thumb ? Buffer.from(p.thumb) : Buffer.alloc(0)
      })
      const planned = { blockOffset, blockLength, byteOffset, byteLength: size }
      copies.push(() => this.copyFile(conv, file.path, size, planned))
      blockOffset += blockLength
      byteOffset += size
    }
    return { refs, copies }
  }

  /** Copy one file into my blob log: exactly one block per BLOB_CHUNK, as planned. Streams, so size doesn't matter. */
  private async copyFile (conv: Conversation, file: string, size: number, planned: { blockOffset: number, blockLength: number, byteOffset: number, byteLength: number }) {
    if (size === 0) return
    const ws = conv.mineBlobs.createWriteStream()
    const fh = await fs.open(file, 'r')
    try {
      for (let left = size; left > 0;) {
        if (this.closed) throw new Error('the app was closing')
        const buf = Buffer.allocUnsafe(Math.min(BLOB_CHUNK, left))
        let got = 0
        while (got < buf.length) {
          const { bytesRead } = await fh.read(buf, got, buf.length - got, null)
          if (bytesRead === 0) throw new Error('the file changed while it was being sent')
          got += bytesRead
        }
        left -= buf.length
        if (!ws.write(buf)) await new Promise<void>((resolve, reject) => { ws.once('drain', resolve); ws.once('error', reject) })
      }
      await new Promise<void>((resolve, reject) => { ws.once('error', reject); ws.once('close', () => resolve()); ws.end() })
    } catch (err) {
      ws.destroy()
      throw err
    } finally {
      await fh.close()
    }
    const id = ws.id
    if (id.blockOffset !== planned.blockOffset || id.blockLength !== planned.blockLength || id.byteOffset !== planned.byteOffset || id.byteLength !== planned.byteLength) {
      throw new Error('the file landed somewhere unexpected in the blob log')
    }
  }

  /** Progress of every attachment in this conversation. */
  transfers (contactId: string): Transfer[] {
    const conv = this.conv(contactId)
    const online = conv.online
    const speed = this.speed(conv)
    const path = online ? connectionPath(conv.conn).path : null
    return conv.items.map(item => {
      const { ref } = item
      const total = ref.size
      const { startedAt, finishedAt, stalledMs, reconnects } = item.stats
      const base = { messageId: item.messageId, index: item.index, direction: item.mine ? 'out' as const : 'in' as const, total, startedAt, finishedAt, stalledMs, reconnects }
      const final = item.mine ? null : conv.record.transfers[item.messageId + '#' + item.index]
      if (final) return { ...base, state: final, done: final === 'done' ? total : 0, speed: 0, path: null }
      // Incoming: blocks actually held in this attachment's range, not the contiguous prefix of the log.
      const have = item.mine ? conv.record.blobsDelivered - ref.blockOffset : item.held
      const frac = ref.blockLength === 0 ? 1 : Math.min(1, Math.max(0, have / ref.blockLength))
      if (item.mine && item.broken) return { ...base, state: 'failed' as const, done: 0, speed: 0, path: null }
      if (item.mine && frac === 1) return { ...base, state: 'done' as const, done: total, speed: 0, path: null }
      return { ...base, state: online ? 'active' as const : 'paused' as const, done: Math.floor(total * frac), speed: online ? speed : 0, path: online ? path : null }
    })
  }

  /** Download a failed attachment again. */
  async retryTransfer (contactId: string, messageId: string, index: number) {
    const conv = this.conv(contactId)
    const item = this.findItem(conv, messageId, index)
    const key = messageId + '#' + index
    if (item.mine || conv.record.transfers[key] !== 'failed' || !conv.theirBlobs) return
    const { blockOffset, blockLength } = item.ref
    await conv.theirBlobs.core.clear(blockOffset, blockOffset + blockLength)
    delete conv.record.transfers[key]
    conv.hashing = null
    item.range?.destroy?.()
    item.range = null
    item.held = 0
    item.seen.fill(0)
    await this.save()
    this.requestItem(conv, item)
    this.scheduleTransfer(conv)
    this.verifyArrived(conv)
  }

  /** Name, type and size of one attachment. Cheap, so safe to call per playback request. */
  attachmentInfo (contactId: string, messageId: string, index: number): { name: string, mime: string, size: number } {
    const { ref } = this.findItem(this.conv(contactId), messageId, index)
    return { name: ref.name, mime: ref.mime, size: ref.size }
  }

  /**
   * How to serve a finished attachment: its declared type if that is an allowlisted
   * image/video type and the first bytes agree, else a download-only generic type.
   */
  async attachmentServing (contactId: string, messageId: string, index: number): Promise<{ mime: string, inline: boolean }> {
    const { mime, size } = this.attachmentInfo(contactId, messageId, index)
    if (!isInlineType(mime) || size === 0) return { mime: DOWNLOAD_TYPE, inline: false }
    let head = Buffer.alloc(0)
    for await (const chunk of this.readAttachment(contactId, messageId, index, { start: 0, end: Math.min(size, 32) - 1 })) {
      head = Buffer.concat([head, chunk])
      if (head.length >= 32) break
    }
    return servedType(mime, head)
  }

  /** The bytes of a finished attachment, optionally a byte range (inclusive end), for playback. */
  readAttachment (contactId: string, messageId: string, index: number, range: { start?: number, end?: number } = {}): AsyncIterable<Buffer> {
    const conv = this.conv(contactId)
    const item = this.findItem(conv, messageId, index)
    if (!item.mine && conv.record.transfers[messageId + '#' + index] !== 'done') {
      throw new Error('This file has not finished arriving')
    }
    const { blockOffset, blockLength, byteOffset, byteLength } = item.ref
    const blobs = item.mine ? conv.mineBlobs : conv.theirBlobs
    if (byteLength === 0) return (async function * () {})()
    return blobs.createReadStream({ blockOffset, blockLength, byteOffset, byteLength }, { ...range, wait: false })
  }

  /** Copy a finished attachment to `dest`. */
  async saveAttachment (contactId: string, messageId: string, index: number, dest: string) {
    const source = this.readAttachment(contactId, messageId, index)
    const out = createWriteStream(dest)
    try {
      for await (const chunk of source) {
        if (!out.write(chunk)) await new Promise<void>(resolve => out.once('drain', () => resolve()))
      }
      await new Promise<void>((resolve, reject) => { out.once('error', reject); out.end(resolve) })
    } catch (err) {
      out.destroy()
      throw err
    }
  }

  private findItem (conv: Conversation, messageId: string, index: number): Item {
    const item = conv.items.find(i => i.messageId === messageId && i.index === index)
    if (!item) throw new Error('Unknown attachment')
    return item
  }

  /**
   * Check the checksum of incoming attachments, one at a time. Blocks are hashed
   * as they arrive (not after the whole file is here), so the check is almost
   * done when the last block lands.
   */
  private verifyArrived (conv: Conversation) {
    const blobs = conv.theirBlobs
    if (!blobs || conv.verifying || this.closed) return
    const next = conv.items.find(i => !i.mine && !conv.record.transfers[i.messageId + '#' + i.index])
    if (!next) return
    const end = next.ref.blockOffset + next.ref.blockLength
    if (conv.hashing?.item !== next) conv.hashing = { item: next, at: next.ref.blockOffset, hash: createHash('sha256') }
    const state = conv.hashing
    const limit = Math.min(blobs.core.contiguousLength, end)
    if (state.at >= limit && state.at < end) return
    conv.verifying = true
    ;(async () => {
      let ok = true
      try {
        while (state.at < limit) {
          // Read a few blocks at once (storage reads overlap), hash them in order.
          const n = Math.min(VERIFY_BATCH, limit - state.at)
          const blocks: Buffer[] = await Promise.all(Array.from({ length: n }, (_, i) => blobs.core.get(state.at + i, { wait: false })))
          for (const block of blocks) state.hash.update(block)
          state.at += n
        }
      } catch {
        ok = false
      }
      if (ok && state.at < end) return
      if (ok) ok = b4a.equals(state.hash.digest(), next.ref.sha256)
      conv.hashing = null
      conv.record.transfers[next.messageId + '#' + next.index] = ok ? 'done' : 'failed'
      if (ok) next.stats.finishedAt = Date.now()
      await this.save()
    })().catch(() => {}).finally(() => {
      conv.verifying = false
      this.scheduleTransfer(conv)
      this.verifyArrived(conv)
    })
  }

  /**
   * Transport numbers for the current connection, for diagnosing slow links
   * (`npm run bench` prints them): round-trip time, UDX congestion window and bytes in
   * flight, retransmits, and how many block requests Hypercore has outstanding.
   */
  linkStats (contactId: string) {
    const conv = this.conv(contactId)
    const raw = conv.conn?.rawStream
    if (!raw) return null
    const peers: any[] = conv.theirBlobs?.core.peers ?? []
    return {
      rttMs: raw.rtt as number,
      cwndBytes: raw.cwnd as number,
      inflightBytes: raw.inflight as number,
      retransmits: raw.retransmits as number,
      mtu: raw.mtu as number,
      requestsInFlight: peers.reduce((n, peer) => n + (peer.inflight ?? 0), 0)
    }
  }

  /** Does this contact owe or await file bytes right now? */
  private wantsBytes (conv: Conversation): boolean {
    if (conv.conn === null) return false
    if (conv.record.blobsDelivered < conv.mineBlobs.core.length) return true
    // Only count idle time when the peer has blocks we are missing. While the sender is still
    // hashing or copying, its log is shorter than the range we asked for and nothing is due.
    const peers: any[] = conv.theirBlobs?.core.peers ?? []
    const remote = peers.reduce((n, peer) => Math.max(n, peer.remoteLength ?? 0), 0)
    return conv.items.some(item => !item.mine && item.held < item.ref.blockLength &&
      conv.record.transfers[item.messageId + '#' + item.index] !== 'done' && !!item.range &&
      Math.min(remote, item.ref.blockOffset + item.ref.blockLength) - item.ref.blockOffset > item.held)
  }

  /**
   * Requests stay pinned to the connection they were sent on. If that connection went
   * quiet (a half-open socket after a network change) drop it: Hyperswarm redials and
   * Hypercore re-requests the missing blocks on the new one.
   */
  private checkStalls () {
    const now = Date.now()
    for (const conv of this.conversations.values()) {
      if (!conv.conn || !this.wantsBytes(conv)) { conv.wantingSince = 0; continue }
      if (!conv.wantingSince) conv.wantingSince = now
      const quietFor = now - Math.max(conv.lastBytes, conv.wantingSince)
      const stallMs = this.opts.stallMs ?? STALL_MS
      const limit = now - this.networkChangedAt < 30000 ? Math.min(STALL_AFTER_NETWORK_CHANGE_MS, stallMs) : stallMs
      if (quietFor < limit) continue
      conv.wantingSince = now
      conv.lastBytes = now
      for (const item of conv.items) {
        if (item.stats.finishedAt || !item.stats.startedAt) continue
        const open = item.mine ? conv.record.blobsDelivered < item.ref.blockOffset + item.ref.blockLength : item.held < item.ref.blockLength
        if (open) { item.stats.stalledMs += quietFor; item.stats.reconnects++ }
      }
      this.emit('warning', conv.record.publicKey, 'Transfer stalled; reconnecting')
      conv.conn.destroy()
    }
  }

  private noteBytes (conv: Conversation, bytes: number) {
    conv.traffic.push({ at: Date.now(), bytes })
    conv.lastBytes = Date.now()
    this.scheduleTransfer(conv)
  }

  private speed (conv: Conversation): number {
    const cutoff = Date.now() - SPEED_WINDOW
    while (conv.traffic.length && conv.traffic[0].at < cutoff) conv.traffic.shift()
    if (!conv.traffic.length) return 0
    let sum = 0
    for (const t of conv.traffic) sum += t.bytes
    return Math.round(sum / (SPEED_WINDOW / 1000))
  }

  /** Tell the app (and the sender) about progress, at most every TRANSFER_TICK ms. */
  private scheduleTransfer (conv: Conversation) {
    if (this.closed) return
    conv.tickDirty = true
    if (conv.tick) return
    conv.tick = setTimeout(() => {
      conv.tick = null
      if (this.closed || !conv.tickDirty) return
      conv.tickDirty = false
      const have = conv.theirBlobs?.core.contiguousLength ?? 0
      if (have !== conv.sentBlobs && conv.messages) {
        conv.sentBlobs = have
        conv.messages.blobs.send(have)
      }
      this.emit('transfer', conv.record.publicKey)
      // Keep ticking while bytes are still moving, so speed decays to zero.
      if (conv.traffic.length) this.scheduleTransfer(conv)
    }, TRANSFER_TICK)
  }

  async editMessage (contactId: string, messageId: string, text: string) {
    await this.appendChange(contactId, messageId, { type: EventType.EDIT, text })
  }

  async deleteMessage (contactId: string, messageId: string) {
    await this.appendChange(contactId, messageId, { type: EventType.DELETE })
  }

  private async appendChange (contactId: string, messageId: string, change: { type: number, text?: string }) {
    const conv = this.conv(contactId)
    const [author, seqStr] = messageId.split(':')
    const target = Number(seqStr)
    if (author !== this.id || !Number.isInteger(target) || target >= conv.mine.length) {
      throw new Error('You can only change your own messages')
    }
    await conv.mine.append(encode(chatEvent, {
      version: PROTOCOL_VERSION, timestamp: Date.now(), target, ...change
    }))
    this.emit('update', contactId, messageId)
  }

  /** The whole conversation, oldest first, with edits and deletes applied. */
  async messages (contactId: string): Promise<Message[]> {
    const conv = this.conv(contactId)
    const out: Message[] = []
    const read = async (core: any, fromMe: boolean, length: number) => {
      const byId = new Map<number, Message>()
      for (let seq = 0; seq < length; seq++) {
        const event = decode<ChatEvent>(chatEvent, await core.get(seq))
        if (event.type === EventType.TEXT || event.type === EventType.MEDIA || event.type === EventType.FILE) {
          const m = this.toMessage(conv, fromMe, seq, event)
          byId.set(seq, m)
          out.push(m)
        } else if (event.type === EventType.EDIT || event.type === EventType.DELETE) {
          const m = byId.get((event as any).target)
          if (!m || m.deleted) continue
          if (event.type === EventType.EDIT) {
            m.text = (event as any).text
            m.edited = true
          } else {
            m.text = ''
            m.attachments = []
            m.deleted = true
          }
        }
      }
    }
    await read(conv.mine, true, conv.mine.length)
    if (conv.theirs) await read(conv.theirs, false, conv.processed)
    return out.sort(compareMessages)
  }

  /** Mark everything from this contact as read (sends a read receipt). */
  async markRead (contactId: string) {
    const conv = this.conv(contactId)
    if (conv.record.myRead === conv.processed) return
    conv.record.myRead = conv.processed
    await this.save()
    conv.messages?.read.send(conv.processed)
  }

  /** Tell the contact I'm typing. Never stored. */
  setTyping (contactId: string, typing: boolean) {
    this.conv(contactId).messages?.typing.send(typing)
  }

  // ---- Connections --------------------------------------------------------

  private mayConnect (remotePublicKey: Buffer): boolean {
    return this.conversations.has(remotePublicKey.toString('hex')) || this.pairingActive()
  }

  private pairingActive () {
    return this.candidates > 0 || this.state.invites.length > 0
  }

  private onconnection (conn: any) {
    conn.on('error', () => {})
    const id = conn.remotePublicKey.toString('hex')
    // If they open the signals channel before we've saved them as a contact
    // (pairing finishes on their side first), wait a little for the pairing.
    Protomux.from(conn).pair({ protocol: SIGNALS_PROTOCOL }, async () => {
      const conv = await this.waitForContact(id, PAIRING_GRACE)
      if (conv && !conn.destroyed) this.attach(conn, conv)
    })
    const conv = this.conversations.get(id)
    // Not a contact: only the pairing protocol (attached by blind-pairing) may use it.
    if (conv) this.attach(conn, conv)
  }

  private waitForContact (id: string, ms: number): Promise<Conversation | null> {
    const conv = this.conversations.get(id)
    if (conv || !this.pairingActive()) return Promise.resolve(conv ?? null)
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer)
        this.off('contact', oncontact)
        resolve(this.conversations.get(id) ?? null)
      }
      const oncontact = (c: Contact) => { if (c.id === id) done() }
      const timer = setTimeout(done, ms)
      this.on('contact', oncontact)
    })
  }

  private attach (conn: any, conv: Conversation) {
    if (this.attached.has(conn)) return
    // Hard check: the Noise key of this connection must be the saved contact's key.
    if (!b4a.equals(conn.remotePublicKey, conv.publicKey)) {
      conn.destroy()
      return
    }
    this.attached.add(conn)

    this.store.replicate(conn)
    const mux = Protomux.from(conn)
    const channel = mux.createChannel({
      protocol: SIGNALS_PROTOCOL,
      onopen: () => {
        conv.sentBlobs = conv.theirBlobs?.core.contiguousLength ?? 0
        conv.messages!.hello.send({
          coreKey: conv.mine.key,
          blobsKey: conv.mineBlobs.key,
          receivedLength: conv.processed,
          readLength: conv.record.myRead,
          blobsLength: conv.sentBlobs
        })
        this.setOnline(conv, true)
      },
      onclose: () => {
        if (conv.channel === channel) this.disconnected(conv)
      }
    })
    if (!channel) return
    const messages = {
      hello: channel.addMessage({ encoding: hello, onmessage: (m: Hello) => this.onhello(conv, m) }),
      typing: channel.addMessage({ encoding: c.bool, onmessage: (t: boolean) => this.ontyping(conv, t) }),
      received: channel.addMessage({ encoding: c.uint, onmessage: (n: number) => this.onreceipt(conv, n, 'delivered') }),
      read: channel.addMessage({ encoding: c.uint, onmessage: (n: number) => this.onreceipt(conv, n, 'read') }),
      blobs: channel.addMessage({ encoding: c.uint, onmessage: (n: number) => this.onblobs(conv, n) })
    }
    if (conv.channel) conv.channel.close()
    // The newest connection wins; a lingering old one (half-open after a network change)
    // would keep Hypercore requests pinned to a dead path.
    const old = conv.conn
    if (old && old !== conn) { old.on('error', () => {}); old.destroy() }
    conv.conn = conn
    conv.channel = channel
    conv.messages = messages
    channel.open()
    conn.once('close', () => {
      if (conv.conn === conn) this.disconnected(conv)
    })
  }

  private disconnected (conv: Conversation) {
    conv.conn = null
    conv.channel = null
    conv.messages = null
    if (conv.online) {
      conv.record.lastSeen = Date.now()
      this.save().catch(() => {})
      this.setOnline(conv, false)
    }
    this.ontyping(conv, false)
  }

  private setOnline (conv: Conversation, online: boolean) {
    if (conv.online === online) return
    conv.online = online
    this.emit('presence', conv.record.publicKey, this.presence(conv))
    this.scheduleTransfer(conv)
  }

  private async onhello (conv: Conversation, m: Hello) {
    const key = m.coreKey.toString('hex')
    if (!conv.record.theirCoreKey) {
      conv.record.theirCoreKey = key
      await this.save()
      await this.openTheirs(conv, m.coreKey)
      await this.processTheirs(conv)
    } else if (conv.record.theirCoreKey !== key) {
      // v1 is one device per person: a different log means something is off.
      this.emit('warning', conv.record.publicKey, 'Contact sent a different chat log than before; ignored')
    }
    if (!conv.record.theirBlobsKey) {
      conv.record.theirBlobsKey = m.blobsKey.toString('hex')
      await this.save()
      await this.openTheirBlobs(conv, m.blobsKey)
    } else if (conv.record.theirBlobsKey !== m.blobsKey.toString('hex')) {
      this.emit('warning', conv.record.publicKey, 'Contact sent a different file log than before; ignored')
    }
    this.onreceipt(conv, m.receivedLength, 'delivered')
    this.onreceipt(conv, m.readLength, 'read')
    this.onblobs(conv, m.blobsLength)
    // A fresh connection may have missed appends made while it was coming up
    // (the sender copies a file while we already download it): ask for the new length.
    conv.theirs?.update({ wait: false }).catch(() => {})
    conv.theirBlobs?.core.update({ wait: false }).catch(() => {})
  }

  /** They now hold the first N blocks of my blob log. */
  private onblobs (conv: Conversation, n: number) {
    n = Math.min(n, conv.mineBlobs.core.length)
    if (n <= conv.record.blobsDelivered) return
    conv.record.blobsDelivered = n
    for (const item of conv.items) {
      if (item.mine && !item.stats.finishedAt && n >= item.ref.blockOffset + item.ref.blockLength) item.stats.finishedAt = Date.now()
    }
    this.save().catch(() => {})
    this.scheduleTransfer(conv)
  }

  private onreceipt (conv: Conversation, n: number, kind: 'delivered' | 'read') {
    const r = conv.record
    n = Math.min(n, conv.mine.length)
    let changed = false
    const now = Date.now()
    if (n > r.delivered) { r.delivered = n; changed = true; checkpoint(r.deliveredTimes, n, now) }
    if (kind === 'read' && n > r.read) { r.read = n; changed = true; checkpoint(r.readTimes, n, now) }
    if (!changed) return
    this.save().catch(() => {})
    this.emit('status', r.publicKey)
  }

  private ontyping (conv: Conversation, typing: boolean) {
    if (conv.typingTimer) clearTimeout(conv.typingTimer)
    conv.typingTimer = null
    if (typing) {
      conv.typingTimer = setTimeout(() => this.ontyping(conv, false), TYPING_TIMEOUT)
    }
    this.emit('typing', conv.record.publicKey, typing)
  }

  // ---- Helpers ------------------------------------------------------------

  private conv (id: string): Conversation {
    const conv = this.conversations.get(id)
    if (!conv) throw new Error('Unknown contact')
    return conv
  }

  private presence (conv: Conversation): Presence {
    if (!conv.online) return { status: 'offline', via: null, path: null, address: null, lastSeen: conv.record.lastSeen }
    const { path, address } = connectionPath(conv.conn)
    return { status: 'online', via: 'direct', path, address, lastSeen: null }
  }

  private toContact (conv: Conversation): Contact {
    const r = conv.record
    return {
      id: r.publicKey,
      name: r.name,
      addedAt: r.addedAt,
      verified: r.verified,
      safetyCode: safetyCode(this.requireKeyPair().publicKey, conv.publicKey),
      presence: this.presence(conv),
      unread: conv.processed - r.myRead
    }
  }

  private toMessage (conv: Conversation, fromMe: boolean, seq: number, event: any): Message {
    const author = fromMe ? this.id : conv.record.publicKey
    const m: Message = {
      id: author + ':' + seq,
      author,
      fromMe,
      seq,
      timestamp: event.timestamp,
      text: event.text ?? '',
      kind: event.type === EventType.MEDIA ? 'media' : event.type === EventType.FILE ? 'file' : 'text',
      attachments: (event.items ?? []).map(toAttachment),
      edited: false,
      deleted: false
    }
    if (fromMe) {
      m.status = seq < conv.record.read ? 'read' : seq < conv.record.delivered ? 'delivered' : 'waiting'
      if (m.status !== 'waiting') m.deliveredAt = timeFor(conv.record.deliveredTimes, seq)
      if (m.status === 'read') m.readAt = timeFor(conv.record.readTimes, seq)
    }
    return m
  }

  private requireKeyPair () {
    if (!this.keyPair) throw new Error('Engine is not ready')
    return this.keyPair
  }

  private requireName () {
    if (!this.state.name) throw new Error('Set a display name first')
  }

  private async loadState () {
    try {
      const raw = JSON.parse(await fs.readFile(this.stateFile(), 'utf8'))
      this.state = { name: raw.name ?? null, contacts: raw.contacts ?? [], invites: raw.invites ?? [] }
      // State written by older versions lacks the file fields.
      for (const r of this.state.contacts) {
        r.theirBlobsKey ??= null
        r.blobsDelivered ??= 0
        r.deliveredTimes ??= []
        r.readTimes ??= []
        r.transfers ??= {}
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  private save (): Promise<void> {
    const write = async () => {
      const file = this.stateFile()
      // Private to this user: it holds contact names and keys' public halves.
      await fs.writeFile(file + '.tmp', JSON.stringify(this.state, null, 2), { mode: 0o600 })
      await fs.rename(file + '.tmp', file)
    }
    this.saving = this.saving.then(write, write)
    return this.saving
  }

  private stateFile () {
    return path.join(this.opts.storage, 'state.json')
  }
}

/** Where a connection goes, from the remote address of its UDX stream. */
export function connectionPath (conn: any): { path: ConnectionPath | null, address: string | null } {
  const address: string | null = conn?.rawStream?.remoteHost ?? null
  if (!address) return { path: null, address: null }
  return { path: isLocalAddress(address) ? 'lan' : 'internet', address }
}

/** Private, link-local or loopback: the other device is on the same network (or this machine). */
export function isLocalAddress (host: string): boolean {
  host = host.replace(/^::ffff:/i, '').toLowerCase()
  if (host.includes(':')) return host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')
  const [a, b] = host.split('.').map(Number)
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

const MAX_CHECKPOINTS = 200

/** sha256 of a file, streamed. */
async function hashFile (file: string, size: number): Promise<Buffer> {
  const hash = createHash('sha256')
  if (size > 0) for await (const chunk of createReadStream(file, { highWaterMark: BLOB_CHUNK })) hash.update(chunk as Buffer)
  return hash.digest()
}

function checkpoint (list: [number, number][], n: number, at: number) {
  list.push([n, at])
  if (list.length > MAX_CHECKPOINTS) list.shift()
}

/** The time the checkpoint that first covered event `seq` was recorded. */
function timeFor (list: [number, number][], seq: number): number | undefined {
  return list.find(([n]) => n > seq)?.[1] ?? list[0]?.[1]
}

function toAttachment (a: AttachmentRef, index: number): Attachment {
  return {
    index,
    // A sender can label anything as an image; only allowlisted types are shown as media.
    kind: !isInlineType(a.mime) ? 'file' : a.kind === AttachmentKind.IMAGE ? 'image' : a.kind === AttachmentKind.VIDEO ? 'video' : 'file',
    name: a.name,
    mime: a.mime,
    size: a.size,
    width: a.width,
    height: a.height,
    duration: a.duration,
    blurhash: a.blurhash,
    thumb: a.thumb.length ? new Uint8Array(a.thumb) : null
  }
}

function toInvite (r: InviteRecord): Invite {
  return { id: r.id, code: r.code, ...inviteLinks(r.code), createdAt: r.createdAt, expiresAt: r.expiresAt }
}

export function compareMessages (a: Message, b: Message): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
  if (a.author !== b.author) return a.author < b.author ? -1 : 1
  return a.seq - b.seq
}

function friendlyPairingError (err: any): Error {
  switch (err?.code) {
    case 'INVITE_USED': return new Error('This invite has already been used')
    case 'INVITE_EXPIRED': return new Error('This invite has expired')
    case 'PAIRING_REJECTED': return new Error('The invite was refused (it may have been revoked)')
    default: return err instanceof Error ? err : new Error('Pairing failed')
  }
}
