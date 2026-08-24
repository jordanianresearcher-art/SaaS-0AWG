// Choosing a model from whatever an endpoint says it has.
//
// This exists because picking one naively has already failed twice in
// production. First a model id was hardcoded (`gemini-2.5-flash`) and went
// stale. Then discovery replaced it with "the first id containing flash" —
// which, on a list that begins with the older generation, re-derives exactly
// the id that just 404'd. Both bugs looked fine in review and both took a
// deploy cycle to surface, which is what this file and its tests are for.
//
// The rules, in order:
//
//   1. Never return something that cannot answer a chat request at all —
//      embeddings, TTS, image generation.
//   2. Never return an id that has already failed this session.
//   3. Prefer the newest generation. A "2.5" that still appears in a list is
//      usually on the way out; the newest number is the one being served.
//   4. Within a generation, prefer the cheap fast tier. The entire reason for
//      pointing at a compatible endpoint is cost, and identifying a car-audio
//      product does not need a frontier model.

/** Model families that cannot serve a chat completion, whatever else they do. */
const NOT_CHAT = /embed|embedding|tts|whisper|audio|imagen|image-generation|aqa|rerank|moderation/i

/**
 * Cheap-and-fast tiers, best first. A miss here is not disqualifying — it just
 * sorts below anything that matches.
 */
const TIER_ORDER = [/flash-lite/i, /flash/i, /mini/i, /lite/i, /haiku/i, /small/i]

function tierRank(id: string): number {
  for (let i = 0; i < TIER_ORDER.length; i++) {
    if (TIER_ORDER[i].test(id)) return i
  }
  return TIER_ORDER.length
}

/**
 * The version number in a model id, as a comparable number.
 *
 * "gemini-3.7-flash" -> 3.7, "gpt-4.1-mini" -> 4.1, "gemini-2.0-flash" -> 2.0.
 * Ids with no version sort last rather than first: an unversioned name is
 * usually an alias or something experimental, and guessing it is newest is how
 * the previous two bugs happened.
 */
export function modelVersion(id: string): number {
  // First number-dot-number, or a bare integer generation, after a letter run.
  const match = id.match(/(\d+)(?:\.(\d+))?/)
  if (!match) return -1
  const major = Number(match[1])
  const minor = match[2] ? Number(match[2]) : 0
  if (!Number.isFinite(major)) return -1
  // Minor scaled so 3.10 sorts above 3.7 rather than below it.
  return major + minor / 100
}

/** True when this id could plausibly answer a chat completion. */
export function isChatModel(id: string): boolean {
  return Boolean(id) && !NOT_CHAT.test(id)
}

/**
 * Pick the best model to try from an endpoint's own list.
 *
 * `exclude` carries ids already known to fail — chiefly the configured one
 * that just returned 404. Without it, discovery happily hands back the same
 * broken answer and the retry is wasted.
 */
export function pickBestModel(ids: string[], exclude: string[] = []): string | null {
  const excluded = new Set(exclude.filter(Boolean).map((id) => id.toLowerCase()))

  const candidates = ids
    .map((id) => id.trim())
    .filter(Boolean)
    // Gemini prefixes its ids with "models/" in the OpenAI-compatible listing.
    .map((id) => id.replace(/^models\//, ''))
    .filter((id) => isChatModel(id))
    .filter((id) => !excluded.has(id.toLowerCase()))
    // Previews and experiments get deprecated without notice; only reach for
    // one if there is nothing stable at all.
    .map((id) => ({ id, unstable: /preview|exp|experimental|latest/i.test(id) }))

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    if (a.unstable !== b.unstable) return a.unstable ? 1 : -1
    const versionDelta = modelVersion(b.id) - modelVersion(a.id)
    if (versionDelta !== 0) return versionDelta
    const tierDelta = tierRank(a.id) - tierRank(b.id)
    if (tierDelta !== 0) return tierDelta
    // Deterministic tie-break, so the same list always yields the same pick.
    return a.id.localeCompare(b.id)
  })

  return candidates[0].id
}
