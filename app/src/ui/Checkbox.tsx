import { useId } from 'react'
import { Checkbox as C } from 'radix-ui'
import { Check, Minus } from 'lucide-react'
import { cn } from './cn'

export interface CheckboxProps {
  label: string
  checked: boolean | 'indeterminate'
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function Checkbox({ label, checked, onCheckedChange, disabled, className }: CheckboxProps) {
  const id = useId()
  return (
    <div className={cn('touch-hit-h flex items-center gap-2', className)}>
      <C.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-input bg-bg text-on-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent"
      >
        <C.Indicator>
          {checked === 'indeterminate' ? <Minus size={12} strokeWidth={2.5} /> : <Check size={12} strokeWidth={2.5} />}
        </C.Indicator>
      </C.Root>
      <label htmlFor={id} className={cn('select-none text-base', disabled && 'text-text-disabled')}>
        {label}
      </label>
    </div>
  )
}
