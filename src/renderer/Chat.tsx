import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Attachment, Contact, Message, Transfer } from '../shared/api.ts'
import { Attachments, type TransferMap, transferKey } from './Attachments.tsx'
import { LOGO } from './content.tsx'
import { connection, time } from './format.ts'
import { Lightbox } from './Lightbox.tsx'
import { TWO_GB, fmtBytes, makePreview } from './media.ts'

const TOOLS = [
  { key: 'P', label: 'hotos', accept: 'image/*', multiple: true, path: <><rect x='3' y='5' width='18' height='14' rx='2' /><circle cx='9' cy='10' r='1.5' /><path d='M21 16l-5-5-8 8' /></> },
  { key: 'V', label: 'ideo', accept: 'video/*', multiple: true, path: <><rect x='3' y='6' width='13' height='12' rx='2' /><path d='M16 10l5-3v10l-5-3' /></> },
  { key: 'F', label: 'ile', accept: '', multiple: true, path: <path d='M21 11.5l-8.5 8.5a5 5 0 01-7-7L14 4.5a3.3 3.3 0 014.7 4.7L10.2 17.7a1.7 1.7 0 01-2.4-2.4L15.5 7.6' /> },
  { key: 'A', label: 'lbum', accept: 'image/*,video/*', multiple: true, path: <><rect x='3' y='3' width='8' height='8' rx='1' /><rect x='13' y='3' width='8' height='8' rx='1' /><rect x='3' y='13' width='8' height='8' rx='1' /><rect x='13' y='13' width='8' height='8' rx='1' /></> }
]

/** Delivery state of my message, in plain words (THEME.md). */
function Status ({ m, name }: { m: Message, name: string }) {
  if (m.status === 'waiting') return <span className='st wait' title={`${name} will get it when they are back online`}>waiting for {name}</span>
  const full = (ts?: number) => ts ? new Date(ts).toLocaleString() : ''
  if (m.status === 'read') {
    return <span className='st seen' title={`Delivered ${full(m.deliveredAt)} · Seen ${full(m.readAt)}`}>seen {m.readAt ? time(m.readAt) : ''}</span>
  }
  return <span className='st' title={`Delivered ${full(m.deliveredAt)}`}>delivered</span>
}

interface Staged { id: number, file: File }

/** A send in progress (copying big files takes a while) or one that went wrong. */
interface Pending { id: number, label: string, failed?: string, run: () => Promise<unknown> }

let nextId = 1

