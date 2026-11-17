import { cn } from './cn'

export type ConstraintKind =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'equal'
  | 'midpoint'
  | 'concentric'
  | 'symmetric'
  | 'fixed'

export type ConstraintState = 'default' | 'hover' | 'selected' | 'conflict'

const glyphs: Record<ConstraintKind, React.ReactNode> = {
  coincident: <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />,
  horizontal: <path d="M5 4.5v7M11 4.5v7M5 8h6" />,
  vertical: <path d="M4.5 4.5L8 11.5l3.5-7" />,
  parallel: <path d="M6 11.5l2.5-7M9.5 11.5l2.5-7" />,
  perpendicular: <path d="M3.5 11.5h9M8 11.5v-7" />,
  tangent: (
    <>
      <circle cx="8" cy="6.5" r="3" />
      <path d="M3.5 11.5h9" />
    </>
  ),
  equal: <path d="M4.5 6.5h7M4.5 9.5h7" />,
  midpoint: (
    <>
      <path d="M3 8h10M8 5v6" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    </>
  ),
  concentric: (
    <>
      <circle cx="8" cy="8" r="1.8" />
      <circle cx="8" cy="8" r="4.5" />
    </>
  ),
  symmetric: (
    <>
      <path d="M8 3v10" strokeDasharray="1.5 1.5" />
      <circle cx="4.6" cy="8" r="1.1" fill="currentColor" />
      <circle cx="11.4" cy="8" r="1.1" fill="currentColor" />
    </>
  ),
  fixed: (
    <>
      <rect x="4.5" y="7.5" width="7" height="5" rx="1" />
      <path d="M6 7.5V6a2 2 0 0 1 4 0v1.5" />
    </>
  ),
}

const stateClass: Record<ConstraintState, string> = {
  default: 'text-text-muted stroke-border fill-surface-raised',
  hover: 'text-text stroke-accent fill-surface-raised',
  selected: 'text-accent stroke-accent fill-accent-subtle',
  conflict: 'text-sketch-conflict stroke-sketch-conflict fill-surface-raised',
}

export interface ConstraintGlyphProps {
  kind: ConstraintKind
  state?: ConstraintState
  /** 16 is the in-sketch size; larger sizes are for previews. */
  size?: number
  className?: string
}

/** SVG-only preview of the sketch overlay badge (no three.js). */
export function ConstraintGlyph({ kind, state = 'default', size = 16, className }: ConstraintGlyphProps) {
  return (
    <svg
      role="img"
      aria-label={`${kind} constraint${state === 'conflict' ? ', conflicting' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn(stateClass[state], className)}
    >
      <rect x="0.5" y="0.5" width="15" height="15" rx="7.5" strokeWidth="1" />
      <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
        {glyphs[kind]}
      </g>
    </svg>
  )
}
