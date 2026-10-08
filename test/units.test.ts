import test from 'brittle'
import crypto from 'hypercore-crypto'
import { dmTopic, safetyCode, parseInvite, inviteLinks, findInviteLink, servedType, isInlineType } from '../src/core/index.ts'
import { detectOS, inviteFromHash, appLink } from '../site/join/join.js'
import { chatEvent, encode, decode, EventType } from '../src/core/encoding.ts'

test('dm topic and safety code do not depend on order', t => {
  const a = crypto.keyPair().publicKey
  const b = crypto.keyPair().publicKey
  t.alike(dmTopic(a, b), dmTopic(b, a))
  t.is(safetyCode(a, b), safetyCode(b, a))
  t.ok(/^\d{5} \d{5} \d{5} \d{5}$/.test(safetyCode(a, b)))
  t.not(safetyCode(a, b), safetyCode(a, crypto.keyPair().publicKey))
})

test('invite links round-trip', t => {
  const code = 'cfo3e5jpcfo3e5jpcfo3e5jp'
  const buf = parseInvite(code)
  const { link, appLink } = inviteLinks(code)
  t.ok(link.startsWith('https://wehatemail.com/join#'))
  t.alike(parseInvite(link), buf)
  t.alike(parseInvite(appLink), buf)
  t.alike(parseInvite('  ' + link + '\n'), buf)
  t.exception(() => parseInvite('!!!'))
})

test('events encode and decode', t => {
  const text = { version: 1, type: EventType.TEXT, timestamp: 1700000000000, text: 'hi 👋' }
  t.alike(decode(chatEvent, encode(chatEvent, text)), text)
  const edit = { version: 1, type: EventType.EDIT, timestamp: 1, target: 3, text: 'x' }
  t.alike(decode(chatEvent, encode(chatEvent, edit)), edit)
  const del = { version: 1, type: EventType.DELETE, timestamp: 2, target: 0 }
  t.alike(decode(chatEvent, encode(chatEvent, del)), del)
})

test('wehatemail:// links are found in command lines and OS calls', t => {
  const code = 'cfo3e5jpcfo3e5jp'
  t.is(findInviteLink(['electron', '--flag', 'wehatemail://join/' + code]), 'wehatemail://join/' + code)
  t.is(findInviteLink(['wehatemail://join/' + code + '/']), 'wehatemail://join/' + code + '/')
  t.is(findInviteLink(['electron', 'https://evil.example/join/' + code]), null)
  t.is(findInviteLink(['wehatemail://other/' + code]), null)
  t.is(findInviteLink(['wehatemail://join/abc;rm -rf']), null)
  t.alike(parseInvite('wehatemail://join/' + code + '/'), parseInvite(code))
})

test('inline media needs an allowlisted type and matching bytes', t => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex')
  const gif = Buffer.from('GIF89a......', 'latin1')
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)])
  const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  ', 'latin1'), Buffer.alloc(8)])
  const webm = Buffer.from('1a45dfa3010000000000001f', 'hex')
  const html = Buffer.from('<html><script>alert(1)</script>', 'latin1')
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'latin1')

  t.alike(servedType('image/png', png), { mime: 'image/png', inline: true })
  t.alike(servedType('Image/JPEG; charset=x', jpeg), { mime: 'image/jpeg', inline: true })
  t.alike(servedType('image/gif', gif), { mime: 'image/gif', inline: true })
  t.alike(servedType('video/mp4', mp4), { mime: 'video/mp4', inline: true })
  t.alike(servedType('video/quicktime', mov), { mime: 'video/quicktime', inline: true })
  t.alike(servedType('video/mp4', mov), { mime: 'video/mp4', inline: true }, 'same container family')
  t.alike(servedType('video/webm', webm), { mime: 'video/webm', inline: true })

  const download = { mime: 'application/octet-stream', inline: false }
  t.alike(servedType('image/png', html), download, 'declared png, really html')
  t.alike(servedType('image/png', jpeg), download, 'declared png, really jpeg')
  t.alike(servedType('image/svg+xml', svg), download, 'svg is never inline')
  t.alike(servedType('text/html', html), download, 'html is never inline')
  t.alike(servedType('application/pdf', Buffer.from('%PDF-1.7')), download)
  t.alike(servedType('image/png', Buffer.alloc(0)), download, 'empty')
  t.ok(!isInlineType('image/svg+xml') && !isInlineType('text/html') && isInlineType('IMAGE/PNG'))
})

test('join page: OS detection and invite from the address', t => {
  t.is(detectOS('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac')
  t.is(detectOS('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows')
  t.is(detectOS('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)'), 'linux')
  t.is(detectOS('', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'mobile', 'iPhone is not a Mac')
  t.is(detectOS('Linux armv8l', 'Mozilla/5.0 (Linux; Android 14)'), 'mobile', 'Android is not Linux')
  t.is(detectOS('', ''), 'other')
  t.is(inviteFromHash('#cfo3e5jpcfo3e5jp'), 'cfo3e5jpcfo3e5jp')
  t.is(inviteFromHash(''), null)
  t.is(inviteFromHash('#short'), null)
  t.is(inviteFromHash('#abc<script>alert(1)</script>'), null)
  t.is(appLink('cfo3e5jpcfo3e5jp'), 'wehatemail://join/cfo3e5jpcfo3e5jp')
})
