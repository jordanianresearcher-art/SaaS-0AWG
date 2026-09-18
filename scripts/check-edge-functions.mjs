// Type-check the Edge Functions, which nothing else does.
//
// These files are the one part of this repo that `tsc -b` never sees: they
// are Deno, they import from URLs, and they live outside the app's tsconfig
// `include`. For a long time the only check they got was an esbuild parse,
// which answers "is this valid syntax?" and nothing else.
//
// That gap shipped a real outage. A refactor replaced a timeout expression
// across the file, including inside three functions that had no `diag`
// variable in scope. It parsed perfectly. At runtime it was a ReferenceError
// on the very first call of the Gemini path, which surfaced to the shop as
// "Could not reach the AI provider" — a message that sends someone to check
// their API key for a bug that had nothing to do with it.
//
// So: stub the URL imports and the Deno global, then run the real compiler.
// Not a full Deno type-check (that would need the Deno toolchain, which is
// not installed here and is not worth a dependency) — but it catches the
// class of mistake that actually happened: undefined names, wrong arity,
// mismatched types.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const FUNCTIONS_DIR = resolve(process.cwd(), 'supabase/functions')

/**
 * Deno's ambient globals and the remote imports, replaced with declarations.
 * Loose on purpose: the goal is to check *our* logic, not to re-type the
 * Supabase client. Anything imported from a URL becomes `any`, so a genuine
 * mistake in our own code still surfaces while third-party shapes do not
 * produce noise nobody will act on.
 */
const PRELUDE = `
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
`

function stubRemoteImports(source) {
  const names = []
  const stripped = source.replace(
    /import\s+(?:type\s+)?(\{[^}]*\}|[\w*\s,]+?)\s+from\s+['"]https:\/\/[^'"]+['"];?\n/g,
    (_match, clause) => {
      const inner = clause.replace(/[{}]/g, '')
      for (const part of inner.split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name && name !== '*' && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name)
      }
      return ''
    },
  )
  const decls = [...new Set(names)].map((n) => `declare const ${n}: any\ndeclare type ${n} = any\n`).join('')
  return { stripped, decls }
}

const TSC = resolve(process.cwd(), 'node_modules/.bin/tsc')

// Checked once, up front, because the failure mode otherwise is silent and
// actively misleading: every function prints a cross with no error under it,
// the script says "9 Edge Function(s) failed type-checking", and the person
// reading that goes looking for a bug in code that is fine. It has already
// cost one person an evening. A missing compiler is a missing compiler, and
// this says so.
if (!existsSync(TSC)) {
  console.error('Cannot find the TypeScript compiler at node_modules/.bin/tsc.')
  console.error('Nothing is wrong with the Edge Functions — the checker cannot run.')
  console.error('\n  npm install\n')
  console.error('Then try again.')
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'edge-typecheck-'))
const entries = readdirSync(FUNCTIONS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())

let failed = 0
for (const entry of entries) {
  const file = join(FUNCTIONS_DIR, entry.name, 'index.ts')
  let source
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const { stripped, decls } = stubRemoteImports(source)
  const out = join(dir, `${entry.name}.ts`)
  writeFileSync(out, PRELUDE + decls + stripped)

  try {
    execFileSync(
      TSC,
      [
        '--noEmit',
        '--target', 'es2022',
        '--lib', 'es2022,dom',
        '--strict',
        '--skipLibCheck',
        '--module', 'esnext',
        '--moduleResolution', 'bundler',
        out,
      ],
      { stdio: 'pipe' },
    )
    console.log(`✔ ${entry.name}`)
  } catch (err) {
    const raw = `${err.stdout ?? ''}${err.stderr ?? ''}`
    const report = raw
      .split('\n')
      // Line numbers refer to the stubbed copy, which is offset by the
      // prelude — say so rather than sending someone to the wrong line.
      .filter((line) => line.includes('error TS'))
      .join('\n')
    // Never print a bare cross. If the compiler failed without producing a
    // TS error, whatever it did say is more useful than silence.
    console.error(`✖ ${entry.name}\n${report || raw.trim() || err.message || 'tsc failed with no output.'}`)
    failed++
  }
}

if (failed > 0) {
  console.error(`\n${failed} Edge Function(s) failed type-checking.`)
  console.error('Line numbers are from a stubbed copy in a temp dir; the offset is this script\'s prelude.')
  process.exit(1)
}
console.log(`\n${entries.length} Edge Function(s) type-check clean.`)
