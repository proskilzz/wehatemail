import test from 'brittle'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setup, waitFor } from './helpers.ts'

async function readAll (source: AsyncIterable<Buffer>) {
  const parts: Buffer[] = []
  for await (const chunk of source) parts.push(chunk)
  return Buffer.concat(parts)
}

async function transferWithCut (t: any, cut: (conn: any, alice: any, bob: any) => void) {
  const { peer } = await setup(t)
  const a = await peer('Alice')
  const b = await peer('Bob')
  const alice = a.engine
  const bob = b.engine
  await bob.acceptInvite((await alice.createInvite()).code)
  await waitFor(() => alice.contact(bob.id).presence.status === 'online' &&
    bob.contact(alice.id).presence.status === 'online')

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-net-'))
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }))
  const data = crypto.randomBytes(8_000_000)
  const file = path.join(dir, 'big.bin')
  await fs.writeFile(file, data)
  await alice.sendFiles(bob.id, [{ path: file, mime: 'application/octet-stream' }])

  // Wait until the transfer is genuinely under way, then cut Alice's connection to Bob.
  await waitFor(() => (bob.transfers(alice.id)[0]?.done ?? 0) > 1_000_000)
  const conn = (alice as any).conv(bob.id).conn
  cut(conn, alice, bob)

  const started = Date.now()
  await waitFor(() => bob.transfers(alice.id)[0]?.state === "done", 30000)
  t.ok(Date.now() - started < 15000, 'finished within seconds of the cut')
  const [msg] = await bob.messages(alice.id)
  t.alike(await readAll(bob.readAttachment(alice.id, msg.id, 0)), data, 'checksum-correct bytes arrived')
}

test('transfer resumes on a new socket after the connection is destroyed', async t => {
  await transferWithCut(t, conn => conn.destroy())
})

test('transfer resumes when the old connection is still half-open', async t => {
  // The old socket stays "up" but silently drops everything (a dead Wi-Fi path).
  await transferWithCut(t, (conn, alice, bob) => {
    conn.rawStream.write = () => true
    // The OS reports the network change; the dead path is dropped and redialled.
    for (const e of [alice, bob]) e.swarm.dht.emit('network-change')
  })
})

test('no false stall while the sender is still hashing/copying before any block exists', async t => {
  const { peer } = await setup(t)
  const a = await peer('Alice', { engineOpts: { stallMs: 400, beforeCopy: () => new Promise(r => setTimeout(r, 2000)) } })
  const b = await peer('Bob', { engineOpts: { stallMs: 400 } })
  const alice = a.engine
  const bob = b.engine
  await bob.acceptInvite((await alice.createInvite()).code)
  await waitFor(() => alice.contact(bob.id).presence.status === 'online' &&
    bob.contact(alice.id).presence.status === 'online')

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-stall-'))
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }))
  const data = crypto.randomBytes(1_000_000)
  const file = path.join(dir, 'slow.bin')
  await fs.writeFile(file, data)

  const warnings: string[] = []
  for (const e of [alice, bob]) e.on('warning', (_id: string, text: string) => warnings.push(text))
  const connBefore = (bob as any).conv(alice.id).conn
  await alice.sendFiles(bob.id, [{ path: file, mime: 'application/octet-stream' }])
  await waitFor(() => bob.transfers(alice.id)[0]?.state === 'done', 30000)

  t.absent(warnings.some(w => /stalled/i.test(w)), 'no stall warning while nothing was due')
  t.is((bob as any).conv(alice.id).conn, connBefore, 'the connection was not dropped')
  const [tr] = bob.transfers(alice.id)
  t.is(tr.reconnects, 0)
  t.ok(tr.startedAt > 0 && tr.finishedAt >= tr.startedAt, 'start and finish times are recorded')
  await waitFor(() => alice.transfers(bob.id)[0]?.finishedAt > 0)
})
