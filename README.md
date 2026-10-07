# We Hate Mail

**Stop sending mail. Open a space and share directly.**

We Hate Mail is a peer-to-peer messenger and file-sharing app. Two people connect
directly, device to device. There's no server in the middle storing your messages,
no inbox to fill up and no company reading along.

> Status: early development. The first goal is two people chatting and sending
> files to each other, with nobody in between.

---

## Why

Email sends everything through someone else's servers: your provider, their
provider and every spam filter in between. Each one keeps a copy.

We Hate Mail turns that around. Instead of *sending mail*, you **open a space**
with someone and things flow straight between you.

```
  Email:          You ──► your server ──► their server ──► Friend
                          (copy kept)     (copy kept)

  We Hate Mail:   You ◄──────── encrypted, direct ────────► Friend
```

## What it does (v1 goals)

- [ ] **Desktop apps** for macOS (.dmg), Windows (.exe) and Linux (.AppImage / .deb)
- [ ] **Invite by link or QR code.** Send it any way you like; they install the app if needed and you're connected
- [ ] **Chat** with end-to-end encryption, directly between devices
- [ ] **Pictures (albums), videos and files** of any size
- [ ] **Pause and resume.** If either of you goes offline, transfers pause and continue when you're back
- [ ] **No accounts.** Your identity is a keypair generated on your device

Full spec: [docs/SPEC.md](docs/SPEC.md)

## How it works

Built on the [Holepunch](https://holepunch.to) peer-to-peer stack:

| Piece | What it does |
|---|---|
| **HyperDHT / Hyperswarm** | Finds the other person and punches through home routers (NAT hole punching) so devices can connect directly |
| **Noise protocol** (`secret-stream`) | Encrypts every connection end to end; peers are identified by public key |
| **Hypercore / Hyperdrive** | Signed logs for chat history and streaming file transfer |
| **Pear / Bare** | JavaScript runtime for P2P desktop apps |

Lessons taken from [Matrix](https://matrix.org) (see the spec). Inspired by [Keet](https://keet.io), [Holesail](https://holesail.io),
[OnionShare](https://onionshare.org) and [Wormhole](https://wormhole.app).

## Privacy: what it protects and what it doesn't

**Protected**
- Message and file **contents**: only you and the other person can read them
- No central server stores your data

**Not (yet) protected**
- **Your IP address is visible to the other person.** A direct connection means
  you get privacy of content, not anonymity.
- **Peer discovery** uses a public DHT, so DHT nodes can see that a key was looked up.
- **Strict networks** (some mobile carriers) may need an encrypted relay. The
  relay can't read anything, but it can see that two peers are connected.
- **Both people need to be online** at the same time to exchange messages.

## Roadmap

- **M1:** core P2P engine (pairing, chat, offline queue), tested headless
- **M2:** desktop app and chat UI (dark theme)
- **M3:** pictures, albums, videos, files, with pause/resume
- **M4:** invite links, QR codes and the wehatemail.com join page
- **M5:** installers for macOS, Windows and Linux via GitHub Actions
- **Later:** multiple devices, backup, group spaces, Tor mode, mobile

## Getting started

_Coming soon._

## License

[MIT](LICENSE)
