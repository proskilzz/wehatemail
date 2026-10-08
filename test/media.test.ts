import test from 'brittle'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setup, once, waitFor } from './helpers.ts'

async function tmpFile (t: any, name: string, bytes: Buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-file-'))
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, name)
  await fs.writeFile(file, bytes)
  return file
}

async function readAll (source: AsyncIterable<Buffer>) {
  const parts: Buffer[] = []
  for await (const chunk of source) parts.push(chunk)
  return Buffer.concat(parts)
}

async function pairUp (t: any) {
  const { peer } = await setup(t)
  const a = await peer('Alice')
  const b = await peer('Bob')
  await b.engine.acceptInvite((await a.engine.createInvite()).code)
  await waitFor(() => a.engine.contact(b.engine.id).presence.status === 'online' &&
    b.engine.contact(a.engine.id).presence.status === 'online')
  return { peer, alice: a.engine, bob: b.engine, aliceData: a, bobData: b }
}

test('album and file arrive with previews, checksums and progress', async t => {
  const { alice, bob } = await pairUp(t)
  const pic1 = crypto.randomBytes(300_000)
  const pic2 = crypto.randomBytes(1000)
  const video = crypto.randomBytes(200_000)
  const doc = crypto.randomBytes(500_000)
  const thumb = crypto.randomBytes(500)

  const files = [
    { path: await tmpFile(t, 'one.jpg', pic1), mime: 'image/jpeg', preview: { width: 800, height: 600, blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj', thumb } },
    { path: await tmpFile(t, 'two.png', pic2), mime: 'image/png' },
    { path: await tmpFile(t, 'clip.mp4', video), mime: 'video/mp4', preview: { width: 640, height: 360, duration: 4200 } },
    { path: await tmpFile(t, 'notes.pdf', doc), mime: 'application/pdf' }
  ]
  const album = once(bob, 'message', (_id, m) => m.kind === 'media')
  const sent = await alice.sendFiles(bob.id, files, 'trip pics')
  t.is(sent.length, 2, 'one album message and one file message')
  t.is(sent[0].kind, 'media')
  t.is(sent[0].attachments.length, 3)
  t.is(sent[0].text, 'trip pics')
  t.is(sent[1].kind, 'file')

  const [, msg] = await album
  t.is(msg.id, sent[0].id)
  t.is(msg.text, 'trip pics')
  t.alike(msg.attachments.map((a: any) => [a.kind, a.name, a.size]), [['image', 'one.jpg', 300_000], ['image', 'two.png', 1000], ['video', 'clip.mp4', 200_000]])
  t.alike(Buffer.from(msg.attachments[0].thumb), thumb, 'thumbnail comes inline')
  t.is(msg.attachments[0].blurhash, 'LEHV6nWB2yk8pyo0adR*.7kCMdnj')
  t.is(msg.attachments[2].duration, 4200)

  await waitFor(() => bob.transfers(alice.id).length === 4 && bob.transfers(alice.id).every(x => x.state === 'done'))
  t.pass('every attachment verified on the receiving side')
  await waitFor(() => alice.transfers(bob.id).every(x => x.state === 'done'))
  t.pass('sender sees them as done too')

  const list = await bob.messages(alice.id)
  t.is(list.length, 2)
  t.alike(await readAll(bob.readAttachment(alice.id, list[0].id, 0)), pic1, 'image bytes match')
  t.alike(await readAll(bob.readAttachment(alice.id, list[0].id, 2)), video, 'video bytes match')
  t.alike(await readAll(bob.readAttachment(alice.id, list[1].id, 0)), doc, 'file bytes match')
  t.alike(await readAll(bob.readAttachment(alice.id, list[0].id, 2, { start: 100, end: 199 })), video.subarray(100, 200), 'byte range for video seeking')
  t.alike(await readAll(alice.readAttachment(bob.id, sent[0].id, 0)), pic1, 'sender can read their own')

  const saved = path.join(path.dirname(files[0].path), 'saved.pdf')
  await bob.saveAttachment(alice.id, list[1].id, 0, saved)
  t.alike(await fs.readFile(saved), doc, 'save to disk')
})

test('an empty file is sent and received', async t => {
  const { alice, bob } = await pairUp(t)
  const got = once(bob, 'message', (_id, m) => m.kind === 'file')
  await alice.sendFiles(bob.id, [{ path: await tmpFile(t, 'empty.txt', Buffer.alloc(0)), mime: 'text/plain' }])
  const [, msg] = await got
  t.is(msg.attachments[0].size, 0)
  await waitFor(() => bob.transfers(alice.id)[0]?.state === 'done')
  t.is((await readAll(bob.readAttachment(alice.id, msg.id, 0))).length, 0)
})

test('a transfer waits while the other person is offline, then finishes', async t => {
  const { peer, alice, bob, bobData } = await pairUp(t)
  await bob.close()
  await waitFor(() => alice.contact(bob.id).presence.status === 'offline')

  const data = crypto.randomBytes(2_000_000)
  await alice.sendFiles(bob.id, [{ path: await tmpFile(t, 'big.bin', data), mime: 'application/octet-stream' }])
  const [tr] = alice.transfers(bob.id)
  t.is(tr.state, 'paused', 'paused while Bob is offline')
  t.is(tr.done, 0)

  const { engine: bob2 } = await peer('Bob', { storage: bobData.storage, secrets: bobData.secrets })
  await waitFor(() => bob2.transfers(alice.id)[0]?.state === 'done', 30000)
  const [msg] = await bob2.messages(alice.id)
  t.alike(await readAll(bob2.readAttachment(alice.id, msg.id, 0)), data, 'arrived after coming back')
  await waitFor(() => alice.transfers(bob.id)[0].state === 'done')
  t.pass('sender sees it done')
})

test('a file whose checksum does not match is marked failed and can be retried', async t => {
  const { alice, bob } = await pairUp(t)
  const conv = (alice as any).conv(bob.id)
  const ws = conv.mineBlobs.createWriteStream()
  ws.end(crypto.randomBytes(1000))
  await new Promise(r => ws.once('close', r))
  const id = ws.id
  const { chatEvent, encode, EventType } = await import('../src/core/encoding.ts')
  const ref = {
    kind: 2, name: 'bad.bin', mime: 'application/octet-stream', size: 1000, sha256: crypto.randomBytes(32),
    ...id, width: 0, height: 0, duration: 0, blurhash: '', thumb: Buffer.alloc(0)
  }
  await conv.mine.append(encode(chatEvent, { version: 1, type: EventType.FILE, timestamp: Date.now(), text: '', items: [ref] }))
  await waitFor(() => bob.transfers(alice.id)[0]?.state === 'failed')
  t.pass('failed')
  await t.exception(async () => { await readAll(bob.readAttachment(alice.id, alice.id + ':0', 0)) }, /not finished/)
  await bob.retryTransfer(alice.id, alice.id + ':0', 0)
  await waitFor(() => bob.transfers(alice.id)[0]?.state === 'failed')
  t.pass('downloaded again, still failing the check')
})

test('attachments are encrypted at rest', async t => {
  const { alice, bob, aliceData } = await pairUp(t)
  const marker = 'plain-marker-98765-' + 'x'.repeat(200)
  await alice.sendFiles(bob.id, [{ path: await tmpFile(t, 'secret.txt', Buffer.from(marker)), mime: 'text/plain' }])
  await alice.close()
  for (const f of await fs.readdir(aliceData.storage, { recursive: true })) {
    const p = path.join(aliceData.storage, f as string)
    if (!(await fs.stat(p)).isFile()) continue
    if ((await fs.readFile(p)).includes('plain-marker-98765')) t.fail('plaintext found in ' + f)
  }
  t.pass('no plaintext on disk')
})

test('attachments are only served inline when the declared type is allowed and the bytes agree', async t => {
  const { alice, bob } = await pairUp(t)
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), crypto.randomBytes(500)])
  const fake = Buffer.from('<html><script>alert(1)</script></html>')
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  await alice.sendFiles(bob.id, [
    { path: await tmpFile(t, 'real.png', png), mime: 'image/png' },
    { path: await tmpFile(t, 'fake.png', fake), mime: 'image/png' },
    { path: await tmpFile(t, 'evil.svg', svg), mime: 'image/svg+xml' },
    { path: await tmpFile(t, 'page.html', fake), mime: 'text/html' }
  ])
  await waitFor(() => bob.transfers(alice.id).length === 4 && bob.transfers(alice.id).every(x => x.state === 'done'))
  const [album, svgMsg, htmlMsg] = await bob.messages(alice.id)
  t.alike(album.attachments.map((a: any) => a.kind), ['image', 'image'], 'only the two png labels count as pictures')
  t.is(svgMsg.attachments[0].kind, 'file', 'svg is a plain file, not a picture')
  t.is(htmlMsg.attachments[0].kind, 'file')
  const download = { mime: 'application/octet-stream', inline: false }
  t.alike(await bob.attachmentServing(alice.id, album.id, 0), { mime: 'image/png', inline: true })
  t.alike(await bob.attachmentServing(alice.id, album.id, 1), download, 'html bytes labelled png')
  t.alike(await bob.attachmentServing(alice.id, svgMsg.id, 0), download)
  t.alike(await bob.attachmentServing(alice.id, htmlMsg.id, 0), download)
  t.alike(await alice.attachmentServing(bob.id, album.id, 0), { mime: 'image/png', inline: true }, 'sender side too')
})
