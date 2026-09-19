import { previewForPath, previewMetaTags } from '../src/lib/linkPreview'

// The front door, in front of the static assets.
//
// Everything this app serves is one HTML file and a JavaScript bundle. That
// is fine for a browser and wrong for a text message: when a review link
// arrives on a phone, the messaging app fetches the page and draws a preview
// card from the raw HTML without ever running the bundle. So the title the
// customer read was whatever `index.html` shipped with — the product's name,
// which means nothing to them and everything to a spam filter.
//
// This Worker rewrites the title and adds Open Graph tags per path on the way
// out. It is a streaming rewrite, so it costs no round trip and no buffering;
// asset requests fall straight through untouched.
//
// The React app still sets its own title once it loads, and should: by then
// it knows the shop's name and can say "Leave Super Car Audio a review". This
// only fixes the moment before that, which is the only moment a preview card
// ever sees.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

/**
 * Swap the contents of <title> and append the preview tags to <head>.
 *
 * `HTMLRewriter` streams, so `element.setInnerContent` on <title> replaces
 * exactly the text node and nothing else — no regex over the document, no
 * chance of matching a `<title>` inside the bundle's own strings.
 */
function rewriteHead(response: Response, pathname: string): Response {
  const preview = previewForPath(pathname)
  return new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(preview.title)
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        element.setAttribute('content', preview.description)
      },
    })
    .on('head', {
      element(element) {
        element.append(previewMetaTags(preview), { html: true })
      },
    })
    .transform(response)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request)

    // Only HTML gets rewritten. A hashed .js or .css asset is served byte for
    // byte, which keeps it cacheable and keeps this Worker off the hot path.
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return response

    // A failed fetch is passed through as-is; rewriting an error page into
    // "Leave us a review" would be a lie told to a preview card.
    if (!response.ok) return response

    return rewriteHead(response, new URL(request.url).pathname)
  },
}
