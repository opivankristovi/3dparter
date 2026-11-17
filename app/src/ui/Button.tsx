import type { ComponentProps, ReactNode } from 'react'
import { cn } from './cn'
import { Spinner } from './ProgressIndicator'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon; replaced by a spinner while loading. */
  icon?: ReactNode
  loading?: boolean
}

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:bg-surface-sunken disabled:text-text-disabled',
  secondary:
    'bg-surface-raised text-text border border-border enabled:hover:bg-surface-sunken disabled:text-text-disabled',
  ghost: 'bg-transparent text-text enabled:hover:bg-surface-sunken disabled:text-text-disabled',
  danger:
    'bg-danger text-on-danger enabled:hover:opacity-90 disabled:bg-surface-sunken disabled:text-text-disabled',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5',
  md: 'h-8 px-3',
  lg: 'h-10 px-4',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={cn(
        'touch-hit inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-base font-medium transition-colors duration-(--motion-fast) active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0',
        variants[variant],
        sizes[size],
        loading && 'cursor-progress',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  )
}
