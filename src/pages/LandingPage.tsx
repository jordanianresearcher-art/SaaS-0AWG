import { Link } from 'react-router-dom'
import {
  Mail,
  Eye,
  BellRing,
  DollarSign,
  Phone,
  Printer,
  FileText,
  ArrowRight,
  ShieldCheck,
  MousePointerClick,
} from 'lucide-react'
import { Logo } from '../components/ui'
import { env } from '../lib/env'

const STEPS = [
  { icon: FileText, label: 'Make a quote' },
  { icon: Mail, label: 'Email it' },
  { icon: DollarSign, label: 'Get paid' },
]

const FEATURES = [
  { icon: Mail, label: 'Email quotes' },
  { icon: Eye, label: "See who's looking" },
  { icon: BellRing, label: 'Simple follow-ups' },
  { icon: DollarSign, label: 'Watch revenue return' },
  { icon: Phone, label: 'Keep your process' },
  { icon: Printer, label: 'Printable proof' },
]

const TRUST = [
  { icon: Mail, label: 'Email only' },
  { icon: MousePointerClick, label: 'One-click stop' },
  { icon: ShieldCheck, label: 'Your data stays yours' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-zinc-100">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Logo className="text-2xl" />
          <div className="flex items-center gap-1">
            <Link to="/join" className="min-h-11 rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-500 hover:bg-zinc-100">
              Join with a shop code
            </Link>
            <Link to="/login" className="min-h-11 rounded-xl px-4 py-2.5 text-base font-semibold text-charcoal hover:bg-zinc-100">
              Shop Login
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-4 pt-16 pb-8 text-center sm:pt-24">
        <h1 className="mx-auto max-w-2xl text-4xl font-black tracking-tight text-ink sm:text-6xl">
          Get paid for the quotes you already wrote.
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-xl text-zinc-600">
          Email the quote. See who opens it. Bring them back.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {env.demoModeEnabled ? (
            <Link
              to="/demo"
              className="inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-xl bg-brand px-9 text-xl font-bold text-white shadow-sm transition-transform hover:scale-[1.02] hover:bg-brand-dark sm:w-auto"
            >
              <MousePointerClick className="h-6 w-6" aria-hidden="true" />
              Try the Demo
            </Link>
          ) : null}
          <Link
            to="/login"
            className="inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-xl border-2 border-zinc-300 px-9 text-xl font-bold text-ink transition-colors hover:border-zinc-400 hover:bg-zinc-50 sm:w-auto"
          >
            Shop Login
          </Link>
        </div>
        <p className="mt-3 text-sm text-zinc-500">No sign-up. No credit card. Just tap and try it.</p>
      </section>

      {/* How it works — 3 icons, almost no words */}
      <section aria-label="How it works" className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center justify-center gap-2 sm:gap-4">
          {STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-2 sm:gap-4">
              <div className="flex flex-col items-center gap-2">
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-brand sm:h-20 sm:w-20">
                  <step.icon className="h-8 w-8 sm:h-9 sm:w-9" aria-hidden="true" />
                </span>
                <span className="text-center text-base font-bold text-ink sm:text-lg">{step.label}</span>
              </div>
              {i < STEPS.length - 1 ? (
                <ArrowRight className="h-6 w-6 shrink-0 text-zinc-300" aria-hidden="true" />
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* Feature icon grid — icon + short label, no paragraphs */}
      <section className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.label}
              className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 px-4 py-7 text-center transition-shadow hover:shadow-md"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-brand">
                <f.icon className="h-7 w-7" aria-hidden="true" />
              </span>
              <span className="text-lg font-bold text-ink">{f.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Trust row — icons instead of a paragraph */}
      <section className="mx-auto max-w-3xl px-4 pb-10">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {TRUST.map((t) => (
            <div key={t.label} className="flex items-center gap-2 text-base font-semibold text-zinc-600">
              <t.icon className="h-5 w-5 text-brand" aria-hidden="true" />
              {t.label}
            </div>
          ))}
        </div>
      </section>

      <section className="bg-zinc-950 py-16">
        <div className="mx-auto max-w-2xl px-4 text-center">
          <h2 className="text-3xl font-black text-white sm:text-4xl">
            That quote didn&apos;t say no. It just went quiet.
          </h2>
          {env.demoModeEnabled ? (
            <Link
              to="/demo"
              className="mt-8 inline-flex min-h-16 items-center justify-center gap-2 rounded-xl bg-white px-9 text-xl font-bold text-ink transition-transform hover:scale-[1.02] hover:bg-zinc-100"
            >
              <MousePointerClick className="h-6 w-6" aria-hidden="true" />
              Try it free
            </Link>
          ) : null}
        </div>
      </section>

      <footer className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-8 text-center text-sm text-zinc-500">
        <Logo className="text-lg" />
        <p>Email only. Every message needs a person to press Send.</p>
      </footer>
    </div>
  )
}
