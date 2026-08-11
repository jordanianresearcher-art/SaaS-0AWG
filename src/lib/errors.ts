// Best-effort human-readable text out of a caught value. Most things this
// app throws are a real Error, but Supabase's PostgrestError (what a failed
// insert/update/rpc throws) is a plain object shaped like
// { message, details, hint, code } — not an Error instance — so a bare
// `err instanceof Error` check misses it and every DB failure collapses to
// the same generic "please try again" toast with no way to tell a real bug
// (a missing column from an unapplied migration, a NOT NULL violation, an
// RLS denial) from a flaky network blip. Surfacing the real message where
// it's safe to (staff-facing screens, not the public quote page) turns
// "could not save" into something a shop owner can actually act on or
// report back.
export function errorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m
  }
  return null
}
