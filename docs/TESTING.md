# Two-machine test checklist

Use installers from **Actions → Build installers** (or a release). Machine A and
B should be different computers. Record results in the tables below (copy them
into the PR or an issue).

## 0. Install
- [ ] Installed on A (OS: ____) and B (OS: ____). Unsigned warning handled as described in the README.
- [ ] App starts, first-run screen shows, name saved.
- [ ] Clicking a `https://wehatemail.com/join#…` link or running `wehatemail://join/test` opens the app (protocol registered by the installer).

## 1. Same Wi-Fi
- [ ] A: Invite → send link to B. B opens the link (or Paste invite).
- [ ] Both show **Connected**. Header says direct or via relay: ______
- [ ] Safety codes match on both sides.
- [ ] Text both ways; typing and seen status work.
- [ ] Album of 5+ photos, a video, a file. Lightbox works.
- [ ] Send a ~500 MB file. Note speed (below).
- [ ] Quit B mid-transfer, restart: transfer resumes, shows Paused then Done.
- [ ] Text sent while B is off shows `waiting for …` and arrives on return.

## 2. One side on a phone hotspot
Put B on a phone hotspot (A stays on Wi-Fi) and repeat: reconnect, text, album,
~500 MB file, pause/resume.

## Results

| Test | Connection type (direct / relay) | MB/s | Notes |
|---|---|---|---|
| Same Wi-Fi, 500 MB A→B | | | |
| Same Wi-Fi, 500 MB B→A | | | |
| Hotspot, 500 MB A→B | | | |
| Hotspot, 500 MB B→A | | | |

MB/s = file size in MB ÷ seconds from Sending to Done.

## 3. Speed: find where the time goes (M6)

Run these on two real machines, **same Wi-Fi**, in this order. Each one adds a layer,
so the first number that drops tells you which layer is slow. A = sender, B = receiver.
Needs Node 22 and `npm install` on both (see README "Getting started").

1. **Plain TCP (the ceiling).**
   B: `nc -l 5000 > /dev/null` (some `nc` need `-p 5000`)
   A: `dd if=/dev/zero bs=1m count=1000 | nc <B's LAN IP> 5000` (Linux: `bs=1M`). `dd` prints MB/s when it finishes.
   Measured 2026-10-08, home Wi-Fi, Pro→Air: **31.8 MB/s**. Target for the app: **≥ 25 MB/s**.
2. **Raw Hyperswarm connection** (network + UDX + Noise, no Hypercore):
   A: `npm run linktest -- --listen 500` prints a key. B: `npm run linktest -- --connect <key>`.
   Both print `path=lan|internet` and the address. Add `--reverse` on B to test B→A.
3. **The engine, no UI** (adds replication, encryption at rest, checksum):
   A: `npm run bench -- --listen 500` prints a code. B: `npm run bench -- --connect <code>`.
   Add `--inflight 64,512` on B to try more block requests in flight (default 16,512).
4. **The real app**: send the same file, read the speed on the transfer card, and the path under **Info → Connection**.

How to read it:
- Step 2 slow, step 1 fast: the UDX/Hyperswarm path is the limit. Check `path=`. If it says `internet` while both are on the same Wi-Fi, the connection is going through the router's public address instead of the LAN.
- Step 2 fast, step 3 slow: replication or hashing on the CPU. Try `--inflight`.
- Step 3 fast, step 4 slow: the app (IPC, progress events).

| Run | Path | Plain TCP | linktest | bench | App |
|---|---|---|---|---|---|
| Same Mac (loopback) | lan | | | | |
| Pro → Air, same Wi-Fi | | 31.8 | | | |
| Air → Pro, same Wi-Fi | | | | | |
| Ethernet (if possible) | | | | | |

