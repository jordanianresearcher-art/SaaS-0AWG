// Refuse to ship a browser bundle with no Supabase credentials in it.
//
// Vite inlines `VITE_*` variables at BUILD time, so where the build runs
// decides what ends up in the bundle. Cloudflare Pages builds this project
// with those variables set in the Pages project (see README), and that worked
// fine. A `deploy:web` script that builds on a laptop instead does not have
// them, produces a bundle whose Supabase config is two empty strings, and
// uploads it perfectly successfully — and the live site then greets everyone
// with "Login isn't set up on this install yet."
//
// Nothing about that failure looks like a build problem, which is what makes
// it worth a hard stop: the build succeeded, the upload succeeded, and the
// only symptom is on the far side of a deploy. So this runs before the build
// and fails loudly instead.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']

/**
 * Vite's own precedence, later files winning. `.env.local` variants are
 * git-ignored and are where real credentials usually live.
 */
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local']

function parseEnvFile(path) {
  const out = {}
  if (!existsSync(path)) return out
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    // Strip surrounding quotes the way a dotenv loader would.
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
    out[key] = value
  }
  return out
}

const fromFiles = {}
for (const file of ENV_FILES) Object.assign(fromFiles, parseEnvFile(resolve(process.cwd(), file)))

// process.env wins: that is how CI (Cloudflare Pages, GitHub Actions) supplies
// these, and it has no .env file at all.
const resolved = { ...fromFiles, ...process.env }
const missing = REQUIRED.filter((key) => !String(resolved[key] ?? '').trim())

if (missing.length > 0) {
  console.error(`
✖ Refusing to build a deploy bundle without: ${missing.join(', ')}

  Vite bakes VITE_* variables into the bundle at build time. Building here
  without them uploads a site that says "Login isn't set up on this install
  yet" to every visitor — the build and the upload both succeed, so nothing
  warns you until it is live.

  Two ways forward:

  1. Let Cloudflare build it (this project's documented setup, and the one
     that has been working). Just push:

         git push

     Cloudflare Pages builds with the VITE_* variables set in the Pages
     project. Nothing else is needed.

  2. Build and deploy from here. Create a .env.local with the same values as
     the Pages project:

         VITE_SUPABASE_URL=https://<project-ref>.supabase.co
         VITE_SUPABASE_ANON_KEY=<anon key>
         VITE_APP_URL=https://<your live url>

     Both are public, RLS-protected values — the anon key is meant to ship in
     a browser bundle. Never put a service-role or Resend key in a VITE_
     variable; those belong in Supabase secrets.

  Edge Functions are unaffected either way: 'npm run deploy:functions' needs
  none of these.
`)
  process.exit(1)
}

console.log(`✔ Deploy env OK (${REQUIRED.join(', ')} present)`)
