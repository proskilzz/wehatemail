import type { Contact, Message, Invite } from '../core/index.ts'

export type { Contact, Message, Invite }

/** App-level settings that live outside the engine. */
export interface Settings {
  acknowledged: boolean
  /** My status line. Only stored on this device in M2 (not sent to buddies yet). */
  status: string
  sounds: boolean
}

export interface InitState {
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
  | { type: 'typing', id: string, typing: boolean }
  | { type: 'invites' }
  | { type: 'warning', id: string, text: string }

/** What the renderer can ask the main process to do. */
export interface WhmApi {
  init (): Promise<InitState>
  completeSetup (name: string): Promise<InitState>
  updateSettings (patch: Partial<Settings>): Promise<Settings>
  contacts (): Promise<Contact[]>
  messages (id: string): Promise<Message[]>
  send (id: string, text: string): Promise<Message>
  markRead (id: string): Promise<void>
  setTyping (id: string, typing: boolean): Promise<void>
  setVerified (id: string, verified: boolean): Promise<void>
  createInvite (): Promise<Invite>
  revokeInvite (id: string): Promise<void>
  listInvites (): Promise<Invite[]>
  acceptInvite (input: string): Promise<Contact>
  copy (text: string): Promise<void>
  onEvent (fn: (e: EngineEvent) => void): () => void
}

declare global {
  interface Window { whm: WhmApi }
}
