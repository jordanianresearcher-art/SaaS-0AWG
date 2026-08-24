import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { LogOut, Package, Plus, Search, ShieldCheck, Store, Trash2 } from 'lucide-react'
import { useAdminRepo, useAppData } from '../data/AppDataContext'
import type { AdminGlobalProduct, AdminProductStock, AdminShopSummary } from '../data/adminRepository'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Logo, Modal } from '../components/ui'
import { formatCurrency, formatDate } from '../lib/format'

const schema = z.object({
  shopName: z.string().min(2, 'Enter a shop name'),
  ownerEmail: z.string().email('Enter a valid owner email'),
})
type FormValues = z.infer<typeof schema>

export default function AdminPage() {
  const adminRepo = useAdminRepo()
  const { signOut } = useAppData()
  const toast = useToast()
  const [shops, setShops] = useState<AdminShopSummary[] | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [result, setResult] = useState<{ shopName: string; emailSent: boolean; inviteLink?: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<'shops' | 'products'>('shops')

  const load = useCallback(async () => {
    setShops(await adminRepo.listShops())
  }, [adminRepo])

  useEffect(() => {
    void load()
  }, [load])

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const onSubmit = async (values: FormValues) => {
    try {
      const created = await adminRepo.createShop(values)
      await load()
      reset()
      setCreateOpen(false)
      setResult({ shopName: values.shopName, emailSent: created.emailSent, inviteLink: created.inviteLink })
    } catch (err) {
      console.error('createShop failed', err)
      toast('error', err instanceof Error ? err.message : 'Could not create the shop.')
    }
  }

  const toggleActive = async (shop: AdminShopSummary) => {
    setBusyId(shop.id)
    try {
      await adminRepo.setShopActive(shop.id, !shop.active)
      await load()
      toast('success', shop.active ? `${shop.name} suspended.` : `${shop.name} reactivated.`)
    } catch (err) {
      console.error('setShopActive failed', err)
      toast('error', err instanceof Error ? err.message : 'Could not update that shop. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <Link to="/"><Logo className="text-2xl" /></Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm font-semibold text-zinc-500 sm:inline">Platform Admin</span>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-6 flex gap-2" role="tablist" aria-label="Admin sections">
          {(['shops', 'products'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-11 rounded-xl border-2 px-4 text-base font-semibold capitalize transition-colors ${
                tab === t ? 'border-brand bg-brand-tint text-brand' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {t === 'products' ? 'Master products' : 'Shops'}
            </button>
          ))}
        </div>

        {tab === 'products' ? <MasterProductsTab /> : null}
        <div className={tab === 'shops' ? '' : 'hidden'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-ink">Shops</h1>
            <p className="mt-1 text-base text-zinc-600">Every shop tenant on 0Gauge Recovery.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-5 w-5" aria-hidden="true" /> New shop
          </Button>
        </div>

        <div className="mt-6">
          {shops === null ? (
            <LoadingBlock label="Loading shops…" />
          ) : shops.length === 0 ? (
            <EmptyState
              title="No shops yet"
              message="Create the first shop to get a new customer up and running."
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="h-5 w-5" aria-hidden="true" /> New shop
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {shops.map((shop) => (
                <li key={shop.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-tint text-brand">
                        <Store className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-lg font-bold text-ink">{shop.name}</p>
                        <p className="text-sm text-zinc-500">
                          Created {formatDate(shop.createdAt)} · {shop.memberCount} team member
                          {shop.memberCount === 1 ? '' : 's'} · {shop.quoteCount} quote
                          {shop.quoteCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={shop.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}>
                        {shop.active ? 'Active' : 'Suspended'}
                      </Badge>
                      <Button
                        variant={shop.active ? 'danger' : 'secondary'}
                        disabled={busyId === shop.id}
                        onClick={() => void toggleActive(shop)}
                      >
                        {shop.active ? 'Suspend' : 'Reactivate'}
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      </main>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a new shop">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Shop name" htmlFor="admin-shop-name" error={errors.shopName?.message} required>
            <Input id="admin-shop-name" {...register('shopName')} placeholder="Big Tex Audio" />
          </Field>
          <Field
            label="Owner email"
            htmlFor="admin-owner-email"
            error={errors.ownerEmail?.message}
            hint="They'll get a sign-in link and land straight in their new shop."
            required
          >
            <Input id="admin-owner-email" type="email" {...register('ownerEmail')} />
          </Field>
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Creating…' : 'Create shop and invite owner'}
          </Button>
        </form>
      </Modal>

      <Modal open={result !== null} onClose={() => setResult(null)} title="Shop created">
        {result ? (
          result.emailSent ? (
            <p className="text-base text-zinc-700">
              <strong>{result.shopName}</strong> is ready — we emailed the owner a sign-in link.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-base text-zinc-700">
                <strong>{result.shopName}</strong> is ready, but we couldn&apos;t email the owner automatically.
                Send them this sign-in link yourself:
              </p>
              {result.inviteLink ? (
                <div className="flex items-center gap-2">
                  <Input readOnly value={result.inviteLink} onFocus={(e) => e.currentTarget.select()} />
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(result.inviteLink!)
                      toast('success', 'Link copied.')
                    }}
                  >
                    Copy
                  </Button>
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </Modal>
    </div>
  )
}

/**
 * The shared product catalog, as the operator sees it.
 *
 * Two jobs, and they pull in opposite directions. Curation is about the
 * product record — fix a mangled model number once and every shop gets the fix.
 * Stock is about the shops — where is this thing, right now. Keeping them on
 * one screen means an operator can answer "who has a CompR 12 in stock" without
 * changing context, which is the actual question they open this to ask.
 *
 * Editing is a modal rather than inline fields: a record here is shared by
 * every shop, and a change that lands on a keystroke is the wrong shape for
 * something with that blast radius.
 */
function MasterProductsTab() {
  const adminRepo = useAdminRepo()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<AdminGlobalProduct[] | null>(null)
  const [editing, setEditing] = useState<AdminGlobalProduct | null>(null)

  const load = useCallback(
    async (q: string) => {
      try {
        setRows(await adminRepo.listGlobalProducts(q))
      } catch (err) {
        console.error('listGlobalProducts failed', err)
        toast('error', err instanceof Error ? err.message : 'Could not load the product list.')
        setRows([])
      }
    },
    [adminRepo, toast],
  )

  useEffect(() => {
    // Debounced: this runs on every keystroke and hits a LIKE across the
    // shared table.
    const t = setTimeout(() => void load(query), 300)
    return () => clearTimeout(t)
  }, [query, load])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-ink">Master products</h1>
          <p className="mt-1 text-base text-zinc-600">
            Every product any shop has identified. Fix one here and every shop gets the fix.
          </p>
        </div>
      </div>

      <div className="relative mt-5">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brand, model, or barcode…"
          aria-label="Search master products"
          className="pl-10"
        />
      </div>

      <div className="mt-4">
        {rows === null ? (
          <LoadingBlock label="Loading products…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={query ? 'Nothing matches that' : 'The shared list is empty'}
            message={
              query
                ? 'Try a brand or a model number.'
                : 'It fills up on its own as shops identify products. Nothing to do here yet.'
            }
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left hover:border-zinc-300"
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-zinc-200 object-contain" />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400">
                      <Package className="h-6 w-6" aria-hidden="true" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-base font-bold text-ink">
                        {[p.brand, p.model].filter(Boolean).join(' ') || p.name || 'Unnamed'}
                      </span>
                      {p.verified ? (
                        <Badge className="shrink-0 bg-green-100 text-green-800" title="Curated — shops can no longer change it">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified
                        </Badge>
                      ) : null}
                    </span>
                    <span className="block truncate text-sm text-zinc-500">
                      {p.barcode ? `${p.barcode} · ` : ''}
                      {p.name || 'No description'}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {p.referencePriceCents !== null ? (
                      <span className="block text-sm font-semibold text-ink">{formatCurrency(p.referencePriceCents)}</span>
                    ) : null}
                    {/* The trust signal: several shops independently landing on
                        the same record is stronger evidence than any one of
                        them. Only worth showing once it means something. */}
                    {p.contributionCount > 1 ? (
                      <span className="block text-xs text-zinc-500">{p.contributionCount} shops</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Product" size="wide">
        {editing ? (
          <ProductEditor
            product={editing}
            onDone={async () => {
              setEditing(null)
              await load(query)
            }}
          />
        ) : null}
      </Modal>
    </div>
  )
}

function ProductEditor({ product, onDone }: { product: AdminGlobalProduct; onDone: () => void }) {
  const adminRepo = useAdminRepo()
  const toast = useToast()
  const [brand, setBrand] = useState(product.brand ?? '')
  const [model, setModel] = useState(product.model ?? '')
  const [name, setName] = useState(product.name)
  const [barcode, setBarcode] = useState(product.barcode ?? '')
  const [saving, setSaving] = useState(false)
  const [stock, setStock] = useState<AdminProductStock[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void adminRepo
      .globalProductStock(product.id)
      .then((s) => !cancelled && setStock(s))
      .catch((err) => {
        // Stock is a bonus panel; a product that can still be edited beats a
        // modal that fails to open because one query did.
        console.error('globalProductStock failed', err)
        if (!cancelled) setStock([])
      })
    return () => {
      cancelled = true
    }
  }, [adminRepo, product.id])

  const save = async () => {
    setSaving(true)
    try {
      await adminRepo.updateGlobalProduct(product.id, {
        brand: brand.trim() || null,
        model: model.trim() || null,
        name: name.trim(),
        barcode: barcode.trim() || null,
      })
      toast('success', 'Updated for every shop.')
      onDone()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save that.')
    } finally {
      setSaving(false)
    }
  }

  const toggleVerified = async () => {
    setSaving(true)
    try {
      await adminRepo.setGlobalProductVerified(product.id, !product.verified)
      toast('success', product.verified ? 'No longer verified.' : 'Verified — shops can no longer change it.')
      onDone()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save that.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('Remove this product from the shared list? Shops keep their own copies.')) return
    setSaving(true)
    try {
      await adminRepo.deleteGlobalProduct(product.id)
      toast('success', 'Removed from the shared list.')
      onDone()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not remove that.')
    } finally {
      setSaving(false)
    }
  }

  const totalUnits = (stock ?? []).reduce((sum, s) => sum + s.quantityOnHand, 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand" htmlFor="gp-brand">
          <Input id="gp-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </Field>
        <Field label="Model" htmlFor="gp-model">
          <Input id="gp-model" value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
      </div>
      <Field label="Description" htmlFor="gp-name" hint="The part after the brand and model — specs, size, finish.">
        <Input id="gp-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Barcode" htmlFor="gp-barcode" hint="Manufacturer barcodes only. Store-assigned codes are never shared.">
        <Input id="gp-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
      </Field>

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-base font-bold text-ink">
          In stock across shops{stock !== null ? ` · ${totalUnits} units` : ''}
        </p>
        {stock === null ? (
          <p className="mt-2 text-sm text-zinc-500">Checking…</p>
        ) : stock.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">No shop is carrying this right now.</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-200">
            {stock.map((s) => (
              <li key={s.shopId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate font-semibold text-ink">{s.shopName}</span>
                <span className="shrink-0 text-zinc-600">
                  {s.quantityOnHand} on hand
                  {s.defaultPriceCents !== null ? ` · ${formatCurrency(s.defaultPriceCents)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save for every shop'}
        </Button>
        <Button variant="secondary" disabled={saving} onClick={() => void toggleVerified()}>
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          {product.verified ? 'Unverify' : 'Verify'}
        </Button>
        <Button variant="danger" disabled={saving} onClick={() => void remove()}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
        </Button>
      </div>
    </div>
  )
}
