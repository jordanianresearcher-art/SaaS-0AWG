// Live storefront search against the retailers this trade actually buys from.
//
// This is what "the car inventory webapp was almost perfect" turns out to have
// been: not a smarter model, but not asking a model at all. The specialist
// retailers (Down4Sound, Moon Car Stereo, Sky High) and manufacturers
// (Sundown) run ordinary storefront platforms whose own search boxes are
// backed by public endpoints that return the product name, the live price,
// the image, and the URL in a few hundred milliseconds. A grounded AI web
// search takes ten seconds to arrive at a worse version of the same answer —
// it is only worth its cost for products these stores don't carry.
//
// Two platforms cover every store on the owner's list:
//
//   Shopify      GET /search/suggest.json?q=…      → clean JSON
//   BigCommerce  GET /search.php?search_query=…    → an HTML page, parsed
//                &template=search/quick-results      here with real fixtures
//
// The HTML parsing anchors on BigCommerce's `data-product-price-without-tax`
// / `data-compare-image` data attributes and the Cornerstone `card-title`
// structure — platform-level markup, not per-shop theme classes — and every
// regex below is exercised against captured copies of the real responses in
// __fixtures__/. A store redesign breaks a fixture test, not a shop's intake.
//
// Only the parsing lives here (pure, testable, mirrored into the Edge
// Function under the usual duplication rule). The fetching — timeouts,
// parallelism, which stores — is the Edge Function's business.

/** One product listing as a retailer's own search returned it. */
export interface RetailerHit {
  /** Display name of the store ("Down4Sound"), for evidence lines. */
  retailer: string
  /** The listing title, entity-decoded, whitespace-collapsed. */
  name: string
  /** The store's vendor/brand field when it has one. */
  brand: string | null
  /** Absolute product-page URL, tracking query stripped. */
  url: string
  imageUrl: string | null
  /** The live selling price. Null when sold out or unpriced. */
  priceCents: number | null
  /** Manufacturer list price when the store shows one alongside. */
  msrpCents: number | null
}

/** The handful of entities storefront HTML actually uses in titles and URLs. */
export function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/**
 * "$1,199.99" / "329.99" / 329.99 → cents. Null for absent, unparseable, or
 * zero — storefronts print "0.00" for sold-out and placeholder prices, and a
 * free product does not exist in this catalog.
 */
export function centsFromPrice(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/[^0-9.]/g, '')
  if (!text) return null
  const dollars = Number.parseFloat(text)
  if (!Number.isFinite(dollars) || dollars <= 0) return null
  return Math.round(dollars * 100)
}

/** Absolutize a storefront link and drop its search-tracking query string. */
function cleanUrl(rawHref: string, origin: string): string | null {
  const href = decodeHtmlEntities(rawHref.trim()).split('?')[0]
  if (!href) return null
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith('//')) return `https:${href}`
  if (href.startsWith('/')) return `${origin}${href}`
  return null
}

