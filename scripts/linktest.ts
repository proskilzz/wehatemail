// Raw bytes over ONE Hyperswarm connection (no Hypercore, no encryption of our own beyond
// the Noise link). It separates "the network path" from "replication" and "the app".
//
//   npm run linktest                       both ends here, on a local test DHT (self-check)
//   npm run linktest -- --listen [MB]      machine A: prints a key, sends MB (default 500)
//   npm run linktest -- --connect <key>    machine B: receives and prints MB/s and the path
//   add --reverse on the connecting side to make B send to A instead
import crypto from 'node:crypto'
import Hyperswarm from 'hyperswarm'
import createTestnet from 'hyperdht/testnet.js'
import { connectionPath } from '../src/core/index.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const after = (name: string) => args[args.indexOf(name) + 1]
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

async function run (swarm: any, role: 'send' | 'receive', mb: number, conn: any) {
  const { path, address } = connectionPath(conn)
  console.error(`connected · path=${path} address=${address}`)
  if (role === 'send') {
    await send(conn, mb)
    console.error('sent ' + mb + ' MB')
  } else {
    const { bytes, ms } = await receive(conn, mb)
    console.log(JSON.stringify({ mb: +(bytes / 1048576).toFixed(1), ms, MBps: +(bytes / 1048576 / (ms / 1000)).toFixed(1), path, address }))
  }
}

if (flag('--listen') || flag('--connect')) {
  const listening = flag('--listen')
  const topic = listening ? crypto.randomBytes(32) : Buffer.from(after('--connect'), 'hex')
  if (topic.length !== 32) throw new Error('The key must be 64 hex characters')
  const mb = Number(listening ? (args.find(a => /^\d+$/.test(a)) ?? 500) : 500)
  const reverse = flag('--reverse')
  const swarm = new Hyperswarm()
  swarm.on('connection', async (conn: any) => {
    conn.on('error', () => {})
    // The listener sends unless --reverse was given on the other side; MB is told in-band by the listener.
    if (listening) {
      const dir = await new Promise<string>(resolve => conn.once('data', (d: Buffer) => resolve(d.toString())))
      await run(swarm, dir === 'reverse' ? 'receive' : 'send', mb, conn)
    } else {
      conn.write(reverse ? 'reverse' : 'forward')
      await run(swarm, reverse ? 'send' : 'receive', mb, conn)
    }
    await swarm.destroy()
    process.exit(0)
  })
  const discovery = swarm.join(topic, { server: listening, client: !listening })
  // Print the key only once the announce is on the DHT; a lookup before that misses
  // and hyperswarm only retries minutes later.
  if (listening) await discovery.flushed()
  if (listening) console.error(`waiting… on the other machine run:\n  npm run linktest -- --connect ${topic.toString('hex')}`)
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
