import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, supabaseConfigured } from '../lib/env'

let client: SupabaseClient | null = null

/** Browser Supabase client using the public anon key only. */
export function getSupabase(): SupabaseClient {
  if (!supabaseConfigured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseAnonKey)
  }
  return client
}
