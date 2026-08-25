// @vitest-environment node
//
// Node, not jsdom: this test transpiles extracted TypeScript with esbuild,
// which refuses to run against jsdom's TextEncoder. There is no DOM here to
// need anyway.
// Guards the one structural hazard in this codebase: Deno cannot import from
// src/, so several pure helpers exist twice — once here, tested, and once
// copy-pasted into an Edge Function, untested. barcodeIdentity, aiJson,
// modelPreference, productNaming, emailTemplates, quoteFlavor and
// autoFollowUp all have a mirrored copy that has to be updated in lockstep.
//
// Nothing enforced that. A copy could drift for weeks and the only symptom
// would be the app and the server disagreeing about a barcode — which reads
// as "the AI is being flaky", not as a bug with a location.
//
// This extracts the mirrored functions out of the Edge Function source at
// test time and runs both copies over the same inputs. It compares BEHAVIOUR,
// not text: the copies legitimately differ in comments and in whether a
// helper is inlined, and a text diff would cry wolf on every one of those
// until someone started ignoring it.

import { describe, expect, it } from 'vitest'
import { transformSync } from 'esbuild'
// Vite's ?raw import rather than node:fs — it keeps this file inside the
// app's tsconfig (which has no node types) and makes the dependency on the
// Edge Function source explicit to the bundler.
import functionSource from '../../supabase/functions/resolve-product/index.ts?raw'
import { barcodeLookupForms, gs1CheckDigit } from './barcodeIdentity'
import { parseLooseJson } from './aiJson'
import { pickBestModel } from './modelPreference'
import fixture from './__fixtures__/shopProducts.json'
import { centsFromPrice, parseBigCommerceQuickResults, parseShopifySuggest } from './retailerSearch'
import { looksDegenerate } from './degenerateText'
import shopifyFixture from './__fixtures__/retailerShopifySuggest.json'
import bigcommerceFixture from './__fixtures__/retailerBigCommerceQuick.html?raw'
import skyHighFixture from './__fixtures__/retailerBigCommerceSkyHigh.html?raw'

/**
 * Loads one MIRROR-BEGIN/MIRROR-END region out of the Edge Function source
 * and evaluates it, so the deployed copy can be called directly from a test.
 *
 * Regions rather than individual functions, because the mirrored code has
 * internal helpers and module constants (isStoreAssignedBarcode, TIER_ORDER)
 * that a per-function extractor would have to resolve by hand. Explicit
 * markers rather than parsing, because the first attempt here counted braces
 * and ran 57,000 characters past the end of extractJsonBlock — whose body is
 * full of `'{'` and `'}'` string literals, since parsing braces is its whole
 * job. Anything robust enough for that is a TypeScript parser, which is far
 * too much machinery to check three small functions.
 *
 * The markers also put the duplication rule in the one place someone editing
 * this code will actually be looking.
 */
function loadMirror(tag: string, exports: string[]): Record<string, (...args: never[]) => unknown> {
  const src = functionSource
  // The trailing space matters: indexOf('MIRROR-BEGIN aiJson') also matches
  // 'MIRROR-BEGIN aiJsonSomethingElse', so a renamed marker would silently
  // keep resolving to the old region and this test would pass on nothing.
  const begin = src.indexOf(`// MIRROR-BEGIN ${tag} `)
  const end = src.indexOf(`// MIRROR-END ${tag}\n`)
  if (begin === -1 || end === -1) {
    throw new Error(
      `The ${tag} mirror markers are missing from the Edge Function. If the mirror was removed ` +
        'because the code is now shared some other way, delete this test with it.',
    )
  }
  const region = src.slice(src.indexOf('\n', begin) + 1, end)
  // esbuild rather than a regex type-stripper: a hand-rolled one breaks on the
  // next generic someone adds and gets misread as mirror drift.
  const js = transformSync(region, { loader: 'ts' }).code
  const factory = new Function(`${js}\nreturn { ${exports.join(', ')} }`)
  return factory() as Record<string, (...args: never[]) => unknown>
}

describe('barcodeIdentity mirror', () => {
  const mirror = loadMirror('barcodeIdentity', ['gs1CheckDigit', 'barcodeLookupForms'])
  const fnForms = mirror.barcodeLookupForms as (raw: string) => string[]
  const fnCheck = mirror.gs1CheckDigit as (payload: string) => number

  // The pilot shop's real barcodes, plus the cases that actually broke:
  // a store-assigned code, a short internal code, a Brazilian EAN-13, a
  // zero-padded UPC, a deliberately corrupted check digit, and whitespace.
  const codes = [
    ...(fixture as { barcode: string }[]).map((r) => r.barcode),
    '200001188725',
    '26040308',
    '7908706600230',
    '0677478807501',
    '677478807502',
    '  677478-807501 ',
    '',
    'EZY-RCA110-GX',
    '12345678',
    '4012345678901',
    '02123456789',
  ]

  it('agrees with the app on every barcode, real and adversarial', () => {
    const disagreements = codes.filter(
      (code) => JSON.stringify(barcodeLookupForms(code)) !== JSON.stringify(fnForms(code)),
    )
    expect(disagreements).toEqual([])
  })

  it('agrees on the check digit itself', () => {
    const payloads = codes.filter((c) => /^\d{7,13}$/.test(c)).map((c) => c.slice(0, -1))
    const disagreements = payloads.filter((p) => gs1CheckDigit(p) !== fnCheck(p))
    expect(disagreements).toEqual([])
  })
})

