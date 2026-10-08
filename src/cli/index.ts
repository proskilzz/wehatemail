// Small dev CLI for testing the engine by hand, on one or two machines.
//   npm run cli -- --data ./alice
// Type /help once it's running.
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { clearLine, cursorTo } from 'node:readline'
import { parseArgs } from 'node:util'
import { Engine, FileSecretStore, type Contact, type Message } from '../core/index.ts'

const { values: args } = parseArgs({
  options: {
    data: { type: 'string', default: path.join(os.homedir(), '.wehatemail-cli') },
    name: { type: 'string' },
    // For local testing against your own DHT: --bootstrap 127.0.0.1:49737
    bootstrap: { type: 'string' }
  }
})

const storage = path.resolve(args.data!)
const bootstrap = args.bootstrap?.split(',').map(s => {
  const [host, port] = s.split(':')
  return { host, port: Number(port) }
})
const engine = new Engine({
  storage,
  // Dev only: secrets go in a plain file. The desktop app uses the OS keychain.
  secrets: new FileSecretStore(path.join(storage, 'secrets.json')),
  bootstrap,
  // A local test DHT only answers on the loopback address.
  host: bootstrap?.every(b => b.host === '127.0.0.1') ? '127.0.0.1' : undefined
})

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
let current: Contact | null = null

function print (line: string) {
  // Keep the prompt tidy when something arrives while typing.
  clearLine(process.stdout, 0)
  cursorTo(process.stdout, 0)
  console.log(line)
  rl.prompt(true)
}

