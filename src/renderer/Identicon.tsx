import { useEffect, useRef } from 'react'

function hash (s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h
}

/** Draw the 5×8 mirrored pixel picture for a public key (10×10 canvas, scaled up by CSS). */
export function drawIdenticon (canvas: HTMLCanvasElement, key: string) {
  const g = canvas.getContext('2d')
  if (!g) return
  let h = hash(key)
  const hue = h % 360
  g.fillStyle = '#0b0d10'
  g.fillRect(0, 0, 10, 10)
  g.fillStyle = `hsl(${hue} 65% 62%)`
  for (let y = 1; y < 9; y++) {
    for (let x = 1; x < 5; x++) {
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
      if (h & 1) { g.fillRect(x, y, 1, 1); g.fillRect(9 - x, y, 1, 1) }
    }
  }
}

/** Both sides compute the same picture from the public key, so nothing is sent. */
export function Identicon ({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) drawIdenticon(ref.current, id) }, [id])
  return <canvas ref={ref} width={10} height={10} aria-hidden />
}
