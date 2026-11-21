import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { LinkButton } from './LinkButton'

/** Shared frame for the plain text pages (privacy, support): skip link, header, one h1, footer links. */
export function InfoPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
        className="absolute left-2 top-2 z-10 -translate-y-16 rounded-md bg-surface-raised px-3 py-2 text-text focus:translate-y-0"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex h-(--layout-topbar-h) w-full max-w-(--layout-dashboard-max) items-center justify-between px-4">
          <Link href="/welcome" className="rounded-sm text-lg font-semibold">
            3DParter
          </Link>
          <LinkButton href="/">Open projects</LinkButton>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-(--layout-dashboard-max) flex-col gap-6 px-4 py-8 outline-none">
        <div className="flex max-w-[65ch] flex-col gap-3">
          <h1 className="text-display font-bold text-text">{title}</h1>
          {intro ? <div className="text-lg text-text-muted">{intro}</div> : null}
        </div>
        <div className="flex max-w-[65ch] flex-col gap-6">{children}</div>
      </main>
      <footer className="border-t border-border">
        <nav aria-label="Footer" className="mx-auto flex w-full max-w-(--layout-dashboard-max) flex-wrap gap-x-4 gap-y-1 px-4 py-4 text-sm text-text-muted">
          <Link href="/welcome" className="underline">
            Home
          </Link>
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          <Link href="/support" className="underline">
            Support
          </Link>
        </nav>
      </footer>
    </div>
  )
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
      <h2 id={`${id}-title`} className="text-xl font-semibold text-text">
        {title}
      </h2>
      {children}
    </section>
  )
}
