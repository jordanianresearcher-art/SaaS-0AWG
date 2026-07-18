import { Navigate, Route, Routes } from 'react-router-dom'
import { useAppData } from './data/AppDataContext'
import { LoadingBlock } from './components/ui'
import { AppLayout } from './layouts/AppLayout'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import DemoEntryPage from './pages/DemoEntryPage'
import PublicQuotePage from './pages/PublicQuotePage'
import OnboardingPage from './pages/OnboardingPage'
import DashboardPage from './pages/app/DashboardPage'
import QuotesPage from './pages/app/QuotesPage'
import NewQuotePage from './pages/app/NewQuotePage'
import QuoteDetailPage from './pages/app/QuoteDetailPage'
import FollowUpsPage from './pages/app/FollowUpsPage'
import ReportsPage from './pages/app/ReportsPage'
import SettingsPage from './pages/app/SettingsPage'

function RequireShop({ children }: { children: React.ReactNode }) {
  const { mode, repo, authReady, session, needsOnboarding } = useAppData()
  if (mode === 'demo' && repo) return <>{children}</>
  if (!authReady) return <LoadingBlock label="Checking your session…" />
  if (session && needsOnboarding) return <Navigate to="/onboarding" replace />
  if (mode === 'production' && repo) return <>{children}</>
  if (session) return <LoadingBlock label="Loading your shop…" />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/demo" element={<DemoEntryPage />} />
      <Route path="/q/:publicToken" element={<PublicQuotePage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route
        path="/app"
        element={
          <RequireShop>
            <AppLayout />
          </RequireShop>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="quotes/new" element={<NewQuotePage />} />
        <Route path="quotes/:quoteId" element={<QuoteDetailPage />} />
        <Route path="follow-ups" element={<FollowUpsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
