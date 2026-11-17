import { FileQuestion } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'
import { LinkButton } from './LinkButton'

export function NotFound({ title = 'Page not found', description = 'That address does not lead anywhere.' }: { title?: string; description?: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <EmptyState
        icon={<FileQuestion strokeWidth={1.75} />}
        title={title}
        description={description}
        action={<LinkButton href="/" variant="primary">Go to projects</LinkButton>}
      />
    </main>
  )
}
