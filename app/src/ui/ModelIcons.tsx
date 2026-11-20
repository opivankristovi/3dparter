// Icons for the modelling tools that the icon set does not have. Same grid, stroke and props as the lucide icons
// next to them (24 box, round caps, currentColor), drawn for this app.
import type { SVGProps } from 'react'

export interface ModelIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
  strokeWidth?: number
}

function Icon({ size = 24, strokeWidth = 2, children, ...rest }: ModelIconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** A square corner turned into a curve. */
export function FilletIcon(props: ModelIconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3v8a9 9 0 0 0 9 9h7" />
    </Icon>
  )
}

/** A square corner cut flat. */
export function ChamferIcon(props: ModelIconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3v8l9 9h7" />
    </Icon>
  )
}

/** Two overlapping solids. */
export function CombineIcon(props: ModelIconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="12" height="12" rx="2" />
      <rect x="9" y="9" width="12" height="12" rx="2" />
    </Icon>
  )
}

/** A profile sweeping around a centre axis. */
export function RevolveIcon(props: ModelIconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v18" />
      <path d="M5 10c0-2.5 3.1-4 7-4s7 1.5 7 4-3.1 4-7 4" />
      <path d="M9 11l3 3-3 3" />
    </Icon>
  )
}

/** A hollowed solid showing wall thickness. */
export function ShellIcon(props: ModelIconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </Icon>
  )
}

/** Move / rotate axes arrows. */
export function MoveIcon(props: ModelIconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v18" />
      <path d="M3 12h18" />
      <path d="m9 6 3-3 3 3" />
      <path d="m9 18 3 3 3-3" />
      <path d="m6 9-3 3 3 3" />
      <path d="m18 9 3 3-3 3" />
    </Icon>
  )
}

/** A tilted construction plane. */
export function PlaneIcon(props: ModelIconProps) {
  return (
    <Icon {...props}>
      <polygon points="4 16 8 6 20 8 16 18 4 16" />
    </Icon>
  )
}
