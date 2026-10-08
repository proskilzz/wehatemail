import type { Attachment, Message, Transfer } from '../shared/api.ts'
import { blurUrl, fmtBytes, fmtDuration, mediaUrl, thumbUrl, transferText } from './media.ts'

export type TransferMap = Map<string, Transfer>
export const transferKey = (messageId: string, index: number) => messageId + '#' + index

interface Ctx {
  contactId: string
  contactName: string
  transfers: TransferMap
  selfOffline: boolean
  onOpen: (m: Message, index: number) => void
  onSave: (m: Message, a: Attachment) => void
  onRetry: (m: Message, a: Attachment) => void
}

const MAX_TILES = 4

const FILE_ICON = <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='#7a828e' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'><path d='M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z' /><path d='M14 3v5h5' /></svg>
const VIDEO_ICON = <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='#7a828e' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'><rect x='3' y='6' width='13' height='12' rx='2' /><path d='M16 10l5-3v10l-5-3' /></svg>

function Bar ({ t }: { t: Transfer }) {
  const pct = t.total ? Math.min(100, 100 * t.done / t.total) : 0
  return <div className={'bar' + (t.state === 'active' ? ' live' : '')}><i style={{ width: pct + '%' }} /></div>
}

function Tile ({ m, a, extra, ctx }: { m: Message, a: Attachment, extra: number, ctx: Ctx }) {
  const t = ctx.transfers.get(transferKey(m.id, a.index))
  const done = t?.state === 'done'
  const key = m.id + ':' + a.index
  // Show the inline thumbnail at once. Without one, the full picture once it
  // has arrived, and a blurhash smear until then.
  const src = thumbUrl(key, a) ?? (a.kind === 'image' && done ? mediaUrl(ctx.contactId, m.id, a.index) : blurUrl(a.blurhash))
  return (
    <button className='ph' onClick={() => ctx.onOpen(m, a.index)} title={a.name}
      style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}>
      {src ? <img src={src} alt={a.name} draggable={false} /> : <span className='noprev'>{a.name}</span>}
      {a.kind === 'video' && <span className='play'>▶{a.duration > 0 && <small>{fmtDuration(a.duration)}</small>}</span>}
      {!done && t && t.state !== 'failed' && <Bar t={t} />}
      {extra > 0 && <span className='more'>+{extra}</span>}
    </button>
  )
}

/** Albums: 1 = full width, 2 = side by side, 3–4 = 2×2, 5+ = 2×2 with a "+N" tile. */
function Album ({ m, ctx }: { m: Message, ctx: Ctx }) {
  const items = m.attachments
  const shown = items.slice(0, MAX_TILES)
  const states = items.map(a => ctx.transfers.get(transferKey(m.id, a.index)))
  const failed = items.filter((_, i) => states[i]?.state === 'failed')
  const open = states.filter(t => t && t.state !== 'done' && t.state !== 'failed')
  const total = open.reduce((n, t) => n + t!.total, 0)
  const have = open.reduce((n, t) => n + t!.done, 0)
  const sample = open[0]
  const line = failed.length
    ? { text: 'Failed', tone: 'bad' as const }
    : sample ? transferText({ ...sample, total, done: have, speed: sample.speed }, ctx.contactName, ctx.selfOffline) : null
  return (
    <div className='albumwrap'>
      <div className={'album n' + Math.min(items.length, 4)}>
        {shown.map((a, i) => (
          <Tile key={a.index} m={m} a={a} ctx={ctx} extra={i === MAX_TILES - 1 ? items.length - MAX_TILES : 0} />
        ))}
      </div>
      {line && (
        <div className={'xfer ' + line.tone}>
          {line.text}
          {failed.length > 0 && failed[0] && <> · <button className='linkbtn' onClick={() => failed.forEach(a => ctx.onRetry(m, a))}>retry</button></>}
        </div>
      )}
    </div>
  )
}

function FileCard ({ m, a, ctx }: { m: Message, a: Attachment, ctx: Ctx }) {
  const t = ctx.transfers.get(transferKey(m.id, a.index))
  const status = transferText(t, ctx.contactName, ctx.selfOffline)
  return (
    <div className='file'>
      {a.kind === 'video' ? VIDEO_ICON : FILE_ICON}
      <div className='filebody'>
        <div className='fn'>{a.name} · {fmtBytes(a.size)}</div>
        {t && t.state !== 'done' && t.state !== 'failed' && <Bar t={t} />}
        <div className={'xfer ' + status.tone}>
          {status.tone === 'warn' && '⏸ '}{status.text}
          {t?.state === 'failed' && <> · <button className='linkbtn' onClick={() => ctx.onRetry(m, a)}>retry</button></>}
          {t?.state === 'done' && <> · <button className='linkbtn' onClick={() => ctx.onSave(m, a)}>save as…</button></>}
        </div>
      </div>
    </div>
  )
}

export function Attachments ({ m, ctx }: { m: Message, ctx: Ctx }) {
  if (!m.attachments.length) return null
  if (m.kind === 'media') return <Album m={m} ctx={ctx} />
  return <>{m.attachments.map(a => <FileCard key={a.index} m={m} a={a} ctx={ctx} />)}</>
}
