import crypto from 'hypercore-crypto'
import b4a from 'b4a'

function sorted (a: Buffer, b: Buffer): Buffer[] {
  return b4a.compare(a, b) <= 0 ? [a, b] : [b, a]
}

/** Swarm topic two contacts meet on to reconnect: hash("wehatemail/v1/dm" + sorted keys). */
export function dmTopic (a: Buffer, b: Buffer): Buffer {
  return crypto.hash([b4a.from('wehatemail/v1/dm'), ...sorted(a, b)])
}

/**
 * Short code both people see identically and can compare out loud.
 * 4 groups of 5 digits, e.g. "04821 99310 27765 51002".
 */
export function safetyCode (a: Buffer, b: Buffer): string {
  const h: Buffer = crypto.hash([b4a.from('wehatemail/v1/safety'), ...sorted(a, b)])
  const groups: string[] = []
  for (let i = 0; i < 4; i++) {
    const n = h.readUIntBE(i * 5, 5) % 100000
    groups.push(String(n).padStart(5, '0'))
  }
  return groups.join(' ')
}
