import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { resolveTenant } from '../data/tenant'
import type { TenantBranding } from '../lib/tenantDomain'

interface TenantState {
  /** The shop this domain belongs to, or null on the platform's own domain. */
  tenant: TenantBranding | null
  /** True until the lookup settles. Hold platform chrome back until it does. */
  loading: boolean
}

const TenantCtx = createContext<TenantState>({ tenant: null, loading: true })

export function TenantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TenantState>({ tenant: null, loading: true })

  useEffect(() => {
    let cancelled = false
    void resolveTenant().then((tenant) => {
      if (!cancelled) setState({ tenant, loading: false })
    })
    return () => {
      cancelled = true
    }
  }, [])

  return <TenantCtx.Provider value={state}>{children}</TenantCtx.Provider>
}

export function useTenant(): TenantState {
  return useContext(TenantCtx)
}
