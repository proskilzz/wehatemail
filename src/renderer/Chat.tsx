import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Contact, Message } from '../shared/api.ts'
import { LOGO } from './content.tsx'
import { connection, time } from './format.ts'

const TOOLS = [
  { key: 'P', label: 'hotos', path: <><rect x='3' y='5' width='18' height='14' rx='2' /><circle cx='9' cy='10' r='1.5' /><path d='M21 16l-5-5-8 8' /></> },
  { key: 'V', label: 'ideo', path: <><rect x='3' y='6' width='13' height='12' rx='2' /><path d='M16 10l5-3v10l-5-3' /></> },
  { key: 'F', label: 'ile', path: <path d='M21 11.5l-8.5 8.5a5 5 0 01-7-7L14 4.5a3.3 3.3 0 014.7 4.7L10.2 17.7a1.7 1.7 0 01-2.4-2.4L15.5 7.6' /> },
  { key: 'A', label: 'lbum', path: <><rect x='3' y='3' width='8' height='8' rx='1' /><rect x='13' y='3' width='8' height='8' rx='1' /><rect x='3' y='13' width='8' height='8' rx='1' /><rect x='13' y='13' width='8' height='8' rx='1' /></> }
]

function Marks ({ m, name }: { m: Message, name: string }) {
  if (m.status === 'waiting') return <span className='wait' title={`Waiting for ${name}`}>✓ waiting for {name}</span>
  const read = m.status === 'read'
  return (
    <span className={'dr' + (read ? ' read' : '')} title={read ? 'Delivered and read' : 'Delivered'}>
      <span className='d'>D</span>{read && <span className='r'>R</span>}
    </span>
  )
}

export function Chat ({ contact, messages, typing, myName, info, onInfo, onInvite, onPaste }: {
  contact: Contact | null
  messages: Message[]
  typing: boolean
  myName: string
  info: boolean
  onInfo: () => void
  onInvite: () => void
  onPaste: () => void
}) {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLElement>(null)
  const typingOff = useRef<ReturnType<typeof setTimeout>>(undefined)
  const id = contact?.id

  useEffect(() => { setText(''); area.current?.focus() }, [id])

  // Grow with the text, from 5 lines up to 40% of the window (CSS max-height).
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [text, id])

  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, id, typing])

  if (!contact) {
    return (
      <main className='chat pane' style={{ display: 'grid', border: '1px solid var(--line)', background: 'var(--pane)' }}>
        <div className='emptyp'>
          <div>
            <pre className='ascii'>{LOGO}</pre>
            <h2>No mail. Just us.</h2>
            <p>Invite someone to start a private chat, straight between your two devices.</p>
            <div className='row' style={{ justifyContent: 'center' }}>
              <button className='btn primary' onClick={onInvite}>+ invite someone</button>
              <button className='btn' onClick={onPaste}>paste invite</button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    clearTimeout(typingOff.current)
    window.whm.setTyping(contact.id, false)
    await window.whm.send(contact.id, t)
  }

  const onChange = (v: string) => {
    setText(v)
    window.whm.setTyping(contact.id, v.length > 0)
    clearTimeout(typingOff.current)
    typingOff.current = setTimeout(() => window.whm.setTyping(contact.id, false), 4000)
  }

  const online = contact.presence.status === 'online'
  return (
    <main className='chat pane'>
      <header className='pane head'>
        <div>
          <div className='name'>{contact.name}</div>
          <div className='sub'>{contact.verified ? 'verified ✓' : 'not verified yet · compare safety codes in Info'}</div>
        </div>
        <div className={'conn' + (!online ? ' off' : contact.presence.via === 'relay' ? ' relay' : '')}>
          <span className={'dot' + (online ? '' : ' off')} />{connection(contact).toLowerCase()}
        </div>
        <button className={'iconbtn' + (info ? ' on' : '')} onClick={onInfo} title='Info: safety code, connection, limitations'>ⓘ</button>
      </header>

      <section className='pane log' ref={log}>
        <div className='sys'><span className='badge'>SYS</span><span>you and {contact.name} are connected. nothing in between.</span>
          {contact.verified && <span className='ok'>safety code matched ✓</span>}
        </div>
        {!online && <div className='sys'><span className='badge'>SYS</span>{contact.name} is offline. messages are delivered when you are both back.</div>}
        {messages.map(m => (
          <div className={'msg' + (m.deleted ? ' deleted' : '')} key={m.id}>
            <div className='meta'>
              <span className={'who ' + (m.fromMe ? 'me' : 'them')}>{m.fromMe ? myName : contact.name}</span>
              {time(m.timestamp)}{m.edited && !m.deleted && ' (edited)'}
              {m.fromMe && m.status && <Marks m={m} name={contact.name} />}
            </div>
            <span className='body'>{m.deleted ? 'message deleted' : m.text}</span>
          </div>
        ))}
        {typing && <div className='typing'>{contact.name} is typing</div>}
      </section>

      <div className='pane compose'>
        <textarea
          ref={area}
          value={text}
          placeholder='type a message…  (enter to send, shift+enter for a new line)'
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
          }}
        />
        <div className='tools'>
          {TOOLS.map(t => (
            <button key={t.key} className='tool' disabled title='Photos, video and files arrive in the next milestone'>
              <svg viewBox='0 0 24 24'>{t.path}</svg><span><u>{t.key}</u>{t.label}</span>
            </button>
          ))}
          <div className='sp' />
          <span className='hint'>attachments: coming soon</span>
          <button className='tool send' onClick={send} disabled={!text.trim()}>Send <svg viewBox='0 0 24 24'><path d='M4 12h15M13 6l6 6-6 6' /></svg></button>
        </div>
      </div>
    </main>
  )
}
