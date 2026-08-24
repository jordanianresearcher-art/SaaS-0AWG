import { describe, expect, it } from 'vitest'
import { detectInAppBrowser } from './inAppBrowser'

// Real user-agent strings. The Android WebView one is the case that matters:
// it is what Gmail hands a tapped magic link on Android, and the session
// created there never reaches Chrome.
const GMAIL_ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36'
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36'
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

describe('detectInAppBrowser', () => {
  it('spots the Android WebView Gmail opens links in', () => {
    const info = detectInAppBrowser(GMAIL_ANDROID_WEBVIEW)
    expect(info.isInApp).toBe(true)
  })

  it('does not flag a real mobile browser', () => {
    // A false positive is worse than a false negative here: it would nag
    // someone already in the right place.
    expect(detectInAppBrowser(CHROME_ANDROID).isInApp).toBe(false)
    expect(detectInAppBrowser(SAFARI_IOS).isInApp).toBe(false)
    expect(detectInAppBrowser(DESKTOP_CHROME).isInApp).toBe(false)
  })

  it('names the app when it can', () => {
    expect(detectInAppBrowser('Mozilla/5.0 Instagram 300.0 Android').app).toBe('Instagram')
    expect(detectInAppBrowser('Mozilla/5.0 [FBAN/FBIOS;FBAV/400.0]').app).toBe('Facebook')
    expect(detectInAppBrowser('Mozilla/5.0 iPhone GSA/300.0 Mobile').app).toBe('the Google app')
  })

  it('is not fooled by "wv" appearing inside another token', () => {
    // The marker is "; wv)" specifically — a device model containing those
    // letters must not trip it.
    expect(detectInAppBrowser('Mozilla/5.0 (Linux; Android 13; SM-WV100) Chrome/116 Mobile Safari/537.36').isInApp).toBe(
      false,
    )
  })

  it('handles a missing user agent rather than throwing', () => {
    expect(detectInAppBrowser(null)).toEqual({ isInApp: false, app: null })
    expect(detectInAppBrowser(undefined)).toEqual({ isInApp: false, app: null })
    expect(detectInAppBrowser('')).toEqual({ isInApp: false, app: null })
  })
})
