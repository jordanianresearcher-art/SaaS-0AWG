# Supabase auth email templates

The app sends its own emails (quotes, invoices, booking confirmations) through
Resend, and those are already styled — see `src/lib/emailTemplates.ts`. The
**sign-in email is different**: Supabase sends it, from a template stored in
the Supabase dashboard, and nothing in this repo can change it at runtime. It
has to be pasted in by hand.

---

## Read this first: the link's host comes from Site URL

The template below links to `{{ .SiteURL }}`, which Supabase replaces with the
**Site URL** configured in your project — *not* with anything the app sends.

> **Dashboard → Authentication → URL Configuration → Site URL**

If that value is `http://localhost:5173`, every magic link you mail points at
localhost. On a desktop where you happen to be running `npm run dev` it works,
which is what makes this so confusing. On a phone the address is unreachable
and the browser reports a typo in it — **sign-in is impossible from mobile and
impossible for every customer.**

Set both of these to your live URL:

| Setting | Value |
|---|---|
| **Site URL** | `https://<your live domain>` |
| **Redirect URLs** | `https://<your live domain>/**` |

The Redirect URLs allow-list matters separately: an `emailRedirectTo` that
isn't on it is silently ignored and Supabase falls back to the Site URL, so a
wrong Site URL breaks the fallback too.

Changing these takes effect on the **next email sent** — no redeploy needed.
Request a fresh link after changing them; links already in your inbox still
carry the old host.

---

## Magic Link template

**Dashboard → Authentication → Email Templates → Magic Link.** Replace the
whole body with this.

Two things about it are load-bearing and should not be "simplified" away:

- **`token_hash`, not `{{ .ConfirmationURL }}`.** The default confirmation URL
  is consumed the moment anything fetches it, and mail apps and corporate
  scanners routinely fetch links before a human taps them — burning the
  single-use token and producing an "expired link" for the real click. The
  `token_hash` form is inert until `/auth/confirm` verifies it on a tap.
- **The visible URL at the bottom.** Some clients strip buttons, and an
  embedded browser sometimes needs the link copied out by hand.

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:24px 12px;background:#f4f4f5;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr>
          <td style="padding:22px 28px;border-top:5px solid #b45309;">
            <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px;color:#18181b;">
              <span style="color:#b45309;">0</span>GAUGE
            </span>
            <span style="font-size:11px;font-weight:700;letter-spacing:2px;color:#71717a;text-transform:uppercase;">&nbsp;Recovery</span>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 28px 28px;">
            <h1 style="margin:0 0 10px 0;font-size:22px;font-weight:800;color:#18181b;">Sign in to your shop</h1>
            <p style="margin:0 0 22px 0;font-size:16px;line-height:1.5;color:#3f3f46;">
              Tap the button below and you're in. No password to remember.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px 0;">
              <tr>
                <td style="background:#f59e0b;border-radius:10px;">
                  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink"
                     style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:700;color:#18181b;text-decoration:none;">
                    Sign in
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 6px 0;font-size:13px;line-height:1.5;color:#71717a;">
              This link works once and expires shortly. If the button doesn't work, copy this address into your browser:
            </p>
            <p style="margin:0 0 22px 0;font-size:12px;line-height:1.5;color:#b45309;word-break:break-all;">
              {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink
            </p>

            <p style="margin:0;padding-top:18px;border-top:1px solid #f4f4f5;font-size:13px;line-height:1.5;color:#a1a1aa;">
              Didn't ask to sign in? You can ignore this email — nothing happens until the link is opened.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

### Why it's built this way

Email clients are roughly fifteen years behind browsers, so this uses tables
for layout and inline styles only — no flexbox, no `<style>` block, no classes.
Gmail strips `<head>` styles entirely.

The button is a padded `<a>` inside a background-coloured table cell rather
than a styled `<button>`, because Outlook renders the latter as nothing at all.
Its target is ~50px tall, which is a real thumb target on a phone.

The colour is the app's copper (`#f59e0b` fill, `#18181b` text — about 9:1
contrast), matching the app chrome so the email and the product look like the
same thing. There are no images, so nothing breaks when a client blocks them
by default and there's no tracking pixel to trip a spam filter.

---

## One template covers sign-in and sign-up

Both `/login` and `/signup` call `signInWithOtp`, so Supabase only ever sends
the **Magic Link** template. `/auth/confirm` routes a brand-new owner to
`/onboarding` and an existing one to `/app` on its own, so the link needs no
`next` parameter and there is no second template to keep in sync.

## After changing anything here

Send yourself a fresh link — old ones in your inbox still point at the old
host. Test from a **phone**, not just a desktop: a wrong Site URL frequently
works on the machine running the dev server and fails everywhere else, which
is exactly how it stayed hidden.
