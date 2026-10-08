import type { Contact, Message, Invite, Attachment, Preview, Transfer } from '../core/index.ts'

export type { Contact, Message, Invite, Attachment, Preview, Transfer }

/** A picked file, ready to send. `path` comes from the preload (the renderer can't read paths itself). */
export interface SendFile {
  path: string
  name: string
  mime: string
  preview?: Preview
}

/** App-level settings that live outside the engine. */
export interface Settings {
  acknowledged: boolean
  /** My status line. Only stored on this device in M2 (not sent to buddies yet). */
  status: string
  sounds: boolean
}

export interface InitState {
  /** My public key (hex), used for my identicon. */
  id: string
  name: string | null
  settings: Settings
  contacts: Contact[]
  invites: Invite[]
}

export type EngineEvent =
  | { type: 'contact', contact: Contact }
  | { type: 'presence', id: string }
  | { type: 'message', id: string, message: Message }
  | { type: 'update', id: string }
  | { type: 'status', id: string }
  | { type: 'transfer', id: string }
  | { type: 'typing', id: string, typing: boolean }
  | { type: 'invites' }
  | { type: 'warning', id: string, text: string }
  /** An invite link opened from outside the app (wehatemail://join/…). */
  | { type: 'link', input: string }

/** What the renderer can ask the main process to do. */
export interface WhmApi {
  init (): Promise<InitState>
  completeSetup (name: string): Promise<InitState>
  updateSettings (patch: Partial<Settings>): Promise<Settings>
  contacts (): Promise<Contact[]>
  messages (id: string): Promise<Message[]>
  send (id: string, text: string): Promise<Message>
  sendFiles (id: string, files: SendFile[], text: string): Promise<Message[]>
  transfers (id: string): Promise<Transfer[]>
  retryTransfer (id: string, messageId: string, index: number): Promise<void>
  /** Asks where to save, then copies the file there. Resolves false if cancelled. */
  saveAttachment (id: string, messageId: string, index: number, name: string): Promise<boolean>
  /** Local path of a File from a picker or a drop. */
  pathFor (file: File): string
  markRead (id: string): Promise<void>
  setTyping (id: string, typing: boolean): Promise<void>
  setVerified (id: string, verified: boolean): Promise<void>
  createInvite (): Promise<Invite>
  revokeInvite (id: string): Promise<void>
  listInvites (): Promise<Invite[]>
  acceptInvite (input: string): Promise<Contact>
  copy (text: string): Promise<void>
  /** An invite link the OS opened the app with, if one is waiting. */
  takeLink (): Promise<string | null>
  onEvent (fn: (e: EngineEvent) => void): () => void
}

declare global {
  interface Window { whm: WhmApi }
}
