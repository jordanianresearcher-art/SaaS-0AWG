// The HTML a customer actually sees, and the one piece of this app that has
// to be beautiful on someone else's screen.
//
// Why this file exists at all: the layout used to live twice, hand-copied
// between here and supabase/functions/send-quote-email, with nothing checking
// that the copies agreed. They took different data shapes, so the duplication
// could not be tested. Everything below takes a flat view model of plain
// strings and numbers instead, which makes the renderer byte-identical on both
// sides — so it sits inside MIRROR markers and
// src/lib/edgeFunctionMirrors.test.ts runs both copies over the same quote and
// compares the HTML. Build the view model on each side; never fork the render.
//
// Email HTML is not web HTML. Every rule below is there because a client
// breaks without it:
//   - Tables for layout. Outlook's rendering engine is Word; flex and grid do
//     not exist there.
//   - Inline styles on every element. Gmail strips <style> for many accounts,
//     so the <style> block carries only progressive extras (media queries,
//     dark mode) that the design survives losing.
//   - No background-image anywhere. Outlook drops it and you get a hole.
//   - Images get width/height attributes as well as CSS, and always a
//     background colour behind them: most clients block remote images until
//     the reader allows them, and the email has to still look composed with
//     every picture missing.
//   - 600px. Wider than that and Outlook's preview pane starts scrolling
//     horizontally.

// MIRROR-BEGIN emailLayout — keep byte-identical with supabase/functions/send-quote-email/index.ts
/** Everything the layout needs, as primitives. Strings arrive RAW and are escaped here. */
interface EmailView {
  shopName: string
  shopLogoUrl: string | null
  /** The shop's own brand colour. Drives every accent; never overridden by app chrome. */
  shopColor: string
  shopPhone: string
  shopAddress: string
  /** First name only. The customer's surname and number never appear in an email. */
  firstName: string
  vehicle: string | null
  publicUrl: string
  optOutUrl: string
  preheader: string
  intro: string
  cta: string
  packageName: string
  priceCents: number
  /** The one big photo at the top. Null falls back to a typographic hero. */
  heroImageUrl: string | null
  items: { label: string; imageUrl: string | null }[]
  addons: { name: string; addonPriceCents: number; totalWithAddonCents: number }[]
  fullTotalCents: number | null
  tints: { name: string; typeLabel: string; coverage: string; extras: string; totalCents: number }[]
  moreTints: number
  financing: { name: string; url: string; payoffDays: number | null }[]
  expiration: string
  /** The gallery, add-ons and tint detail ride on the first email only. */
  showFullSummary: boolean
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Opens a full-width row inside the 600px card. */
function row(inner: string, padding: string, background: string): string {
  return `<tr><td style="padding:${padding};background:${background};">${inner}</td></tr>`
}

/**
 * The inbox preview line — the text a client shows next to the subject.
 *
 * Padded with sixty zero-width non-joiners so the client stops before it
 * starts reading the greeting. Without the padding, every email previews as
 * "Hi Marcus, Thanks for stopping by" and four follow-ups look identical in
 * the list.
 */
function preheader(text: string): string {
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">` +
    `${esc(text)}${'&zwnj;&nbsp;'.repeat(60)}` +
    `</div>`
  )
}

/**
 * The hero. A large product photo when the quote has one, and a typographic
 * panel when it does not.
 *
 * Capped at 420px wide inside a 600px band rather than bled to the edges,
 * because catalog photography is whatever the manufacturer shot — a tall
 * enclosure and a wide amplifier both have to look deliberate here, and only
 * a fixed frame does that. `max-height` is ignored by Outlook, which is
 * acceptable: it degrades to a big picture, not a broken one.
 */
function heroHtml(v: EmailView): string {
  if (v.heroImageUrl) {
    // alt="" and a grey ground on the <img> itself, not a caption. Most
    // clients block remote images until the reader allows them, so this band
    // is first seen empty — and an empty band has to look like a deliberate
    // grey panel, never like a broken-image icon with a product name spilling
    // out beside it. The fixed-height cell keeps the layout from jumping when
    // the pictures finally load.
    return row(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">` +
        `<tr><td align="center" height="220" style="height:220px;padding:0;">` +
        `<img src="${esc(v.heroImageUrl)}" alt="" width="400" height="220" ` +
        `style="display:block;width:100%;max-width:400px;height:220px;object-fit:contain;margin:0 auto;border:0;outline:none;background:#e9e9ec;" />` +
        `</td></tr></table>`,
      '26px 24px',
      '#f4f4f5',
    )
  }
  const line = v.vehicle ? `Built for your ${v.vehicle}` : 'Built for you'
  return row(
    `<p style="margin:0;font-size:22px;line-height:1.25;font-weight:800;letter-spacing:-0.01em;color:#0b0b0c;text-align:center;">${esc(line)}</p>`,
    '32px 24px',
    '#f4f4f5',
  )
}

