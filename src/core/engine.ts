import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import Hyperswarm from 'hyperswarm'
import HyperDHT from 'hyperdht'
import Corestore from 'corestore'
import Protomux from 'protomux'
import BlindPairing from 'blind-pairing'
import { createInvite, decodeInvite } from 'blind-pairing-core'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import type { SecretStore } from './secrets.ts'
import {
  PROTOCOL_VERSION, EventType, chatEvent, peerInfo, hello, encode, decode, c,
  type ChatEvent, type PeerInfo, type Hello
} from './encoding.ts'
import { dmTopic, safetyCode } from './keys.ts'
import { inviteToCode, inviteLinks, parseInvite } from './invite-link.ts'

const INVITE_TTL = 24 * 60 * 60 * 1000
const TYPING_TIMEOUT = 6000
const SIGNALS_PROTOCOL = 'wehatemail/v1/signals'
const PAIRING_GRACE = 30000

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
}

export type PresenceStatus = 'online' | 'offline'

export interface Presence {
  status: PresenceStatus
  /** How we're connected. Relays are not configured in M1, so always "direct". */
  via: 'direct' | 'relay' | null
  lastSeen: number | null
}

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

export interface Message {
  /** `<author id>:<seq>`. Stable across both devices. */
  id: string
  author: string
  fromMe: boolean
  seq: number
  timestamp: number
  text: string
  edited: boolean
  deleted: boolean
  /** Only set on my own messages. "waiting" = one grey tick. */
  status?: MessageStatus
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

interface Conversation {
  record: ContactRecord
  publicKey: Buffer
  convKey: Buffer
  mine: any
  theirs: any | null
  processed: number
  processing: Promise<void> | null
  discovery: any
  conn: any | null
  channel: any | null
  messages: { hello: any, typing: any, received: any, read: any } | null
  online: boolean
  typingTimer: NodeJS.Timeout | null
}

/**
 * The headless P2P engine: identity, invites, contacts, chat logs and
 * signals. No Electron imports here, so it runs in tests and the CLI.
 *
 * Events:
 *   'contact'  (contact)                    a contact was added
 *   'presence' (contactId, presence)
 *   'message'  (contactId, message)         a new text message arrived (or I sent one)
 *   'update'   (contactId, messageId)       a message was edited or deleted
 *   'status'   (contactId)                  delivery/read state of my messages changed
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
    await fs.mkdir(storage, { recursive: true })
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
    this.pairing = new BlindPairing(this.swarm, { poll: this.opts.pairingPoll })

    for (const record of this.state.contacts) await this.openConversation(record)

    this.pruneInvites()
    for (const invite of this.state.invites) await this.listenForInvite(invite)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    await this.opening?.catch(() => {})
    for (const conv of this.conversations.values()) {
      if (conv.typingTimer) clearTimeout(conv.typingTimer)
    }
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

    await this.addContact(peer, convKey)
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
    this.conv(id).record.verified = verified
    await this.save()
  }

  private async addContact (peer: PeerInfo, convKey: Buffer): Promise<Contact> {
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
    this.emit('contact', contact)
    return contact
  }

  private async openConversation (record: ContactRecord): Promise<Conversation> {
    const convKey = await this.opts.secrets.get('conv.' + record.publicKey)
    if (!convKey) throw new Error('Missing conversation key for a contact')
    const publicKey = b4a.from(record.publicKey, 'hex')
    const mine = this.store.get({ name: 'dm/' + record.publicKey, encryption: { key: convKey } })
    await mine.ready()

    const conv: Conversation = {
      record,
      publicKey,
      convKey,
      mine,
      theirs: null,
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
    if (record.theirCoreKey) await this.openTheirs(conv, b4a.from(record.theirCoreKey, 'hex'))

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
    theirs.download({ start: 0, end: -1 })
    const onchange = () => { this.processTheirs(conv).catch(err => this.emit('warning', conv.record.publicKey, String(err?.message ?? err))) }
    theirs.on('append', onchange)
    theirs.on('download', onchange)
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
        if (event.type === EventType.TEXT) {
          this.emit('message', id, this.toMessage(conv, false, seq, event))
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
        if (event.type === EventType.TEXT) {
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
        conv.messages!.hello.send({
          coreKey: conv.mine.key,
          receivedLength: conv.processed,
          readLength: conv.record.myRead
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
      read: channel.addMessage({ encoding: c.uint, onmessage: (n: number) => this.onreceipt(conv, n, 'read') })
    }
    if (conv.channel) conv.channel.close()
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
    this.onreceipt(conv, m.receivedLength, 'delivered')
    this.onreceipt(conv, m.readLength, 'read')
  }

  private onreceipt (conv: Conversation, n: number, kind: 'delivered' | 'read') {
    const r = conv.record
    n = Math.min(n, conv.mine.length)
    let changed = false
    if (n > r.delivered) { r.delivered = n; changed = true }
    if (kind === 'read' && n > r.read) { r.read = n; changed = true }
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
    return conv.online
      ? { status: 'online', via: 'direct', lastSeen: null }
      : { status: 'offline', via: null, lastSeen: conv.record.lastSeen }
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
      text: event.text,
      edited: false,
      deleted: false
    }
    if (fromMe) {
      m.status = seq < conv.record.read ? 'read' : seq < conv.record.delivered ? 'delivered' : 'waiting'
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
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  private save (): Promise<void> {
    const write = async () => {
      const file = this.stateFile()
      await fs.writeFile(file + '.tmp', JSON.stringify(this.state, null, 2))
      await fs.rename(file + '.tmp', file)
    }
    this.saving = this.saving.then(write, write)
    return this.saving
  }

  private stateFile () {
    return path.join(this.opts.storage, 'state.json')
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
