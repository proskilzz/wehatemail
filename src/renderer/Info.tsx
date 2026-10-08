import { useEffect, useRef } from 'react'
import type { Contact } from '../shared/api.ts'
import { LOGO, Limits } from './content.tsx'
import { connection } from './format.ts'

export function Info ({ contact, focusSafety, onClose }: { contact: Contact | null, focusSafety: number, onClose: () => void }) {
  const safety = useRef<HTMLDivElement>(null)
  // The "Info" link in the chat header lands here.
  useEffect(() => { if (focusSafety) safety.current?.scrollIntoView({ block: 'start' }) }, [focusSafety])
  return (
    <aside className='pane infop'>
      <div className='top'>
        <div className='title'>Info{contact ? ' · ' + contact.name : ''}</div>
        <button className='x' onClick={onClose} title='Close (Esc)' aria-label='Close info'>×</button>
      </div>
      <pre className='ascii'>{LOGO}</pre>
      {contact && (
        <>
          <div ref={safety} />
          <h3>Safety code</h3>
          <div className='code'>{contact.safetyCode}</div>
          <div className='small'>Compare this with {contact.name} by voice or in person. If it matches, tap verify.</div>
          <div className='row' style={{ marginTop: 8 }}>
            <button className='btn' onClick={() => window.whm.setVerified(contact.id, !contact.verified)}>
              {contact.verified ? 'Verified ✓ (undo)' : 'Mark as verified'}
            </button>
          </div>
          <h3>Connection</h3>
          <div>{connection(contact)}</div>
        </>
      )}
      <h3>Limitations</h3>
      <Limits />
    </aside>
  )
}
