import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Barcode, FileText, BellRing, BarChart3, Settings, LogOut } from 'lucide-react'
import { useAppData } from '../data/AppDataContext'
import { Logo } from '../components/ui'
import type { ReactNode } from 'react'

const NAV = [
  { to: '/app', label: 'Home', icon: LayoutDashboard, end: true },
  // Scanning is the primary daily workflow — first after Home in the
  // desktop nav, and the prominent center button on the mobile bottom nav
  // below (not one of the flanking slots, see bottomFlankItems).
  { to: '/app/scan', label: 'Scan', icon: Barcode, end: false },
  { to: '/app/quotes', label: 'Quotes', icon: FileText, end: false },
  { to: '/app/follow-ups', label: 'Follow-ups', icon: BellRing, end: false },
  { to: '/app/reports', label: 'Reports', icon: BarChart3, end: false },
  { to: '/app/settings', label: 'Settings', icon: Settings, end: false },
]

// Mobile bottom nav shows two items flanking the center Scan button —
// Home/Quotes and Follow-ups/Reports, same set as before Scan existed.
// Settings stays reachable via the header icon (below) like it already was.
const bottomFlankItems = NAV.filter((item) => item.to !== '/app/scan' && item.to !== '/app/settings')

function NavItem({ to, label, icon: Icon, end, bottom }: (typeof NAV)[number] & { bottom?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        bottom
          ? `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${isActive ? 'text-brand' : 'text-zinc-500'}`
          : `flex items-center gap-3 rounded-xl px-4 py-3 text-base font-semibold ${isActive ? 'bg-blue-50 text-brand' : 'text-charcoal hover:bg-zinc-100'}`
      }
    >
      <Icon className={bottom ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden="true" />
      {label}
    </NavLink>
  )
}

function DemoBanner(): ReactNode {
  const { mode, exitDemo } = useAppData()
  const navigate = useNavigate()
  if (mode !== 'demo') return null
  return (
    <div className="no-print flex items-center justify-center gap-3 bg-amber-400 px-4 py-1.5 text-sm font-bold text-amber-950">
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
  const { shop, mode, signOut } = useAppData()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <header className="no-print sticky top-0 z-40 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <NavLink to="/app" className="shrink-0">
            <Logo className="text-2xl" />
          </NavLink>
          <div className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-40 truncate text-sm font-semibold text-zinc-600 sm:block">
              {shop?.name}
            </span>
            <NavLink
              to="/app/settings"
              aria-label="Settings"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 md:hidden"
            >
              <Settings className="h-5 w-5" aria-hidden="true" />
            </NavLink>
            {mode === 'production' ? (
              <button
                type="button"
                onClick={async () => {
                  await signOut()
                  navigate('/')
                }}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"
                aria-label="Sign out"
              >
                <LogOut className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-24 md:pb-10">
        <Outlet />
      </main>
      {/* Bottom navigation for phones — the primary device for shop staff. */}
      <nav
        aria-label="Main"
        className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {bottomFlankItems.slice(0, 2).map((item) => (
          <NavItem key={item.to} {...item} bottom />
        ))}
        <NavLink
          to="/app/scan"
          aria-label="Scan"
          className="flex min-h-14 flex-1 flex-col items-center justify-center"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-md">
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
