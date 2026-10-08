import type { ReactNode } from 'react'

export const LOGO = String.raw`__      __ _  _ __  __
\ \    / /| || |  \/  |
 \ \/\/ / | __ | |\/| |
  \_/\_/  |_||_|_|  |_|
  we hate mail`

/** The six limitations from SPEC §6. Shown on first run, in Settings and in the Info pane. */
export const LIMITS: { title: string, body: ReactNode }[] = [
  { title: 'Both of you need to be online.', body: 'Messages and files are delivered directly. Nothing is stored on a server. Transfers pause when either side goes offline and resume automatically.' },
  { title: 'The other person can see your IP address.', body: 'The connection is direct. This hides what you say, not where you are.' },
  { title: 'Some networks need a relay.', body: "A relay can't read anything, but it can see that two devices are connected. The status shows “via relay”." },
  { title: 'One device per person.', body: 'If you lose or wipe this device, your history and contacts are gone. There is no cloud backup in v1.' },
  { title: 'Anyone holding an unused invite link can use it.', body: 'Invites are single-use and expire after 24 hours. Revoke the ones you have not used.' },
  { title: "The app isn't signed yet.", body: 'Your operating system will warn you when you install it.' }
]

export function Limits () {
  return (
    <ol className='limits'>
      {LIMITS.map(l => <li key={l.title}><b>{l.title}</b> {l.body}</li>)}
    </ol>
  )
}
