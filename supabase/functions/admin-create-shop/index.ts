// Supabase Edge Function: admin-create-shop
// Platform-admin-only: creates a new shop tenant and gets its owner into the
// system. Tries to email the owner a sign-in link via Resend; if that fails,
// returns the raw link so the caller can copy/send it manually. Never uses
// Supabase's own mailer — generateLink only creates the link, it doesn't send.
//
// Deploy:  supabase functions deploy admin-create-shop
// Secrets: same as send-quote-email (RESEND_API_KEY, EMAIL_FROM, APP_URL) —
//          no new secrets required.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function fail(status: number, message: string): Response {
  return json(status, { ok: false, message })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const suffix = crypto.randomUUID().slice(0, 6)
  return `${base || 'shop'}-${suffix}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail(405, 'Method not allowed')
  }

  let body: { shopName?: string; ownerEmail?: string }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'Invalid request')
  }
  const shopName = body.shopName?.trim()
  const ownerEmail = body.ownerEmail?.trim().toLowerCase()
  if (!shopName || shopName.length < 2) {
    return fail(400, 'Enter a shop name.')
  }
  if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return fail(400, 'Enter a valid owner email.')
  }

  // User-JWT client — used only to identify the caller.
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) {
    return fail(401, 'You must be signed in to do this.')
  }

  // Service-role client for everything else. The platform-admin check must
  // query the table directly — is_platform_admin() reads auth.uid(), which
  // is null under a service-role session with no JWT, so calling the RPC
  // through this client would always return false.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: adminRow } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!adminRow) {
    return fail(403, 'You are not a platform admin.')
  }

  const slug = slugify(shopName)
  const { data: shop, error: shopError } = await admin
    .from('shops')
    .insert({ name: shopName, slug, email: ownerEmail, reply_to_email: ownerEmail })
    .select('id')
    .single()
  if (shopError || !shop) {
    return fail(500, 'Could not create the shop. Please try again.')
  }

  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: ownerEmail,
    options: { redirectTo: `${appUrl}/app` },
  })
  if (linkError || !linkData?.user) {
    // Compensating cleanup — no cross-API transaction is possible here.
    await admin.from('shops').delete().eq('id', shop.id)
    return fail(500, 'Could not invite that owner. Check the email address and try again.')
  }

  const ownerUserId = linkData.user.id
  const actionLink = linkData.properties?.action_link
  const { error: membershipError } = await admin
    .from('shop_memberships')
    .insert({ shop_id: shop.id, user_id: ownerUserId, role: 'owner' })
  if (membershipError) {
    await admin.from('shops').delete().eq('id', shop.id)
    return fail(500, 'Could not finish setting up the shop. Please try again.')
  }

  // Best-effort delivery through Resend (reusing the same secrets as
  // send-quote-email). Failure here is not fatal — the UI falls back to a
  // copy-link the platform admin can send themselves.
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const emailFrom = Deno.env.get('EMAIL_FROM')
  let emailSent = false
  if (resendKey && emailFrom && actionLink) {
    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [ownerEmail],
          subject: `You're set up on 0Gauge Recovery — ${shopName}`,
          html: `<p>Hi,</p><p>Your shop <strong>${escapeHtml(shopName)}</strong> is ready on 0Gauge Recovery.</p><p><a href="${escapeHtml(actionLink)}">Click here to sign in and get started</a>.</p>`,
          text: `Your shop ${shopName} is ready on 0Gauge Recovery. Sign in here: ${actionLink}`,
        }),
      })
      emailSent = resendResponse.ok
    } catch {
      emailSent = false
    }
  }

  return json(200, {
    ok: true,
    shopId: shop.id,
    emailSent,
    inviteLink: emailSent ? undefined : actionLink,
  })
})
