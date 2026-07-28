import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'

// Small shared UI kit: big touch targets, high contrast, minimal motion.

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark border-transparent',
  secondary: 'bg-white text-ink border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50',
  ghost: 'bg-transparent text-charcoal border-transparent hover:bg-zinc-100',
  danger: 'bg-white text-red-700 border-red-300 hover:bg-red-50',
  success: 'bg-green-700 text-white border-transparent hover:bg-green-800',
}

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-xl border px-4 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-12 text-base'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type="button" {...props} className={`${buttonBase} ${buttonStyles[variant]} ${className}`} />
}

export function LinkButton({
  variant = 'primary',
  to,
  className = '',
  children,
}: {
  variant?: ButtonVariant
  to: string
  className?: string
  children: ReactNode
}) {
  return (
    <Link to={to} className={`${buttonBase} ${buttonStyles[variant]} ${className}`}>
      {children}
    </Link>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm print-block ${className}`}>
      {children}
    </div>
  )
}

export function Badge({
  children,
  className = '',
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={`w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-base text-ink placeholder-zinc-400 focus:border-brand ${className}`}
      />
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...props }, ref) {
    return (
      <textarea
        ref={ref}
        {...props}
        className={`w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-base text-ink placeholder-zinc-400 focus:border-brand ${className}`}
      />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', ...props }, ref) {
    return (
      <select
        ref={ref}
        {...props}
        className={`w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-base text-ink focus:border-brand ${className}`}
      />
    )
  },
)

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-base font-semibold text-ink">
        {label}
        {required ? <span aria-hidden="true" className="text-red-600"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-sm text-zinc-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-base text-zinc-600">{message}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-zinc-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-brand" aria-hidden="true" />
      <span className="text-base font-medium">{label}</span>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  size,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** @deprecated use `size="wide"` instead — kept so existing callers don't need to change. */
  wide?: boolean
  size?: 'default' | 'wide' | 'xl'
}) {
  const resolvedSize = size ?? (wide ? 'wide' : 'default')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Move focus into the dialog so keyboard/screen-reader users land in it.
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl ${
          resolvedSize === 'xl' ? 'sm:max-w-6xl' : resolvedSize === 'wide' ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Logo({ className = '', light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex items-baseline gap-0.5 font-black tracking-tight ${className}`}>
      <span className="text-brand">0</span>
      <span className={light ? 'text-white' : 'text-ink'}>GAUGE</span>
      <span className={`ml-1.5 text-[0.6em] font-bold tracking-widest uppercase ${light ? 'text-zinc-300' : 'text-zinc-500'}`}>
        Recovery
      </span>
    </span>
  )
}
