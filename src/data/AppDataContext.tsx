import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import type { MembershipRole, QuoteBundle, Shop } from '../types'
import type { DataRepository } from './repository'
import type { AdminRepository } from './adminRepository'
import { DemoRepository } from './demoRepository'
import { SupabaseRepository } from './supabaseRepository'
import { SupabaseAdminRepository } from './adminRepository'
import { getSupabase } from './supabaseClient'
import { env, supabaseConfigured } from '../lib/env'

const MODE_KEY = '0gauge-mode'

export type AppMode = 'demo' | 'production' | null

interface AppDataValue {
  mode: AppMode
  /** Null until a mode is active (demo entered, or signed in with a shop). */
  repo: DataRepository | null
  shop: Shop | null
  /**
   * This user's role on the current shop. 'inventory' is a shared-device
   * member (joined via /join with a shop access code, see migration
   * 0017) — RLS already walls it off from quotes/customers/reporting at
   * the database layer; this drives the matching UI restriction (nav,
   * routing) so a wrong URL shows "not available" instead of an empty or
   * broken screen. Demo mode is always 'owner' (full access).
   */
  role: MembershipRole | null
  bundles: QuoteBundle[]
  loading: boolean
  loadError: string | null
  session: Session | null
  authReady: boolean
  needsOnboarding: boolean
  isPlatformAdmin: boolean
  adminRepo: AdminRepository | null
  enterDemo: () => void
  exitDemo: () => void
  resetDemo: () => void
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  completeOnboarding: (shopId: string) => void
  /** Called by /join right after join_shop_with_access_code succeeds — mirrors completeOnboarding but for the low-privilege shared-device role. */
  completeJoin: (shopId: string) => void
}

const AppDataContext = createContext<AppDataValue | null>(null)

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AppMode>(() =>
    env.demoModeEnabled && localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : null,
  )
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabaseConfigured)
  const [shopId, setShopId] = useState<string | null>(null)
  const [role, setRole] = useState<MembershipRole | null>(null)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [shop, setShop] = useState<Shop | null>(null)
  const [bundles, setBundles] = useState<QuoteBundle[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [demoRepo, setDemoRepo] = useState<DemoRepository | null>(() =>
    env.demoModeEnabled && localStorage.getItem(MODE_KEY) === 'demo' ? new DemoRepository() : null,
  )

  // Track the Supabase session and the user's shop membership.
  useEffect(() => {
    if (!supabaseConfigured) return
    const supabase = getSupabase()
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabaseConfigured || !session) {
      setShopId(null)
      setRole(null)
      setNeedsOnboarding(false)
      return
    }
    let cancelled = false
    getSupabase()
      .from('shop_memberships')
      .select('shop_id, role')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data?.shop_id) {
          setShopId(data.shop_id)
          setRole(data.role as MembershipRole)
          setNeedsOnboarding(false)
          setMode('production')
        } else {
          setNeedsOnboarding(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [session])

  // Platform-admin status is orthogonal to shop membership — a platform
  // admin may or may not also belong to a shop.
  useEffect(() => {
    if (!supabaseConfigured || !session) {
      setIsPlatformAdmin(false)
      return
    }
    let cancelled = false
    getSupabase()
      .from('platform_admins')
      .select('user_id')
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsPlatformAdmin(Boolean(data))
      })
    return () => {
      cancelled = true
    }
  }, [session])

  const adminRepo: AdminRepository | null = useMemo(() => {
    if (!isPlatformAdmin || !supabaseConfigured) return null
    return new SupabaseAdminRepository(getSupabase())
  }, [isPlatformAdmin])

  const repo: DataRepository | null = useMemo(() => {
    if (mode === 'demo') return demoRepo
    if (mode === 'production' && session && shopId) {
      return new SupabaseRepository(getSupabase(), shopId)
    }
    return null
  }, [mode, demoRepo, session, shopId])

  const refresh = useCallback(async () => {
    if (!repo) return
    setLoading(true)
    setLoadError(null)
    try {
      const [nextShop, nextBundles] = await Promise.all([repo.getShop(), repo.listQuoteBundles()])
      setShop(nextShop)
      setBundles(nextBundles)
    } catch {
      setLoadError('Could not load your shop data. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [repo])

  useEffect(() => {
    if (repo) void refresh()
    else {
      setShop(null)
      setBundles([])
    }
  }, [repo, refresh])

  const enterDemo = useCallback(() => {
    localStorage.setItem(MODE_KEY, 'demo')
    setDemoRepo(new DemoRepository())
    setMode('demo')
  }, [])

  const exitDemo = useCallback(() => {
    localStorage.removeItem(MODE_KEY)
    setDemoRepo(null)
    setMode(null)
  }, [])

  const resetDemo = useCallback(() => {
    if (demoRepo) {
      demoRepo.resetDemoData()
      void refresh()
    }
  }, [demoRepo, refresh])

  const signOut = useCallback(async () => {
    if (supabaseConfigured) await getSupabase().auth.signOut()
    setMode((m) => (m === 'production' ? null : m))
    setShopId(null)
    setRole(null)
  }, [])

  const completeOnboarding = useCallback((newShopId: string) => {
    setShopId(newShopId)
    setRole('owner')
    setNeedsOnboarding(false)
    setMode('production')
  }, [])

  const completeJoin = useCallback((newShopId: string) => {
    setShopId(newShopId)
    setRole('inventory')
    setNeedsOnboarding(false)
    setMode('production')
  }, [])

  const value: AppDataValue = {
    mode,
    repo,
    shop,
    // Demo mode has no real membership row — always full access.
    role: mode === 'demo' ? 'owner' : role,
    bundles,
    loading,
    loadError,
    session,
    authReady,
    needsOnboarding,
    isPlatformAdmin,
    adminRepo,
    enterDemo,
    exitDemo,
    resetDemo,
    refresh,
    signOut,
    completeOnboarding,
    completeJoin,
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider')
  return ctx
}

/** For screens that are only rendered once a mode is active. */
export function useRepo(): DataRepository {
  const { repo } = useAppData()
  if (!repo) throw new Error('No active data repository')
  return repo
}

/** For screens rendered only behind RequirePlatformAdmin. */
export function useAdminRepo(): AdminRepository {
  const { adminRepo } = useAppData()
  if (!adminRepo) throw new Error('No active admin repository')
  return adminRepo
}
