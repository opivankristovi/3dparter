import { Select as S } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from './cn'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  options: SelectOption[]
  value: string
  onValueChange: (value: string) => void
  /** Accessible name. */
  label: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function Select({ options, value, onValueChange, label, placeholder, disabled, className }: SelectProps) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        aria-label={label}
        className={cn(
          'touch-hit-h inline-flex h-8 min-w-32 items-center justify-between gap-2 rounded-md border border-border-input bg-bg px-3 text-base transition-colors duration-(--motion-fast) enabled:hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-text-disabled data-[placeholder]:text-text-muted',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown size={16} strokeWidth={1.75} />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-(--radix-select-trigger-width) rounded-md border border-border bg-surface-raised p-1 shadow-pop"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="touch-hit-h relative flex h-7 cursor-default select-none items-center rounded-sm pl-7 pr-3 text-base outline-none data-[disabled]:text-text-disabled data-[highlighted]:bg-surface-sunken"
              >
                <S.ItemIndicator className="absolute left-2">
                  <Check size={16} strokeWidth={1.75} />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
