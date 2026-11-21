import { Component } from 'react'
import type { ReactNode } from 'react'
import { recordError } from './errorLog'

/** Logs render errors locally, then shows a plain fallback with a way to report it. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    recordError('react', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg p-4 text-center text-text">
        <h1 className="text-xl">Something went wrong</h1>
        <p className="max-w-[48ch] text-base text-text-muted">
          Your projects are saved in this browser and were not touched. Reload to carry on. If it keeps happening, you can send us a report from the support page.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="touch-hit h-8 rounded-md bg-accent px-3 text-base font-medium text-on-accent hover:bg-accent-hover"
            onClick={() => location.reload()}
          >
            Reload
          </button>
          <a
            href="#/support"
            onClick={() => this.setState({ failed: false })}
            className="touch-hit inline-flex h-8 items-center rounded-md border border-border bg-surface-raised px-3 text-base font-medium text-text hover:bg-surface-sunken"
          >
            Report a problem
          </a>
        </div>
      </main>
    )
  }
}
