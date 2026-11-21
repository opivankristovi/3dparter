// The Text card: wording, size, turn, and an optional curve for the text to follow.
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Type } from 'lucide-react'
import { useSettings } from '../../app/useSettings'
import { evalExpr, isNumberLiteral } from '../../doc/expr'
import { checkFieldText } from '../../doc/fieldInput'
import { useProjectStore } from '../../doc/store'
import type { DisplayUnit, SketchEntity } from '../../doc/types'
import { useVariableSuggestions } from '../../doc/useVariableSuggestions'
import { formatDisplay } from '../../doc/units'
import { scopeOf } from '../../doc/variables'
import { selectionRef } from '../pick'
import { Button } from '../../ui/Button'
import { NumericInput } from '../../ui/NumericInput'
import type { FieldFeedback } from '../../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../../ui/ParameterCard'
import { RemovableChip } from '../../ui/RemovableChip'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { commitText } from './commands'
import { useTextUi } from './textUi'
import type { TextSession } from './textUi'

/** `expr` is set when the text is a formula or variable (kept so the number follows the variables). */
type Parsed = { ok: true; value: number; preview?: string; expr?: string } | { ok: false; message: string }

/** A number field that holds back invalid text and only passes valid values on. */
function useNumberField(current: string, parse: (text: string) => Parsed, onValue: (v: number, expr?: string) => void) {
  const [typed, setTyped] = useState<string | null>(null)
  const suggestions = useVariableSuggestions('mm')
  const check = (text: string): FieldFeedback => {
    const r = parse(text)
    if (!r.ok) return { error: r.message }
    return r.preview ? { preview: r.preview } : {}
  }
  return {
    invalid: typed !== null,
    field: {
      value: typed ?? current,
      error: typed !== null ? check(typed).error : undefined,
      check,
      suggestions,
      onValueChange: (text: string) => {
        const r = parse(text)
        if (!r.ok) {
          setTyped(text)
          return
        }
        setTyped(null)
        onValue(r.value, r.expr)
      },
    },
  }
}

const scope = () => scopeOf(useProjectStore.getState().doc)

function parseLength(text: string, units: DisplayUnit): Parsed {
  const r = checkFieldText(text, units, { kind: 'length', positive: true }, scope())
  return r.ok ? { ok: true, value: r.value, ...(r.isExpression ? { preview: r.preview, expr: r.expr } : {}) } : { ok: false, message: r.message }
}

function parseDegrees(text: string): Parsed {
  const r = checkFieldText(text, 'mm', { kind: 'angle' }, scope())
  return r.ok ? { ok: true, value: r.value, ...(r.isExpression ? { preview: r.preview, expr: r.expr } : {}) } : { ok: false, message: r.message }
}

function parsePercent(text: string): Parsed {
  const t = text.trim()
  if (t === '') return { ok: false, message: 'Enter a number from 0 to 100.' }
  const r = evalExpr(t, scope())
  if (!r.ok) return { ok: false, message: r.message }
  if (!Number.isFinite(r.value) || r.value < 0 || r.value > 100) return { ok: false, message: 'Enter a number from 0 to 100.' }
  return { ok: true, value: r.value, ...(isNumberLiteral(t) ? {} : { preview: String(Number(r.value.toFixed(4))) }) }
}

const KIND_NAME: Record<SketchEntity['type'], string> = { line: 'Line', circle: 'Circle', arc: 'Arc', text: 'Text' }

function nameOf(entities: SketchEntity[], id: string): string {
  const e = entities.find((x) => x.id === id)
  if (!e) return 'Missing curve'
  const same = entities.filter((x) => x.type === e.type)
  return `${KIND_NAME[e.type]} ${same.indexOf(e) + 1}`
}

const num = (n: number) => String(Number(n.toFixed(4)))

/** The open Text card, or null when no text is being placed or edited. */
export function useTextCard(): ReactNode {
  const session = useTextUi((s) => s.session)
  return session ? <TextCard key={session.draft.id} session={session} /> : null
}

