// What a link to this app looks like before anyone opens it.
//
// A review link arrives by text message. Before the customer taps anything,
// their phone fetches the page and draws a preview card from the raw HTML —
// title, description, image. It does not run JavaScript, so `usePageTitle`
// never happens: whatever `index.html` shipped with is what the customer
// reads. For months that was "0Gauge Recovery", which is the name of the
// software the shop bought. The customer has never heard of it, so a text
// from the shop they just paid previewed as a stranger's link.
//
// This module decides the preview from the path alone, and a Worker rewrites
// the served HTML with it (see `worker/index.ts`). The path is all there is
// to go on at that moment — no session, no database round trip in front of
// every asset request.
//
// Deliberately shop-neutral. The Worker could not name the shop without a
// lookup it should not be doing, and guessing one from the hostname would
// eventually put the wrong name on a real customer's screen. The domain in
// the card already says supercaraudio.com; the words only have to stop
// working against it.

export interface LinkPreview {
  title: string
  description: string
}

/** The fallback: the platform's own front door, where the product name belongs. */
export const DEFAULT_PREVIEW: LinkPreview = {
  title: '0Gauge Recovery',
  description:
    '0Gauge Recovery — win back customers who got a quote but never came back. Built for independent car-audio shops.',
}

/**
 * Written as a customer would read it on a lock screen.
 *
 * Second person, no product name, no jargon. "Your quote" is the customer's
 * quote, not a feature of an app.
 */
const BY_PREFIX: { prefix: string; preview: LinkPreview }[] = [
  {
    prefix: '/r/',
    preview: {
      title: 'Leave us a review',
      description: 'Tell us how we did. It takes a few seconds.',
    },
  },
  {
    prefix: '/q/',
    preview: {
      title: 'Your quote',
      description: 'Your quote is ready. Open it to see what is included and what it costs.',
    },
  },
  {
    prefix: '/book/',
    preview: {
      title: 'Book your appointment',
      description: 'Pick a day and a time that works for you.',
    },
  },
  {
    prefix: '/booking/',
    preview: {
      title: 'Your appointment',
      description: 'See your appointment, reschedule it, or let us know you cannot make it.',
    },
  },
  {
    prefix: '/ask/',
    preview: {
      title: 'Ask for a review',
      description: 'Enter a phone number to send a review link.',
    },
  },
]

/**
 * The preview for a path.
 *
 * Prefix matching, not equality: every one of these routes carries a token or
 * a slug after it. A bare `/r` with nothing after it is not a review link, so
 * it falls through to the default rather than promising a review page that
 * will render as "link expired".
 */
export function previewForPath(pathname: string | null | undefined): LinkPreview {
  if (!pathname) return DEFAULT_PREVIEW
  // Matching from the start means a query string or a fragment cannot change
  // the answer, so there is nothing to strip first — the opt-out link
  // `/q/<token>?stop=1` still previews as a quote.
  const found = BY_PREFIX.find((entry) => pathname.startsWith(entry.prefix))
  return found ? found.preview : DEFAULT_PREVIEW
}

/** HTML-escape for text going into an attribute value. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The tags a messaging app actually reads, as one HTML fragment.
 *
 * Open Graph is what iMessage, WhatsApp, Messenger and Signal parse; Twitter's
 * card tag is read by a few others and costs two lines. `og:url` is left out
 * on purpose — it would have to be built from the request, and a wrong one
 * makes some clients show a different address than the one the customer was
 * sent, which is exactly the suspicion this change exists to remove.
 */
export function previewMetaTags(preview: LinkPreview): string {
  const title = escapeAttribute(preview.title)
  const description = escapeAttribute(preview.description)
  return [
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
  ].join('')
}
