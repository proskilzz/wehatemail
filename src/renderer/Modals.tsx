import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import type { Invite, Settings } from '../shared/api.ts'
import { Limits } from './content.tsx'

export function Modal ({ children, onClose, wide }: { children: ReactNode, onClose: () => void, wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className='overlay' onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={'modal' + (wide ? ' wide' : '')} role='dialog'>{children}</div>
    </div>
  )
}

function expiry (ms: number) {
  const left = Math.max(0, ms - Date.now())
  const h = Math.floor(left / 3600000)
  return h >= 1 ? `expires in ${h} h` : `expires in ${Math.max(1, Math.round(left / 60000))} min`
}

export function InviteModal ({ invites, onClose }: { invites: Invite[], onClose: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const create = async () => {
    setError('')
    setCopied(false)
    try { setInvite(await window.whm.createInvite()) } catch (e: any) { setError(e.message) }
  }

  useEffect(() => { create() }, [])
  useEffect(() => {
    if (!invite) return
    QRCode.toDataURL(invite.link, { margin: 1, width: 400, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(''))
  }, [invite])

  const others = invites.filter(i => i.id !== invite?.id)
  return (
    <Modal onClose={onClose}>
      <h2>+ invite someone</h2>
      <div className='small'>Send them this link or let them scan the code. It works once and expires in 24 hours.</div>
      {invite && (
        <>
          <img className='qr' src={qr} alt='QR code for your invite link' />
          <div className='linkbox'>{invite.link}</div>
          <div className='row'>
            <button className='btn primary' onClick={() => { window.whm.copy(invite.link); setCopied(true) }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
            <button className='btn danger' onClick={async () => { await window.whm.revokeInvite(invite.id); create() }}>Revoke &amp; make a new one</button>
          </div>
          <div className='warnbox'>Anyone who gets this link before your friend does can use it. Keep it between you two.</div>
        </>
      )}
      {!invite && !error && <div className='small' style={{ margin: '12px 0' }}>making your invite and announcing it… a few seconds</div>}
      {error && <div className='err'>{error}</div>}
      {others.length > 0 && (
        <>
          <h3>Other unused invites</h3>
          {others.map(i => (
            <div className='invrow' key={i.id}>
              <span>invite · {expiry(i.expiresAt)}</span>
              <button className='btn' onClick={() => window.whm.revokeInvite(i.id)}>Revoke</button>
            </div>
          ))}
        </>
      )}
      <div className='row end'><button className='btn' onClick={onClose}>Close</button></div>
    </Modal>
  )
}

export function PasteModal ({ initial = '', onClose, onJoined }: { initial?: string, onClose: () => void, onJoined: (id: string) => void }) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const join = async () => {
    setBusy(true)
    setError('')
    try {
      const contact = await window.whm.acceptInvite(text)
      onJoined(contact.id)
    } catch (e: any) {
      setError(String(e.message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <h2>paste invite</h2>
      <div className='small' style={{ marginBottom: 8 }}>Paste the link or code your friend sent you. They need to keep their app open while you connect.</div>
      <textarea autoFocus value={text} onChange={e => setText(e.target.value)} placeholder='https://wehatemail.com/join#…' spellCheck={false} disabled={busy} />
      {busy && <div className='small' style={{ marginTop: 8 }}>connecting… this can take a few seconds</div>}
      {error && <div className='err'>{error}</div>}
      <div className='row end'>
        <button className='btn' onClick={onClose} disabled={busy}>Cancel</button>
        <button className='btn primary' onClick={join} disabled={busy || !text.trim()}>Connect</button>
      </div>
    </Modal>
  )
}

export function HowModal ({ settings, onSettings, onClose }: { settings: Settings, onSettings: (p: Partial<Settings>) => void, onClose: () => void }) {
  return (
    <Modal onClose={onClose} wide>
      <h2>how this works</h2>
      <div className='small' style={{ marginBottom: 10 }}>What We Hate Mail does and doesn't protect.</div>
      <Limits />
      <h3>Settings</h3>
      <label className='check'>
        <input type='checkbox' checked={settings.sounds} onChange={e => onSettings({ sounds: e.target.checked })} />
        door sounds when a buddy comes online or leaves
      </label>
      <div className='row end'><button className='btn' onClick={onClose}>Close</button></div>
    </Modal>
  )
}
