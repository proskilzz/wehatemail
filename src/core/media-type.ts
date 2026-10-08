// Which attachments may be shown inline. The sender declares a mime type, but the
// sender is just another person's computer, so we only trust it when the real bytes agree.

/** Types the app will render in an <img> or <video>. Deliberately short: no SVG, no HTML. */
export const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/ogg'
])

export const DOWNLOAD_TYPE = 'application/octet-stream'

/** "Image/JPEG; charset=x" -> "image/jpeg" */
export function normalizeMime (declared: string): string {
  return declared.split(';')[0].trim().toLowerCase()
}

/** True when the declared type is on the allowlist (says nothing about the bytes). */
export function isInlineType (declared: string): boolean {
  return INLINE_TYPES.has(normalizeMime(declared))
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** Guess the type from the first bytes (magic numbers). Null when it is not an allowlisted type. */
export function sniffType (head: Uint8Array): string | null {
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 4) === 'PNG') return 'image/png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 6 && /^GIF8[79]a$/.test(ascii(head, 0, 6))) return 'image/gif'
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp'
  if (head.length >= 2 && ascii(head, 0, 2) === 'BM') return 'image/bmp'
  if (head.length >= 12 && ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'video/webm'
  if (head.length >= 4 && ascii(head, 0, 4) === 'OggS') return 'video/ogg'
  return null
}

/**
 * The type to serve for an attachment: the declared one if it is allowlisted and the
 * bytes agree, otherwise a generic download type. QuickTime and MP4 share a container
 * family, so either label is accepted for either.
 */
export function servedType (declared: string, head: Uint8Array): { mime: string, inline: boolean } {
  const want = normalizeMime(declared)
  const got = sniffType(head)
  const family = (m: string) => m === 'video/quicktime' ? 'video/mp4' : m
  if (INLINE_TYPES.has(want) && got && family(want) === family(got)) return { mime: want, inline: true }
  return { mime: DOWNLOAD_TYPE, inline: false }
}
