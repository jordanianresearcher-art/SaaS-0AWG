// Runtime environment. Only VITE_-prefixed vars exist in the browser bundle.

export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  appUrl: (import.meta.env.VITE_APP_URL as string | undefined) ?? 'http://localhost:5173',
  demoModeEnabled: (import.meta.env.VITE_ENABLE_DEMO_MODE as string | undefined) !== 'false',
}

export const supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
