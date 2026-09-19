import type { PublicReviewRequest } from '../types'
import { DemoRepository } from './demoRepository'
import { getSupabase } from './supabaseClient'
import { env, supabaseConfigured } from '../lib/env'

// The review landing page runs anonymously in both modes, same shape as
// src/data/publicQuote.ts. Demo tokens resolve against the local demo
// database; anything else goes to the Supabase RPCs.

export interface ReviewApi {
  get(): Promise<PublicReviewRequest | null>
  /** Returns where to send them. Decided server-side — the browser is the customer's. */
  rate(rating: number): Promise<{ redirectTo: string | null; showFeedback: boolean; redirectBlocked: boolean }>
  submitFeedback(body: string): Promise<void>
}

const DEMO_DB_KEY = '0gauge-demo-db'

function demoAvailableFor(token: string): boolean {
  if (!env.demoModeEnabled) return false
  return token.startsWith('demo-review-token-') || localStorage.getItem(DEMO_DB_KEY) !== null
}

export async function resolveReviewApi(token: string): Promise<ReviewApi | null> {
  if (demoAvailableFor(token)) {
    const demo = new DemoRepository()
    const found = await demo.getPublicReviewRequest(token)
    if (found) {
      return {
        // Re-read rather than returning `found`: getPublicReviewRequest also
        // records the open, and the page asks for it once.
        get: async () => found,
        rate: (rating) => demo.submitReviewRating(token, rating),
        submitFeedback: (body) => demo.submitReviewFeedback(token, body),
      }
    }
  }
  if (supabaseConfigured) {
    const supabase = getSupabase()
    return {
      get: async () => {
        const { data, error } = await supabase.rpc('get_public_review_request', { p_code: token })
        if (error) throw error
        return (data as PublicReviewRequest | null) ?? null
      },
      rate: async (rating) => {
        const { data, error } = await supabase.rpc('submit_review_rating', {
          p_code: token,
          p_rating: rating,
        })
        if (error) throw error
        const row = (data ?? {}) as Record<string, unknown>
        return {
          redirectTo: typeof row.redirectTo === 'string' ? row.redirectTo : null,
          showFeedback: row.showFeedback !== false,
          redirectBlocked: row.redirectBlocked === true,
        }
      },
      submitFeedback: async (body) => {
        const { error } = await supabase.rpc('submit_review_feedback', { p_code: token, p_feedback: body })
        if (error) throw error
      },
    }
  }
  return null
}
