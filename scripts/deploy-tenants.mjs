// Upload the build that already exists to every client's Cloudflare account.
//
// One repository, one build, many places to put it. This runs AFTER the
// platform deploy and reuses the same dist/, which matters: VITE_* variables
// are baked in at build time and every tenant talks to the same Supabase
// project, so rebuilding per tenant would produce identical bundles and
// invite them to stop being identical.
//
// A tenant config is any wrangler.<name>.jsonc in the repo root. Adding a
// client is copying one file and changing two fields.
//
// Cloudflare requires a Worker and the domain it serves to be in the same
// account. That is the only reason these exist — not because the software
// differs per client. It does not, and it must not.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const PLACEHOLDER = 'PASTE_'
const root = process.cwd()
const configs = readdirSync(root).filter((f) => /^wrangler\..+\.jsonc?$/.test(f)).sort()

if (configs.length === 0) {
  console.log('No client deployments configured. Nothing else to upload.')
  process.exit(0)
}

let deployed = 0
let skipped = 0

for (const file of configs) {
  const raw = readFileSync(resolve(root, file), 'utf8')
  const name = (raw.match(/"name"\s*:\s*"([^"]+)"/) ?? [])[1] ?? file
  // A placeholder account id is a setup step nobody finished, not a failure.
  // Say which file and what to put in it rather than letting wrangler fail
  // with an authentication error that points nowhere useful.
  if (raw.includes(PLACEHOLDER)) {
    console.warn(`\n⏭  ${name} — skipped.`)
    console.warn(`   ${file} still has a placeholder account id.`)
    console.warn('   Cloudflare dashboard → that account → the ID is in the address bar and in the sidebar.')
    skipped++
    continue
  }
  console.log(`\n→ ${name} (${file})`)
  try {
    execFileSync('npx', ['wrangler', 'deploy', '-c', file], { stdio: 'inherit', shell: process.platform === 'win32' })
    deployed++
  } catch {
    // Keep going: one client's account being unreachable must not stop the
    // rest from getting the fix.
    console.error(`✖ ${name} failed to deploy. The others are unaffected; re-run when it is sorted.`)
    skipped++
  }
}

console.log(`\n${deployed} client deployment(s) updated${skipped ? `, ${skipped} skipped` : ''}.`)