/**
 * The price, as the loudest thing in the email.
 *
 * It used to be a grey sentence in the middle of a paragraph — "quoted from
 * $3,199" — which is where a number goes when you are apologising for it. A
 * shop that has done the work should say the number plainly. Near-black panel
 * so it reads as a plate on a piece of equipment rather than a web callout,
 * and so it survives a client that inverts colours for dark mode.
 */
function priceHtml(v: EmailView): string {
  if (v.priceCents <= 0) return ''
  const label = v.packageName.trim() || 'Your build'
  const sub = v.vehicle ? `for your ${v.vehicle}` : 'for you'
  return row(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">` +
      `<tr><td style="padding:20px 24px;background:#0b0b0c;border-radius:14px;">` +
      `<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${esc(v.shopColor)};">${esc(label)}</p>` +
      `<p style="margin:0;font-size:38px;line-height:1.1;font-weight:800;letter-spacing:-0.02em;color:#ffffff;">${money(v.priceCents)}</p>` +
      `<p style="margin:6px 0 0;font-size:14px;color:#a1a1aa;">${esc(sub)}</p>` +
      `</td></tr></table>`,
    '20px 24px 4px',
    '#ffffff',
  )
}

/**
 * The call to action.
 *
 * One button, full width, 56px of height. There is no competing link above
 * it, and the caption underneath says what happens next rather than repeating
 * the button. A phone number sits below as the second option for the customer
 * who would always rather call than tap.
 */
function ctaHtml(v: EmailView): string {
  return row(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">` +
      `<tr><td align="center" bgcolor="${esc(v.shopColor)}" style="background:${esc(v.shopColor)};border-radius:12px;">` +
      `<a href="${esc(v.publicUrl)}" style="display:block;padding:18px 24px;font-size:18px;font-weight:800;letter-spacing:-0.01em;color:#ffffff;text-decoration:none;">${esc(v.cta)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#71717a;text-align:center;">` +
      `Everything is on one page — pick your options and reply right there.</p>` +
      `<p style="margin:10px 0 0;font-size:15px;text-align:center;color:#3f3f46;">` +
      `Or call <a href="tel:${esc(v.shopPhone)}" style="color:${esc(v.shopColor)};font-weight:700;text-decoration:none;">${esc(v.shopPhone)}</a></p>`,
    '16px 24px 24px',
    '#ffffff',
  )
}

/**
 * "What's in it" — the products, at a size a person can actually see.
 *
 * Two across, 240px wide. These were 36px thumbnails, which is a favicon: it
 * proves a photo exists without showing anyone anything. A customer who paid
 * for a Kicker CompR should see the Kicker CompR. Each tile keeps its grey
 * ground when the image is blocked, so a two-column grid of empty boxes still
 * reads as a layout.
 */
function galleryHtml(v: EmailView): string {
  if (v.items.length === 0) return ''
  const tile = (item: EmailView['items'][number]): string =>
    `<td width="50%" valign="top" style="padding:6px;vertical-align:top;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;">` +
    // Fixed 140px picture cell whether or not there is a picture. Tiles sit
    // two across, and a row whose cells disagree about their height reads as
    // a broken grid — which is what happens the moment one product has no
    // photo, or the reader has images turned off.
    `<tr><td align="center" height="140" style="height:140px;padding:14px 10px 6px;">` +
    (item.imageUrl
      ? `<img src="${esc(item.imageUrl)}" alt="" width="190" height="140" style="display:block;width:100%;max-width:190px;height:140px;object-fit:contain;border:0;background:#fafafa;" />`
      : `<div style="height:140px;line-height:140px;font-size:13px;color:#c4c4c8;">No photo yet</div>`) +
    `</td></tr>` +
    `<tr><td style="padding:0 12px 14px;font-size:14px;line-height:1.4;font-weight:600;color:#27272a;text-align:center;">${esc(item.label)}</td></tr>` +
    `</table></td>`

  const rows: string[] = []
  for (let i = 0; i < v.items.length; i += 2) {
    const pair = v.items.slice(i, i + 2)
    rows.push(`<tr>${pair.map(tile).join('')}${pair.length === 1 ? '<td width="50%"></td>' : ''}</tr>`)
  }
  return row(
    `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">What&rsquo;s in it</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 -6px;">${rows.join('')}</table>`,
    '8px 18px 4px',
    '#ffffff',
  )
}

