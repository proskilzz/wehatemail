import test from 'brittle'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { stripJpeg, stripPng, stripMetadata } from '../src/core/strip-metadata.ts'
import { setup, waitFor } from './helpers.ts'

const SECRET = 'GPSLatitude37.7749N-122.4194W-SerialNumber-SECRET'

function seg (marker: number, body: Buffer) {
  const h = Buffer.from([0xff, marker, 0, 0])
  h.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([h, body])
}

/** Big-endian EXIF with an orientation tag and a pile of "GPS" text. */
function exif (orientation: number) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4)
  tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4)
  tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12)
  tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(orientation, 18)
  return seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), tiff, Buffer.from(SECRET)]))
}

const SCAN = Buffer.concat([seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), crypto.randomBytes(2000).map(b => b === 0xff ? 0xfe : b), Buffer.from([0xff, 0xd9])])

function jpeg (orientation = 1) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    exif(orientation),
    seg(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>' + SECRET)),
    seg(0xed, Buffer.from('Photoshop 3.0\0' + SECRET)),
    seg(0xfe, Buffer.from(SECRET)),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xc0, Buffer.from([8, 0, 8, 0, 8, 1, 1, 0x11, 0])),
    SCAN
  ])
}

function box (type: string, ...parts: Buffer[]) {
  const body = Buffer.concat(parts)
  const h = Buffer.alloc(8)
  h.writeUInt32BE(body.length + 8, 0); h.write(type, 4, 'latin1')
  return Buffer.concat([h, body])
}

/** A MOV-shaped file: ftyp, moov (with location in udta and meta) before mdat, like a "fast start" iPhone clip. */
function mov (moovFirst: boolean) {
  const frames = crypto.randomBytes(50_000)
  const moov = box('moov',
    box('mvhd', Buffer.alloc(100, 7)),
    box('trak', box('tkhd', Buffer.alloc(84, 3)), box('udta', Buffer.from('trak ' + SECRET))),
    box('udta', box('\xa9xyz', Buffer.from('+37.7749-122.4194/' + SECRET))),
    box('meta', Buffer.from('mdta com.apple.quicktime.location.ISO6709 ' + SECRET)))
  const ftyp = box('ftyp', Buffer.from('qt  \0\0\0\0qt  '))
  const mdat = box('mdat', frames)
  return { file: Buffer.concat(moovFirst ? [ftyp, moov, mdat] : [ftyp, mdat, moov]), frames }
}

async function tmp (t: any) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-priv-'))
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

test('JPEG: GPS, camera and comments are gone, pixels and rotation stay', t => {
  const input = jpeg(6)
  const out = stripJpeg(input)!
  t.absent(out.includes(SECRET), 'no secret text left')
  t.absent(out.includes('xmpmeta') || out.includes('Photoshop'), 'XMP and IPTC gone')
  t.ok(out.includes(SCAN), 'compressed picture data is byte-identical')
  t.ok(out.includes('JFIF'), 'JFIF header kept')
  t.ok(out.includes(Buffer.from([0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06])), 'orientation 6 kept')
  t.ok(out.length < input.length)
  t.absent(stripJpeg(jpeg(1))!.includes('Exif'), 'no EXIF at all when upright')
  t.is(stripJpeg(Buffer.from('not a jpeg')), null)
})

test('PNG: text and EXIF chunks are removed, image chunks are kept', t => {
  const chunk = (type: string, data: Buffer) => {
    const b = Buffer.alloc(12 + data.length)
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8)
    return b
  }
  const idat = chunk('IDAT', crypto.randomBytes(500))
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('GPS\0' + SECRET)), chunk('eXIf', Buffer.from(SECRET)), idat, chunk('IEND', Buffer.alloc(0))])
  const out = stripPng(png)!
  t.absent(out.includes(SECRET))
  t.ok(out.includes(idat))
})

for (const moovFirst of [true, false]) {
  test(`MOV (moov ${moovFirst ? 'before' : 'after'} the frames): location and device boxes are blanked, frames and size untouched`, async t => {
    const dir = await tmp(t)
    const { file, frames } = mov(moovFirst)
    await fs.writeFile(path.join(dir, 'in.mov'), file)
    t.ok(await stripMetadata(path.join(dir, 'in.mov'), path.join(dir, 'out.mov'), 'video/quicktime'))
    const out = await fs.readFile(path.join(dir, 'out.mov'))
    t.is(out.length, file.length, 'same size, so chunk offsets stay valid')
    t.absent(out.includes(SECRET) || out.includes('xyz') || out.includes('ISO6709'), 'no location left')
    t.ok(out.includes(frames), 'frames byte-identical')
    t.ok(out.includes('mvhd'), 'movie header kept')
    t.not(await stripMetadata(path.join(dir, 'in.mov'), path.join(dir, 'x'), 'application/pdf'), true, 'other types are not touched')
  })
}

test('sending: Photos/Video are cleaned and renamed, File and "original" are untouched', async t => {
  const { peer } = await setup(t)
  const a = await peer('Alice')
  const b = await peer('Bob')
  await b.engine.acceptInvite((await a.engine.createInvite()).code)
  await waitFor(() => a.engine.contact(b.engine.id).presence.status === 'online' && b.engine.contact(a.engine.id).presence.status === 'online')
  const dir = await tmp(t)
  const pic = jpeg(1)
  const clip = mov(true).file
  await fs.writeFile(path.join(dir, 'IMG_0042.JPG'), pic)
  await fs.writeFile(path.join(dir, 'IMG_0043.jpg'), pic)
  await fs.writeFile(path.join(dir, 'MVI_1.mov'), clip)
  const f = (name: string, mime: string, clean: boolean) => ({ path: path.join(dir, name), mime, clean })
  const sent = await a.engine.sendFiles(b.engine.id, [
    f('IMG_0042.JPG', 'image/jpeg', true),
    f('IMG_0043.jpg', 'image/jpeg', false), // "Send original" or the File button
    f('MVI_1.mov', 'video/quicktime', true)
  ])
  t.alike(sent[0].attachments.map(x => x.name), ['photo-1.jpg', 'IMG_0043.jpg', 'video-1.mov'])
  await waitFor(() => b.engine.transfers(a.engine.id).length === 3 && b.engine.transfers(a.engine.id).every(x => x.state === 'done'))
  const read = async (i: number) => {
    const parts: Buffer[] = []
    for await (const c of b.engine.readAttachment(a.engine.id, sent[0].id, i)) parts.push(c)
    return Buffer.concat(parts)
  }
  t.absent((await read(0)).includes(SECRET), 'cleaned photo has no GPS')
  t.alike(await read(1), pic, 'original is byte-for-byte what was picked')
  t.absent((await read(2)).includes(SECRET), 'cleaned video has no location')
  t.alike(await fs.readFile(path.join(dir, 'IMG_0042.JPG')), pic, 'my own file is never modified')
})
