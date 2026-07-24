import type { Customer, Quote, QuoteOption, Shop, TemplateType } from '../types'
import { formatCurrency, formatDate, formatVehicle, quoteValueCents } from './format'

// All five manual email templates. Emails stay short and drive the customer to
// the public quote page — the full quote never rides inside the email.
// NOTE: supabase/functions/send-quote-email keeps a mirrored copy of this
// logic for server-side rendering. Update both together.

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface EmailContext {
  shop: Shop
  customer: Customer
  quote: Quote
  options: QuoteOption[]
  publicUrl: string
  optOutUrl: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface TemplateCopy {
  subject: (ctx: EmailContext) => string
  intro: (ctx: EmailContext) => string
  cta: string
}

const COPY: Record<TemplateType, TemplateCopy> = {
  initial: {
    subject: (c) => {
      const v = formatVehicle(c.customer)
      return v ? `Your ${v} audio quote from ${c.shop.name}` : `Your audio quote from ${c.shop.name}`
    },
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `Thanks for stopping by ${c.shop.name}. Here is the quote you asked for${v ? ` on your ${v}` : ''}. You can review the options and pricing at the link below.`
    },
    cta: 'View My Quote',
  },
  check_in: {
    subject: (c) => {
      const v = formatVehicle(c.customer)
      return v ? `Any questions about your ${v} quote?` : 'Any questions about your quote?'
    },
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `Just checking in on the quote we put together${v ? ` for your ${v}` : ' for you'}. If anything is unclear or you want to tweak the setup, reply to this email or give us a call — happy to help.`
    },
    cta: 'Review My Quote',
  },
  financing_option: {
    subject: (c) => `Options that fit your budget — ${c.shop.name}`,
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `We know a full system is a real investment. If the price on your${v ? ` ${v}` : ''} quote is the holdup, we can talk financing or put together a lower-cost package that still sounds great. The quote link below has the current options.`
    },
    cta: 'See My Options',
  },
  payday_reminder: {
    subject: (c) => `Ready when you are — ${c.shop.name}`,
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `You asked us to follow up in a bit${v ? ` about your ${v}` : ''}. Your quote is still ready to go — take a look when the timing works and we can get you on the schedule.`
    },
    cta: 'View My Quote',
  },
  final_check_in: {
    subject: (c) => {
      const v = formatVehicle(c.customer)
      return v ? `Last note about your ${v} quote` : 'Last note about your quote'
    },
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `This is our last note about ${v ? `the quote for your ${v}` : 'your quote'} — we won't keep filling your inbox. If you'd still like to get it done, the quote is at the link below and we'd love to have you in.`
    },
    cta: 'View My Quote',
  },
}

export function renderEmail(templateType: TemplateType, ctx: EmailContext): RenderedEmail {
  const copy = COPY[templateType]
  const { shop, customer, quote } = ctx
  const subject = copy.subject(ctx)
  const intro = copy.intro(ctx)
  const value = quoteValueCents(ctx.options)
  const vehicle = formatVehicle(customer)
  const valueLine =
    value > 0 ? (vehicle ? `Quoted from ${formatCurrency(value)} for your ${vehicle}.` : `Quoted from ${formatCurrency(value)}.`) : ''
  // Emails stay short — no window-by-window breakdown, just a pointer to the full quote.
  const tintTeaser =
    templateType === 'initial' && quote.windowTints.length > 0
      ? 'Includes window tint — see your quote for the full breakdown.'
      : ''
  const expiration = quote.expirationDate
    ? `This quote is good through ${formatDate(quote.expirationDate)}.`
    : ''

  const text = [
    `Hi ${customer.firstName || 'there'},`,
    '',
    intro,
    '',
    `${copy.cta}: ${ctx.publicUrl}`,
    valueLine,
    tintTeaser,
    expiration,
    '',
    `Questions? Call ${shop.phone} or reply to this email (${shop.replyToEmail}).`,
    '',
    `${shop.name}`,
    shop.address,
    '',
    `Don't want more emails about this quote? Stop follow-ups here: ${ctx.optOutUrl}`,
  ]
    .filter((line) => line !== null)
    .join('\n')

  const color = shop.primaryColor || '#1d4ed8'
  const html = `
<div style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="padding:20px 24px;border-bottom:3px solid ${color};">
      ${
        shop.logoUrl
          ? `<img src="${escapeHtml(shop.logoUrl)}" alt="${escapeHtml(shop.name)}" style="max-height:48px;max-width:220px;" />`
          : `<div style="font-size:20px;font-weight:800;color:#18181b;">${escapeHtml(shop.name)}</div>`
      }
    </div>
    <div style="padding:24px;color:#27272a;font-size:16px;line-height:1.6;">
      <p style="margin:0 0 16px;">Hi ${escapeHtml(customer.firstName || 'there')},</p>
      <p style="margin:0 0 20px;">${escapeHtml(intro)}</p>
      ${
        value > 0
          ? `<p style="margin:0 0 20px;color:#52525b;">${vehicle ? `Your ${escapeHtml(vehicle)} &middot; ` : ''}quoted from <strong style="color:#18181b;">${formatCurrency(value)}</strong></p>`
          : ''
      }
      ${tintTeaser ? `<p style="margin:0 0 20px;color:#52525b;">${escapeHtml(tintTeaser)}</p>` : ''}
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${escapeHtml(ctx.publicUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:17px;padding:14px 32px;border-radius:10px;">${copy.cta}</a>
      </p>
      ${expiration ? `<p style="margin:0 0 16px;color:#52525b;font-size:14px;">${escapeHtml(expiration)}</p>` : ''}
      <p style="margin:0;color:#52525b;font-size:15px;">Questions? Call <a href="tel:${escapeHtml(shop.phone)}" style="color:${color};">${escapeHtml(shop.phone)}</a> or just reply to this email.</p>
    </div>
    <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:13px;line-height:1.6;">
      <div><strong>${escapeHtml(shop.name)}</strong> &middot; ${escapeHtml(shop.phone)}</div>
      <div>${escapeHtml(shop.address)}</div>
      <div style="margin-top:8px;">
        You received this because you asked ${escapeHtml(shop.name)} for a quote.
        <a href="${escapeHtml(ctx.optOutUrl)}" style="color:#71717a;">Stop follow-up emails</a>
      </div>
    </div>
  </div>
</div>`.trim()

  return { subject, html, text }
}
