import { useEffect, useRef, useState } from 'react'
import { Loader2, Package } from 'lucide-react'
import { useRepo } from '../data/AppDataContext'
import type { ProductSuggestion } from '../data/repository'
import { formatCurrency } from '../lib/format'
import { Input } from './ui'
import { splitItemName } from '../lib/productNaming'

const DEBOUNCE_MS = 600
const MIN_QUERY_LENGTH = 3

/**
 * A text input that debounce-searches AI+web-search product suggestions as
 * staff type a partial SKU/model/name (e.g. "NA-12F") and shows them in a
 * dropdown (image, brand/model, name, price) — pick one to fill the rest of
 * a product form in one tap. Purely a search-and-pick control: the caller
 * owns the actual text value (so it stays wired to whatever form field this
 * is standing in for) and decides what to do with a selected suggestion.
 *
 * Demo mode's repository always resolves lookupProductSuggestions to [] (see
 * DemoRepository), so this quietly never shows a dropdown there rather than
 * needing its own demo-mode branch.
 */
export function ProductSuggestField({
  id,
  value,
  onChange,
  onSelect,
  placeholder,
  autoFocus,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  onSelect: (suggestion: ProductSuggestion) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const repo = useRepo()
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([])
  // Why the list is empty, when it is empty for a reason other than "no
  // match" — an unfunded key or a provider that refused the call. Shown in
  // the dropdown rather than as a toast: this fires on a debounced keystroke,
  // and a toast per keystroke would be unusable.
  const [lookupNote, setLookupNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // True once a search has actually come back for the current query — lets
  // the dropdown distinguish "haven't searched yet" (show nothing) from
  // "searched and found nothing" (show a message), which loading/suggestions
  // alone can't tell apart once suggestions is back down to [].
  const [searched, setSearched] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const query = value.trim()
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([])
      setLookupNote(null)
      setLoading(false)
      setSearched(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      void repo
        .lookupProductSuggestions(query)
        .then((result) => {
          if (cancelled) return
          setSuggestions(result.suggestions)
          setLookupNote(
            !result.aiConfigured
              ? "Product lookup isn't set up yet — an admin needs to add an AI key in Supabase."
              : result.aiError
                ? `Product lookup failed — ${result.aiError}.`
                : null,
          )
          setSearched(true)
          setOpen(true)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [value, repo])

  // Close the dropdown on an outside click — a plain blur fires before the
  // suggestion button's own click, which would dismiss the list before the
  // tap registers.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const handleSelect = (suggestion: ProductSuggestion) => {
    onSelect(suggestion)
    setOpen(false)
    setSuggestions([])
    setSearched(false)
  }

  const showDropdown = open && value.trim().length >= MIN_QUERY_LENGTH && (loading || searched)

  return (
    // Not position:relative/absolute for the dropdown -- it renders in normal
    // flow so it pushes whatever's below it down instead of overlaying (and
    // silently swallowing clicks on) sibling fields, which matters wherever
    // this sits directly above another input (e.g. a price field right below
    // the name field in the scan workspace's one-off-item row).
    <div ref={containerRef}>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true)
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          className={loading ? 'pr-10' : undefined}
        />
        {loading ? (
          <Loader2 className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" aria-hidden="true" />
        ) : null}
      </div>
      {showDropdown ? (
        <div className="mt-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
          {suggestions.length === 0 ? (
            <p className={`px-3 py-2.5 text-sm ${!loading && lookupNote ? 'text-amber-800' : 'text-zinc-500'}`}>
              {loading ? 'Searching the web…' : (lookupNote ?? 'No matches found.')}
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto">
              {suggestions.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => handleSelect(s)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                      {s.imageUrl ? (
                        <img src={s.imageUrl} alt="" className="h-full w-full rounded-lg object-contain" />
                      ) : (
                        <Package className="h-5 w-5 text-brand" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {splitItemName(s).title}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">{splitItemName(s).descriptor ?? '—'}</span>
                    </span>
                    {s.unitPriceCents !== null ? (
                      <span className="shrink-0 text-xs font-medium text-zinc-600">{formatCurrency(s.unitPriceCents)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
