import { useCallback, useEffect, useRef, useState } from 'react'
import type { Contact, EngineEvent, Invite, Message, Settings, Transfer } from '../shared/api.ts'
import { Chat } from './Chat.tsx'
import { FirstRun } from './FirstRun.tsx'
import { Info } from './Info.tsx'
import { HowModal, InviteModal, PasteModal } from './Modals.tsx'
import { Avatar, BuddiesButton, Drawer } from './Buddies.tsx'
import { door } from './sound.ts'

type Dialog = 'invite' | 'paste' | 'how' | null

export function App () {
  const [ready, setReady] = useState(false)
  const [myId, setMyId] = useState('')
  const [name, setName] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>({ acknowledged: false, status: '', sounds: false })
  const [contacts, setContacts] = useState<Contact[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [typing, setTyping] = useState<Record<string, boolean>>({})
  const [info, setInfo] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [safetyFocus, setSafetyFocus] = useState(0)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [warning, setWarning] = useState('')
  // An invite link the OS opened us with; shown in the connect box once setup is done.
  const [link, setLink] = useState<string | null>(null)

  // The event handler lives for the whole session, so it reads current values from here.
  const live = useRef({ selected, settings, contacts })
  live.current = { selected, settings, contacts }

  const loadMessages = useCallback(async (id: string) => {
    const list = await window.whm.messages(id)
    const progress = await window.whm.transfers(id)
    if (live.current.selected === id) { setMessages(list); setTransfers(progress) }
    if (document.hasFocus()) await window.whm.markRead(id)
    setContacts(await window.whm.contacts())
  }, [])

  const apply = useCallback((s: { id: string, name: string | null, settings: Settings, contacts: Contact[], invites: Invite[] }) => {
    setMyId(s.id)
    setName(s.name)
    setSettings(s.settings)
    setContacts(s.contacts)
    setInvites(s.invites)
  }, [])

  useEffect(() => {
    window.whm.init().then(s => {
      apply(s)
      setSelected(s.contacts[0]?.id ?? null)
      setReady(true)
      window.whm.takeLink().then(l => { if (l) { setLink(l); setDialog('paste') } })
    })
    return window.whm.onEvent(async (e: EngineEvent) => {
      if (e.type === 'invites') {
        setInvites(await window.whm.listInvites())
        return
      }
      if (e.type === 'transfer') {
        if (e.id === live.current.selected) setTransfers(await window.whm.transfers(e.id))
        return
      }
      if (e.type === 'typing') {
        setTyping(t => ({ ...t, [e.id]: e.typing }))
        return
      }
      if (e.type === 'link') {
        setLink(e.input)
        setDialog('paste')
        return
      }
      if (e.type === 'warning') {
        setWarning(e.text)
        return
      }
      if (e.type === 'presence' && live.current.settings.sounds) {
        const before = live.current.contacts.find(c => c.id === e.id)
        const after = (await window.whm.contacts()).find(c => c.id === e.id)
        if (before && after && before.presence.status !== after.presence.status) door(after.presence.status === 'online')
      }
      setContacts(await window.whm.contacts())
      if (e.type === 'contact') setInvites(await window.whm.listInvites())
      if (e.type !== 'presence' && 'id' in e && e.id === live.current.selected) loadMessages(e.id)
    })
  }, [apply, loadMessages])

  useEffect(() => {
    setMessages([])
    setTransfers([])
    if (selected) loadMessages(selected)
  }, [selected, loadMessages])

  useEffect(() => {
    const onFocus = () => { if (live.current.selected) loadMessages(live.current.selected) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadMessages])

  // Esc closes the Buddies drawer and the Info pane (clicking outside does too, via the scrim).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { setDrawer(false); setInfo(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) return null

  if (!settings.acknowledged || !name) {
    return <FirstRun onDone={async n => { apply(await window.whm.completeSetup(n)) }} />
  }

  const contact = contacts.find(c => c.id === selected) ?? null
  const updateSettings = async (patch: Partial<Settings>) => setSettings(await window.whm.updateSettings(patch))

  return (
    <>
      <div className='app'>
        <BuddiesButton unread={contacts.reduce((n, c) => c.id === selected ? n : n + c.unread, 0)} onClick={() => setDrawer(true)} />
        {contact && (
          <Avatar
            side='them'
            id={contact.id}
            name={contact.name}
            status={contact.presence.status === 'online' ? 'online' : 'offline'}
          />
        )}
        <Avatar side='me' id={myId} name='you' status={settings.status} onStatus={status => updateSettings({ status })} />
        <Chat
          contact={contact}
          messages={messages}
          transfers={transfers}
          typing={!!(contact && typing[contact.id] && contact.presence.status === 'online')}
          myName={name}
          info={info}
          onInfo={() => setInfo(v => !v)}
          onSafety={() => { setInfo(true); setSafetyFocus(n => n + 1) }}
          onInvite={() => setDialog('invite')}
          onPaste={() => setDialog('paste')}
        />
        {(drawer || info) && <div className='scrim' onClick={() => { setDrawer(false); setInfo(false) }} />}
        <Drawer
          open={drawer}
          settings={settings}
          contacts={contacts}
          selected={selected}
          onSelect={setSelected}
          onClose={() => setDrawer(false)}
          onInvite={() => setDialog('invite')}
          onPaste={() => setDialog('paste')}
          onHow={() => setDialog('how')}
        />
        {info && <Info contact={contact} focusSafety={safetyFocus} onClose={() => setInfo(false)} />}
      </div>
      {warning && (
        <div className='overlay' onClick={() => setWarning('')}>
          <div className='modal'><div className='badge' style={{ display: 'inline-block' }}>SYS</div><p>{warning}</p></div>
        </div>
      )}
      {dialog === 'invite' && <InviteModal invites={invites} onClose={() => setDialog(null)} />}
      {dialog === 'paste' && <PasteModal initial={link ?? ''} onClose={() => { setDialog(null); setLink(null) }} onJoined={id => { setDialog(null); setLink(null); setSelected(id) }} />}
      {dialog === 'how' && <HowModal settings={settings} onSettings={updateSettings} onClose={() => setDialog(null)} />}
    </>
  )
}
