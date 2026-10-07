import test from 'brittle'
import fs from 'node:fs/promises'
import path from 'node:path'
import Hyperswarm from 'hyperswarm'
import { setup, once, waitFor } from './helpers.ts'
import { dmTopic } from '../src/core/index.ts'

test('disconnect, queue while offline, reconnect after restart', async t => {
  const { peer } = await setup(t)
  const { engine: alice } = await peer('Alice')
  const bob1 = await peer('Bob')

  await bob1.engine.acceptInvite((await alice.createInvite()).code)
  const bobId = bob1.engine.id
  await waitFor(() => alice.contact(bobId).presence.status === 'online')

  const wentOffline = once(alice, 'presence', (_id, p) => p.status === 'offline')
  await bob1.engine.close()
  const [, presence] = await wentOffline
  t.ok(presence.lastSeen > 0, 'Alice sees Bob offline with a last-seen time')

  await alice.sendText(bobId, 'are you there?')
  await alice.sendText(bobId, 'second one')
  const queued = await alice.messages(bobId)
  t.alike(queued.map(m => m.status), ['waiting', 'waiting'], 'messages wait for Bob')

  // Bob comes back with the same data folder and keychain.
  const { engine: bob } = await peer('Bob', { storage: bob1.storage, secrets: bob1.secrets })
  t.is(bob.id, bobId, 'same identity after restart')
  t.is(bob.contacts()[0].name, 'Alice', 'contact survived restart')

  await waitFor(async () => (await bob.messages(alice.id)).length === 2)
  t.alike((await bob.messages(alice.id)).map(m => m.text), ['are you there?', 'second one'], 'queued messages arrive')

  await waitFor(async () => (await alice.messages(bobId)).every(m => m.status === 'delivered'))
  t.pass('Alice sees them delivered')

  const back = once(bob, 'message', (_id, m) => !m.fromMe)
  await alice.sendText(bobId, 'welcome back')
  t.is((await back)[1].text, 'welcome back', 'live chat works after reconnect')
})

test('restarted Alice still has her history and gets Bob\'s offline messages', async t => {
  const { peer } = await setup(t)
  const alice1 = await peer('Alice')
  const { engine: bob } = await peer('Bob')
  await bob.acceptInvite((await alice1.engine.createInvite()).code)
  const aliceId = alice1.engine.id

  await alice1.engine.sendText(bob.id, 'before restart')
  await waitFor(async () => (await bob.messages(aliceId)).length === 1)
  await alice1.engine.close()
  await bob.sendText(aliceId, 'while you were away')

  const { engine: alice } = await peer('Alice', { storage: alice1.storage, secrets: alice1.secrets })
  await waitFor(async () => (await alice.messages(bob.id)).length === 2)
  t.alike((await alice.messages(bob.id)).map(m => m.text), ['before restart', 'while you were away'])
  t.is(alice.contact(bob.id).unread, 1, 'one unread')
})

test('a stranger on the DM topic is not let in', async t => {
  const { testnet, peer } = await setup(t)
  const { engine: alice } = await peer('Alice')
  const { engine: bob } = await peer('Bob')
  await bob.acceptInvite((await alice.createInvite()).code)

  const mallory = new Hyperswarm({ dht: testnet.createNode() })
  t.teardown(() => mallory.destroy())
  let accepted = false
  mallory.on('connection', (conn: any) => {
    conn.on('error', () => {})
    conn.on('data', () => { accepted = true })
  })
  // Mallory knows the topic (e.g. guessed the keys) but not Bob's secret key.
  mallory.join(dmTopic(Buffer.from(alice.id, 'hex'), Buffer.from(bob.id, 'hex')))
  await mallory.flush()
  await new Promise(r => setTimeout(r, 1500))
  t.absent(accepted, 'no data from Alice to a stranger')
  t.is(alice.contacts().length, 1)
})

test('chat logs are encrypted at rest', async t => {
  const { peer } = await setup(t)
  const { engine: alice, storage } = await peer('Alice')
  const { engine: bob } = await peer('Bob')
  await bob.acceptInvite((await alice.createInvite()).code)
  await alice.sendText(bob.id, 'secret-marker-12345')
  await alice.close()

  const files = await fs.readdir(storage, { recursive: true })
  for (const f of files) {
    const p = path.join(storage, f as string)
    if (!(await fs.stat(p)).isFile()) continue
    const buf = await fs.readFile(p)
    if (buf.includes('secret-marker-12345')) t.fail('plaintext found in ' + f)
  }
  t.pass('no plaintext on disk')
})
