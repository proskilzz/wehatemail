// Remove location, camera and date metadata from pictures and videos, without re-encoding.
// Pure Node (no Electron), so it is testable headless.
//
// - JPEG: drop every APPn segment except JFIF, the ICC colour profile and Adobe, and all
//   comments. If the picture is rotated by its EXIF orientation, keep a tiny EXIF that holds
//   only the orientation.
// - PNG: drop text, EXIF and time chunks. WebP: drop the EXIF and XMP chunks.
// - MP4 / MOV: overwrite `udta`, `meta` (and top-level `uuid`) boxes with a same-size `free`
//   box. Nothing moves, so chunk offsets stay valid and the audio/video bytes are untouched.

import fs from 'node:fs/promises'
import { normalizeMime } from './media-type.ts'

const MAX_IN_MEMORY = 256 * 1024 * 1024
const MAX_MOOV = 64 * 1024 * 1024

/** Mime types this module can clean. Anything else is sent as it is. */
export function canStrip (mime: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'].includes(normalizeMime(mime))
}

/** Write a cleaned copy of `src` to `dest`. Returns false (and writes nothing) when the file isn't a type we can clean. */
export async function stripMetadata (src: string, dest: string, mime: string): Promise<boolean> {
  const type = normalizeMime(mime)
  if (type === 'video/mp4' || type === 'video/quicktime') return stripIso(src, dest)
  if (type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/webp') return false
  const st = await fs.stat(src)
  if (st.size > MAX_IN_MEMORY) return false
  const input = await fs.readFile(src)
  const out = type === 'image/jpeg' ? stripJpeg(input) : type === 'image/png' ? stripPng(input) : stripWebp(input)
  if (!out) return false
  await fs.writeFile(dest, out, { mode: 0o600 })
  return true
}

// ---- JPEG --------------------------------------------------------------------

/** EXIF orientation (1–8) of a JPEG APP1 payload, or 1. */
function exifOrientation (seg: Buffer): number {
  // seg = "Exif\0\0" + TIFF
  if (seg.length < 14 || seg.toString('latin1', 0, 4) !== 'Exif') return 1
  const t = seg.subarray(6)
  const le = t.toString('latin1', 0, 2) === 'II'
  if (!le && t.toString('latin1', 0, 2) !== 'MM') return 1
  const u16 = (o: number) => le ? t.readUInt16LE(o) : t.readUInt16BE(o)
  const u32 = (o: number) => le ? t.readUInt32LE(o) : t.readUInt32BE(o)
  try {
    const ifd = u32(4)
    const n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      if (u16(e) === 0x0112) {
        const v = u16(e + 8)
        return v >= 1 && v <= 8 ? v : 1
      }
    }
  } catch {}
  return 1
}

function orientationOnlyExif (orientation: number): Buffer {
  const b = Buffer.alloc(2 + 2 + 6 + 8 + 2 + 12 + 4)
  let o = 0
  b[o++] = 0xff; b[o++] = 0xe1
  b.writeUInt16BE(b.length - 2, o); o += 2
  b.write('Exif\0\0', o, 'latin1'); o += 6
  b.write('MM', o, 'latin1'); o += 2
  b.writeUInt16BE(42, o); o += 2
  b.writeUInt32BE(8, o); o += 4
  b.writeUInt16BE(1, o); o += 2 // one entry
  b.writeUInt16BE(0x0112, o); o += 2
  b.writeUInt16BE(3, o); o += 2 // SHORT
  b.writeUInt32BE(1, o); o += 4
  b.writeUInt16BE(orientation, o)
  return b
}

export function stripJpeg (input: Buffer): Buffer | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null
  const kept: Buffer[] = [input.subarray(0, 2)]
  let orientation = 1
  let jfif = -1
  let pos = 2
  while (pos + 4 <= input.length) {
    if (input[pos] !== 0xff) return null
    const marker = input[pos + 1]
    if (marker === 0xff) { pos++; continue }
    // Markers without a length, then start of scan: the rest is image data, copy it whole.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { kept.push(input.subarray(pos, pos + 2)); pos += 2; continue }
    if (marker === 0xda) { kept.push(input.subarray(pos)); pos = input.length; break }
    const len = input.readUInt16BE(pos + 2)
    if (len < 2 || pos + 2 + len > input.length) return null
    const seg = input.subarray(pos, pos + 2 + len)
    const body = seg.subarray(4)
    let keep = true
    if (marker === 0xe1 && body.toString('latin1', 0, 4) === 'Exif') { orientation = exifOrientation(body); keep = false } else if (marker === 0xe0) {
      keep = body.toString('latin1', 0, 4) === 'JFIF'
      if (keep) jfif = kept.length
    } else if (marker === 0xe2) keep = body.toString('latin1', 0, 11) === 'ICC_PROFILE'
    else if (marker === 0xee) keep = body.toString('latin1', 0, 5) === 'Adobe'
    else if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) keep = false
    if (keep) kept.push(seg)
    pos += 2 + len
  }
  if (orientation !== 1) kept.splice(jfif >= 0 ? jfif + 1 : 1, 0, orientationOnlyExif(orientation))
  return Buffer.concat(kept)
}

// ---- PNG / WebP --------------------------------------------------------------