function time (ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function tick (m: Message) {
  if (!m.fromMe) return ''
  return m.status === 'read' ? ' ✓✓ read' : m.status === 'delivered' ? ' ✓✓' : ' ✓ waiting for ' + current?.name
}

function presence (c: Contact) {
  if (c.presence.status === 'online') return 'Connected'
  return c.presence.lastSeen ? 'Offline: last seen ' + new Date(c.presence.lastSeen).toLocaleString() : 'Offline'
}

function findContact (q: string): Contact {
  const list = engine.contacts()
  const n = Number(q)
  const c = Number.isInteger(n) && n >= 1 ? list[n - 1] : list.find(c => c.name.toLowerCase() === q.toLowerCase())
  if (!c) throw new Error('No such contact. Try /contacts')
  return c
}

const HELP = `
  /invite              make an invite link to send to someone
  /invites             list unused invites    /revoke <n>   revoke one
  /join <link|code>    use someone's invite
  /contacts            list contacts          /chat <n|name> talk to one
  /history             show this conversation
  /safety              show the safety code to compare with them
  /verify              mark them as verified (after comparing the code)
  /name <name>         change your display name
  /quit
  Anything else is sent as a message to the current contact.
`

async function command (line: string) {
  const [cmd, ...rest] = line.split(' ')
  const arg = rest.join(' ').trim()
  switch (cmd) {
    case '/help': return print(HELP)
    case '/name': await engine.setName(arg); return print('Name set to ' + engine.name)
    case '/invite': {
      const inv = await engine.createInvite()
      return print(`Send them this link (single use, expires ${new Date(inv.expiresAt).toLocaleString()}):\n  ${inv.link}\nOr the code:\n  ${inv.code}`)
    }
    case '/invites': {
      const list = engine.listInvites()
      if (!list.length) return print('No unused invites.')
      return print(list.map((inv, i) => `  ${i + 1}. made ${new Date(inv.createdAt).toLocaleString()}, expires ${new Date(inv.expiresAt).toLocaleString()}`).join('\n'))
    }
    case '/revoke': {
      const inv = engine.listInvites()[Number(arg) - 1]
      if (!inv) return print('No such invite. Try /invites')
      await engine.revokeInvite(inv.id)
      return print('Revoked.')
    }
    case '/join': {
      if (!arg) return print('Usage: /join <link or code>')
      print('Pairing... (both of you need to be online)')
      const c = await engine.acceptInvite(arg, { timeout: 2 * 60 * 1000 })
        .catch((err: Error) => {
          throw new Error(err.message === 'Pairing timed out'
            ? 'Pairing timed out. The invite may be used, revoked or expired, or they are offline.'
            : err.message)
        })
      current = c
      return print(`Paired with ${c.name}. Safety code: ${c.safetyCode}\nYou're now chatting with ${c.name}.`)
    }
    case '/contacts': {
      const list = engine.contacts()
      if (!list.length) return print('No contacts yet. Use /invite or /join.')
      return print(list.map((c, i) => `  ${i + 1}. ${c.name}${c.verified ? ' (verified)' : ''}: ${presence(c)}${c.unread ? `, ${c.unread} unread` : ''}`).join('\n'))
    }
    case '/chat': {
      current = findContact(arg)
      print(`Chatting with ${current.name} (${presence(current)})`)
      return command('/history')
    }
    case '/history': {
      if (!current) return print('Pick a contact first: /chat <n>')
      const msgs = await engine.messages(current.id)
      await engine.markRead(current.id)
      if (!msgs.length) return print('(no messages yet)')
      return print(msgs.map(m => `  [${time(m.timestamp)}] ${m.fromMe ? 'you' : current!.name}: ${m.deleted ? '(deleted)' : m.text}${m.edited ? ' (edited)' : ''}${tick(m)}`).join('\n'))
    }
    case '/safety': {
      if (!current) return print('Pick a contact first: /chat <n>')
      return print(`Safety code with ${current.name}: ${current.safetyCode}\nCompare it by voice or in person. If it matches, type /verify.`)
    }
    case '/verify': {
      if (!current) return print('Pick a contact first: /chat <n>')
      await engine.setVerified(current.id, true)
      return print(current.name + ' marked as verified.')
    }
    case '/quit': return quit()
    default: return print('Unknown command. Type /help')
  }
}

async function quit () {
  rl.close()
  await engine.close()
  process.exit(0)
}

async function main () {
  await engine.ready()
  if (args.name) await engine.setName(args.name)
  while (!engine.name) await engine.setName(await rl.question('Your display name: ')).catch(() => {})

  console.log(`We Hate Mail dev CLI. You are ${engine.name}. Data: ${storage}`)
  console.log('Note: this CLI keeps secrets in a plain file. Type /help for commands.')

  engine.on('contact', (c: Contact) => {
    print(`* ${c.name} is now a contact. Safety code: ${c.safetyCode}`)
    if (!current) current = c
  })
  engine.on('presence', (id: string) => {
    const c = engine.contact(id)
    print(`* ${c.name}: ${presence(c)}`)
  })
  engine.on('message', (id: string, m: Message) => {
    if (m.fromMe) return
    const c = engine.contact(id)
    const files = m.attachments.map(a => `[${a.kind}: ${a.name}]`).join(' ')
    print(`[${time(m.timestamp)}] ${c.name}: ${[m.text, files].filter(Boolean).join(' ')}`)
    if (current?.id === id) engine.markRead(id).catch(() => {})
  })
  engine.on('typing', (id: string, typing: boolean) => {
    if (typing && current?.id === id) print(`* ${engine.contact(id).name} is typing...`)
  })
  engine.on('warning', (_id: string, msg: string) => print('! ' + msg))

  const list = engine.contacts()
  if (list.length) {
    current = list[0]
    console.log(`Chatting with ${current.name}. /contacts to see everyone.`)
  }

  rl.setPrompt('> ')
  rl.prompt()
  rl.on('line', async (line) => {
    line = line.trim()
    try {
      if (!line) return rl.prompt()
      if (line.startsWith('/')) return await command(line)
      if (!current) return print('No contact selected. Use /invite, /join or /chat.')
      const m = await engine.sendText(current.id, line)
      if (m.status === 'waiting' && engine.contact(current.id).presence.status !== 'online') {
        print(`  ✓ waiting for ${current.name} (sends when they're online)`)
      } else {
        rl.prompt()
      }
    } catch (err: any) {
      print('! ' + err.message)
    }
  })
  rl.on('close', () => { engine.close().then(() => process.exit(0)) })
  process.on('SIGINT', quit)
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
