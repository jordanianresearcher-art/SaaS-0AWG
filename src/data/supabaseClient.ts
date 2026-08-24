import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, supabaseConfigured } from '../lib/env'

let client: SupabaseClient | null = null

/** Browser Supabase client using the public anon key only. */
export function getSupabase(): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        // These are supabase-js defaults today. They are written out because
        // staying signed in is a product requirement here — a shop owner signs
        // in once on the phone they carry all day — and a silent change to a
        // library default should show up as a diff in this file rather than as
        // an owner being logged out mid-shift.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // storageKey is deliberately NOT set. Overriding it would move every
        // stored session to a new key, signing out everyone who is currently
        // signed in — a certain cost, paid once by real users, against a
        // hypothetical benefit. The default is fine.
      },
    })
  }
  return client
}
