# Putting a shop on its own domain

One repository, one build, many front doors. There is no second copy of the
software and there must never be one: every fix would have to be applied to
each copy, they drift within weeks, and a bug fixed for one shop stays broken
for the rest.

A `git push` updates every domain at once. That is the whole point.

---

## What each domain shows

| | Platform domain | A shop's domain (e.g. `supercaraudio.com`) |
|---|---|---|
| `/` | The marketing page | Redirects to the login |
| `/login` | "Shop login", 0Gauge branding | "Super Car Audio login", their logo and colour |
| `/signup` | Create a shop account | Redirects to the login |
| Everything after sign-in | Identical | Identical |

The shop is resolved from the hostname alone, before anyone signs in. See
`src/lib/tenantDomain.ts` for the rules and `get_shop_branding_by_domain` in
migration 0032 for the lookup, which returns only what a customer already sees
on a quote: name, slug, logo, colour.

Sign-in itself is unchanged. A person's access comes from their shop
membership, not from the door they walked through, so the same account works
from either address and RLS is still the only thing enforcing separation.

---

## Adding a shop's domain

Four steps, in this order. Steps 2-4 are the owner's; none of them is code.

**1. Point the domain at the app.** In Cloudflare Pages, open the existing
project → Custom domains → Set up a custom domain → enter `supercaraudio.com`.
Add `www.supercaraudio.com` too and let Cloudflare redirect it; the app treats
both as the same front door, but a visitor who types `www` should still land.

Use the *same* Pages project. A second project would be a second build, which
is the copy this document exists to prevent.

**2. Set the domain in the app.** Sign in as that shop, Settings → "Your own
web address" → `supercaraudio.com`. Bare hostname: no `https://`, no `www.`,
no trailing slash. The database refuses the other shapes rather than storing a
hostname that can never match.

**3. Add the domain to Supabase Auth.** Dashboard → Authentication → URL
Configuration → Redirect URLs. Add `https://supercaraudio.com/**`. Magic-link
sign-in from that domain fails without it, and the failure looks like a broken
link rather than a misconfiguration.

**4. Leave `APP_URL` alone unless the *platform* address changes.** It is a
Supabase Edge Function secret and it is what server-sent emails use to build
quote links. It should point at the platform address, which every shop can
reach. Setting it to one shop's domain would put that shop's hostname in every
other shop's emails.

---

## What does NOT need changing

The app resolves its own address from the browser (`env.appUrl` reads
`window.location.origin`). Every link it generates in the browser — the public
quote, the review page, the counter shortcut — is already on whatever domain
the staff member is using. That was a deliberate fix after a build shipped
with `VITE_APP_URL` unset and mailed magic links pointing at `localhost`.

So: no code change, no rebuild, and no environment variable when a shop's
domain is added or changed.

---

## When the client's domain is in their own Cloudflare account

Cloudflare requires a Worker and the domain it serves to be in the **same
account**. A shop that keeps its own Cloudflare account therefore needs the
app uploaded there too.

This is still not a second copy. One repository, one build, and a config file
per destination that says nothing except where to put it:

```
wrangler.jsonc                 the platform
wrangler.supercaraudio.jsonc   Super Car Audio's account
```

`npm run deploy:web` builds once and uploads that same `dist/` to every one,
so a fix ships everywhere in a single command and they cannot drift. Adding a
client is copying one file and changing `name` and `account_id`.

Two setup steps per client, once:

1. **Get access.** In the client's Cloudflare account: Manage Account →
   Members → Invite your own address as **Administrator**, then accept the
   invite. One `wrangler login` then covers both accounts.
2. **Fill in the account id.** It is in the address bar of their dashboard,
   and in the sidebar under Account ID. Not a secret. Paste it into their
   config, replacing the placeholder — the deploy script skips any config
   that still has one rather than failing with an authentication error that
   points nowhere.

Then add their custom domain to **their** Worker, in **their** account, using
the steps above.

At roughly ten clients this stops being the right shape and Cloudflare for
SaaS is — one CNAME from the client and no account access at all. The config
files are the thing to delete when that day comes.

## Renaming the repository

Cosmetic, and safe. GitHub → Settings → rename. GitHub keeps redirects from
the old name, and Cloudflare Pages follows the connection rather than the
name. Update the `origin` remote afterwards:

```bash
git remote set-url origin https://github.com/<owner>/<new-name>.git
```

The Pages *project* name is separate, and it is what produces the
`*.pages.dev` address. Renaming it changes that address; any real custom
domain is unaffected.
