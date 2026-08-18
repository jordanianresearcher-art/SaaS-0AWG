// Tap-to-text: `sms:` links that open the staff member's own messaging app with
// the message already written.
//
// This is deliberately NOT an SMS API. Sending real texts from a server means
// A2P 10DLC campaign registration (weeks of lead time, per-shop paperwork) at
// every US provider — not a Twilio-specific problem. Shops already text
// customers all day from their own phones, and a text from the number the
// customer recognizes lands better than one from a shortcode. So the app writes
// the message; the human presses send.
//
// The tradeoff: we can never know whether it was actually sent, so nothing in
// the app records a "text sent" event off the back of one of these links.

/**
 * Digits only, with the US country code dropped if present.
 *
 * Phone numbers in this app are free text ("214-555-0100", "(214) 555 0100",
 * "+1 214 555 0100") because the quote form has no required fields. Both iOS
 * and Android want a bare digit string in the `sms:` target.
 */
export function normalizePhoneForSms(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 0) return null
  // 11 digits starting with 1 is a US number written with its country code.
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  // Anything shorter than 7 digits can't be dialed; don't build a dead link.
  if (national.length < 7) return null
  return national
}

/**
 * Build an `sms:` URL with a prefilled body, or null when the number is unusable.
 *
 * The `?&body=` separator is not a typo. iOS historically parses the body only
 * after `&`, Android only after `?`; `?&` is the one form both accept, and it
 * remains the widely-used cross-platform spelling.
 */
export function buildSmsLink(phone: string | null | undefined, body: string): string | null {
  if (!phone) return null
  const number = normalizePhoneForSms(phone)
  if (!number) return null
  return `sms:${number}?&body=${encodeURIComponent(body)}`
}

export interface QuoteSmsContext {
  firstName: string | null
  shopName: string
  vehicle: string | null
  quoteUrl: string
}

export interface BookingSmsContext {
  firstName: string | null
  shopName: string
  serviceName: string | null
  /** Already formatted for humans — "tomorrow at 2:00 PM". */
  whenLabel: string
  manageUrl: string
}

/** "Hi Marcus" / "Hi there" — never "Hi null". */
function greeting(firstName: string | null): string {
  const name = firstName?.trim()
  return name ? `Hi ${name}` : 'Hi there'
}

function vehiclePhrase(vehicle: string | null): string {
  const v = vehicle?.trim()
  return v ? ` for your ${v}` : ''
}

/**
 * The manual counterpart to each automatic follow-up email. Wording matches the
 * email stage so a customer who gets both doesn't hear two different pitches —
 * but these are short and personal, the way a shop owner actually texts.
 */
export const QUOTE_SMS_TEMPLATES = {
  check_in: (c: QuoteSmsContext) =>
    `${greeting(c.firstName)}, it's ${c.shopName}. Just checking in on the quote${vehiclePhrase(c.vehicle)} — any questions? ${c.quoteUrl}`,
  financing_option: (c: QuoteSmsContext) =>
    `${greeting(c.firstName)}, it's ${c.shopName}. If the price is the holdup${vehiclePhrase(c.vehicle)}, we have financing — most approvals take a few minutes. ${c.quoteUrl}`,
  payday_reminder: (c: QuoteSmsContext) =>
    `${greeting(c.firstName)}, it's ${c.shopName}. You asked me to check back around payday — your quote's still good: ${c.quoteUrl}`,
  final_check_in: (c: QuoteSmsContext) =>
    `${greeting(c.firstName)}, it's ${c.shopName}. Last note from me — the quote${vehiclePhrase(c.vehicle)} is still here whenever you're ready: ${c.quoteUrl}`,
  initial: (c: QuoteSmsContext) =>
    `${greeting(c.firstName)}, it's ${c.shopName}. Here's the quote${vehiclePhrase(c.vehicle)} you asked for: ${c.quoteUrl}`,
} as const

export type QuoteSmsTemplate = keyof typeof QUOTE_SMS_TEMPLATES

export function buildQuoteSmsBody(template: QuoteSmsTemplate, ctx: QuoteSmsContext): string {
  return QUOTE_SMS_TEMPLATES[template](ctx)
}

/** Appointment reminder — the manual twin of the automatic 24h reminder email. */
export function buildBookingReminderSmsBody(ctx: BookingSmsContext): string {
  const service = ctx.serviceName?.trim()
  const what = service ? `your ${service}` : 'your appointment'
  return `${greeting(ctx.firstName)}, reminder from ${ctx.shopName} — ${what} is ${ctx.whenLabel}. Need to change it? ${ctx.manageUrl}`
}

/** Sent right after booking someone over the phone, while they're still on the line. */
export function buildBookingConfirmationSmsBody(ctx: BookingSmsContext): string {
  const service = ctx.serviceName?.trim()
  const what = service ? `your ${service}` : 'your appointment'
  return `${greeting(ctx.firstName)}, you're booked at ${ctx.shopName} — ${what} ${ctx.whenLabel}. Details here: ${ctx.manageUrl}`
}
