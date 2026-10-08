import { decode, encode } from 'blurhash'
import type { Attachment, Preview, Transfer } from '../shared/api.ts'

const THUMB_SIZE = 360

export function fmtBytes (n: number) {
  if (n < 1000) return n + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do { v /= 1000; i++ } while (v >= 1000 && i < units.length - 1)
  return (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i]
}

export function fmtDuration (ms: number) {
  const s = Math.round(ms / 1000)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

export const TWO_GB = 2 * 1000 ** 3

/** Plain-word state of an attachment, as in SPEC §4.5. */
export function transferText (t: Transfer | undefined, name: string, selfOffline: boolean): { text: string, tone: '' | 'warn' | 'bad' | 'ok' } {
  if (!t) return { text: '', tone: '' }
  if (t.state === 'done') return { text: 'Done', tone: 'ok' }
  if (t.state === 'failed') return { text: 'Failed', tone: 'bad' }
  const pct = t.total ? Math.min(99, Math.floor(100 * t.done / t.total)) + '%' : ''
  if (selfOffline) return { text: `Paused: you're offline · ${pct}`, tone: 'warn' }
  if (t.state === 'paused') return { text: `Paused: ${name} is offline · ${pct}`, tone: 'warn' }
  const speed = t.speed > 0 ? ' · ' + fmtBytes(t.speed) + '/s' : ''
  return { text: (t.direction === 'out' ? 'Sending ' : 'Receiving ') + pct + speed, tone: '' }
}

// ---- Previews (made here because the engine can't decode media) -------------

function drawScaled (source: CanvasImageSource, w: number, h: number, max: number) {
  const scale = Math.min(1, max / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function fromCanvas (source: CanvasImageSource, w: number, h: number): Promise<Pick<Preview, 'thumb' | 'blurhash'>> {
  const canvas = drawScaled(source, w, h, THUMB_SIZE)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.72))
  const tiny = drawScaled(canvas, canvas.width, canvas.height, 32)
  const pixels = tiny.getContext('2d')!.getImageData(0, 0, tiny.width, tiny.height)
  return {
    thumb: blob ? new Uint8Array(await blob.arrayBuffer()) : undefined,
    blurhash: encode(pixels.data, tiny.width, tiny.height, 4, 3)
  }
}

/** A small JPEG and blurhash for a picture, or a poster frame and length for a video. Never throws. */
export async function makePreview (file: File): Promise<Preview | undefined> {
  try {
    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file)
      const p = await fromCanvas(bitmap, bitmap.width, bitmap.height)
      const out = { width: bitmap.width, height: bitmap.height, ...p }
      bitmap.close()
      return out
    }
    if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file)
      try {
        const video = document.createElement('video')
        video.muted = true
        video.preload = 'auto'
        video.src = url
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve()
          video.onerror = () => reject(new Error('unreadable video'))
        })
        video.currentTime = Math.min(1, (video.duration || 0) / 10)
        await new Promise<void>(resolve => { video.onseeked = () => resolve(); setTimeout(resolve, 3000) })
        const p = await fromCanvas(video, video.videoWidth, video.videoHeight)
        return { width: video.videoWidth, height: video.videoHeight, duration: Math.round((video.duration || 0) * 1000), ...p }
      } finally {
        URL.revokeObjectURL(url)
      }
    }
  } catch {
    // No preview is fine: the tile falls back to the file itself.
  }
  return undefined
}

// ---- Showing previews --------------------------------------------------------

const urls = new Map<string, string>()

/** Data URL for the inline thumbnail of an attachment (cached per message). */
export function thumbUrl (key: string, a: Attachment): string | null {
  if (!a.thumb) return null
  let url = urls.get(key)
  if (!url) {
    let bin = ''
    for (let i = 0; i < a.thumb.length; i += 8192) bin += String.fromCharCode(...a.thumb.subarray(i, i + 8192))
    url = 'data:image/jpeg;base64,' + btoa(bin)
    urls.set(key, url)
  }
  return url
}

const blurs = new Map<string, string>()

/** A soft colour smear to show while nothing else is available. */
export function blurUrl (hash: string): string | null {
  if (!hash) return null
  let url = blurs.get(hash)
  if (!url) {
    try {
      const pixels = decode(hash, 32, 32)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const ctx = canvas.getContext('2d')!
      const image = ctx.createImageData(32, 32)
      image.data.set(pixels)
      ctx.putImageData(image, 0, 0)
      url = canvas.toDataURL()
    } catch {
      return null
    }
    blurs.set(hash, url)
  }
  return url
}

export const mediaUrl = (contactId: string, messageId: string, index: number) =>
  `whm-media://${contactId}/${encodeURIComponent(messageId)}/${index}`
