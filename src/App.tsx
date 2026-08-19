import { Navigate, Route, Routes } from 'react-router-dom'
import { useAppData } from './data/AppDataContext'
import { LoadingBlock, EmptyState } from './components/ui'
import { AppLayout } from './layouts/AppLayout'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import AuthConfirmPage from './pages/AuthConfirmPage'
import DemoEntryPage from './pages/DemoEntryPage'
import JoinPage from './pages/JoinPage'
import PublicQuotePage from './pages/PublicQuotePage'
import BookingPage from './pages/BookingPage'
import BookingManagePage from './pages/BookingManagePage'
import OnboardingPage from './pages/OnboardingPage'
import DashboardPage from './pages/app/DashboardPage'
import ScanWorkspacePage from './pages/app/ScanWorkspacePage'
import CalendarPage from './pages/app/CalendarPage'
import InventoryPage from './pages/app/InventoryPage'
import InventoryDetailPage from './pages/app/InventoryDetailPage'
import NewInventoryItemPage from './pages/app/NewInventoryItemPage'
import InventoryCheckPage from './pages/app/InventoryCheckPage'
import LabelPrintPage from './pages/app/LabelPrintPage'
import QuotesPage from './pages/app/QuotesPage'
import NewQuotePage from './pages/app/NewQuotePage'
import QuoteDetailPage from './pages/app/QuoteDetailPage'
import FollowUpsPage from './pages/app/FollowUpsPage'
import PilotReportPage from './pages/app/PilotReportPage'
import SettingsPage from './pages/app/SettingsPage'
import AdminPage from './pages/AdminPage'

function RequireShop({ children }: { children: React.ReactNode }) {
  const { mode, repo, authReady, session, needsOnboarding } = useAppData()
  if (mode === 'demo' && repo) return <>{children}</>
  if (!authReady) return <LoadingBlock label="Checking your session…" />
  if (session && needsOnboarding) return <Navigate to="/onboarding" replace />
  if (mode === 'production' && repo) return <>{children}</>
  if (session) return <LoadingBlock label="Loading your shop…" />
  return <Navigate to="/login" replace />
}

// Quotes, follow-ups, reports, and settings carry customer/revenue data —
// off limits to a shared 'inventory' device (see migration 0017; RLS is
// the real enforcement, this is just so a wrong URL reads as "not
// available" instead of an empty/broken screen).
function RequireFullAccess({ children }: { children: React.ReactNode }) {
  const { role } = useAppData()
  if (role === 'inventory') {
    return (
      <EmptyState
        title="Not available on this device"
        message="This device is signed in for inventory only. Ask a shop owner or manager to sign in with their account for this page."
      />
    )
  }
  return <>{children}</>
}

function DashboardOrInventory() {
  const { role } = useAppData()
  return role === 'inventory' ? <Navigate to="/app/inventory" replace /> : <DashboardPage />
}

function RequirePlatformAdmin({ children }: { children: React.ReactNode }) {
  const { authReady, session, isPlatformAdmin } = useAppData()
  if (!authReady) return <LoadingBlock label="Checking your session…" />
  if (!session) return <Navigate to="/login" replace />
  if (!isPlatformAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/auth/confirm" element={<AuthConfirmPage />} />
      <Route path="/demo" element={<DemoEntryPage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/q/:publicToken" element={<PublicQuotePage />} />
      <Route path="/book/:shopSlug" element={<BookingPage />} />
      <Route path="/booking/:publicToken" element={<BookingManagePage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route
        path="/app"
        element={
          <RequireShop>
            <AppLayout />
          </RequireShop>
        }
      >
        <Route index element={<DashboardOrInventory />} />
        <Route path="scan" element={<ScanWorkspacePage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="inventory/new" element={<NewInventoryItemPage />} />
        <Route path="inventory/check" element={<InventoryCheckPage />} />
        <Route path="inventory/labels" element={<LabelPrintPage />} />
        <Route path="inventory/:itemId" element={<InventoryDetailPage />} />
        <Route
          path="calendar"
          element={
            <RequireFullAccess>
              <CalendarPage />
            </RequireFullAccess>
          }
        />
        <Route
          path="quotes"
          element={
            <RequireFullAccess>
              <QuotesPage />
            </RequireFullAccess>
          }
        />
        <Route
          path="quotes/new"
          element={
            <RequireFullAccess>
              <NewQuotePage />
            </RequireFullAccess>
          }
        />
        <Route
          path="quotes/:quoteId"
          element={
            <RequireFullAccess>
              <QuoteDetailPage />
            </RequireFullAccess>
          }
        />
        <Route
          path="follow-ups"
          element={
            <RequireFullAccess>
              <FollowUpsPage />
            </RequireFullAccess>
          }
        />
        <Route
          path="report"
          element={
            <RequireFullAccess>
              <PilotReportPage />
            </RequireFullAccess>
          }
        />
        {/* The Reports page is gone — its analytics live on Home now, and the
            printable pilot report moved to /app/report. Anyone with the old
            page bookmarked lands on the printable report rather than a 404
            that bounces them out to the marketing site. */}
        <Route path="reports" element={<Navigate to="/app/report" replace />} />
        <Route
          path="settings"
          element={
            <RequireFullAccess>
              <SettingsPage />
            </RequireFullAccess>
          }
        />
      </Route>
      <Route
        path="/admin"
        element={
          <RequirePlatformAdmin>
            <AdminPage />
          </RequirePlatformAdmin>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
