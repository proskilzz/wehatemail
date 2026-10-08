import { useEffect, useState } from 'react'
import type { Contact, Settings } from '../shared/api.ts'

interface Props {
  name: string
  settings: Settings
  contacts: Contact[]
  selected: string | null
  onSelect: (id: string) => void
  onInvite: () => void
  onPaste: () => void
  onHow: () => void
  onStatus: (s: string) => void
}

export function Sidebar (p: Props) {
  const [status, setStatus] = useState(p.settings.status)
  useEffect(() => setStatus(p.settings.status), [p.settings.status])
  return (
    <aside className='pane side'>
      <div className='title'><span>Buddies</span><button onClick={p.onHow} title='How this works'>? how it works</button></div>
      <ul className='buddies'>
        {p.contacts.length === 0 && <li className='empty-list'>no buddies yet</li>}
        {p.contacts.map(c => (
          <li key={c.id} className={'buddy' + (c.id === p.selected ? ' sel' : '')} onClick={() => p.onSelect(c.id)}>
            <span className={'dot' + (c.presence.status === 'online' ? '' : ' off')} />
            {c.name}
            <span className='st'>{c.presence.status === 'online' ? '' : 'offline'}</span>
            {c.unread > 0 && c.id !== p.selected && <span className='count'>{c.unread}</span>}
          </li>
        ))}
      </ul>
      <div className='sidebtns'>
        <button className='invite' onClick={p.onInvite}>+ invite</button>
        <button className='invite paste' onClick={p.onPaste} title='Paste an invite you received'>paste</button>
      </div>
      <div className='mebox'>
        <b>{p.name}</b> <span className='dot' />
        <input
          className='status'
          value={status}
          maxLength={80}
          title='Your status line (stays on this device for now)'
          onChange={e => setStatus(e.target.value)}
          onBlur={() => p.onStatus(status)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
      </div>
    </aside>
  )
}
