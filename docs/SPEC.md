# We Hate Mail: v1 Product & Technical Spec

This is the source of truth for v1. If code and this spec disagree, fix one of
them in the same PR and say which one in the PR description.

## 1. Product in one paragraph

You open the app and tap **Invite**. It shows a link and a QR code. You send the
link to someone however you like. They open it, install the app if they need to,
and the app connects you directly, peer to peer, with no server in between.
Your side shows them as **Connected**. From then on you can both send messages,
pictures (shown as an album when you send several), videos and files. Everyone
can see plainly what the app does and doesn't protect. If either person goes
offline, transfers pause and pick up again when you're both back.

## 2. Platforms (all required for v1)

| Platform | Deliverable |
|---|---|
| macOS | `.dmg` (universal: Apple Silicon + Intel) |
| Windows | `.exe` installer (NSIS), x64 |
| Linux | `.AppImage` and `.deb`, x64 |

Built automatically by GitHub Actions when a `v*` tag is pushed and attached
to a GitHub Release. v1 ships **unsigned**: macOS Gatekeeper and Windows
SmartScreen will warn. The download page and README must explain how to open
it anyway. Signing and notarization come after v1.

## 3. Tech stack

- **Electron + TypeScript.** The main process runs the P2P engine (Node), the
  renderer is the UI. We use Electron rather than the Pear runtime because
  electron-builder reliably produces dmg/exe/AppImage today.
- **UI:** React + Vite. Dark theme only for v1.
- **P2P (Holepunch stack):** `hyperswarm`, `hyperdht`, `corestore`, `hypercore`,
  `hyperblobs`, `protomux`, `compact-encoding`, `b4a`. For pairing, evaluate
  Holepunch's `blind-pairing` first (Keet uses it). Only roll your own if it
  doesn't fit, and write down why.
- **Packaging:** `electron-builder`.
- **Tests:** `brittle` or `vitest` for the engine, using `hyperdht/testnet` so two
  peers can run in one process without the public DHT.

Keep the P2P engine (`packages/core` or `src/core`) **independent of Electron**
so it can be tested headless and reused later (CLI, mobile).

## 4. Core flows

### 4.1 Identity
- First launch: generate an ed25519 keypair per device and ask for a display name.
- Store secrets with Electron `safeStorage` (OS keychain). Never log keys.
- v1 is **one device per person**. Say so in the UI (see §6).

### 4.2 Invite → connect
1. Alice clicks **Invite** and gets a single-use invite. It expires after 24 h
   and can be revoked.
2. The app shows the link `https://wehatemail.com/join#<invite>` and a QR code
   for it. The invite lives after the `#`, so it is **never sent to any server**.
3. Bob opens the link. The static join page tries to open
   `wehatemail://join/<invite>` (a custom protocol registered by the app). If the
   app isn't installed, the page shows download buttons for his OS (GitHub
   Releases), then tells him to click the link again or paste the code.
   The app also has a **Paste invite** box.
4. The apps find each other on the DHT using the invite secret, run the pairing
   handshake, and swap long-term public keys and display names.
5. Both sides save the contact. Alice's app shows **Bob: Connected**.
6. To reconnect later, both join a swarm topic derived from
   `hash("wehatemail/v1/dm" + sorted(pubA, pubB))`. Every connection **must check**
   that the remote Noise public key belongs to the saved contact.
7. Show a **safety code**, a short code derived from both public keys, that the
   two people can compare by voice or in person (§7, the Matrix lesson).

### 4.3 Messaging
- Each person writes to their **own Hypercore log per conversation**, and the
  peer replicates it. Messages are ordered by (timestamp, author, seq).
- Event types (versioned, encoded with `compact-encoding`):
  `text`, `media` (one event holding 1..N image/video refs, which is the album),
  `file`, `edit`, `delete`.
- **Ephemeral signals** go over a separate `protomux` channel and are never
  stored: typing, presence (online/offline), read receipts.
- Hypercores are encrypted at rest with a per-conversation key kept in the keychain.

### 4.4 Media & files
- Blobs go in **Hyperblobs**, and the message event only stores references
  (blob id, size, mime, name, sha256).
- **Albums:** several images or videos picked together become one `media` event.
  The UI shows them as a grid: 1 = full width, 2 = side by side, 3–4 = 2×2,
  5+ = grid with a "+N" tile. Click to open a lightbox you can swipe through.
- The sender generates a thumbnail and a blurhash (stored inline in the event),
  so the recipient sees a preview right away while the full file downloads.
  Videos get a poster frame and duration.