/** Add-ons priced as increments on the main package, never as rival totals. */
function addonsHtml(v: EmailView): string {
  if (v.addons.length === 0) return ''
  const lines = v.addons
    .map(
      (a) =>
        `<tr>` +
        `<td style="padding:9px 0;border-top:1px solid #e4e4e7;font-size:15px;color:#3f3f46;">${esc(a.name.trim() || 'Add-on')}` +
        `<br /><span style="font-size:13px;color:#a1a1aa;">Brings it to ${money(a.totalWithAddonCents)}</span></td>` +
        `<td align="right" style="padding:9px 0;border-top:1px solid #e4e4e7;font-size:16px;font-weight:800;color:#0b0b0c;white-space:nowrap;">+${money(a.addonPriceCents)}</td>` +
        `</tr>`,
    )
    .join('')
  const full =
    v.fullTotalCents !== null
      ? `<p style="margin:12px 0 0;font-size:15px;font-weight:700;color:${esc(v.shopColor)};">Everything included: ${money(v.fullTotalCents)}</p>`
      : ''
  return row(
    `<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">Want to go further?</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${lines}</table>` +
      full,
    '16px 24px 4px',
    '#ffffff',
  )
}

/** Window tint written out in words — which glass, at what percentage. */
function tintHtml(v: EmailView): string {
  if (v.tints.length === 0) return ''
  const blocks = v.tints
    .map(
      (t) =>
        `<p style="margin:0 0 10px;font-size:15px;line-height:1.5;color:#3f3f46;">` +
        `<strong style="color:#0b0b0c;">${esc(t.name)}</strong> &mdash; ${esc(t.typeLabel)} film` +
        (t.coverage ? `<br /><span style="color:#71717a;">${esc(t.coverage)}</span>` : '') +
        (t.extras ? `<br /><span style="color:#a1a1aa;">Plus ${esc(t.extras)}</span>` : '') +
        (t.totalCents > 0 ? ` <strong style="color:#0b0b0c;">${money(t.totalCents)}</strong>` : '') +
        `</p>`,
    )
    .join('')
  return row(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#fafafa;border-radius:12px;">` +
      `<tr><td style="padding:16px 18px;">` +
      `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">Window tint</p>` +
      blocks +
      (v.moreTints > 0
        ? `<p style="margin:0;font-size:13px;color:#a1a1aa;">+${v.moreTints} more &mdash; see your full quote</p>`
        : '') +
      `</td></tr></table>`,
    '16px 24px 4px',
    '#ffffff',
  )
}

/**
 * Financing, placed after the price on purpose.
 *
 * The moment a number lands is the moment "can I split this up?" occurs to
 * someone, and it is already one of the most common replies on a public
 * quote. Every URL here has been sanitized upstream and is escaped again on
 * the way into the href, because this function is the last thing between
 * stored data and a real inbox.
 */
