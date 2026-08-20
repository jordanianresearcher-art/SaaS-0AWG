// Getting JSON back out of a model that wasn't constrained to produce it.
//
// The resolver's preferred path pins the model to a strict JSON schema, and
// when that works the response is already clean. But that path depends on
// three exact things being right at once — the model name, the web-search tool
// identifier, and the structured-output request shape — and if any one of them
// is wrong for a given account, the whole call 400s and the shop gets nothing.
//
// So there is a last rung that asks a plain chat model for JSON in the prompt
// and takes whatever comes back. That reply is *usually* clean and
// occasionally wrapped in a ```json fence, prefaced with "Here are the
// products I found:", or followed by a helpful paragraph. All of those are
// recoverable, and recovering them is the difference between a working lookup
// and a broken one.
//
// Deliberately conservative: it extracts and parses, and returns null rather
// than guessing when it can't. A wrong parse would invent a product, which is
// far worse for a shop than no result.

/**
 * Pull the first complete JSON object or array out of a model's reply.
 *
 * Scans for a balanced `{...}` or `[...]`, tracking string literals and
 * escapes so a brace *inside* a product name ("JL Audio 12W6v3 {open box}")
 * can't end the object early — the naive "first `{` to last `}`" approach
 * breaks on exactly the kind of text this has to survive.
 *
 * Returns the raw JSON substring, or null when there is no balanced value.
 */
export function extractJsonBlock(raw: string): string | null {
  if (!raw) return null

  // A fenced block, when present, is the most reliable signal of intent —
  // prefer its contents over anything outside it.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const haystack = fence ? fence[1] : raw

  for (let start = 0; start < haystack.length; start++) {
    const opener = haystack[start]
    if (opener !== '{' && opener !== '[') continue
    const closer = opener === '{' ? '}' : ']'

    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < haystack.length; i++) {
      const ch = haystack[i]

      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        // Only meaningful inside a string, but harmless outside: a backslash
        // can't legally appear in JSON structure anyway.
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue

      if (ch === opener) depth++
      else if (ch === closer) {
        depth--
        if (depth === 0) return haystack.slice(start, i + 1)
      }
    }
    // Unbalanced from this opener (a truncated reply, most likely). Trying a
    // later opener would only find a fragment, so give up on this haystack.
    break
  }

  return null
}

/**
 * Parse a model's reply into an object, tolerating fences and surrounding
 * prose. Returns null on anything it cannot parse cleanly — never a partial
 * or repaired result.
 */
export function parseLooseJson<T = unknown>(raw: string | null | undefined): T | null {
  if (typeof raw !== 'string') return null

  // The overwhelmingly common case: the whole reply is already valid JSON.
  const trimmed = raw.trim()
  if (trimmed) {
    try {
      return JSON.parse(trimmed) as T
    } catch {
      // Fall through to extraction.
    }
  }

  const block = extractJsonBlock(raw)
  if (!block) return null
  try {
    return JSON.parse(block) as T
  } catch {
    return null
  }
}
