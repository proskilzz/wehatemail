import { useEffect, useState } from 'react'
import type { Contact, Settings } from '../shared/api.ts'
import { Identicon } from './Identicon.tsx'

/** The AIM-style avatar boxes in the left column. */
export function Avatar ({ side, id, name, status, onStatus }: {
  side: 'them' | 'me'
  id: string
  name: string
  status: string
  onStatus?: (s: string) => void
}) {
  const [text, setText] = useState(status)
  useEffect(() => setText(status), [status])
  return (
    <div className={'pane avatar ' + side + ' ' + (side === 'them' ? 'themcol' : 'mecol')}>
      <div className='frame'><Identicon id={id} /></div>
      <div className='nm'>{name}</div>
      {onStatus
        ? (
          <input
            className='st'
            value={text}
            maxLength={80}
            placeholder='set a status'
            title='Your status line (stays on this device for now)'
            onChange={e => setText(e.target.value)}
            onBlur={() => onStatus(text)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />
          )
        : <div className='st'>{status}</div>}
    </div>
  )
}

export function BuddiesButton ({ unread, onClick }: { unread: number, onClick: () => void }) {
  return (
    <button className='buddiesbtn' onClick={onClick} title='Buddies (other chats)'>
      <svg viewBox='0 0 24 24'><path d='M4 6h16M4 12h16M4 18h16' /></svg>buddies
      {unread > 0 && <span className='newdot' title={`${unread} new in other chats`}>{unread}</span>}
    </button>
  )
}

/** Slides over the left side. Esc, the × and clicking outside all close it (App handles Esc and the scrim). */
export function Drawer ({ open, settings: _settings, contacts, selected, onSelect, onClose, onInvite, onPaste, onHow }: {
  open: boolean
  settings: Settings
  contacts: Contact[]
  selected: string | null
  onSelect: (id: string) => void
  onClose: () => void
  onInvite: () => void
  onPaste: () => void
  onHow: () => void
}) {
  return (
    <aside className={'pane drawer' + (open ? ' open' : '')} aria-hidden={!open}>
      <div className='top'>
        <div className='title'>Buddies</div>
        <button className='x' onClick={onClose} title='Close (Esc)' aria-label='Close buddies'>×</button>
      </div>
      <ul className='buddies'>
        {contacts.length === 0 && <li className='empty-list'>no buddies yet</li>}
        {contacts.map(c => (
          <li key={c.id} className={'buddy' + (c.id === selected ? ' sel' : '')} onClick={() => { onSelect(c.id); onClose() }}>
            <span className={'dot' + (c.presence.status === 'online' ? '' : ' off')} />
            {c.name}
            <span className='st'>{c.presence.status === 'online' ? '' : 'offline'}</span>
            {c.unread > 0 && c.id !== selected && <span className='count'>{c.unread}</span>}
          </li>
        ))}
      </ul>
      <div className='sidebtns'>
        <button className='invite' onClick={() => { onClose(); onInvite() }}>+ invite someone</button>
        <button className='invite paste' onClick={() => { onClose(); onPaste() }} title='Paste an invite you received'>paste</button>
      </div>
      <button className='howbtn' onClick={() => { onClose(); onHow() }}>? how this works</button>
    </aside>
  )
}
