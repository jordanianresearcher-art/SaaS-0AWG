// Pure logic behind the universal product resolver: normalization, ranking,
// and conservative deduplication of candidates returned by the
// `resolve-product` Edge Function. Framework-agnostic and network-free by
// design so it's fully unit-testable — the actual network call lives in
// DataRepository.resolveProduct() (src/data/repository.ts /
// supabaseRepository.ts). The same normalize* functions are mirrored
// (duplicated, not imported — different runtime) in
// supabase/functions/resolve-product/index.ts.

/**
 * The subset of ProductResolutionCandidate this module actually needs.
 * Deliberately a local, minimal, structural type rather than importing the
 * full repository DTO — keeps this module a standalone, dependency-free
 * algorithm any candidate-shaped object can be run through.
 */
export interface RankableCandidate {
  id: string
  brand: string | null
  model: string | null
  name: string
  upc: string | null
  confidence: number
  evidence: string[]
}

/**
 * Barcodes are strings, never numbers — leading zeros are significant and
 * must never be dropped. Only whitespace and scanner-added separators
 * (some Bluetooth scanners insert a dash) are stripped.
 */
export function normalizeBarcode(raw: string): string {
  return raw.trim().replace(/[\s-]/g, '')
}

/** Lowercase, trimmed, whitespace-collapsed — a stable cache/comparison key for free text. */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Splits a normalized string into comparison tokens (alphanumeric runs). */
function tokenize(value: string): string[] {
  return normalizeQuery(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

/**
 * How many of `query`'s tokens appear verbatim among a candidate's own
 * brand/model/name tokens — the exact-match signal that should outrank a
 * looser semantic AI match. Not a fuzzy/partial-substring score on purpose:
 * a real model number ("na-12f") matching exactly is a much stronger
 * signal than a generic word overlapping.
 */
function exactTokenOverlap(candidate: RankableCandidate, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0
  const candidateTokens = new Set([
    ...tokenize(candidate.brand ?? ''),
    ...tokenize(candidate.model ?? ''),
    ...tokenize(candidate.name),
  ])
  return queryTokens.filter((t) => candidateTokens.has(t)).length
}

/**
 * Ranks candidates for display: exact model/brand token matches against the
 * original query first (most-specific evidence a human would trust), then
 * by the resolver's own confidence score, descending. `query` may be a
 * barcode or free text — either way it's just tokenized the same way, so a
 * barcode query naturally contributes no token-overlap signal (no
 * candidate's brand/model/name literally contains the digits) and ranking
 * falls back to confidence, which is exactly what's wanted there.
 */
export function rankCandidates<T extends RankableCandidate>(candidates: T[], query: string): T[] {
  const queryTokens = tokenize(query)
  return [...candidates].sort((a, b) => {
    const overlapDiff = exactTokenOverlap(b, queryTokens) - exactTokenOverlap(a, queryTokens)
    if (overlapDiff !== 0) return overlapDiff
    return b.confidence - a.confidence
  })
}

/**
 * Conservative merge: only collapses candidates that share an exact UPC, or
 * share an exact normalized brand *and* exact normalized model (both
 * present and non-empty). Never merges on name similarity alone — two
 * candidates that merely sound alike are kept separate rather than risking
 * silently hiding a real distinction between two products. The
 * higher-confidence candidate of a merged pair wins; its evidence gains any
 * unique evidence lines from the one it absorbed.
 */
export function dedupeCandidates<T extends RankableCandidate>(candidates: T[]): T[] {
  const kept: T[] = []

  for (const candidate of candidates) {
    const matchIndex = kept.findIndex((existing) => sameProduct(existing, candidate))
    if (matchIndex === -1) {
      kept.push(candidate)
      continue
    }
    const existing = kept[matchIndex]
    const winner = candidate.confidence > existing.confidence ? candidate : existing
    const loser = winner === candidate ? existing : candidate
    const mergedEvidence = [...winner.evidence, ...loser.evidence.filter((e) => !winner.evidence.includes(e))]
    kept[matchIndex] = { ...winner, evidence: mergedEvidence }
  }

  return kept
}

function sameProduct(a: RankableCandidate, b: RankableCandidate): boolean {
  if (a.upc && b.upc && a.upc === b.upc) return true
  const brandA = normalizeQuery(a.brand ?? '')
  const brandB = normalizeQuery(b.brand ?? '')
  const modelA = normalizeQuery(a.model ?? '')
  const modelB = normalizeQuery(b.model ?? '')
  if (!brandA || !modelA || !brandB || !modelB) return false
  return brandA === brandB && modelA === modelB
}
