let ctx: AudioContext | null = null

/** Our own soft two-note "door" chime. Up when a buddy comes online, down when they leave. */
export function door (arriving: boolean) {
  try {
    ctx ??= new AudioContext()
    const notes = arriving ? [523, 784] : [784, 523]
    notes.forEach((freq, i) => {
      const t = ctx!.currentTime + i * 0.12
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(t)
      osc.stop(t + 0.32)
    })
  } catch {}
}
