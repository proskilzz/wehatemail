// Connect to a linktest listener directly over HyperDHT (no Hyperswarm) and measure throughput.
// Usage: node scripts/dhtprobe.mjs <key from "npm run linktest -- --listen MB"> [reverse]
// Worked on 2026-10-08 where linktest --connect hung; prints the path, mtu and MB/s.
import HyperDHT from 'hyperdht'
const topic = Buffer.from(process.argv[2], 'hex')
const reverse = process.argv[3] === 'reverse'
const dht = new HyperDHT()
await dht.ready()
let key = null
for await (const r of dht.lookup(topic)) if (r.peers[0]) { key = r.peers[0].publicKey; break }
if (!key) { console.log('no peer found'); process.exit(1) }
const s = dht.connect(key)
s.on('error', e => { console.log('error', e.code || e.message); process.exit(1) })
s.on('open', () => {
  console.log('connected via', s.rawStream.remoteHost, 'mtu', s.rawStream.mtu)
  s.write(reverse ? 'reverse' : 'forward')
  if (reverse) {
    const chunk = Buffer.alloc(1 << 20, 7); let n = 0; const t0 = Date.now()
    const pump = () => { while (n < 200) { n++; if (!s.write(chunk)) return s.once('drain', pump) } s.end(); s.once('close', () => { console.log('sent 200 MB in', (Date.now() - t0) / 1000, 's (ends when the far side has it)'); process.exit(0) }) }
    pump(); return
  }
  let bytes = 0, t0 = 0, last = Date.now()
  s.on('data', d => { if (!t0) t0 = Date.now(); bytes += d.length; last = Date.now() })
  const tick = setInterval(() => {
    const secs = (Date.now() - t0) / 1000
    console.log(`${(bytes / 1048576).toFixed(0)} MB  ${(bytes / 1048576 / secs).toFixed(1)} MB/s avg  mtu ${s.rawStream.mtu} rtt ${s.rawStream.rtt}ms cwnd ${(s.rawStream.cwnd / 1024).toFixed(0)}KB retransmits ${s.rawStream.retransmits}`)
    if (Date.now() - last > 15000) { console.log('STALLED: no data for 15 s'); process.exit(2) }
  }, 5000)
  s.on('end', () => { clearInterval(tick); const secs = (Date.now() - t0) / 1000; console.log(`DONE ${(bytes / 1048576).toFixed(0)} MB in ${secs.toFixed(1)} s = ${(bytes / 1048576 / secs).toFixed(1)} MB/s`); process.exit(0) })
})
setTimeout(() => { console.log('timeout'); process.exit(1) }, 180000)
