import test from 'brittle'
import { setup, once, waitFor } from './helpers.ts'

test('pair, chat, see presence and receipts', async t => {
  const { peer } = await setup(t)
  const { engine: alice } = await peer('Alice')
  const { engine: bob } = await peer('Bob')

  const invite = await alice.createInvite()
  t.ok(invite.link.startsWith('https://wehatemail.com/join#'), 'web link')
  t.ok(invite.appLink.startsWith('wehatemail://join/'), 'app link')

  const aliceSawBob = once(alice, 'contact')
  const aliceName = await bob.acceptInvite(invite.link)
  const [bobOnAlice] = await aliceSawBob

  t.is(aliceName.name, 'Alice')
  t.is(aliceName.id, alice.id)
  t.is(bobOnAlice.name, 'Bob')
  t.is(bobOnAlice.id, bob.id)
  t.is(aliceName.safetyCode, bobOnAlice.safetyCode, 'same safety code on both sides')
  t.is(alice.listInvites().length, 0, 'invite is used up')

  await waitFor(() => alice.contact(bob.id).presence.status === 'online' &&
    bob.contact(alice.id).presence.status === 'online')
  t.pass('both connected')

  const got = once(bob, 'message', (_id, m) => !m.fromMe)
  const sent = await alice.sendText(bob.id, 'hello bob')
  const [from, msg] = await got
  t.is(from, alice.id)
  t.is(msg.text, 'hello bob')
  t.is(msg.id, sent.id, 'same message id on both sides')

  await waitFor(async () => (await alice.messages(bob.id))[0].status === 'delivered')
  t.pass('delivered tick')

  await bob.markRead(alice.id)
  await waitFor(async () => (await alice.messages(bob.id))[0].status === 'read')
  t.pass('read receipt')

  const typing = once(alice, 'typing', (_id, on) => on)
  bob.setTyping(alice.id, true)
  await typing
  t.pass('typing signal')

  const reply = once(alice, 'message', (_id, m) => !m.fromMe)
  await bob.sendText(alice.id, 'hi alice')
  await reply

  const updated = once(bob, 'update')
  await alice.editMessage(bob.id, sent.id, 'hello bob (edited)')
  await updated
  const list = await bob.messages(alice.id)
  t.alike(list.map(m => m.text), ['hello bob (edited)', 'hi alice'], 'ordered, edit applied')
  t.ok(list[0].edited)

  const deleted = once(bob, 'update')
  await alice.deleteMessage(bob.id, sent.id)
  await deleted
  t.ok((await bob.messages(alice.id))[0].deleted, 'delete applied')

  await t.exception(() => alice.editMessage(bob.id, list[1].id, 'nope'), /own messages/)
})

test('invites are single use, revocable and expire', async t => {
  const { peer } = await setup(t)
  const { engine: alice } = await peer('Alice')
  const { engine: bob } = await peer('Bob')
  const { engine: carol } = await peer('Carol')

  const invite = await alice.createInvite()
  await bob.acceptInvite(invite.code)
  await t.exception(() => carol.acceptInvite(invite.code, { timeout: 3000 }), /already been used|timed out/)

  const revoked = await alice.createInvite()
  await alice.revokeInvite(revoked.id)
  t.is(alice.listInvites().length, 0)
  await t.exception(() => carol.acceptInvite(revoked.code, { timeout: 3000 }), /timed out|refused/)

  await t.exception(() => carol.acceptInvite('not an invite'), /does not look like/)
  t.is(alice.contacts().length, 1, 'only Bob became a contact')
})

test('expired invite is refused locally', async t => {
  const { peer } = await setup(t)
  const { engine: alice } = await peer('Alice')
  const { engine: bob } = await peer('Bob')
  ;(alice as any).opts.inviteTtl = 1
  const invite = await alice.createInvite()
  await new Promise(r => setTimeout(r, 10))
  await t.exception(() => bob.acceptInvite(invite.code), /expired/)
})

test('verifying a contact emits an update at once; the inviter is told who joined', async t => {
  const { peer } = await setup(t)
  const a = await peer('Alice')
  const b = await peer('Bob')
  const aliceSees = once(a.engine, 'contact')
  const bobSees = once(b.engine, 'contact')
  await b.engine.acceptInvite((await a.engine.createInvite()).code)
  t.is((await aliceSees)[1], true, 'inviter side: joined through my invite')
  t.is((await bobSees)[1], false, 'joiner side: not flagged')

  const changed = once(a.engine, 'contact')
  await a.engine.setVerified(b.engine.id, true)
  const [contact, viaInvite] = await changed
  t.is(contact.verified, true)
  t.is(viaInvite, false)
  const undone = once(a.engine, 'contact')
  await a.engine.setVerified(b.engine.id, false)
  t.is((await undone)[0].verified, false)
})
