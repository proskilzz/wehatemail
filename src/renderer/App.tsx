import { useCallback, useEffect, useRef, useState } from 'react'
import type { Contact, EngineEvent, Invite, Message, Settings } from '../shared/api.ts'
import { Chat } from './Chat.tsx'
import { FirstRun } from './FirstRun.tsx'
import { Info } from './Info.tsx'
import { HowModal, InviteModal, PasteModal } from './Modals.tsx'
import { Sidebar } from './Sidebar.tsx'
import { door } from './sound.ts'

type Dialog = 'invite' | 'paste' | 'how' | null

export function App () {
  const [ready, setReady] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>({ acknowledged: false, status: '', sounds: false })
  const [contacts, setContacts] = useState<Contact[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [typing, setTyping] = useState<Record<string, boolean>>({})
  const [info, setInfo] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [warning, setWarning] = useState('')

  // The event handler lives for the whole session, so it reads current values from here.
  const live = useRef({ selected, settings, contacts })
  live.current = { selected, settings, contacts }

  const loadMessages = useCallback(async (id: string) => {
    const list = await window.whm.messages(id)
    if (live.current.selected === id) setMessages(list)
    if (document.hasFocus()) await window.whm.markRead(id)
    setContacts(await window.whm.contacts())
  }, [])

  const apply = useCallback((s: { name: string | null, settings: Settings, contacts: Contact[], invites: Invite[] }) => {
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
    })
    return window.whm.onEvent(async (e: EngineEvent) => {
      if (e.type === 'invites') {
        setInvites(await window.whm.listInvites())
        return
      }
      if (e.type === 'typing') {
        setTyping(t => ({ ...t, [e.id]: e.typing }))
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
    if (selected) loadMessages(selected)
  }, [selected, loadMessages])

  useEffect(() => {
    const onFocus = () => { if (live.current.selected) loadMessages(live.current.selected) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadMessages])

  if (!ready) return null

  if (!settings.acknowledged || !name) {
    return <FirstRun onDone={async n => { apply(await window.whm.completeSetup(n)) }} />
  }

  const contact = contacts.find(c => c.id === selected) ?? null
  const updateSettings = async (patch: Partial<Settings>) => setSettings(await window.whm.updateSettings(patch))

  return (
    <>
      <div className={'app' + (info ? ' info' : '')}>
        <Sidebar
          name={name}
          settings={settings}
          contacts={contacts}
          selected={selected}
          onSelect={setSelected}
          onInvite={() => setDialog('invite')}
          onPaste={() => setDialog('paste')}
          onHow={() => setDialog('how')}
          onStatus={status => updateSettings({ status })}
        />
        <Chat
          contact={contact}
          messages={messages}
          typing={!!(contact && typing[contact.id] && contact.presence.status === 'online')}
          myName={name}
          info={info}
          onInfo={() => setInfo(v => !v)}
          onInvite={() => setDialog('invite')}
          onPaste={() => setDialog('paste')}
        />
        {info && <Info contact={contact} />}
      </div>
      {warning && (
        <div className='overlay' onClick={() => setWarning('')}>
          <div className='modal'><div className='badge' style={{ display: 'inline-block' }}>SYS</div><p>{warning}</p></div>
        </div>
      )}
      {dialog === 'invite' && <InviteModal invites={invites} onClose={() => setDialog(null)} />}
      {dialog === 'paste' && <PasteModal onClose={() => setDialog(null)} onJoined={id => { setDialog(null); setSelected(id) }} />}
      {dialog === 'how' && <HowModal settings={settings} onSettings={updateSettings} onClose={() => setDialog(null)} />}
    </>
  )
}
