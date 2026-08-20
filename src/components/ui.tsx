import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, X } from 'lucide-react'

// Small shared UI kit: big touch targets, high contrast, minimal motion.
//
// Every page inherits its look from here, so this file is where the shop's
// answer to "it looks generic" gets fixed once instead of page by page. Three
// things carry that weight:
//
//   - Elevation. Two steps (--shadow-card, --shadow-raised in index.css)
//     instead of one flat shadow on everything, so a card that sits on the
//     page and a card that floats above it read differently.
//   - A type scale with a middle. Headings used to jump from text-3xl to
//     text-base with nothing between, which is why sections all felt like the
//     same weight. PageHeader and SectionHeader occupy the missing steps.
//   - Controls that answer you. An input whose only focus feedback is a 1px
//     border color change reads unfinished; every control here gets a ring,
//     a hover, and a pressed state.

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

const buttonStyles: Record<ButtonVariant, string> = {
  // Near-black on bright copper, not white on it: ~9:1 contrast versus ~5:1,
  // and it reads like a physical amber control rather than a web button.
  primary: 'bg-brand-bright text-ink hover:bg-brand active:bg-brand hover:text-white border-transparent shadow-[var(--shadow-card)]',
  secondary: 'bg-white text-ink border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100 shadow-[var(--shadow-card)]',
  ghost: 'bg-transparent text-charcoal border-transparent hover:bg-zinc-200/60 active:bg-zinc-200',
  danger: 'bg-white text-red-700 border-red-300 hover:bg-red-50 active:bg-red-100 shadow-[var(--shadow-card)]',
  success: 'bg-green-700 text-white border-transparent hover:bg-green-800 active:bg-green-900 shadow-[var(--shadow-card)]',
}

// `active:translate-y-px` is the whole motion budget — one pixel of give on
// press, which is what makes a button feel like a button on a touchscreen
// without animating anything.
const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-xl border px-4 font-semibold transition-colors active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:active:translate-y-0 min-h-12 text-base'

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

export function Card({
  children,
  className = '',
  tone = 'default',
}: {
  children: ReactNode
  className?: string
  /**
   * `default` sits on the page. `raised` floats above it — for the one card on
   * a screen that is the point of the screen. `flush` drops the shadow for
   * cards nested inside another surface, where a second shadow just muddies
   * the edge.
   */
  tone?: 'default' | 'raised' | 'flush'
}) {
  const toneClass =
    tone === 'raised'
      ? 'shadow-[var(--shadow-raised)] border-zinc-200/80'
      : tone === 'flush'
        ? 'shadow-none'
        : 'shadow-[var(--shadow-card)]'
  return (
    <div className={`rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 print-block ${toneClass} ${className}`}>
      {children}
    </div>
  )
}

