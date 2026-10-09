// Raw bytes over ONE Hyperswarm connection (no Hypercore, no encryption of our own beyond
// the Noise link). It separates "the network path" from "replication" and "the app".
//
//   npm run linktest                       both ends here, on a local test DHT (self-check)
//   npm run linktest -- --listen [MB]      machine A: prints a key, sends MB (default 500)
//   npm run linktest -- --connect <key>    machine B: receives and prints MB/s and the path
//   add --reverse on the connecting side to make B send to A instead
//   add --swarm on the connecting side to dial through Hyperswarm instead of HyperDHT directly
//
// Why --connect dials HyperDHT directly: on 2026-10-08 a Hyperswarm client-only join never
// connected between two real machines, while a plain dht.lookup + dht.connect
// (scripts/dhtprobe.mjs) worked in seconds. The direct path is the proven one; --swarm keeps
// the old path (with progress logging) so the difference can be pinpointed on real machines.
import crypto from 'node:crypto'
import Hyperswarm from 'hyperswarm'
import HyperDHT from 'hyperdht'
import createTestnet from 'hyperdht/testnet.js'
import { connectionPath } from '../src/core/index.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const after = (name: string) => args[args.indexOf(name) + 1]
// Only for testing this script against a local testnet: LINKTEST_BOOTSTRAP=127.0.0.1:49737
const bootstrap = process.env.LINKTEST_BOOTSTRAP ? [process.env.LINKTEST_BOOTSTRAP] : undefined
const CHUNK = Buffer.alloc(1024 * 1024, 7)

function send (conn: any, mb: number) {
  return new Promise<void>(resolve => {
    let n = 0
    const pump = () => {
      while (n < mb) {
        n++
        if (!conn.write(CHUNK)) return conn.once('drain', pump)
      }
      conn.end(resolve)
    }
    pump()
  })
}

function receive (conn: any, mb: number) {
  return new Promise<{ bytes: number, ms: number }>(resolve => {
    let bytes = 0
    let t0 = 0
    conn.on('data', (d: Buffer) => {
      if (!t0) t0 = Date.now()
      bytes += d.length
      if (bytes >= mb * 1024 * 1024) resolve({ bytes, ms: Date.now() - t0 })
    })
    // The sender ends the stream when done, so a smaller send than expected still reports.
    conn.on('end', () => resolve({ bytes, ms: Date.now() - t0 }))
  })
}

async function run (_swarm: any, role: 'send' | 'receive', mb: number, conn: any) {
  const { path, address } = connectionPath(conn)
  console.error(`connected · path=${path} address=${address}`)
  if (role === 'send') {
    await send(conn, mb)
    // Stay until the other side has taken everything and closed; exiting now would cut the tail off.
    await new Promise<void>(resolve => { conn.once('close', resolve); setTimeout(resolve, 15000).unref() })
    console.error('sent ' + mb + ' MB')
  } else {
    const { bytes, ms } = await receive(conn, mb)
    conn.destroy()
    console.log(JSON.stringify({ mb: +(bytes / 1048576).toFixed(1), ms, MBps: +(bytes / 1048576 / (ms / 1000)).toFixed(1), path, address }))
  }
}

const log = (m: string) => console.error(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`)
const T0 = Date.now()

/** Look the topic up and dial the first peer found, retrying every few seconds until connected. */
async function dialDirect (topic: Buffer): Promise<any> {
  const dht = new HyperDHT({ bootstrap, ephemeral: bootstrap ? false : undefined })
  await dht.ready()
  for (let attempt = 1; ; attempt++) {
    log(`lookup #${attempt}…`)
    let key: Buffer | null = null
    for await (const r of dht.lookup(topic)) {
      if (r.peers[0]) { key = r.peers[0].publicKey; break }
    }
    if (!key) { log('no listener announced yet'); await new Promise(r => setTimeout(r, 3000)); continue }
    log('found listener, connecting…')
    const conn = dht.connect(key)
    const opened = await new Promise<boolean>(resolve => {
      const onerror = (e: any) => { log('connect failed: ' + (e?.code || e?.message)); resolve(false) }
      conn.once('open', () => { conn.off('error', onerror); resolve(true) })
      conn.on('error', onerror)
      conn.once('close', () => resolve(false))
    })
    if (opened) { conn.on('error', () => {}); return { conn, dht } }
    await new Promise(r => setTimeout(r, 1000))
  }
}

async function finish (conn: any, listening: boolean, reverse: boolean, mb: number) {
  if (listening) {
    const dir = await new Promise<string>(resolve => conn.once('data', (d: Buffer) => resolve(d.toString())))
    await run(null, dir === 'reverse' ? 'receive' : 'send', mb, conn)
  } else {
    conn.write(reverse ? 'reverse' : 'forward')
    await run(null, reverse ? 'send' : 'receive', mb, conn)
  }
  process.exit(0)
}

if (flag('--listen') || flag('--connect')) {
  const listening = flag('--listen')
  const topic = listening ? crypto.randomBytes(32) : Buffer.from(after('--connect'), 'hex')
  if (topic.length !== 32) throw new Error('The key must be 64 hex characters')
  const mb = Number(listening ? (args.find(a => /^\d+$/.test(a)) ?? 500) : 500)
  const reverse = flag('--reverse')
  if (!listening && !flag('--swarm')) {
    const { conn } = await dialDirect(topic)
    await finish(conn, false, reverse, mb)
  } else {
    const swarm = new Hyperswarm({ dht: new HyperDHT({ bootstrap, ephemeral: bootstrap ? false : undefined }) })
    swarm.on('connection', (conn: any) => {
      conn.on('error', () => {})
      log('connection from Hyperswarm')
      finish(conn, listening, reverse, mb)
    })
    if (!listening) log('joining through Hyperswarm…')
    const discovery = swarm.join(topic, { server: listening, client: !listening })
    // Print the key only once the announce is on the DHT; a lookup before that misses
    // and hyperswarm only retries minutes later.
    if (listening) await discovery.flushed()
    if (listening) console.error(`waiting… on the other machine run:\n  npm run linktest -- --connect ${topic.toString('hex')}`)
  }
} else {
  const mb = Number(args.find(a => /^\d+$/.test(a)) ?? 500)
  const testnet = await createTestnet(3)
  const a = new Hyperswarm({ dht: testnet.createNode() })
  const b = new Hyperswarm({ dht: testnet.createNode() })
  const topic = crypto.randomBytes(32)
  const got = new Promise<void>(resolve => {
    a.on('connection', (conn: any) => { conn.on('error', () => {}); run(a, 'send', mb, conn).then(resolve) })
  })
  b.on('connection', (conn: any) => { conn.on('error', () => {}); run(b, 'receive', mb, conn) })
  await a.join(topic, { server: true, client: false }).flushed()
  b.join(topic, { server: false, client: true })
  await got
  await new Promise(r => setTimeout(r, 500))
  await a.destroy(); await b.destroy(); await testnet.destroy()
  process.exit(0)
}
