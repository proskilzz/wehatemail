import test from 'brittle'
import crypto from 'hypercore-crypto'
import { dmTopic, safetyCode, parseInvite, inviteLinks } from '../src/core/index.ts'
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
