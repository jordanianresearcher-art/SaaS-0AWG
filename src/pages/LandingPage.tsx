import { Link } from 'react-router-dom'
import { Mail, Eye, BellRing, DollarSign, Phone, Printer } from 'lucide-react'
import { Logo } from '../components/ui'
import { env } from '../lib/env'

const FEATURES = [
  {
    icon: Mail,
    title: 'Professional quote emails',
    body: 'Send a clean Good / Better / Insane quote to the customer’s inbox in about two minutes.',
  },
  {
    icon: Eye,
    title: 'Know when they look',
    body: 'The moment a customer opens their quote link, it shows up in your app. No more guessing.',
  },
  {
    icon: BellRing,
    title: 'Simple follow-ups',
    body: 'A short list every morning of who to email or call today. You press send — nothing goes out on its own.',
  },
  {
    icon: DollarSign,
    title: 'See the money come back',
    body: 'Track appointments, deposits, and won jobs. Print a report that shows recovered revenue in plain numbers.',
  },
  {
    icon: Phone,
    title: 'Keep your process',
    body: 'Works next to your POS and your phone. No new register, no new payment system, nothing to rip out.',
  },
  {
    icon: Printer,
    title: 'A report you can hold',
    body: 'Run a 7 or 14-day pilot and print the results. If it didn’t make you money, you’ll see that too.',
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-zinc-100">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Logo className="text-2xl" />
          <Link to="/login" className="min-h-11 rounded-xl px-4 py-2.5 text-base font-semibold text-charcoal hover:bg-zinc-100">
            Shop Login
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 pt-14 pb-10 text-center sm:pt-20">
        <h1 className="mx-auto max-w-3xl text-4xl font-black tracking-tight text-ink sm:text-5xl">
          Win back the customers who got a quote and never came back.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-600 sm:text-xl">
          0Gauge Recovery is built for independent car-audio shops. Email professional quotes, see when
          customers open them, follow up at the right time, and watch quoted money turn into won jobs.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {env.demoModeEnabled ? (
            <Link
              to="/demo"
              className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-brand px-8 text-lg font-bold text-white hover:bg-brand-dark sm:w-auto"
            >
              Try the Demo
            </Link>
          ) : null}
          <Link
            to="/login"
            className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border border-zinc-300 px-8 text-lg font-bold text-ink hover:bg-zinc-50 sm:w-auto"
          >
            Shop Login
          </Link>
        </div>
        <p className="mt-4 text-sm text-zinc-500">The demo runs entirely on this device with sample data. No sign-up needed.</p>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-zinc-200 p-5">
              <f.icon className="h-7 w-7 text-brand" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-bold text-ink">{f.title}</h2>
              <p className="mt-1.5 text-base leading-relaxed text-zinc-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-zinc-950 py-14">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-2xl font-black text-white sm:text-3xl">
            You already quoted the work. This gets you paid for more of it.
          </h2>
          <p className="mt-4 text-lg text-zinc-300">
            Most shops never hear back from half the people they quote. A polite email, sent at the right
            time, brings a surprising number of them through the door.
          </p>
          {env.demoModeEnabled ? (
            <Link
              to="/demo"
              className="mt-7 inline-flex min-h-14 items-center justify-center rounded-xl bg-white px-8 text-lg font-bold text-ink hover:bg-zinc-200"
            >
              See it with sample data
            </Link>
          ) : null}
        </div>
      </section>

      <footer className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 py-8 text-center text-sm text-zinc-500">
        <Logo className="text-lg" />
        <p>Email follow-ups only, always sent by a person at your shop. Customers can stop emails with one click.</p>
      </footer>
    </div>
  )
}
