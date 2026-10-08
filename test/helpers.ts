import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import createTestnet from 'hyperdht/testnet.js'
import { Engine, MemorySecretStore, type SecretStore } from '../src/core/index.ts'

export async function setup (t: any) {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const dirs: string[] = []
  const engines: Engine[] = []

  async function peer (name: string, opts: { storage?: string, secrets?: SecretStore } = {}) {
    let storage = opts.storage
    if (!storage) {
      storage = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-test-'))
      dirs.push(storage)
    }
    const secrets = opts.secrets ?? new MemorySecretStore()
    const engine = new Engine({ storage, secrets, dht: testnet.createNode(), pairingPoll: 500 })
    engines.push(engine)
    await engine.ready()
    await engine.setName(name)
    return { engine, storage, secrets }
  }

  t.teardown(async () => {
    for (const e of engines) await e.close()
    for (const d of dirs) await fs.rm(d, { recursive: true, force: true })
  }, { order: -1 })

  return { testnet, peer }
}

/** Resolves the next time `emitter` emits `event` with args passing `filter`. */
export function once (emitter: any, event: string, filter: (...args: any[]) => boolean = () => true) {
  return new Promise<any[]>(resolve => {
    const fn = (...args: any[]) => {
      if (!filter(...args)) return
      emitter.off(event, fn)
      resolve(args)
    }
    emitter.on(event, fn)
  })
}

export async function waitFor (fn: () => boolean | Promise<boolean>, ms = 20000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise(r => setTimeout(r, 50))
  }
}
