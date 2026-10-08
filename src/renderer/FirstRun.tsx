import { useState } from 'react'
import { LOGO, Limits } from './content.tsx'

export function FirstRun ({ onDone }: { onDone: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ok = name.trim().length > 0 && !busy

  const go = async () => {
    setBusy(true)
    try { await onDone(name.trim()) } catch (e: any) { setError(e.message); setBusy(false) }
  }

  return (
    <div className='pane' style={{ margin: 8, height: 'calc(100vh - 16px)' }}>
      <div className='firstrun'>
        <pre className='ascii'>{LOGO}</pre>
        <h2 className='mono' style={{ margin: '0 0 4px' }}>welcome. no mail. just us.</h2>
        <p style={{ marginTop: 0 }}>Pick a name your friends will see. It stays on your devices and is shared only with people you invite.</p>
        <input className='field' autoFocus maxLength={40} placeholder='display name' value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ok) go() }} />
        <div className='badge' style={{ display: 'inline-block', margin: '20px 0 8px' }}>SYS</div>
        <div className='small' style={{ marginBottom: 8 }}>Please read this once. It's what the app does and doesn't protect.</div>
        <Limits />
        {error && <div className='err'>{error}</div>}
        <div className='row end'><button className='btn primary' disabled={!ok} onClick={go}>I understand</button></div>
      </div>
    </div>
  )
}
