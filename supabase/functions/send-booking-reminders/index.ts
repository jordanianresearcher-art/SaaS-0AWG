// Supabase Edge Function: send-booking-reminders
//
// The no-show killer. Sends a reminder for every appointment starting in
// roughly 24 hours that hasn't been reminded yet.
//
// A no-show costs a shop the whole bay slot — for a tint job that's a few
// hundred dollars of capacity that cannot be resold that day. This is the
// highest-value-per-line-of-code feature in the booking system.
//
// Like send-quote-followups, this decides *who* and delegates the actual
// rendering/sending to send-booking-email (kind: 'reminder'), so there is one
// copy of the email and it cannot drift from the confirmation.
//
// Deploy:
//   supabase functions deploy send-booking-reminders --no-verify-jwt
//   supabase secrets set CRON_SECRET=<same secret as send-quote-followups>
//
// Schedule it hourly (run once in the SQL editor):
//   select cron.schedule(
//     'send-booking-reminders',
//     '0 * * * *',
//     $$ select net.http_post(
//          url := 'https://<project-ref>.supabase.co/functions/v1/send-booking-reminders',
//          headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret','<CRON_SECRET>')
//        ) $$
//   );
//
// Hourly (unlike the daily follow-up sender) because "24 hours before" needs
// hour resolution. The window below is intentionally wider than one hour so a
// single missed run still catches its appointments on the next pass;
// reminder_sent_at is what actually prevents a duplicate, not the window.

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { ok: false, message: 'Method not allowed' })

  const cronSecret = Deno.env.get('CRON_SECRET')
  // Fail closed — without a secret this would be an open "email my customers" endpoint.
  if (!cronSecret) return json(503, { ok: false, message: 'CRON_SECRET is not configured.' })
  if (req.headers.get('X-Cron-Secret') !== cronSecret) return json(401, { ok: false, message: 'Unauthorized' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // 23–26h out: wide enough that one skipped hourly run doesn't lose a
  // reminder, and reminder_sent_at guarantees at most one per appointment.
  const now = Date.now()
  const windowStart = new Date(now + 23 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(now + 26 * 60 * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from('appointments')
    .select('id, public_token, status')
    .is('reminder_sent_at', null)
    .in('status', ['confirmed', 'awaiting_deposit'])
    .gte('starts_at', windowStart)
    .lt('starts_at', windowEnd)
    .limit(200)

  if (error) {
    console.error('load due reminders failed', error)
    return json(500, { ok: false, message: 'Could not load appointments.' })
  }

  const rows = (data ?? []) as Array<{ id: string; public_token: string; status: string }>
  let sent = 0
  let failed = 0

  for (const row of rows) {
    try {
      // Sequential: Resend rate-limits, and a burst is the fastest way to get
      // a shop's sending domain throttled.
      const res = await fetch(`${supabaseUrl}/functions/v1/send-booking-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': cronSecret },
        body: JSON.stringify({ publicToken: row.public_token, kind: 'reminder' }),
      })
      if (!res.ok) {
        failed += 1
        console.error('reminder rejected', row.id, res.status)
        continue
      }
      // Mark only after a successful call. send-booking-email is
      // fire-and-forget by design (it returns 200 with sent:false when email
      // isn't configured), so this can mark a reminder that wasn't truly
      // delivered — an acceptable trade to guarantee we never send two.
      const { error: markError } = await admin
        .from('appointments')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', row.id)
      if (markError) {
        console.error('could not mark reminder_sent_at', row.id, markError)
      }
      sent += 1
    } catch (err) {
      failed += 1
      console.error('reminder threw', row.id, err)
    }
  }

  return json(200, { ok: true, considered: rows.length, sent, failed })
})
