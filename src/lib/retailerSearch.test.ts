// Exercised against captured copies of the real storefront responses — the
// __fixtures__ files are trimmed windows of what these endpoints actually
// returned, not hand-written approximations. When a store redesigns and a
// parser stops finding its cards, the failure lands here with the store's
// name on it instead of in a shop's intake flow as "search found nothing".

import { describe, expect, it } from 'vitest'
import {
  centsFromPrice,
  decodeHtmlEntities,
  interleaveRetailerHits,
  parseBigCommerceQuickResults,
  parseShopifySuggest,
  type RetailerHit,
} from './retailerSearch'
import shopifyFixture from './__fixtures__/retailerShopifySuggest.json'
import bigcommerceFixture from './__fixtures__/retailerBigCommerceQuick.html?raw'
import skyHighFixture from './__fixtures__/retailerBigCommerceSkyHigh.html?raw'

describe('centsFromPrice', () => {
  it('reads the formats storefronts actually print', () => {
    expect(centsFromPrice('329.99')).toBe(32999)
    expect(centsFromPrice('$1,199.99')).toBe(119999)
    expect(centsFromPrice(59.99)).toBe(5999)
    expect(centsFromPrice('120')).toBe(12000)
  })

  it('treats zero and garbage as no price, not a free product', () => {
    expect(centsFromPrice('0.00')).toBeNull()
    expect(centsFromPrice('')).toBeNull()
    expect(centsFromPrice(null)).toBeNull()
    expect(centsFromPrice('Call for price')).toBeNull()
  })
})

describe('parseShopifySuggest — Moon Car Stereo, real payload', () => {
  const hits = parseShopifySuggest(shopifyFixture, 'https://mooncarstereo.com', 'Moon Car Stereo')

  it('finds the JP234 the owner scans, with its live price', () => {
    expect(hits.length).toBeGreaterThan(0)
    const jp = hits[0]
    expect(jp.name).toBe('Down4Sound JP234 2000W 4-Channel Amplifier')
    expect(jp.brand).toBe('Down4Sound')
    expect(jp.priceCents).toBe(32999)
    expect(jp.retailer).toBe('Moon Car Stereo')
  })

  it('absolutizes the product URL and strips search tracking', () => {
    expect(hits[0].url).toBe(
      'https://mooncarstereo.com/products/down4sound-jp234-4-channel-car-amplifier-2000-watts',
    )
    expect(hits[0].url).not.toContain('_psq')
  })

  it('carries a real CDN image', () => {
    expect(hits[0].imageUrl).toMatch(/^https:\/\/cdn\.shopify\.com\//)
  })

  it('returns nothing for a shape that is not a suggest payload', () => {
    expect(parseShopifySuggest({ anything: true }, 'https://x', 'X')).toEqual([])
    expect(parseShopifySuggest(null, 'https://x', 'X')).toEqual([])
  })
})

describe('parseBigCommerceQuickResults — Down4Sound, real page', () => {
  const hits = parseBigCommerceQuickResults(
    bigcommerceFixture,
    'https://www.down4soundshop.com',
    'Down4Sound',
  )

  it('finds the Big 3 kit the owner waited a web search for', () => {
    // This exact query — "big 3 kit green" — is the one that "took forever"
    // through the AI path and came back with a bare name. The storefront
    // answers it with the full listing.
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits[0].name).toBe('DOWN4SOUND | BIG 3 - 0 GAUGE CCA ( LIME GREEN /BLACK )')
    expect(hits[0].brand).toBe('DOWN4SOUND')
  })

  it('reads the price the card actually shows', () => {
    expect(hits[0].msrpCents).toBe(11999)
    expect(hits[0].priceCents).toBe(5999)
  })

  it('takes the product image from the compare attribute', () => {
    expect(hits[0].imageUrl).toMatch(/^https:\/\/cdn11\.bigcommerce\.com\/.*\.jpg/)
  })

  it('strips the search-tracking query from the product URL', () => {
    expect(hits[0].url).toBe(
      'https://www.down4soundshop.com/down4sound-big-3-0-gauge-cca-lime-green-black/',
    )
  })

  it('mines nothing from the navigation and chrome around the results', () => {
    // The fixture deliberately keeps the page's nav noise: category links,
    // login, cart. None of it sits inside a card-title, so none of it may
    // become a "product".
    for (const hit of hits) {
      expect(hit.name).not.toMatch(/login|cart|about us|clearance/i)
    }
  })
})

describe('parseBigCommerceQuickResults — Sky High, real page, different theme habits', () => {
  const hits = parseBigCommerceQuickResults(
    skyHighFixture,
    'https://www.skyhighcaraudio.com',
    'Sky High Car Audio',
  )

  it('parses a theme with no compare buttons and no brand line', () => {
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].name).toMatch(/Sky High Car Audio/)
  })

  it('falls back to the lazyloaded card image, not the loading spinner', () => {
    // Sky High lazyloads: `src` is a placeholder SVG, the real image lives in
    // `data-src`. Taking `src` would put a spinner icon on every product.
    const withImage = hits.find((h) => h.imageUrl !== null)
    if (withImage) expect(withImage.imageUrl).not.toMatch(/loading\.svg/)
  })

  it('keeps absolute product URLs as they are', () => {
    expect(hits[0].url).toMatch(/^https:\/\/(www\.)?skyhighcaraudio\.com\//)
  })
})

describe('interleaveRetailerHits', () => {
  const hit = (retailer: string, n: number): RetailerHit => ({
    retailer,
    name: `${retailer} product ${n}`,
    brand: null,
    url: `https://${retailer}.example/${n}`,
    imageUrl: null,
    priceCents: null,
    msrpCents: null,
  })

  it('alternates stores so no one store crowds out the rest', () => {
    const merged = interleaveRetailerHits([
      [hit('a', 1), hit('a', 2), hit('a', 3)],
      [hit('b', 1)],
      [hit('c', 1), hit('c', 2)],
    ])
    expect(merged.map((h) => h.retailer)).toEqual(['a', 'b', 'c', 'a', 'c', 'a'])
  })

  it('respects the overall cap', () => {
    const merged = interleaveRetailerHits([[1, 2, 3, 4].map((n) => hit('a', n))], 2)
    expect(merged).toHaveLength(2)
  })

  it('drops a listing two stores both returned by URL', () => {
    const dupe = hit('a', 1)
    const merged = interleaveRetailerHits([[dupe], [{ ...dupe, retailer: 'b' }]])
    expect(merged).toHaveLength(1)
  })
})

describe('decodeHtmlEntities', () => {
  it('handles the entities storefront titles actually contain', () => {
    expect(decodeHtmlEntities('AMP &amp; SUB &quot;COMBO&quot; &#39;22')).toBe('AMP & SUB "COMBO" \'22')
  })
})
