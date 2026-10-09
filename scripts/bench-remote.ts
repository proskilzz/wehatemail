// The engine across two real machines over the public DHT, no UI.
//
//   npm run bench -- --listen [MB]        machine A: prints an invite code, sends MB (default 500)
//   npm run bench -- --connect <code>     machine B: pairs, receives, prints MB/s and the path
//   add --reverse on the connecting side to send B → A instead
//   add --inflight 64,512 on the receiving side to try more block requests in flight (default 16,512)
//
// Each side prints one JSON line. Compare with `npm run linktest` (raw connection) and a
// plain TCP copy (docs/TESTING.md) to see where the time goes.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Engine, MemorySecretStore } from '../src/core/index.ts'

const args = process.argv.slice(2)
const listening = args.includes('--listen')
const reverse = args.includes('--reverse')
const mb = Number(args.find(a => /^\d+$/.test(a)) ?? 500)
const wait = async (fn: () => boolean) => { while (!fn()) await new Promise(r => setTimeout(r, 50)) }

const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-bench-'))
const inflight = args.includes('--inflight') ? args[args.indexOf('--inflight') + 1].split(',').map(Number) as [number, number] : undefined
const engine = new Engine({ storage, secrets: new MemorySecretStore(), inflightRange: inflight })
await engine.ready()
await engine.setName(listening ? 'Listener' : 'Connector')

let peerId: string
if (listening) {
  const invite = await engine.createInvite()
  console.error(`waiting… on the other machine run:\n  npm run bench -- --connect ${invite.code}${reverse ? ' --reverse' : ''}`)
  await new Promise<void>(resolve => engine.once('contact', () => resolve()))
  peerId = engine.contacts()[0].id
} else {
  const code = args[args.indexOf('--connect') + 1]
  peerId = (await engine.acceptInvite(code, { timeout: 120000 })).id
}
await wait(() => engine.contact(peerId).presence.status === 'online')
const where = engine.contact(peerId).presence
console.error(`connected · path=${where.path} address=${where.address}`)

const iSend = listening ? !reverse : reverse
const rate = (ms: number) => +(mb / (ms / 1000)).toFixed(1)
if (iSend) {
  const file = path.join(storage, 'big.bin')
  const fh = await fs.open(file, 'w')
  const chunk = crypto.randomBytes(1024 * 1024)
  for (let i = 0; i < mb; i++) await fh.write(chunk)
  await fh.close()
  const t0 = Date.now()
  const [msg] = await engine.sendFiles(peerId, [{ path: file, mime: 'application/octet-stream' }])
  const copyMs = Date.now() - t0
  await wait(() => engine.transfers(peerId).find(t => t.messageId === msg.id)?.state === 'done')
  const ms = Date.now() - t0
  console.log(JSON.stringify({ role: 'sender', mb, senderCopyMBps: rate(copyMs), delivered_ms: ms, MBps: rate(ms), path: where.path, address: where.address }))
} else {
  await new Promise<void>(resolve => engine.on('message', (_id, m) => { if (m.kind === 'file') resolve() }))
  const t0 = Date.now()
  await wait(() => { const t = engine.transfers(peerId)[0]; return t?.state === 'done' })
  const ms = Date.now() - t0
  console.log(JSON.stringify({ role: 'receiver', mb, verified_ms: ms, MBps: rate(ms), path: where.path, address: where.address }))
}
await new Promise(r => setTimeout(r, 1500))
await engine.close()
await fs.rm(storage, { recursive: true, force: true })
process.exit(0)