function TextCard({ session }: { session: TextSession }) {
  const { draft, isNew, sketchId } = session
  const change = useTextUi((s) => s.change)
  const picking = useTextUi((s) => s.pickingPath)
  const units = useProjectStore((s) => s.doc.units)
  const precision = useSettings((s) => s.settings.precision)
  const features = useProjectStore((s) => s.doc.features)
  const sketch = features.find((x) => x.id === sketchId)
  const entities = sketch?.type === 'sketch' ? sketch.sketch.entities : []
  const textId = useId()
  const empty = draft.text.trim() === ''
  const path = draft.path

  const size = useNumberField(
    draft.sizeExpr ?? formatDisplay(draft.size, units, precision),
    (t) => parseLength(t, units),
    (v, expr) => change({ size: v, sizeExpr: expr }),
  )
  const turn = useNumberField(
    draft.rotationExpr ?? num((draft.rotation * 180) / Math.PI),
    parseDegrees,
    (v, expr) => change({ rotation: (v * Math.PI) / 180, rotationExpr: expr }),
  )
  const start = useNumberField(
    num((path?.offset ?? 0) * 100),
    parsePercent,
    (v) => path && change({ path: { ...path, offset: v / 100 } }),
  )

  const blocked = empty || size.invalid || turn.invalid || start.invalid
  const close = () => useTextUi.getState().close()
  const apply = () => {
    if (blocked) return
    commitText(sketchId, draft, isNew)
    if (isNew) useProjectStore.getState().setSelection([selectionRef(sketchId, draft.id)])
    close()
  }
  const target = path ? entities.find((e) => e.id === path.entityId) : undefined

  return (
    <ParameterCard
      title="Text"
      icon={<Type size={16} strokeWidth={1.75} />}
      applyDisabled={blocked}
      onApply={apply}
      onCancel={close}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={textId} className="text-xs text-text-muted">
          Text
        </label>
        <div className="touch-hit-h flex h-7 items-center rounded-sm border border-border-input bg-bg px-2 hover:border-text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
          <input
            id={textId}
            type="text"
            value={draft.text}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={empty ? `${textId}-hint` : undefined}
            onChange={(e) => change({ text: e.target.value })}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </div>
        {empty ? (
          <p id={`${textId}-hint`} className="text-sm text-text-muted">
            Type some text
          </p>
        ) : null}
      </div>
      <NumericInput label="Size" unit={units} step={1} {...size.field} />
      <NumericInput label="Rotation" unit="°" step={5} disabled={!!path} {...turn.field} />
      <ParameterRow label="Along">
        {path && target ? (
          <div className="flex flex-wrap items-center gap-1">
            <RemovableChip
              label={nameOf(entities, path.entityId)}
              removeLabel="Stop following this curve"
              onRemove={() => change({ path: undefined })}
            />
          </div>
        ) : picking ? (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm text-text-muted">Click a circle, arc or line in the sketch.</p>
            <Button size="sm" variant="ghost" onClick={() => useTextUi.getState().setPicking(false)}>
              Stop
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">None</span>
            <Button size="sm" variant="secondary" onClick={() => useTextUi.getState().setPicking(true)}>
              Pick a curve
            </Button>
          </div>
        )}
      </ParameterRow>
      {path && target ? (
        <>
          <ParameterRow label="Side">
            <SegmentedControl
              label="Side of the curve"
              value={path.side}
              onValueChange={(v) => change({ path: { ...path, side: v === 'inside' ? 'inside' : 'outside' } })}
              options={[
                { value: 'outside', label: 'Outside' },
                { value: 'inside', label: 'Inside' },
              ]}
              className="self-start"
            />
          </ParameterRow>
          <NumericInput label="Start" unit="%" step={5} {...start.field} />
        </>
      ) : null}
    </ParameterCard>
  )
}
