import { cn } from './cn'

export type DimensionKind = 'linear' | 'horizontal' | 'vertical' | 'radius' | 'diameter' | 'angle'
export type DimensionState = 'driving' | 'driven' | 'editing' | 'conflict'

export interface DimensionLabelProps {
  kind: DimensionKind
  /** Number with unit, e.g. "40 mm". Radius/diameter/angle prefixes are added here. */
  value: string
  state?: DimensionState
  className?: string
}

/** Small filled arrowhead pointing along `angle` degrees (0 = right) with its tip at (x, y). */
function Arrow({ x, y, angle, cls }: { x: number; y: number; angle: number; cls: string }) {
  return <path d="M0 0l-8 -3v6z" transform={`translate(${x} ${y}) rotate(${angle})`} className={cls} stroke="none" />
}

const prefix: Partial<Record<DimensionKind, string>> = { radius: 'R ', diameter: 'Ø ' }

/** SVG-only preview of a sketch dimension: leader lines in the dimension colour and a value pill. */
export function DimensionLabel({ kind, value, state = 'driving', className }: DimensionLabelProps) {
  const conflict = state === 'conflict'
  const line = conflict ? 'stroke-sketch-conflict' : 'stroke-dimension'
  const fill = conflict ? 'fill-sketch-conflict' : 'fill-dimension'
  const text = `${prefix[kind] ?? ''}${value}`
  const shown = state === 'driven' ? `(${text})` : text
  const pillW = Math.max(48, shown.length * 7.5 + 16)

  const pill = (cx: number, cy: number) => (
    <g>
      <rect
        x={cx - pillW / 2}
        y={cy - 11}
        width={pillW}
        height={22}
        rx={11}
        className={cn(
          'fill-surface-raised',
          state === 'editing' ? 'stroke-accent' : conflict ? 'stroke-sketch-conflict' : 'stroke-border',
        )}
        strokeWidth={state === 'editing' ? 2 : 1}
      />
      <text
        x={cx}
        y={cy + 4.5}
        textAnchor="middle"
        className={cn(
          'font-sans text-[13px] stroke-none',
          conflict ? 'fill-sketch-conflict' : state === 'driven' ? 'fill-text-muted' : 'fill-text',
        )}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {shown}
        {state === 'editing' ? '|' : ''}
      </text>
    </g>
  )

  let geometry: React.ReactNode
  switch (kind) {
    case 'horizontal':
      geometry = (
        <>
          <path d="M20 30v50M180 30v50M20 62h160" className={line} fill="none" />
          <Arrow x={20} y={62} angle={180} cls={fill} />
          <Arrow x={180} y={62} angle={0} cls={fill} />
          {pill(100, 62)}
        </>
      )
      break
    case 'vertical':
      geometry = (
        <>
          <path d="M70 12h40M70 88h40M90 12v76" className={line} fill="none" />
          <Arrow x={90} y={12} angle={-90} cls={fill} />
          <Arrow x={90} y={88} angle={90} cls={fill} />
          {pill(90, 50)}
        </>
      )
      break
    case 'linear':
      geometry = (
        <g transform="rotate(-14 100 50)">
          <path d="M20 30v50M180 30v50M20 62h160" className={line} fill="none" />
          <Arrow x={20} y={62} angle={180} cls={fill} />
          <Arrow x={180} y={62} angle={0} cls={fill} />
          {pill(100, 62)}
        </g>
      )
      break
    case 'radius':
      geometry = (
        <>
          <circle cx="70" cy="50" r="34" fill="none" className="stroke-sketch-construction" strokeDasharray="4 3" />
          <path d="M70 50L94 26" className={line} fill="none" />
          <Arrow x={94} y={26} angle={-45} cls={fill} />
          {pill(138, 22)}
        </>
      )
      break
    case 'diameter':
      geometry = (
        <>
          <circle cx="100" cy="50" r="38" fill="none" className="stroke-sketch-construction" strokeDasharray="4 3" />
          <path d="M72 77L128 23" className={line} fill="none" />
          <Arrow x={72} y={77} angle={135} cls={fill} />
          <Arrow x={128} y={23} angle={-45} cls={fill} />
          {pill(100, 50)}
        </>
      )
      break
    case 'angle':
      geometry = (
        <>
          <path d="M30 80H150M30 80L120 20" className="stroke-sketch-construction" fill="none" />
          <path d="M100 80A70 70 0 0 0 88.5 41.5" className={line} fill="none" />
          <Arrow x={100} y={80} angle={90} cls={fill} />
          <Arrow x={88.5} y={41.5} angle={-123} cls={fill} />
          {pill(130, 58)}
        </>
      )
      break
  }

  return (
    <svg
      role="img"
      aria-label={`${kind} dimension ${shown}, ${state}`}
      viewBox="0 0 200 100"
      width={200}
      height={100}
      className={className}
      strokeWidth={1.25}
    >
      {geometry}
    </svg>
  )
}
