import { Button } from './Button'
import { Dialog } from './Dialog'
import { KbdChip } from './KbdChip'

interface ShortcutItem {
  label: string
  keys: string[]
}

interface ShortcutGroup {
  title: string
  items: ShortcutItem[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { label: 'Zoom to fit', keys: ['F'] },
      { label: 'Zoom to selected face', keys: ['Space'] },
      { label: 'Reset home view', keys: ['Ctrl', '1'] },
      { label: 'Show keyboard shortcuts', keys: ['?'] },
    ],
  },
  {
    title: 'Sketch',
    items: [
      { label: 'Rectangle', keys: ['R'] },
      { label: 'Circle', keys: ['C'] },
      { label: 'Line', keys: ['L'] },
      { label: 'Arc', keys: ['A'] },
      { label: 'Trim', keys: ['T'] },
      { label: 'Dimension', keys: ['D'] },
      { label: 'Horizontal', keys: ['H'] },
      { label: 'Vertical', keys: ['V'] },
      { label: 'Construction toggle', keys: ['X'] },
    ],
  },
  {
    title: 'Modeling',
    items: [
      { label: 'Extrude', keys: ['E'] },
      { label: 'Revolve', keys: ['O'] },
      { label: 'Fillet', keys: ['G'] },
      { label: 'Chamfer', keys: ['K'] },
      { label: 'Shell', keys: ['S'] },
      { label: 'Combine', keys: ['J'] },
      { label: 'Move', keys: ['M'] },
      { label: 'Construction plane', keys: ['P'] },
      { label: 'Measure', keys: ['U'] },
    ],
  },
  {
    title: 'Edit & Selection',
    items: [
      { label: 'Command search', keys: ['Ctrl', 'K'] },
      { label: 'Undo', keys: ['Ctrl', 'Z'] },
      { label: 'Redo', keys: ['Ctrl', 'Shift', 'Z'] },
      { label: 'Solids selection filter', keys: ['B'] },
      { label: 'Delete selected', keys: ['Delete'] },
      { label: 'Cancel / clear selection', keys: ['Esc'] },
    ],
  },
]

export interface ShortcutSheetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** S13. Modal sheet listing workspace keyboard shortcuts grouped by task. */
export function ShortcutSheetDialog({ open, onOpenChange }: ShortcutSheetDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Press Esc or Done to close."
      size="lg"
      footer={
        <Button data-autofocus="" variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <div className="grid max-h-[60dvh] grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title} className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-sunken p-3">
            <h3 className="text-sm font-semibold text-text">{group.title}</h3>
            <ul className="flex flex-col gap-1.5">
              {group.items.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-text-muted">{item.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.keys.map((k) => (
                      <KbdChip key={k}>{k}</KbdChip>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
