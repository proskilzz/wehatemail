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

## Known issue (not fixed in M5)
`npm run bench` gives ~53 MB/s on an M1 Max, but two real apps on the same Mac
got ~13 MB/s. The gap is the network path (UDX / hole-punched path), so measure
on real machines first and record the numbers above.
