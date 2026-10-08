import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Where the engine keeps secrets (identity seed, conversation keys, invite
 * seeds). The Electron app passes one backed by `safeStorage` (OS keychain).
 * The engine never logs what goes through here.
 */
export interface SecretStore {
  get (name: string): Promise<Buffer | null>
  set (name: string, value: Buffer): Promise<void>
  delete (name: string): Promise<void>
}

/** Keeps secrets in memory only. For tests. */
export class MemorySecretStore implements SecretStore {
  private map = new Map<string, Buffer>()
  async get (name: string) { return this.map.get(name) ?? null }
  async set (name: string, value: Buffer) { this.map.set(name, Buffer.from(value)) }
  async delete (name: string) { this.map.delete(name) }
}

/**
 * Keeps secrets in a plain file (mode 0600). For the dev CLI only: it is NOT
 * encrypted. The desktop app uses the OS keychain instead.
 */
export class FileSecretStore implements SecretStore {
  private cache: Record<string, string> | null = null
  constructor (private file: string) {}

  private async load () {
    if (this.cache) return this.cache
    try {
      this.cache = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
      this.cache = {}
    }
    return this.cache!
  }

  private async save () {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(this.cache), { mode: 0o600 })
    await fs.rename(tmp, this.file)
  }

  async get (name: string) {
    const v = (await this.load())[name]
    return v === undefined ? null : Buffer.from(v, 'base64')
  }

  async set (name: string, value: Buffer) {
    (await this.load())[name] = value.toString('base64')
    await this.save()
  }

  async delete (name: string) {
    delete (await this.load())[name]
    await this.save()
  }
}

/** The slice of Electron's `safeStorage` we use. Lets this stay Electron-free and testable. */
export interface SafeStorageLike {
  isEncryptionAvailable (): boolean
  encryptString (plain: string): Buffer
  decryptString (encrypted: Buffer): string
}

/**
 * Keeps secrets in one file, encrypted with the OS keychain through Electron's
 * `safeStorage`. The file is mode 0600. Throws if the OS can't encrypt, rather
 * than quietly falling back to plain text.
 */
export class SafeStorageSecretStore implements SecretStore {
  private cache: Record<string, string> | null = null
  constructor (private file: string, private safe: SafeStorageLike) {}

  private async load () {
    if (!this.safe.isEncryptionAvailable()) {
      throw new Error('Your system keychain is not available, so secrets cannot be stored safely. On Linux, install and unlock GNOME Keyring or KWallet, then start the app again.')
    }
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.file)
      this.cache = JSON.parse(this.safe.decryptString(raw))
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
      this.cache = {}
    }
    return this.cache!
  }

  private async save () {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = this.file + '.tmp'
    await fs.writeFile(tmp, this.safe.encryptString(JSON.stringify(this.cache)), { mode: 0o600 })
    await fs.rename(tmp, this.file)
  }

  async get (name: string) {
    const v = (await this.load())[name]
    return v === undefined ? null : Buffer.from(v, 'base64')
  }

  async set (name: string, value: Buffer) {
    (await this.load())[name] = value.toString('base64')
    await this.save()
  }

  async delete (name: string) {
    delete (await this.load())[name]
    await this.save()
  }
}
