// Copy the handwritten browser half into lib/ so the packaged bundle ships
// the ./client export (dsh-client-modules serves this file to the web shell).
import { copyFileSync, mkdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
mkdirSync(new URL('lib/', root), { recursive: true })
copyFileSync(new URL('client/client.js', root), new URL('lib/client.js', root))
console.log('copied client/client.js -> lib/client.js')
