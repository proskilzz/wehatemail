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

## Layout: one-on-one first (AIM style)

```
┌──────────┬─ bob ─ for extra security, compare codes · Info ─ ● connected ─ ⓘ ┐
│≡ buddies①│                                                                  │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ ┌──────┐ │  bob · 21:04                                                     │
│ │ ▚▞▚▞ │ │  you there?                                                      │
│ │ ▞▚▞▚ │ │  you · 21:05                                        seen 21:06   │
│ └──────┘ │  sending the pics now   [album grid, +N]                         │
│   bob    │                                                                  │
│ on the   │                                                                  │
│ road 🚐  │                                                                  │
├──────────┼──────────────────────────────────────────────────────────────────┤
│ ┌──────┐ │ ┃ type a message…   (big: 5 lines, grows)                        │
│ │ ▞▚▞▚ │ │                                                                  │
│ └──────┘ ├──────────────────────────────────────────────────────────────────┤
│   you    │ [Photos] [Video] [File] [Album]                       [Send ▸]   │
└──────────┴──────────────────────────────────────────────────────────────────┘
```

- **The app is built for one conversation at a time.** There's no always-on
  sidebar. Like the AIM window, a narrow left column shows **two avatar boxes**:
  - **their avatar on top,** beside the message log (name in red, status line under it)
  - **your avatar on the bottom,** beside the compose box (name "you" in blue, your status line under it)

  The avatar frames are tinted with the name colours.
- **Avatars are pixel identicons** made from each person's public key: a 5×8
  mirrored pixel grid, one hue, on the dark background. Both sides work out the
  same picture, so nothing is sent and no protocol change is needed. The
  picture also helps people notice if a key ever changes. Custom pictures come
  later.
- **Buddies button** (`≡ buddies`) at the top of the left column, always
  there. A green number badge shows unread messages in *other* chats.
  Clicking it slides the **Buddies drawer** over the left side: the buddy list
  (green selection bar, presence dots, unread counts), `+ invite someone`, and
  an **×** to close. Esc and clicking outside close it too. Picking a buddy
  switches the chat and closes the drawer.
- **Info pane** opens from the ⓘ button or the "Info" link and slides over
  the right side. It has an **×** in its top-right corner, and Esc and clicking
  outside close it.
- **Compose:** at least 5 lines tall and grows up to 40% of the window. Enter
  sends, Shift+Enter adds a new line. You can drop files anywhere in the window.
- **Bottom bar** (AIM): labelled line-icon buttons for Photos, Video, File and
  Album, with Send separated on the right.

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
- A status line under each avatar (BBM / AIM away message). Click yours to edit it.
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
