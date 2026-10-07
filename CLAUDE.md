# CLAUDE.md

Context for Claude Code sessions (local and cloud) working on this repo.

## What this is

We Hate Mail is a peer-to-peer desktop messenger (macOS, Windows, Linux).
Two people pair with an invite link or QR code, then chat and send pictures,
videos and files directly, with no server in the middle. It's built on the
Holepunch stack (Hyperswarm/HyperDHT, Hypercore, Hyperblobs) inside Electron.

**Read `docs/SPEC.md` before doing anything.** It holds the product
requirements, architecture, user-facing limitations, Matrix lessons and the
milestone plan.

## How to work here

- Do **one milestone per session/PR** (SPEC §8), in order. Don't start the next one.
- Work on a branch named `m<N>-<short-name>` and open a PR. Never push to `main`.
- PR description: what was built, how to test it by hand, anything that
  departs from the spec and why.
- Keep the P2P engine free of Electron imports so it stays testable headless.
- Tests must pass (`npm test`) before opening the PR. Use `hyperdht/testnet`.
  Never depend on the public DHT in tests.
- Before adding a dependency, check it's maintained and that its current API
  matches what you expect. Run a tiny probe if unsure.
- Never log or commit keys, invite secrets or user content.
- The owner is a beginner developer. Keep the README "Getting started"
  steps exact and copy-pasteable (Node version, `npm install`, `npm run dev`).

## Owner

GitHub: proskilzz. Domain: wehatemail.com (the join page will live at
`/join`; `board.` is already used for something else).
