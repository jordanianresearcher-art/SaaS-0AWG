// Reject model output that has come apart, before it becomes a product.
//
// A shop typed "jp234 purple" and rapid intake saved:
//
//   brand JBL
//   model A100-P-P-P-P-P-P-P-P-P-cd-cd-cd-corp...
//   name  JBL-A100-P-P-P-P-P-P-P-monolith-monol...
//
// That is a language model in a repetition loop — a failure mode of the
// generation itself, not of the prompt or the search. It has nothing to do
// with whether the product exists.
//
// It matters because every other guard in the resolver is about *truth*
// (did a source confirm this barcode, was the web actually searched) and
// none of them fire here: the JSON parsed, the schema validated, the fields
// are all strings. The candidate is well-formed and meaningless, so it sails
// through and lands in a shop's catalog under a name nobody can search for
// later.
//
// Deliberately narrow. This detects text that has structurally collapsed —
// the same fragment over and over — and nothing else. It is not a
// plausibility check and must never become one: real car-audio SKUs look
// like line noise ("EZY-RCA110-GX", "FR-M800.4D", "T400X4ad"), and a filter
// with opinions about what a model number should look like would throw away
// exactly the obscure products this app exists to identify.

/** Longest run of one immediately-repeated token, e.g. "P-P-P-P" → 4. */
function longestTokenRun(tokens: string[]): number {
  let best = 1
  let run = 1
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] && tokens[i] === tokens[i - 1]) {
      run += 1
      if (run > best) best = run
    } else {
      run = 1
    }
  }
  return best
}

/**
 * True when a string looks like generation that has degenerated rather than
 * a real (if ugly) product name.
 *
 * Three independent signals, each seen in the wild:
 *
 *   1. A short token repeated four or more times in a row — "P-P-P-P-P",
 *      "cd-cd-cd-cd". Four is the threshold because three is reachable
 *      legitimately ("2-2-2 ohm") and four essentially is not.
 *   2. The same character repeated eight or more times — "AAAAAAAA".
 *   3. Absurd length. No real model number or product name runs past 120
 *      characters; a loop reaches it easily.
 */
export function looksDegenerate(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false
  const text = raw.trim()
  if (!text) return false

  if (text.length > 120) return true
  if (/(.)\1{7,}/.test(text)) return true

  // Split on the separators a loop tends to emit between its repeats.
  const tokens = text
    .toLowerCase()
    .split(/[\s\-_./|,]+/)
    .filter(Boolean)
  if (tokens.length < 4) return false

  const shortTokens = tokens.map((t) => (t.length <= 4 ? t : `«${t}»`))
  return longestTokenRun(shortTokens) >= 4
}

/**
 * True when any field a person will read has collapsed.
 *
 * Checked across name, model and brand together rather than per field: the
 * loop usually corrupts one of them first, and a candidate whose model is
 * garbage is not rescued by having a clean brand.
 */
export function candidateLooksDegenerate(candidate: {
  name?: string | null
  model?: string | null
  brand?: string | null
}): boolean {
  return (
    looksDegenerate(candidate.name) ||
    looksDegenerate(candidate.model) ||
    looksDegenerate(candidate.brand)
  )
}
