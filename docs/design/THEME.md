# Theme: "Night Shift"

A clean, crisp dark theme that feels like 2004 at 1 a.m.: AIM open, BlackBerry on
the desk, a terminal in the corner. **The source of truth is the mockup
`docs/design/mockup.html`.** Open it in a browser. This file explains the decisions.

## Where each idea comes from

| From | We keep | We drop |
|---|---|---|
| **isle.chat** (terminal chat) | Near-black panes with thin 1px borders, monospace for chrome, the solid **green selection bar**, right-aligned unread counts, the purple `BOT`-style badge (ours: `SYS`), ASCII-art logo | Monospace for message text (hard to read in long chats), three always-visible panes |
| **BlackBerry Messenger** | Contact header with a **status line** under the name, message groups with a small "name · time" header, the idea of showing delivery state on every message (but in plain words, not BBM's cryptic D/R), the bright blue blinking cursor | Glossy gradients, speech-bubble tails |
| **AIM** | **Blue name for me, red for them**, the **big compose box**, the **bottom button bar** of labelled icons with **Send** set apart on the right, "Buddy List" wording, a door sound when someone comes online | The formatting toolbar, Warn/Games, busy XP chrome |

## Layout

```
┌─ Buddies ───────────┬─ Bob ● Connected · direct ───────── [ⓘ] ┐
│ ▌Bob            ●   │                                          │
│  Sam            2   │  bob · 21:04                             │
│  Mia     away…      │  you there?                              │
│                     │                                          │
│                     │  you · 21:05                   seen 21:06│
│                     │  yep! sending the trip pics              │
│                     │  ┌────┬────┐                             │
│                     │  │ 🖼 │ 🖼 │  album, 2×2 grid, "+N" tile │
│                     │  ├────┼────┤                             │
│                     │  │ 🖼 │ +3 │                             │
│                     │  └────┴────┘                             │
│                     │  [file card · ▓▓▓░░ 62% · Paused: Bob   │
│                     │   is offline]                            │
│ [ + Invite ]        ├──────────────────────────────────────────┤
│                     │ ┃ Type a message…   (big: 5 lines, grows)│
│ you · status line   ├──────────────────────────────────────────┤
│ ● online            │ [Photos] [Video] [File] [Album]  [Send ▸]│
└─────────────────────┴──────────────────────────────────────────┘
```

- **Two panes by default.** The ⓘ button opens a third "Info" pane on the right
  (isle.chat style) with the ASCII logo, safety code, connection type and the
  limitations. It's closed by default to keep things simple.
- **Compose:** at least 5 lines tall and grows up to 40% of the window. Enter
  sends, Shift+Enter adds a new line. You can drop files anywhere in the window.
- **Bottom bar** (AIM): labelled icon buttons for Photos, Video, File and Album,
  with Send separated on the right. Icons are thin 1.5px line icons, not
  cartoon ones.

## Colour tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0d10` | window background |
| `--pane` | `#101317` | panes |
| `--raised` | `#171b21` | cards, compose box, hover |
| `--line` | `#2a3038` | 1px pane borders |
| `--text` | `#e4e7ec` | body text |
| `--muted` | `#7a828e` | timestamps, hints |
| `--me` | `#6ea8ff` | my name (AIM blue, lifted for dark) |
| `--them` | `#ff7a7a` | their name (AIM red, softened) |
| `--select` | `#9be39b` | selection bar, online dot, "seen" status (terminal green) |
| `--cursor` | `#3d8bff` | caret, focus ring (BBM blue) |
| `--badge` | `#6b5cff` | `SYS` badge (isle.chat purple) |
| `--warn` | `#f5b14a` | paused / relay / limitation notices |
| `--danger` | `#ff5c5c` | failed |

## Type

- **IBM Plex Mono**: names, timestamps, status, codes, buttons, pane titles.
- **IBM Plex Sans**: message text and long copy.
- Both are open source (OFL) and bundled with the app (no web font loading).
  Base size 14px, line height 1.5.

## Details that carry the nostalgia (keep them subtle)

- The selected buddy is a solid green bar with dark text.
- **Message status in plain words**, small mono text at the right of the
  "name · time" line, never single letters or symbols that need explaining:
  `sending…` (muted) → `waiting for bob` (amber, while they're offline) →
  `delivered` (muted) → `seen 21:06` (green) / `failed · retry` (red, clickable).
  Hovering shows full times ("Delivered 21:05 · Seen 21:06").
- A status line under your name and theirs (BBM / AIM away message), editable
  in the sidebar.
- System lines (joined, verified, paused) use a `SYS` badge, isle.chat style.
- The block caret blinks in BBM blue.
- **Sounds off by default.** When turned on: our *own* soft "door" sounds when
  a buddy comes online or leaves. Never AOL's original sounds (copyrighted).
- The empty state shows the ASCII-art logo and "No mail. Just us."

## Rules

- Crisp over cute: 1px borders, no shadows apart from the lightbox, no
  gradients, corner radius 6px (cards) and 4px (buttons).
- No product trademarks or logos from the inspirations (no AIM running man,
  no BlackBerry marks).
