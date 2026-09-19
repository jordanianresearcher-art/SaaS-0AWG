import { useEffect } from 'react'

/**
 * The browser tab, set by the page that owns it.
 *
 * Public pages are read by customers, not by the shop, and the tab is part of
 * what they see — in a tab strip, in a "recently closed" list, and in a
 * screenshot they send someone. "0Gauge Recovery" there tells a customer
 * nothing and looks like they landed on the wrong site.
 *
 * Deliberately a page-level concern rather than something the app shell does
 * globally: a global setter and a page setter race on mount, and React runs
 * child effects before parent ones, so the shell would win and the page's
 * title would flash and vanish.
 */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
