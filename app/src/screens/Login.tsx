import { LogIn } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'
import { LinkButton } from './LinkButton'

/** S01 stub. There are no accounts yet; everything lives in this browser. */
export function Login() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <EmptyState
        icon={<LogIn strokeWidth={1.75} />}
        title="Sign in"
        description="Sign-in arrives with cloud sync. Your projects are saved in this browser."
        action={<LinkButton href="/" variant="primary">Back to projects</LinkButton>}
      />
    </main>
  )
}