/**
 * The top of a page: title, optional one-line explanation, actions on the
 * right. Every page hand-rolled this with slightly different sizes and
 * spacing, which is most of why the app read as unfinished from screen to
 * screen. One component, one rhythm.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  /** A "back to X" link rendered above the title. */
  back?: { to: string; label: string }
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back ? (
          <Link to={back.to} className="text-sm font-semibold text-brand hover:text-brand-dark">
            &larr; {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-base text-zinc-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * A section title inside a card, optionally with a link on the right. The
 * missing middle of the type scale: bigger than body, smaller than a page
 * title, and consistent everywhere it appears.
 */
export function SectionHeader({
  title,
  action,
  note,
}: {
  title: string
  action?: ReactNode
  /** Small right-aligned qualifier — a window ("Last 60 days"), a count. */
  note?: string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
      {action ?? (note ? <span className="text-xs font-medium text-zinc-500">{note}</span> : null)}
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

/**
 * One style for every text-entry control, so a form never looks assembled from
 * parts. The focus treatment is a ring rather than a border-color swap: a 1px
 * hue change is easy to miss on a phone in a sunlit bay, and it was the single
 * biggest reason the forms read as unfinished.
 *
 * `aria-invalid` drives the error look, so a field styles itself red from the
 * same attribute that tells a screen reader it is wrong — the two can't drift
 * apart the way a separate `error` prop would let them.
 */
const controlBase =
  'w-full rounded-xl border bg-white px-3 py-3 text-base text-ink placeholder-zinc-400 transition-colors ' +
  'border-zinc-300 hover:border-zinc-400 ' +
  'focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-none ' +
  'aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-red-500/10 ' +
  'disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500'

/**
 * How a control learns it is in an errored Field.
 *
 * The alternative — every page remembering to pass `aria-invalid` next to the
 * `error` prop it already passed — is exactly the kind of duplication that
 * drifts: some forms got it, most didn't, and the ones that didn't showed a
 * red message above a control that still looked perfectly fine. Reading it
 * from the Field means the message, the red border, and what a screen reader
 * announces can never disagree.
 *
 * A control may also live outside any Field (a search box, a filter), which is
 * why the default is a valid, undescribed control rather than a thrown error.
 */
const FieldStateContext = createContext<{ invalid: boolean; errorId: string | undefined }>({
  invalid: false,
  errorId: undefined,
})

/** Props a control inherits from its Field, unless the caller set them itself. */
function useFieldProps(explicit: {
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling'
  'aria-describedby'?: string
}) {
  const { invalid, errorId } = useContext(FieldStateContext)
  return {
    'aria-invalid': explicit['aria-invalid'] ?? (invalid || undefined),
    'aria-describedby': explicit['aria-describedby'] ?? errorId,
  }
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return <input ref={ref} {...props} {...useFieldProps(props)} className={`${controlBase} ${className}`} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...props }, ref) {
    return <textarea ref={ref} {...props} {...useFieldProps(props)} className={`${controlBase} ${className}`} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', ...props }, ref) {
    return <select ref={ref} {...props} {...useFieldProps(props)} className={`${controlBase} ${className}`} />
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
  const errorId = `${useId()}-error`
  return (
    <FieldStateContext.Provider value={{ invalid: Boolean(error), errorId: error ? errorId : undefined }}>
      <div>
        <label htmlFor={htmlFor} className="mb-1.5 block text-base font-semibold text-ink">
          {label}
          {required ? <span aria-hidden="true" className="text-red-600"> *</span> : null}
        </label>
        {children}
        {hint && !error ? <p className="mt-1.5 text-sm text-zinc-500">{hint}</p> : null}
        {/* The error sits tight under its own control with an icon, rather
            than floating as another grey line that could belong to anything. */}
        {error ? (
          <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldStateContext.Provider>
  )
}

export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string
  message: string
  action?: ReactNode
  /** A lucide icon element. Given one, the state reads as a designed screen rather than a paragraph of grey text. */
  icon?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center shadow-[var(--shadow-card)]">
      {icon ? (
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-tint text-brand">
          {icon}
        </span>
      ) : null}
      <h3 className="text-lg font-bold tracking-tight text-ink">{title}</h3>
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

  // Read the latest onClose through a ref rather than putting it in the
  // effect's dependency array. Callers almost always pass an inline arrow
  // (`onClose={() => setOpen(false)}`), which gets a new identity on every
  // render of the parent — if that identity were a dependency here, typing
  // into ANY input inside the modal (which re-renders the parent on every
  // keystroke) would re-run this effect and yank focus back onto the dialog
  // shell via `ref.current?.focus()`, dropping the keystroke and closing the
  // on-screen keyboard. Depending on [open] alone means this only fires when
  // the modal actually opens/closes, not on every unrelated re-render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    // Move focus into the dialog so keyboard/screen-reader users land in it.
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`max-h-[92vh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-[var(--shadow-raised)] sm:rounded-2xl sm:p-6 ${
          resolvedSize === 'xl' ? 'sm:max-w-6xl' : resolvedSize === 'wide' ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        {/* `space-y-4` on the shell gives every modal the same internal rhythm
            without each caller remembering to add it. */}
        <div className="flex items-center justify-between gap-4 border-b border-zinc-100 pb-4">
          <h2 className="text-xl font-bold tracking-tight text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"
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
      {/* The copper "0" needs the brighter step on dark chrome — the deeper
          one is tuned for contrast against white and disappears here. */}
      <span className={light ? 'text-brand-bright' : 'text-brand'}>0</span>
      <span className={light ? 'text-white' : 'text-ink'}>GAUGE</span>
      <span className={`ml-1.5 text-[0.6em] font-bold tracking-widest uppercase ${light ? 'text-zinc-300' : 'text-zinc-500'}`}>
        Recovery
      </span>
    </span>
  )
}
