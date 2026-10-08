import { useCallback, useEffect, useRef } from 'react'
import type { Attachment, Message } from '../shared/api.ts'
import { type TransferMap, transferKey } from './Attachments.tsx'
import { blurUrl, fmtBytes, mediaUrl, thumbUrl, transferText } from './media.ts'

/** Full-size viewer for an album: arrow keys, buttons or a swipe to move, Esc to close. */
export function Lightbox ({ contactId, contactName, message, index, transfers, selfOffline, onIndex, onClose, onSave }: {
  contactId: string
  contactName: string
  message: Message
  index: number
  transfers: TransferMap
  selfOffline: boolean
  onIndex: (i: number) => void
  onClose: () => void
  onSave: (m: Message, a: Attachment) => void
}) {
  const items = message.attachments.filter(a => a.kind !== 'file')
  const pos = Math.max(0, items.findIndex(a => a.index === index))
  const a = items[pos]
  const swipe = useRef<number | null>(null)

  const go = useCallback((d: number) => {
    if (!items.length) return
    onIndex(items[(pos + d + items.length) % items.length].index)
  }, [items, pos, onIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  if (!a) return null
  const t = transfers.get(transferKey(message.id, a.index))
  const done = t?.state === 'done'
  const status = transferText(t, contactName, selfOffline)
  const poster = thumbUrl(message.id + ':' + a.index, a) ?? blurUrl(a.blurhash) ?? undefined
  const src = mediaUrl(contactId, message.id, a.index)

  return (
    <div className='lightbox' onClick={onClose}
      onPointerDown={e => { swipe.current = e.clientX }}
      onPointerUp={e => {
        if (swipe.current !== null && Math.abs(e.clientX - swipe.current) > 60) go(e.clientX < swipe.current ? 1 : -1)
        swipe.current = null
      }}>
      <div className='lbtop' onClick={e => e.stopPropagation()}>
        <span className='mono'>{a.name} · {fmtBytes(a.size)}</span>
        <span className='sp' />
        {items.length > 1 && <span className='mono'>{pos + 1} / {items.length}</span>}
        {done && <button className='btn' onClick={() => onSave(message, a)}>save as…</button>}
        <button className='btn' onClick={onClose}>close</button>
      </div>
      {items.length > 1 && <button className='lbnav l' onClick={e => { e.stopPropagation(); go(-1) }} aria-label='previous'>‹</button>}
      <div className='lbstage' onClick={e => e.stopPropagation()}>
        {a.kind === 'video' && done
          ? <video key={a.index} src={src} poster={poster} controls autoPlay />
          : a.kind === 'image' && done
            ? <img key={a.index} src={src} alt={a.name} draggable={false} />
            : <div className='lbwait'>
              {poster && <img src={poster} alt={a.name} draggable={false} />}
              <div className={'xfer ' + status.tone}>{a.kind === 'video' ? 'Video plays when it has fully arrived. ' : ''}{status.text}</div>
            </div>}
      </div>
      {items.length > 1 && <button className='lbnav r' onClick={e => { e.stopPropagation(); go(1) }} aria-label='next'>›</button>}
    </div>
  )
}