function financingHtml(v: EmailView): string {
  if (v.financing.length === 0) return ''
  // The longest window any of this shop's providers actually offers, taken
  // from what the shop entered per provider. Null everywhere means nobody has
  // entered one, and then the block says nothing about a payoff window at
  // all — the alternative is the app inventing a term in someone else's
  // lease agreement, in a real customer's inbox.
  const windows = v.financing.map((o) => o.payoffDays).filter((d): d is number => typeof d === 'number' && d > 0)
  const longest = windows.length > 0 ? Math.max(...windows) : null

  const rows = v.financing
    .map(
      (o) =>
        `<tr><td align="center" style="padding:0 0 8px;">` +
        `<a href="${esc(o.url)}" style="display:block;padding:14px 18px;background:#ffffff;border:2px solid ${esc(v.shopColor)};border-radius:11px;color:${esc(v.shopColor)};text-decoration:none;font-weight:700;font-size:15px;">` +
        `Apply with ${esc(o.name)}` +
        (o.payoffDays
          ? `<span style="display:block;margin-top:2px;font-size:12px;font-weight:600;color:#71717a;">${o.payoffDays} days to pay it off</span>`
          : '') +
        `</a></td></tr>`,
    )
    .join('')

  const heading = longest
    ? `<p style="margin:0 0 4px;font-size:19px;line-height:1.3;font-weight:800;color:#0b0b0c;">Pay back in ${longest} days, get it today!</p>` +
      `<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#71717a;">Take it home now and clear the balance within ${longest} days &mdash; no interest, nothing added on top.</p>`
    : `<p style="margin:0 0 4px;font-size:17px;font-weight:800;color:#0b0b0c;">Don&rsquo;t want to pay it all at once?</p>` +
      `<p style="margin:0 0 14px;font-size:14px;color:#71717a;">Applying takes a few minutes and most decisions come back right away.</p>`

  return row(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#f4f4f5;border-radius:12px;">` +
      `<tr><td style="padding:18px;">` +
      heading +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${rows}</table>` +
      (longest
        ? `<p style="margin:10px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa;">Terms come from the finance company, not from us &mdash; their agreement is the one that counts.</p>`
        : '') +
      `</td></tr></table>`,
    '16px 24px 8px',
    '#ffffff',
  )
}

/**
 * The whole email.
 *
 * A complete document rather than a bare <div>, which is what unlocks the
 * <head>: a viewport tag, a colour-scheme declaration so a dark-mode client
 * stops inverting the palette by guesswork, and the media query that turns
 * the two-across gallery into one column on a phone. None of it is load
 * bearing — every rule has an inline equivalent or degrades to the desktop
 * layout — but on the clients that honour it, the difference is the whole
 * impression.
 */
function renderEmailHtml(v: EmailView): string {
  const color = v.shopColor || '#1d4ed8'
  const view: EmailView = { ...v, shopColor: color }
  const header =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">` +
    `<tr>` +
    `<td style="vertical-align:middle;">` +
    (view.shopLogoUrl
      ? `<img src="${esc(view.shopLogoUrl)}" alt="${esc(view.shopName)}" style="display:block;max-height:44px;max-width:210px;border:0;" />`
      : `<span style="font-size:19px;font-weight:800;letter-spacing:-0.01em;color:#0b0b0c;">${esc(view.shopName)}</span>`) +
    `</td>` +
    `<td align="right" style="vertical-align:middle;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#a1a1aa;">Your quote</td>` +
    `</tr></table>`

  const body =
    `<p style="margin:0 0 14px;font-size:20px;font-weight:800;letter-spacing:-0.01em;color:#0b0b0c;">Hi ${esc(view.firstName || 'there')},</p>` +
    `<p style="margin:0;font-size:16px;line-height:1.6;color:#3f3f46;">${esc(view.intro)}</p>`

  const closing =
    (view.expiration
      ? `<p style="margin:0 0 12px;font-size:14px;color:#71717a;">${esc(view.expiration)}</p>`
      : '') +
    `<p style="margin:0;font-size:15px;line-height:1.6;color:#3f3f46;">Reply to this email and it comes straight to us.</p>`

  const footer =
    `<p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#3f3f46;">${esc(view.shopName)}</p>` +
    `<p style="margin:0 0 2px;font-size:13px;color:#71717a;">${esc(view.shopAddress)}</p>` +
    `<p style="margin:0 0 10px;font-size:13px;color:#71717a;">${esc(view.shopPhone)}</p>` +
    `<p style="margin:0;font-size:12px;line-height:1.6;color:#a1a1aa;">` +
    `You got this because you asked ${esc(view.shopName)} for a quote. ` +
    `<a href="${esc(view.optOutUrl)}" style="color:#a1a1aa;text-decoration:underline;">Stop follow-up emails</a></p>`

  const rows = [
    row(header, '20px 24px 18px', '#ffffff'),
    `<tr><td style="padding:0;height:3px;line-height:3px;font-size:0;background:${esc(color)};">&nbsp;</td></tr>`,
    heroHtml(view),
    row(body, '24px 24px 4px', '#ffffff'),
    priceHtml(view),
    ctaHtml(view),
    view.showFullSummary ? galleryHtml(view) : '',
    view.showFullSummary ? addonsHtml(view) : '',
    view.showFullSummary ? tintHtml(view) : '',
    financingHtml(view),
    row(closing, '12px 24px 24px', '#ffffff'),
    row(footer, '20px 24px', '#fafafa'),
  ].join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(view.shopName)}</title>
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  img { -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media only screen and (max-width:620px) {
    /* The gallery deliberately stays two across on a phone: at 390px the
       tiles are still 170px wide, which is a product you can see, and one
       column would push the add-ons below three screens of scrolling. */
    .og-shell { padding:12px 8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#e9e9ec;">
${preheader(view.preheader)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#e9e9ec;">
<tr><td class="og-shell" align="center" style="padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="border-collapse:collapse;width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
${rows}
</table>
</td></tr>
</table>
</body>
</html>`
}
// MIRROR-END emailLayout

// Exported outside the mirrored region on purpose: the Edge Function copy has
// no module system to export into, and the region has to stay byte-identical
// for src/lib/edgeFunctionMirrors.test.ts to compare the two.
export { renderEmailHtml }
export type { EmailView }
