// The Holepunch modules ship without TypeScript types. We keep them loosely
// typed here and wrap them in typed code in the engine.
declare module 'hyperswarm'
declare module 'hyperdht'
declare module 'hyperdht/testnet.js'
declare module 'corestore'
declare module 'hypercore'
declare module 'hypercore-crypto'
declare module 'protomux'
declare module 'compact-encoding'
declare module 'b4a'
declare module 'blind-pairing'
declare module 'z32'
declare module 'brittle' {
  const test: (name: string, fn: (t: any) => unknown) => void
  export default test
}
declare module 'blind-pairing-core'
