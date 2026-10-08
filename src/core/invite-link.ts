import z32 from 'z32'

export const JOIN_URL = 'https://wehatemail.com/join#'
export const APP_URL = 'wehatemail://join/'

export function inviteToCode (invite: Buffer): string {
  return z32.encode(invite)
}

export function inviteLinks (code: string) {
  return { link: JOIN_URL + code, appLink: APP_URL + code }
}

/** The wehatemail://join/<code> link in a command line or OS "open URL" call, if there is one. */
export function findInviteLink (args: string[]): string | null {
  return args.find(a => /^wehatemail:\/\/join\/[a-z0-9]+\/?$/i.test(a)) ?? null
}

/** Accepts the web link, the wehatemail:// link or the bare code. */
export function parseInvite (input: string): Buffer {
  let s = input.trim()
  const hash = s.indexOf('#')
  if (hash !== -1) s = s.slice(hash + 1)
  else if (s.startsWith(APP_URL)) s = s.slice(APP_URL.length)
  s = s.replace(/\s+/g, '').replace(/\/+$/, '')
  try {
    return z32.decode(s)
  } catch {
    throw new Error('That does not look like a We Hate Mail invite')
  }
}