- No size limit in v1, but warn above 2 GB ("both of you need to stay online
  until this finishes").

### 4.5 Offline, pause, resume
- Hypercore replication works in blocks, so an interrupted transfer resumes
  where it stopped. No restart from zero.
- Each attachment shows: progress %, speed, and a state:
  `Sending`, `Paused: Bob is offline`, `Paused: you're offline`, `Done`, `Failed`.
- Text sent while the peer is offline appears as **Waiting for Bob** (one
  grey tick) and goes out automatically when they reconnect.
- The conversation header always shows the peer's presence:
  **Connected** (direct) / **Connected via relay** / **Offline: last seen …**.

## 5. Look & feel

- Theme **"Night Shift"**: dark, crisp, a little nostalgic (terminal chat + BBM + AIM).
  Read `docs/design/THEME.md` and match `docs/design/mockup.html`. The mockup is
  the visual source of truth; its CSS tokens are the ones to use.
- Clean and simple: two panes (Buddies + chat), with an optional Info pane.
  A **large compose box** with a bottom bar of labelled attachment buttons
  (Photos, Video, File, Album) and Send set apart on the right.

## 6. Limitations people must see

Show these on a first-run screen (they must click "I understand"), on a
**How this works** page in Settings, and in context where they apply:

1. **Both of you need to be online** to deliver messages and files. Nothing is
   stored on a server. Transfers pause when either side goes offline and resume
   automatically.
2. **The other person can see your IP address** (direct connection). This hides
   *what* you say, not *where* you are.
3. **Some networks need a relay.** The relay can't read anything, but it can see
   that two devices are connected. The status shows "via relay".
4. **One device per person.** If you lose or wipe this device, your history
   and contacts are gone (no cloud backup in v1). An export/backup option is on
   the roadmap.
5. **Anyone holding an unused invite link can use it.** Invites are single-use
   and expire after 24 h. Revoke unused ones.
6. **The app isn't signed yet.** Your OS will warn when you install it.

## 7. Lessons from Matrix

Matrix is the best-known open, decentralized chat protocol. What we take from it:

| Matrix lesson | What we do |
|---|---|
| **Homeservers keep metadata** (who talks to whom, when, room membership) even with E2EE on | No servers. The DHT only sees topic hashes, and §6 is honest about what remains |
| **Key management is the hardest UX problem.** "Unable to decrypt" errors and lost keys after logout hurt users most | v1 is deliberately single-device, with a clear warning. Design multi-device and backup *before* building them, not after |
| **Device verification** (emoji/SAS comparison, cross-signing) | Safety code per contact that people compare, plus a "Verified" badge |
| **Everything is an event** in an append-only, signed history | Signed per-author Hypercore logs. Edits and deletes are new events, never mutations |
| **Ephemeral vs persistent events** (typing and receipts aren't stored in room history) | Separate protomux channel for ephemeral signals |
| **Open spec first** enabled many clients and bridges | Write `docs/PROTOCOL.md` alongside the code and version everything (`wehatemail/v1/...`) |
| **Media thumbnails/blurhash** make big media usable on slow links | Sender-side thumbnails and blurhash in the event |
| **Federation complexity and spam** grew with openness | Contacts only exist through an explicit invite. No public directory, no unsolicited messages |

## 8. Milestones (one PR each, in order)

1. **M1: Core engine (headless).** Identity, invite/pair, reconnect with key
   check, text messages, presence, offline queue. Tests: two peers on
   `hyperdht/testnet` pair, chat, disconnect, reconnect, and get queued messages.
   Plus a small CLI (`npm run cli`) for manual two-machine testing.
2. **M2: Electron app + chat UI.** First-run (name and limitations screen),
   sidebar, chat, Invite with link and QR, Paste invite, presence, safety code. Also: a
   `safeStorage` SecretStore, and engine state files written with mode 0600 (M1 review).
3. **M3: Media & files.** Hyperblobs, albums, lightbox, video, file cards,
   progress, pause/resume states.
   Also fix from M2 testing: (a) replace the D/R marks with plain-word status
   (see THEME.md, "Message status in plain words"); (b) the keychain error is
   OS-specific: on macOS say to click Allow on the keychain prompt (Linux keeps
   the GNOME Keyring/KWallet advice); (c) the unverified-contact line under
   the name in the chat header is calm, not a warning: muted grey, no red/amber,
   text `for extra security, compare codes · Info` where **Info** is a link that
   opens the Info pane at the safety code. Verified stays `verified ✓`.
   Keep it simple (KISS): one short line, one link, no icons or extra buttons.
4. **M4: Links & install flow.** `wehatemail://` protocol on all 3 OSes, static
   join page in `site/` (for wehatemail.com) with OS detection and download buttons.
5. **M5: Packaging & release.** electron-builder config, GitHub Actions matrix
   (macos, windows, ubuntu) building dmg/exe/AppImage/deb on `v*` tags, and a
   release checklist.

## 9. Out of scope for v1

Group chats, multiple devices, cloud backup, voice/video calls, Tor mode, mobile
apps, signing/notarization, auto-update.