function cleanImage(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const url = raw.trim()
  if (url.startsWith('//')) return `https:${url}`
  if (/^https?:\/\//i.test(url)) return url
  return null
}

function collapseWhitespace(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * Shopify predictive search: resources.results.products[].
 *
 * Deliberately tolerant of everything except the fields it needs — `body`
 * carries kilobytes of product HTML and `variants` an array of objects, and
 * both are ignored rather than validated so a Shopify version bump that
 * reshapes them cannot break parsing of the fields that matter.
 */
export function parseShopifySuggest(payload: unknown, origin: string, retailer: string, limit = 4): RetailerHit[] {
  const products = (payload as { resources?: { results?: { products?: unknown[] } } })?.resources?.results
    ?.products
  if (!Array.isArray(products)) return []

  const hits: RetailerHit[] = []
  for (const raw of products) {
    if (hits.length >= limit) break
    const p = raw as Record<string, unknown>
    if (typeof p?.title !== 'string' || typeof p?.url !== 'string') continue
    const url = cleanUrl(p.url, origin)
    if (!url) continue
    const featured = (p.featured_image as { url?: unknown } | null | undefined)?.url
    const price = centsFromPrice(p.price as string | number | null | undefined)
    const compareAt = centsFromPrice(p.compare_at_price_min as string | number | null | undefined)
    hits.push({
      retailer,
      name: collapseWhitespace(p.title),
      brand: typeof p.vendor === 'string' && p.vendor.trim() ? p.vendor.trim() : null,
      url,
      imageUrl: cleanImage(typeof p.image === 'string' ? p.image : typeof featured === 'string' ? featured : null),
      priceCents: price,
      // Shopify's compare-at is the "was" price; only meaningful above the
      // live price, and "0.00" has already collapsed to null.
      msrpCents: compareAt !== null && price !== null && compareAt > price ? compareAt : null,
    })
  }
  return hits
}

/**
 * BigCommerce quick-results: a full themed HTML page, mined for its product
 * cards.
 *
 * Association is positional. Titles anchor the cards; each card's price,
 * MSRP, and brand are the first of their kind AFTER its title and before the
 * next one, and its image is the last image BEFORE the title (the figure
 * precedes the card body in Cornerstone markup). Images prefer the
 * `data-compare-image` attribute, falling back to a lazyloaded card image's
 * `data-src` — the `src` on those is a loading-spinner placeholder.
 */
export function parseBigCommerceQuickResults(
  html: string,
  origin: string,
  retailer: string,
  limit = 5,
): RetailerHit[] {
  const titleRe = /<h4 class="card-title">\s*<a href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/g
  const titles: Array<{ href: string; text: string; start: number; end: number }> = []
  for (let m = titleRe.exec(html); m; m = titleRe.exec(html)) {
    titles.push({ href: m[1], text: m[2], start: m.index, end: titleRe.lastIndex })
  }

  const hits: RetailerHit[] = []
  const seenUrls = new Set<string>()
  for (let i = 0; i < titles.length && hits.length < limit; i++) {
    const t = titles[i]
    const url = cleanUrl(t.href, origin)
    const name = collapseWhitespace(decodeHtmlEntities(t.text))
    if (!url || !name || seenUrls.has(url)) continue

    // The card's own territory: after this title, before the next.
    const segment = html.slice(t.end, i + 1 < titles.length ? titles[i + 1].start : html.length)
    const price = segment.match(/data-product-price-without-tax[^>]*>\s*\$?([\d,]+(?:\.\d{1,2})?)\s*</)
    const msrp = segment.match(/data-product-rrp-price-without-tax[^>]*>\s*\$?([\d,]+(?:\.\d{1,2})?)\s*</)
    const brand = segment.match(/card-text--brand[^>]*>\s*([^<]+?)\s*</)

    // Backwards for the image: from the previous title (or the top) to here.
    const before = html.slice(i > 0 ? titles[i - 1].end : 0, t.start)
    let imageUrl: string | null = null
    const compareImages = [...before.matchAll(/data-compare-image="([^"]+)"/g)]
    if (compareImages.length > 0) {
      imageUrl = cleanImage(decodeHtmlEntities(compareImages[compareImages.length - 1][1]))
    } else {
      const cardImages = [...before.matchAll(/<img[^>]*class=['"][^'"]*card-image[^'"]*['"][^>]*>/g)]
      const last = cardImages[cardImages.length - 1]?.[0]
      const src = last?.match(/data-src="([^"]+)"/) ?? last?.match(/src="([^"]+)"/)
      if (src) imageUrl = cleanImage(decodeHtmlEntities(src[1]))
    }

    seenUrls.add(url)
    hits.push({
      retailer,
      name,
      brand: brand ? collapseWhitespace(decodeHtmlEntities(brand[1])) : null,
      url,
      imageUrl,
      priceCents: centsFromPrice(price?.[1] ?? null),
      msrpCents: centsFromPrice(msrp?.[1] ?? null),
    })
  }
  return hits
}

/**
 * Merge per-store result lists round-robin — each store's own relevance
 * ranking is preserved within itself, and no single store's verbosity can
 * crowd the others off a short list.
 */
export function interleaveRetailerHits(groups: RetailerHit[][], limit = 6): RetailerHit[] {
  const out: RetailerHit[] = []
  const seen = new Set<string>()
  for (let round = 0; out.length < limit; round++) {
    let added = false
    for (const group of groups) {
      const hit = group[round]
      if (!hit || out.length >= limit) continue
      if (seen.has(hit.url)) continue
      seen.add(hit.url)
      out.push(hit)
      added = true
    }
    if (!added) break
  }
  return out
}