describe('aiJson mirror', () => {
  const mirror = loadMirror('aiJson', ['parseLooseJson'])
  const fnParse = mirror.parseLooseJson as (raw: string | null | undefined) => unknown

  // Every shape a model has actually replied with on rung 3.
  const replies = [
    '{"candidates":[{"name":"JP-284"}]}',
    '```json\n{"candidates":[]}\n```',
    'Here is what I found:\n\n{"candidates":[{"name":"TS 400X4"}]}\n\nHope that helps!',
    '```\n[{"name":"KISLOC2"}]\n```',
    '{"candidates":[{"name":"a \\"quoted\\" product"}]}',
    '{"candidates":[{"name":"unterminated',
    'I could not find that product.',
    '',
    // A decoy object before the fenced answer. This one is load-bearing: it
    // is the only input here that can tell "prefer the fenced block" apart
    // from "scan the whole reply", and without it a mirror that dropped
    // fence handling entirely still passed this suite.
    'I considered {"wrong":1} first. Final answer:\n```json\n{"candidates":[{"name":"right"}]}\n```',
  ]

  it('recovers exactly the same value from every reply shape', () => {
    for (const reply of replies) {
      expect(JSON.stringify(fnParse(reply) ?? null), reply.slice(0, 40)).toBe(
        JSON.stringify(parseLooseJson(reply) ?? null),
      )
    }
  })
})

describe('modelPreference mirror', () => {
  const mirror = loadMirror('modelPreference', ['pickBestModel'])
  const fnPick = mirror.pickBestModel as (ids: string[], exclude?: string[]) => string | null

  const listings = [
    ['models/gemini-2.5-flash', 'models/gemini-3-flash', 'models/gemini-3-pro'],
    ['gpt-5.6', 'gpt-5.6-mini', 'gpt-4o'],
    ['models/gemini-3.10-flash', 'models/gemini-3.7-flash'],
    ['models/embedding-001', 'models/imagen-3'],
    [],
    // A pure tie on generation and tier, so the only thing separating these
    // is the deterministic id tie-break. Also load-bearing: every other
    // listing here is decided before the tie-break is ever reached, so
    // reversing it went undetected until this case existed.
    ['zeta-flash', 'alpha-flash'],
    ['models/gemini-3-flash', 'models/gemini-3-flash-002'],
  ]

  it('picks the same model from the same listing', () => {
    for (const ids of listings) {
      expect(fnPick(ids), ids.join(',')).toBe(pickBestModel(ids))
    }
  })

  it('agrees when a model has already failed and must be skipped', () => {
    const ids = ['models/gemini-2.5-flash', 'models/gemini-3-flash']
    expect(fnPick(ids, ['gemini-3-flash'])).toBe(pickBestModel(ids, ['gemini-3-flash']))
  })
})

describe('retailerSearch mirror', () => {
  const mirror = loadMirror('retailerSearch', [
    'centsFromPrice',
    'parseShopifySuggest',
    'parseBigCommerceQuickResults',
    'interleaveRetailerHits',
  ])
  const fnShopify = mirror.parseShopifySuggest as (
    payload: unknown,
    origin: string,
    retailer: string,
  ) => unknown[]
  const fnBigCommerce = mirror.parseBigCommerceQuickResults as (
    html: string,
    origin: string,
    retailer: string,
  ) => unknown[]
  const fnCents = mirror.centsFromPrice as (v: string | number | null) => number | null

  it('parses the captured Shopify payload identically', () => {
    expect(fnShopify(shopifyFixture, 'https://mooncarstereo.com', 'Moon Car Stereo')).toEqual(
      parseShopifySuggest(shopifyFixture, 'https://mooncarstereo.com', 'Moon Car Stereo'),
    )
  })

  it('parses both captured BigCommerce pages identically', () => {
    // Two different stores, two different theme habits (compare buttons vs
    // lazyloaded images) — both must agree, or one store's products silently
    // vanish from server results while every client test stays green.
    for (const [html, origin] of [
      [bigcommerceFixture, 'https://www.down4soundshop.com'],
      [skyHighFixture, 'https://www.skyhighcaraudio.com'],
    ] as const) {
      expect(fnBigCommerce(html, origin, 'x')).toEqual(parseBigCommerceQuickResults(html, origin, 'x'))
    }
  })

  it('agrees on price parsing at the awkward edges', () => {
    for (const v of ['329.99', '$1,199.99', '0.00', '', 'Call for price', '120'] as const) {
      expect(fnCents(v), v).toBe(centsFromPrice(v))
    }
  })
})

describe('degenerateText mirror', () => {
  const mirror = loadMirror('degenerateText', ['looksDegenerate', 'candidateLooksDegenerate'])
  const fnLooks = mirror.looksDegenerate as (raw: string | null) => boolean

  it('agrees on the collapsed output and on every real product', () => {
    const cases = [
      'A100-P-P-P-P-P-P-P-P-P-cd-cd-cd-corp',
      'JBL-A100-P-P-P-P-P-P-P-monolith-monolith',
      'KickerAAAAAAAAAA',
      '2-2-2 ohm wiring kit',
      'EZY-RCA110-GX',
      'FR-M800.4D',
      'XD600/6v2',
      'DOWN4SOUND | BIG 3 - 0 GAUGE CCA ( LIME GREEN /BLACK )',
      '',
      ...(fixture as { model: string }[]).slice(0, 40).map((r) => r.model),
    ]
    const disagreements = cases.filter((c) => fnLooks(c) !== looksDegenerate(c))
    expect(disagreements).toEqual([])
  })
})
