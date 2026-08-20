import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Barcode, Boxes, FileText, CalendarDays, BellRing, Settings, LogOut } from 'lucide-react'
import { useAppData } from '../data/AppDataContext'
import { Logo } from '../components/ui'
import type { ReactNode } from 'react'

const FULL_NAV = [
  { to: '/app', label: 'Home', icon: LayoutDashboard, end: true },
  // Scanning is the primary daily workflow — first after Home in the
  // desktop nav, and the prominent center button on the mobile bottom nav
  // below (not one of the flanking slots, see bottomFlankItems).
  { to: '/app/scan', label: 'Scan', icon: Barcode, end: false },
  { to: '/app/inventory', label: 'Inventory', icon: Boxes, end: false },
  { to: '/app/calendar', label: 'Calendar', icon: CalendarDays, end: false },
  { to: '/app/quotes', label: 'Quotes', icon: FileText, end: false },
  { to: '/app/follow-ups', label: 'Follow-ups', icon: BellRing, end: false },
  { to: '/app/settings', label: 'Settings', icon: Settings, end: false },
]

// A shared-access ('inventory') device only ever sees Scan + Inventory —
// everything else 404s into "not available" via RequireFullAccess anyway
// (RLS is the real enforcement), so there's no reason to show a link to it.
const INVENTORY_ONLY_NAV = [
  { to: '/app/scan', label: 'Scan', icon: Barcode, end: false },
  { to: '/app/inventory', label: 'Inventory', icon: Boxes, end: true },
]

type NavEntry = (typeof FULL_NAV)[number]

function NavItem({ to, label, icon: Icon, end, bottom }: NavEntry & { bottom?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        bottom
          ? `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${isActive ? 'text-brand-bright' : 'text-zinc-400'}`
          : `flex items-center gap-2 rounded-xl px-3 py-2.5 text-[15px] font-semibold whitespace-nowrap transition-colors ${
              isActive ? 'bg-white/10 text-brand-bright' : 'text-zinc-300 hover:bg-white/5 hover:text-white'
            }`
      }
    >
      <Icon className={bottom ? 'h-6 w-6' : 'h-[18px] w-[18px]'} aria-hidden="true" />
      {label}
    </NavLink>
  )
}

function DemoBanner(): ReactNode {
  const { mode, exitDemo } = useAppData()
  const navigate = useNavigate()
  if (mode !== 'demo') return null
  return (
    <div className="no-print flex items-center justify-center gap-2 bg-zinc-800 px-4 py-1.5 text-sm font-bold text-amber-300">
      <span>Demo Data — nothing here is real</span>
      <button
        type="button"
        className="underline"
        onClick={() => {
          exitDemo()
          navigate('/')
        }}
      >
        Exit demo
      </button>
    </div>
  )
}

export function AppLayout() {
  const { shop, mode, role, signOut } = useAppData()
  const navigate = useNavigate()

  const isInventoryOnly = role === 'inventory'
  // Up to two letters from the shop's name — enough to recognise at a glance,
  // and it degrades to a single character rather than an empty box.
  const shopInitials =
    (shop?.name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '0G'
  const nav = isInventoryOnly ? INVENTORY_ONLY_NAV : FULL_NAV
  // Mobile bottom nav flanks the center Scan button with up to two items a
  // side. Calendar takes Follow-ups' slot here: booking is the on-the-go,
  // glance-at-it-between-customers task; Follow-ups stays one tap away on the
  // desktop nav and becomes an oversight queue rather than a daily to-do
  // once auto follow-ups ship (see docs/MVP_PLAN.md's Phase 5 notes).
  const bottomFlankItems = isInventoryOnly
    ? nav.filter((item) => item.to !== '/app/scan')
    : nav.filter((item) => ['/app', '/app/inventory', '/app/calendar', '/app/quotes'].includes(item.to))

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      {/* Dark chrome, light work surfaces. The nav is the instrument panel;
          the page below it is the workbench. */}
      <header className="no-print sticky top-0 z-40 border-b border-black/40 bg-chrome">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <NavLink to={isInventoryOnly ? '/app/inventory' : '/app'} className="shrink-0">
            <Logo className="text-2xl" light />
          </NavLink>
          <div className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 md:flex">
            {nav.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </div>
          {/* The shop name used to sit as loose text beside two loose icon
              buttons, which is what made the header feel cramped — three
              unrelated things competing with the nav for the same row. They
              collapse into one account chip: initials, name, and the actions
              that belong to the account. */}
          <div className="flex shrink-0 items-center gap-1">
            {!isInventoryOnly ? (
              <NavLink
                to="/app/settings"
                aria-label="Settings"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-300 hover:bg-white/10 md:hidden"
              >
                <Settings className="h-5 w-5" aria-hidden="true" />
              </NavLink>
            ) : null}
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-chrome-soft py-1 pr-1 pl-2">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-bright text-xs font-black text-ink"
              >
                {shopInitials}
              </span>
              <span className="hidden max-w-32 truncate text-sm font-semibold text-zinc-200 lg:block">
                {shop?.name}
              </span>
              {mode === 'production' ? (
                <button
                  type="button"
                  onClick={async () => {
                    await signOut()
                    navigate('/')
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                  aria-label="Sign out"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-24 md:pb-10">
        <Outlet />
      </main>
      {/* Bottom navigation for phones — the primary device for shop staff. */}
      <nav
        aria-label="Main"
        className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-black/40 bg-chrome pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {bottomFlankItems.slice(0, 2).map((item) => (
          <NavItem key={item.to} {...item} bottom />
        ))}
        <NavLink
          to="/app/scan"
          aria-label="Scan"
          className="flex min-h-14 flex-1 flex-col items-center justify-center"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-bright text-ink shadow-md">
            <Barcode className="h-7 w-7" aria-hidden="true" />
          </span>
        </NavLink>
        {bottomFlankItems.slice(2, 4).map((item) => (
          <NavItem key={item.to} {...item} bottom />
        ))}
      </nav>
    </div>
  )
}
