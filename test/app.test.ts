import test from 'brittle'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SafeStorageSecretStore, keychainMessage, type SafeStorageLike } from '../src/core/index.ts'
import { setup } from './helpers.ts'

// A stand-in for Electron's safeStorage: "encrypts" by reversing the bytes.
function fakeSafe (available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: s => Buffer.from(s).reverse(),
    decryptString: b => Buffer.from(b).reverse().toString()
  }
}

test('SafeStorageSecretStore encrypts on disk and round-trips', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-safe-'))
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'secrets.bin')
  const store = new SafeStorageSecretStore(file, fakeSafe())
  await store.set('a', Buffer.from('secret-value'))
  t.alike(await store.get('a'), Buffer.from('secret-value'))
  t.is(await store.get('missing'), null)

  const raw = await fs.readFile(file)
  t.absent(raw.toString().includes(Buffer.from('secret-value').toString('base64')), 'not stored as readable JSON')

  const again = new SafeStorageSecretStore(file, fakeSafe())
  t.alike(await again.get('a'), Buffer.from('secret-value'))
  await again.delete('a')
  t.is(await again.get('a'), null)

  if (process.platform !== 'win32') t.is((await fs.stat(file)).mode & 0o777, 0o600)
})

test('SafeStorageSecretStore refuses when the keychain is unavailable', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whm-safe-'))
  t.teardown(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new SafeStorageSecretStore(path.join(dir, 's.bin'), fakeSafe(false))
  await t.exception(() => store.set('a', Buffer.from('x')), /keychain/)
  await t.exception(() => store.get('a'), /keychain/)
})

test('engine state file is private (0600)', async t => {
  if (process.platform === 'win32') return t.pass('modes do not apply on Windows')
  const { peer } = await setup(t)
  const { storage } = await peer('alice')
  t.is((await fs.stat(path.join(storage, 'state.json'))).mode & 0o777, 0o600)
})

test('the keychain error tells each OS what to do', t => {
  t.ok(/click Allow/.test(keychainMessage('darwin')), 'macOS: click Allow on the prompt')
  t.absent(/GNOME/.test(keychainMessage('darwin')))
  t.ok(/GNOME Keyring or KWallet/.test(keychainMessage('linux')), 'Linux keeps the keyring advice')
  t.absent(/click Allow/.test(keychainMessage('linux')))
  t.ok(/keychain/.test(keychainMessage('win32')))
})
