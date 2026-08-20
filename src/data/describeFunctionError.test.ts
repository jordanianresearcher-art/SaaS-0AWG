import { describe, expect, it } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { describeFunctionError } from './supabaseRepository'

// These exist because the first version of the self-test told an owner "No AI
// provider key is set" moments after they had set one, recharged the account,
// and redeployed. The real cause was a version skew — a browser on new code
// calling an Edge Function on old code — and the diagnostic buried it behind a
// guess. Error paths that only ever run when something is already wrong are
// exactly the ones worth pinning.

function httpError(status: number, body: unknown): FunctionsHttpError {
  const response = new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return new FunctionsHttpError(response)
}

describe('describeFunctionError', () => {
  it('names a version skew instead of blaming the key', async () => {
    // The old function validated kind against barcode/text/photo only, so it
    // rejects the self-test outright with this exact message.
    const message = await describeFunctionError(httpError(400, { ok: false, message: 'Missing shopId or kind' }))
    expect(message).toMatch(/older than this app/i)
    expect(message).toMatch(/supabase functions deploy resolve-product/)
    expect(message).not.toMatch(/key/i)
  })

  it('reports a function that was never deployed', async () => {
    const message = await describeFunctionError(httpError(404, { message: 'Not Found' }))
    expect(message).toMatch(/not deployed/i)
    expect(message).toMatch(/supabase functions deploy resolve-product/)
  })

  it('surfaces the message the function actually sent', async () => {
    // supabase-js collapses every non-2xx to "Edge Function returned a non-2xx
    // status code" and discards the body. The body is the whole diagnosis.
    const message = await describeFunctionError(httpError(500, { ok: false, message: 'OPENAI_API_KEY is malformed' }))
    expect(message).toContain('OPENAI_API_KEY is malformed')
    expect(message).toContain('500')
  })

  it('points a rejected session at signing in again', async () => {
    const message = await describeFunctionError(httpError(401, { message: 'You must be signed in to resolve a product.' }))
    expect(message).toMatch(/sign out and back in/i)
  })

  it('still reports the status when the body is not JSON', async () => {
    // A proxy error page or an empty 502 tells us nothing but the status,
    // which is still more than "non-2xx".
    const message = await describeFunctionError(httpError(502, '<html>Bad Gateway</html>'))
    expect(message).toContain('502')
  })

  it('falls back to a plain Error message', async () => {
    expect(await describeFunctionError(new Error('Failed to fetch'))).toBe('Failed to fetch')
  })

  it('never returns an empty string for something it cannot read', async () => {
    expect(await describeFunctionError({ weird: true })).toBeTruthy()
  })
})
