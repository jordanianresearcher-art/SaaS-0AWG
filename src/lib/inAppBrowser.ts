// Is this page running inside an app's built-in browser rather than the
// phone's real one?
//
// It matters for exactly one flow: signing in. Tapping a magic link in Gmail
// opens it in Gmail's own embedded browser, which has its own storage. A
// session created there is real and works — but only there. Close Gmail, open
// Chrome, and you are signed out, because nothing is shared between them.
// There is no web API that moves a session from one browser to another.
//
// What saves us is that /auth/confirm does not verify on load — it waits for a
// tap. So when the page opens in an embedded browser the token is still
// unused, and the same link pasted into the real browser signs you in *there*,
// which is where you actually want to be.
//
// Detection is best-effort by nature: user-agent strings are the only signal,
// apps change them, and iOS apps using SFSafariViewController are close to
// indistinguishable from Safari. So this is used to *promote* the handoff
// advice, never to gate anything — the escape hatch is offered either way, and
// a false negative costs nothing.

/** Markers that identify an embedded browser with reasonable confidence. */
const IN_APP_MARKERS: Array<{ pattern: RegExp; app: string }> = [
  // Android WebView reports "; wv)" in its UA — Gmail, and most Android apps
  // that embed a browser, land here.
  { pattern: /;\s*wv\)/i, app: 'this app' },
  { pattern: /FBAN|FBAV|FB_IAB/i, app: 'Facebook' },
  { pattern: /Instagram/i, app: 'Instagram' },
  { pattern: /\bLine\//i, app: 'LINE' },
  { pattern: /MicroMessenger/i, app: 'WeChat' },
  { pattern: /LinkedInApp/i, app: 'LinkedIn' },
  { pattern: /\bTwitter\b/i, app: 'X' },
  // Google's own iOS app (Gmail and Search both use it for links).
  { pattern: /\bGSA\//i, app: 'the Google app' },
]

export interface InAppBrowserInfo {
  /** True when the UA matches a known embedded browser. */
  isInApp: boolean
  /** Which app, when we can tell — for copy like "Gmail's browser". */
  app: string | null
}

export function detectInAppBrowser(userAgent: string | null | undefined): InAppBrowserInfo {
  const ua = userAgent ?? ''
  if (!ua) return { isInApp: false, app: null }

  for (const { pattern, app } of IN_APP_MARKERS) {
    if (pattern.test(ua)) return { isInApp: true, app }
  }
  return { isInApp: false, app: null }
}

/** Convenience wrapper for component code. Safe outside a browser. */
export function currentInAppBrowser(): InAppBrowserInfo {
  if (typeof navigator === 'undefined') return { isInApp: false, app: null }
  return detectInAppBrowser(navigator.userAgent)
}
