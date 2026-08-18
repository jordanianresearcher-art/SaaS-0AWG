// Supabase Edge Function: send-quote-followups
//
// The scheduled sender behind automatic quote follow-ups. Retires the app's
// original "a human presses Send for every email" stance — see migration 0023
// for why.
//
// It deliberately does NOT render or send email itself. It decides *which*
// quotes are due and then calls send-quote-email for each one, authenticating
// with CRON_SECRET instead of a user JWT. That keeps one copy of the
// rendering, the eligibility guards, the email_messages logging, and the
// next-follow-up scheduling — the automated path cannot drift from the manual
// one because it *is* the manual one.
//
// Deploy:
//   supabase functions deploy send-quote-followups --no-verify-jwt
//   supabase secrets set CRON_SECRET=<a long random string>
//
// --no-verify-jwt is required because pg_cron calls this with a shared secret,
// not a Supabase user token. The function is useless without the secret, and
// it refuses to run at all if CRON_SECRET is unset (see below) — so an
// unconfigured deploy fails closed rather than emailing customers.
//
// Schedule it (run once in the SQL editor, replacing the placeholders):
//   select cron.schedule(
//     'send-quote-followups',
//     '0 15 * * *',                       -- 15:00 UTC daily; pick a mid-morning local hour
//     $$ select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/send-quote-followups',
//          headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret','<CRON_SECRET>')
//        ) $$
//   );
//
// Sending once a day (not hourly) is deliberate: follow-up dates have day
// granularity, and a daily run means a customer can never receive two
// follow-ups within a few hours of each other if a date is edited.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type TemplateType = 'initial' | 'check_in' | 'financing_option' | 'payday_reminder' | 'final_check_in'

/**
 * Mirror of AUTO_SEQUENCE / AUTO_SENDABLE_STATUSES in src/lib/autoFollowUp.ts
 * (Deno cannot import from src/). Update both together — that copy drives what
 * the follow-ups queue predicts, this one drives what customers receive.
 */
const AUTO_SEQUENCE: TemplateType[] = ['check_in', 'financing_option', 'final_check_in']
const AUTO_SENDABLE_STATUSES = ['emailed', 'viewed']

interface DueRow {
  quote_id: string
  shop_id: string
  status: string
  next_follow_up_at: string | null
  email_follow_up_allowed: boolean
  expiration_date: string | null
  customer_email: string | null
  customer_email_permission_confirmed: boolean
  customer_opted_out_at: string | null
  has_customer_response: boolean
  sent_templates: string[]
}

/** Returns the template to send, or null with the reason it was skipped. */
function decide(row: DueRow, now: Date): { template: TemplateType } | { skip: string } {
  if (!row.email_follow_up_allowed) return { skip: 'quote_disabled' }
  if (row.customer_opted_out_at) return { skip: 'opted_out' }
  if (!row.customer_email) return { skip: 'no_email' }
  if (!row.customer_email_permission_confirmed) return { skip: 'no_permission' }
  if (!AUTO_SENDABLE_STATUSES.includes(row.status)) return { skip: 'terminal_status' }
  // A customer who answered gets a human, not a robot.
  if (row.has_customer_response) return { skip: 'customer_responded' }

  if (row.expiration_date) {
    const expiry = new Date(`${row.expiration_date}T23:59:59Z`)
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < now.getTime()) return { skip: 'expired' }
  }

  // Automation only continues a conversation a human started.
  if (!row.sent_templates || row.sent_templates.length === 0) return { skip: 'never_sent' }

  if (!row.next_follow_up_at) return { skip: 'not_due' }
  const due = new Date(row.next_follow_up_at)
  if (Number.isNaN(due.getTime()) || due.getTime() > now.getTime()) return { skip: 'not_due' }

  const sent = new Set(row.sent_templates)
  const next = AUTO_SEQUENCE.find((t) => !sent.has(t))
  if (!next) return { skip: 'sequence_complete' }
  return { template: next }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json(405, { ok: false, message: 'Method not allowed' })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  // Fail closed: without a configured secret this endpoint would be an open
  // "email all my customers" button.
  if (!cronSecret) {
    return json(503, { ok: false, message: 'CRON_SECRET is not configured.' })
  }
  if (req.headers.get('X-Cron-Secret') !== cronSecret) {
    return json(401, { ok: false, message: 'Unauthorized' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data, error } = await admin.rpc('list_due_follow_ups', { p_limit: 100 })
  if (error) {
    console.error('list_due_follow_ups failed', error)
    return json(500, { ok: false, message: 'Could not load due follow-ups.' })
  }

  const rows = (data ?? []) as DueRow[]
  const now = new Date()
  const skipped: Record<string, number> = {}
  let sent = 0
  let failed = 0

  for (const row of rows) {
    const verdict = decide(row, now)
    if ('skip' in verdict) {
      skipped[verdict.skip] = (skipped[verdict.skip] ?? 0) + 1
      continue
    }

    try {
      // Sequential, not Promise.all: Resend rate-limits, and a burst of
      // parallel sends is the fastest way to get a shop's domain throttled.
      const res = await fetch(`${supabaseUrl}/functions/v1/send-quote-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': cronSecret,
        },
        body: JSON.stringify({ quoteId: row.quote_id, templateType: verdict.template }),
      })
      if (res.ok) {
        sent += 1
      } else {
        failed += 1
        console.error('auto follow-up rejected', row.quote_id, verdict.template, res.status, await res.text())
      }
    } catch (err) {
      failed += 1
      console.error('auto follow-up threw', row.quote_id, err)
    }
  }

  // send-quote-email advances next_follow_up_at itself, so a quote that sent
  // successfully will not be picked up again tomorrow. A quote that failed
  // keeps its due date and is retried on the next run — which is the behavior
  // we want for a transient provider outage.
  return json(200, { ok: true, considered: rows.length, sent, failed, skipped })
})
