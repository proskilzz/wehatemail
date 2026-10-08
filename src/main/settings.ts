import fs from 'node:fs/promises'
import path from 'node:path'
import type { Settings } from '../shared/api.ts'

const DEFAULTS: Settings = { acknowledged: false, status: 'no mail. just us.', sounds: false }

/** Tiny JSON settings file (mode 0600). Holds no secrets. */
export class SettingsFile {
  private value: Settings = { ...DEFAULTS }
  constructor (private file: string) {}

  async load () {
    try {
      this.value = { ...DEFAULTS, ...JSON.parse(await fs.readFile(this.file, 'utf8')) }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
    return this.get()
  }

  get (): Settings { return { ...this.value } }

  async update (patch: Partial<Settings>) {
    const next = { ...this.value }
    if (typeof patch.acknowledged === 'boolean') next.acknowledged = patch.acknowledged
    if (typeof patch.sounds === 'boolean') next.sounds = patch.sounds
    if (typeof patch.status === 'string') next.status = patch.status.slice(0, 80)
    this.value = next
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    await fs.writeFile(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 })
    await fs.rename(this.file + '.tmp', this.file)
    return this.get()
  }
}
