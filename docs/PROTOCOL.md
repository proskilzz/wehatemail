# We Hate Mail protocol (v1)

How two We Hate Mail apps talk to each other. Everything is versioned under
`wehatemail/v1/...`. The reference implementation is `src/core/`.

## Identity

- Each device has one ed25519 keypair, generated from a random 32-byte seed
  (`hypercore-crypto.keyPair(seed)`). The seed is stored in the OS keychain.
- The same keypair is the device's Hyperswarm / Noise key, so a connection's
  `remotePublicKey` *is* the peer's identity.
- A contact's id is their public key, hex encoded.

## Invites and pairing

Pairing uses Holepunch's [`blind-pairing`](https://github.com/holepunchto/blind-pairing).

1. Alice creates an invite with `blind-pairing-core.createInvite(key, { seed, expires })`:
   - `seed`: 32 random bytes, the invite secret.
   - `key`: 32 random bytes per invite. blind-pairing requires it, but we don't
     use it for anything else.
   - `expires`: unix ms, now + 24 h.
2. The invite bytes are z32 encoded. Links:
   - `https://wehatemail.com/join#<code>` (the code stays after `#`, so it never
     reaches a server)
   - `wehatemail://join/<code>`
3. Alice listens on the invite's discovery key (`addMember`). Bob calls
   `addCandidate` with `userData = PeerInfo(Bob)` (below). blind-pairing
   encrypts and signs the request with the invite key, so only someone who has
   the invite can make one, and only Alice can read it.
4. Alice checks that the invite is still pending (single use, not expired, not
   revoked), then confirms with:
   - `encryptionKey`: a new random 32-byte **conversation key**
   - `additional.data = PeerInfo(Alice)`, signed with the invite secret key
   Otherwise she denies (`status` 2 = used, 3 = expired).
5. Both sides save the contact and the conversation key. The invite is deleted.

```
PeerInfo {
  version: uint      // 1
  publicKey: fixed32 // identity key
  name: string       // display name
}
```

## Reconnecting

- Both peers join the swarm topic
  `blake2b("wehatemail/v1/dm" || sortedKeyA || sortedKeyB)` as client and server.
- Each peer also dials the other's public key directly (`swarm.joinPeer`).
  Hyperswarm retries this with backoff, which reconnects quickly when both come
  online at the same moment (topic lookups only refresh every few minutes).
- **Key check:** a connection is only used for chat if its Noise
  `remotePublicKey` equals a saved contact's key. The swarm firewall rejects
  everyone else, except while an invite is pending or being used (pairing needs
  to accept unknown peers).

## Chat logs

- Each person has one Hypercore per conversation (`corestore` name
  `dm/<contact id>`), which only they can write to. The peer replicates it.
- Both logs are encrypted with the conversation key (Hypercore block
  encryption), on disk and in transit (on top of Noise).
- The log key is announced in the `hello` signal (below).
- Messages are ordered by `(timestamp, author, seq)`. A message id is
  `<author id>:<seq>`.

### Events

Each block is one event, encoded with `compact-encoding`:

```
Event {
  version: uint    // 1
  type: uint
  timestamp: uint  // unix ms, sender's clock
  ...body by type
}

1 text    { text: string }
2 media   (M3)
3 file    (M3)
4 edit    { target: uint, text: string }  // target = seq in the same log
5 delete  { target: uint }
```

Edits and deletes are new events, never changes to old blocks. An author can
only edit or delete their own messages (the target is in their own log).
Unknown types are skipped, so newer clients can add types.

## Signals (ephemeral, never stored)

A `protomux` channel with protocol `wehatemail/v1/signals` on each contact
connection. Messages, in order:

| # | Message    | Encoding | Meaning |
|---|------------|----------|---------|
| 0 | `hello`    | `{ coreKey: fixed32, receivedLength: uint, readLength: uint }` | My log for our chat, how many of your events I have, how many I've read. Sent when the channel opens. |
| 1 | `typing`   | `bool`   | I started/stopped typing. Receivers treat it as off after 6 s. |
| 2 | `received` | `uint`   | I now have your first N events (delivery ticks). |
| 3 | `read`     | `uint`   | I've read your first N events. |

Presence is the channel itself: open = online, closed = offline (last seen = when it closed).

## What the network can see

- DHT nodes see lookups and announces for the DM topic hash, the invite
  discovery key and each device's public key. They don't see names or content.
- The peer sees your IP address (direct connection).
