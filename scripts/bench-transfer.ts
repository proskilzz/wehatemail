// Measures where file-transfer time goes. Usage: npm run bench -- [megabytes]
// Alice (this process) sends one file to Bob (a child process, so each has its own CPU)
// over a local test DHT. Prints MB/s for the sender's copy into the blob log and end to end.
import { fork } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import DHT from 'hyperdht'
import createTestnet from 'hyperdht/testnet.js'
import { Engine, MemorySecretStore } from '../src/core/index.ts'

const wait = async (fn: () => boolean) => { while (!fn()) await new Promise(r => setTimeout(r, 20)) }

async function peer (name: string, dht: any) {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-bench-'))
  const engine = new Engine({ storage, secrets: new MemorySecretStore(), dht, pairingPoll: 500 })
  await engine.ready()
  await engine.setName(name)
  return { engine, storage }
}

if (process.argv[2] === 'bob') {
  const { engine: bob, storage } = await peer('Bob', new DHT({ bootstrap: JSON.parse(process.argv[3]) }))
  process.on('message', async (m: any) => {
    if (m.invite) {
      await bob.acceptInvite(m.invite)
      process.send!({ paired: bob.id })
    }
    if (m.watch) {
      // Report when the file has arrived and when its checksum check passed.
      let arrived = 0
      const timer = setInterval(() => {
        const x = bob.transfers(m.watch).find(t => t.messageId === m.message)
        if (x && !arrived && x.done >= x.total) { arrived = Date.now(); process.send!({ arrived }) }
        if (x?.state === 'done') { clearInterval(timer); process.send!({ done: Date.now() }) }
      }, 20)
    }
    if (m.quit) { await bob.close(); await fs.rm(storage, { recursive: true, force: true }); process.exit(0) }
  })
  process.send!({ ready: true })
} else {
  const mb = Number(process.argv[2] ?? 200)
  const testnet = await createTestnet(3)
  const { engine: alice, storage } = await peer('Alice', testnet.createNode())
  const child = fork(import.meta.filename, ['bob', JSON.stringify(testnet.bootstrap)], { execArgv: process.execArgv })
  const next = (key: string) => new Promise<any>(resolve => {
    const fn = (m: any) => { if (key in m) { child.off('message', fn); resolve(m) } }
    child.on('message', fn)
  })
  await next('ready')
  const paired = next('paired')
  child.send({ invite: (await alice.createInvite()).code })
  const { paired: bobId } = await paired
  await wait(() => alice.contact(bobId).presence.status === 'online')

  const file = path.join(storage, 'big.bin')
  const fh = await fs.open(file, 'w')
  const chunk = crypto.randomBytes(1024 * 1024)
  for (let i = 0; i < mb; i++) await fh.write(chunk)
  await fh.close()

  const t0 = Date.now()
  const arrived = next('arrived')
  const done = next('done')
  const [msg] = await alice.sendFiles(bobId, [{ path: file, mime: 'application/octet-stream' }])
  const copyMs = Date.now() - t0
  child.send({ watch: alice.id, message: msg.id })
  const a = (await arrived).arrived - t0
  const d = (await done).done - t0
  const rate = (ms: number) => +(mb / (ms / 1000)).toFixed(1)
  console.log(JSON.stringify({
    mb,
    senderCopyMs: copyMs, senderCopyMBps: rate(copyMs),
    allBytesArrivedMs: a, receiverVerifiedMs: d,
    endToEndMBps: rate(d)
  }))
  child.send({ quit: true })
  setTimeout(() => child.kill('SIGKILL'), 3000).unref()
  await new Promise(resolve => child.once('exit', resolve))
  await alice.close()
  await testnet.destroy()
  await fs.rm(storage, { recursive: true, force: true })
  process.exit(0)
}
