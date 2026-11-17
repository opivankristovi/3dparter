import { useId } from 'react'
import { Switch as S } from 'radix-ui'
import { cn } from './cn'

export interface SwitchProps {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function Switch({ label, checked, onCheckedChange, disabled, className }: SwitchProps) {
  const id = useId()
  return (
    <div className={cn('touch-hit-h flex items-center gap-2', className)}>
      <S.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-5 w-9 shrink-0 rounded-pill bg-border-input transition-colors duration-(--motion-fast) disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent"
      >
        <S.Thumb className="block size-4 translate-x-0.5 rounded-pill bg-on-accent transition-transform duration-(--motion-fast) data-[state=checked]:translate-x-[18px]" />
      </S.Root>
      <label htmlFor={id} className={cn('select-none text-base', disabled && 'text-text-disabled')}>
        {label}
      </label>
    </div>
  )
}
