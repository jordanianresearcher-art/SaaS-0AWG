import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { LogOut, Plus, Store } from 'lucide-react'
import { useAdminRepo, useAppData } from '../data/AppDataContext'
import type { AdminShopSummary } from '../data/adminRepository'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Logo, Modal } from '../components/ui'
import { formatDate } from '../lib/format'

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