export function stripPng (input: Buffer): Buffer | null {
  if (input.length < 8 || input[0] !== 0x89 || input.toString('latin1', 1, 4) !== 'PNG') return null
  const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'])
  const kept: Buffer[] = [input.subarray(0, 8)]
  for (let pos = 8; pos < input.length;) {
    if (pos + 12 > input.length) return null
    const len = input.readUInt32BE(pos)
    const end = pos + 12 + len
    if (end > input.length) return null
    if (!drop.has(input.toString('latin1', pos + 4, pos + 8))) kept.push(input.subarray(pos, end))
    pos = end
  }
  return Buffer.concat(kept)
}

export function stripWebp (input: Buffer): Buffer | null {
  if (input.length < 12 || input.toString('latin1', 0, 4) !== 'RIFF' || input.toString('latin1', 8, 12) !== 'WEBP') return null
  const kept: Buffer[] = [input.subarray(0, 12)]
  for (let pos = 12; pos + 8 <= input.length;) {
    const tag = input.toString('latin1', pos, pos + 4)
    const size = input.readUInt32LE(pos + 4)
    const end = pos + 8 + size + (size & 1)
    if (end > input.length + 1) return null
    const chunk = Buffer.from(input.subarray(pos, Math.min(end, input.length)))
    if (tag === 'EXIF' || tag === 'XMP ') { pos = end; continue }
    if (tag === 'VP8X' && chunk.length >= 9) chunk[8] &= ~(0x08 | 0x04) // no EXIF, no XMP
    kept.push(chunk)
    pos = end
  }
  const out = Buffer.concat(kept)
  out.writeUInt32LE(out.length - 8, 4)
  return out
}

// ---- MP4 / MOV ---------------------------------------------------------------

interface Box { start: number, size: number, type: string, header: number }

function readBox (buf: Buffer, pos: number, limit: number): Box | null {
  if (pos + 8 > limit) return null
  let size = buf.readUInt32BE(pos)
  const type = buf.toString('latin1', pos + 4, pos + 8)
  let header = 8
  if (size === 1) {
    if (pos + 16 > limit) return null
    size = Number(buf.readBigUInt64BE(pos + 8))
    header = 16
  } else if (size === 0) size = limit - pos
  if (size < header || pos + size > limit) return null
  return { start: pos, size, type, header }
}

/** Turn the box at `pos` into a same-size `free` box. */
function blank (buf: Buffer, box: Box) {
  buf.fill(0, box.start, box.start + box.size)
  buf.writeUInt32BE(box.size, box.start)
  buf.write('free', box.start + 4, 'latin1')
}

/** Blank udta/meta boxes inside a container box (moov, trak). */
function cleanContainer (buf: Buffer, from: number, to: number) {
  for (let pos = from; pos < to;) {
    const box = readBox(buf, pos, to)
    if (!box) return
    if (box.type === 'udta' || box.type === 'meta') blank(buf, box)
    else if (box.type === 'trak') cleanContainer(buf, box.start + box.header, box.start + box.size)
    pos += box.size
  }
}

async function stripIso (src: string, dest: string): Promise<boolean> {
  const fh = await fs.open(src, 'r')
  try {
    const size = (await fh.stat()).size
    const head = Buffer.alloc(16)
    // Walk the top-level boxes, remembering where metadata lives.
    const patches: { box: Box, at: number }[] = []
    const moovs: Box[] = []
    let sawFtyp = false
    for (let pos = 0; pos < size;) {
      const { bytesRead } = await fh.read(head, 0, 16, pos)
      if (bytesRead < 8) return false
      let boxSize = head.readUInt32BE(0)
      let header = 8
      if (boxSize === 1) {
        if (bytesRead < 16) return false
        boxSize = Number(head.readBigUInt64BE(8))
        header = 16
      } else if (boxSize === 0) boxSize = size - pos
      if (boxSize < header) return false
      const box: Box = { start: pos, size: boxSize, type: head.toString('latin1', 4, 8), header }
      if (pos === 0 && box.type !== 'ftyp') return false
      if (box.type === 'ftyp') sawFtyp = true
      if (box.type === 'moov') moovs.push(box)
      else if (box.type === 'meta' || box.type === 'udta' || box.type === 'uuid') patches.push({ box, at: pos })
      if (pos + box.size > size) return false
      pos += box.size
    }
    if (!sawFtyp) return false
    await fs.copyFile(src, dest)
    const out = await fs.open(dest, 'r+')
    try {
      for (const { box, at } of patches) {
        const free = Buffer.alloc(Math.min(box.size, 1 << 20))
        // Blank top-level boxes in place: header first, then zeros.
        const h = Buffer.alloc(8)
        h.writeUInt32BE(box.size > 0xffffffff ? 1 : box.size, 0)
        h.write('free', 4, 'latin1')
        if (box.size > 0xffffffff) throw new Unsupported()
        await out.write(h, 0, 8, at)
        for (let off = 8; off < box.size; off += free.length) await out.write(free, 0, Math.min(free.length, box.size - off), at + off)
      }
      for (const moov of moovs) {
        if (moov.size > MAX_MOOV) throw new Unsupported()
        const buf = Buffer.alloc(moov.size)
        await out.read(buf, 0, moov.size, moov.start)
        cleanContainer(buf, moov.header, moov.size)
        await out.write(buf, 0, moov.size, moov.start)
      }
    } catch (err) {
      await out.close().catch(() => {})
      await fs.rm(dest, { force: true })
      if (err instanceof Unsupported) return false
      throw err
    }
    await out.close()
    return true
  } finally {
    await fh.close()
  }
}

class Unsupported extends Error {}