export function Chat ({ contact, messages, transfers, typing, myName, notes, info, onInfo, onSafety, onInvite, onPaste }: {
  contact: Contact | null
  messages: Message[]
  transfers: Transfer[]
  typing: boolean
  myName: string
  notes: string[]
  info: boolean
  onInfo: () => void
  onSafety: () => void
  onInvite: () => void
  onPaste: () => void
}) {
  const [text, setText] = useState('')
  const [staged, setStaged] = useState<Staged[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [dragging, setDragging] = useState(false)
  const [viewing, setViewing] = useState<{ messageId: string, index: number } | null>(null)
  const [selfOffline, setSelfOffline] = useState(!navigator.onLine)
  const area = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLElement>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const typingOff = useRef<ReturnType<typeof setTimeout>>(undefined)
  const dragDepth = useRef(0)
  const id = contact?.id

  const map: TransferMap = new Map(transfers.map(t => [transferKey(t.messageId, t.index), t]))

  useEffect(() => { setText(''); setStaged([]); setPending([]); setViewing(null); area.current?.focus() }, [id])

  useEffect(() => {
    const set = () => setSelfOffline(!navigator.onLine)
    window.addEventListener('online', set)
    window.addEventListener('offline', set)
    return () => { window.removeEventListener('online', set); window.removeEventListener('offline', set) }
  }, [])

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
  }, [messages.length, pending.length, id, typing])

  const stage = useCallback((files: File[]) => {
    if (files.length) setStaged(s => [...s, ...files.map(file => ({ id: nextId++, file }))])
    area.current?.focus()
  }, [])

  // Drop files anywhere in the window.
  useEffect(() => {
    if (!id) return
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => { if (hasFiles(e)) { dragDepth.current++; setDragging(true) } }
    const leave = (e: DragEvent) => { if (hasFiles(e) && --dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      stage([...(e.dataTransfer?.files ?? [])])
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [id, stage])

  // Alt+P / V / F / A open the pickers (the underlined letters).
  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const tool = TOOLS.find(t => t.key.toLowerCase() === e.key.toLowerCase())
      if (!tool) return
      e.preventDefault()
      inputs.current[tool.key]?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id])

  if (!contact) {
    return (
      <main className='pane emptymain'>
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

  const failure = (err: any) => String(err?.message ?? err).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

  const start = (p: Pending) => {
    setPending(list => list.map(x => x.id === p.id ? { ...x, failed: undefined } : x))
    p.run().then(
      () => setPending(list => list.filter(x => x.id !== p.id)),
      err => setPending(list => list.map(x => x.id === p.id ? { ...x, failed: failure(err) } : x))
    )
  }

  const run = (label: string, task: () => Promise<unknown>) => {
    const item: Pending = { id: nextId++, label, run: task }
    setPending(list => [...list, item])
    start(item)
  }

  const send = async () => {
    const t = text.trim()
    if (!t && !staged.length) return
    setText('')
    clearTimeout(typingOff.current)
    window.whm.setTyping(contact.id, false)
    if (!staged.length) {
      await window.whm.send(contact.id, t)
      return
    }
    const batch = staged
    setStaged([])
    const label = batch.length === 1 ? batch[0].file.name : `${batch.length} files`
    run(label, async () => {
      const files = []
      for (const { file } of batch) {
        files.push({ path: window.whm.pathFor(file), name: file.name, mime: file.type || 'application/octet-stream', preview: await makePreview(file) })
      }
      await window.whm.sendFiles(contact.id, files, t)
    })
  }

  const onChange = (v: string) => {
    setText(v)
    window.whm.setTyping(contact.id, v.length > 0)
    clearTimeout(typingOff.current)
    typingOff.current = setTimeout(() => window.whm.setTyping(contact.id, false), 4000)
  }

  const save = (m: Message, a: Attachment) => { window.whm.saveAttachment(contact.id, m.id, a.index, a.name) }
  const retry = (m: Message, a: Attachment) => { window.whm.retryTransfer(contact.id, m.id, a.index) }
  const ctx = {
    contactId: contact.id,
    contactName: contact.name,
    transfers: map,
    selfOffline,
    onOpen: (m: Message, index: number) => setViewing({ messageId: m.id, index }),
    onSave: save,
    onRetry: retry
  }

  const total = staged.reduce((n, s) => n + s.file.size, 0)
  const online = contact.presence.status === 'online'
  const viewed = viewing ? messages.find(m => m.id === viewing.messageId) : undefined
  return (
    <>
      <header className='pane head'>
        <div>
          <div className='name'>{contact.name}</div>
          <div className='sub'>
            {contact.verified
              ? 'verified ✓'
              : <>for extra security, compare codes · <button className='linkbtn' onClick={onSafety}>Info</button></>}
          </div>
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
        {notes.map((n, i) => <div className='sys' key={i}><span className='badge'>SYS</span><span>{n}</span></div>)}
        {!online && <div className='sys'><span className='badge'>SYS</span>{contact.name} is offline. messages and files are delivered when you are both back.</div>}
        {messages.map(m => (
          <div className={'msg' + (m.deleted ? ' deleted' : '')} key={m.id}>
            <div className='meta'>
              <span className={'who ' + (m.fromMe ? 'me' : 'them')}>{m.fromMe ? myName : contact.name}</span>
              {time(m.timestamp)}{m.edited && !m.deleted && ' (edited)'}
              {m.fromMe && m.status && <Status m={m} name={contact.name} />}
            </div>
            {(m.deleted || m.text) && <span className='body'>{m.deleted ? 'message deleted' : m.text}</span>}
            <Attachments m={m} ctx={ctx} />
          </div>
        ))}
        {pending.map(p => (
          <div className='msg' key={p.id}>
            <div className='meta'>
              <span className='who me'>{myName}</span>
              {p.failed
                ? <span className='st fail'>failed · <button className='linkbtn' onClick={() => start(p)}>retry</button></span>
                : <span className='st'>sending…</span>}
            </div>
            <div className='file'><div className='filebody'><div className='fn'>{p.label}</div>{p.failed && <div className='xfer bad'>{p.failed}</div>}</div></div>
          </div>
        ))}
        {typing && <div className='typing'>{contact.name} is typing</div>}
      </section>

      <div className='pane compose'>
        {staged.length > 0 && (
          <div className='tray'>
            {staged.map(s => (
              <span className='chip' key={s.id} title={s.file.name}>
                {s.file.name} · {fmtBytes(s.file.size)}
                <button onClick={() => setStaged(list => list.filter(x => x.id !== s.id))} aria-label={`remove ${s.file.name}`}>×</button>
              </span>
            ))}
            {total > TWO_GB && <div className='warnbox'>Over 2 GB: both of you need to stay online until this finishes.</div>}
          </div>
        )}
        <textarea
          ref={area}
          value={text}
          placeholder='type a message…  (enter to send, shift+enter for a new line)'
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
          }}
        />
      </div>

      <div className='pane tools'>
          {TOOLS.map(t => (
            <button key={t.key} className='tool' onClick={() => inputs.current[t.key]?.click()} title={`${t.key}${t.label} (Alt+${t.key})`}>
              <svg viewBox='0 0 24 24'>{t.path}</svg><span><u>{t.key}</u>{t.label}</span>
              <input
                ref={el => { inputs.current[t.key] = el }}
                type='file'
                hidden
                multiple={t.multiple}
                accept={t.accept || undefined}
                onClick={e => e.stopPropagation()}
                onChange={e => { stage([...(e.target.files ?? [])]); e.target.value = '' }}
              />
            </button>
          ))}
          <div className='sp' />
          <span className='hint'>or drop files anywhere</span>
          <button className='tool send' onClick={send} disabled={!text.trim() && !staged.length}>Send <svg viewBox='0 0 24 24'><path d='M4 12h15M13 6l6 6-6 6' /></svg></button>
      </div>

      {dragging && <div className='dropveil'><div>drop files to send to {contact.name}</div></div>}
      {viewed && viewing && (
        <Lightbox
          contactId={contact.id}
          contactName={contact.name}
          message={viewed}
          index={viewing.index}
          transfers={map}
          selfOffline={selfOffline}
          onIndex={index => setViewing({ messageId: viewed.id, index })}
          onClose={() => setViewing(null)}
          onSave={save}
        />
      )}
    </>
  )
}
