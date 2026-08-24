// Runtime environment. Only VITE_-prefixed vars exist in the browser bundle.

export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  /**
   * Where this app is actually running.
   *
   * Resolved from the browser first, and only then from the build-time
   * variable. A page knows its own origin; being *told* it by an env var is
   * strictly worse, because a build that forgets the variable silently
   * produces links to localhost. That is not hypothetical — it shipped, and
   * every magic link mailed to a phone pointed at http://localhost:5173,
   * which a phone cannot reach, so the browser reported a typo in the address
   * and sign-in was impossible from mobile.
   *
   * VITE_APP_URL remains the fallback for any non-browser context (tests,
   * SSR), and localhost last for local dev.
   */
  appUrl:
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : ((import.meta.env.VITE_APP_URL as string | undefined) ?? 'http://localhost:5173'),
  demoModeEnabled: (import.meta.env.VITE_ENABLE_DEMO_MODE as string | undefined) !== 'false',
}

export const supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
