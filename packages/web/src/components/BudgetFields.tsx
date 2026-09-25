import type { OptionsResponse } from '@verifai/core'
import { formatCount } from '../lib/format'
import type { CheckFormValues, FormField } from '../lib/request'
import { Field } from './Field'

interface BudgetFieldsProps {
  readonly options: OptionsResponse
  readonly values: CheckFormValues
  readonly problems: Readonly<Partial<Record<FormField | 'form', readonly string[]>>>
  readonly onChange: (values: CheckFormValues) => void
}

const MS_PER_MINUTE = 60_000

type TextKey = 'maxRequests' | 'maxTokens' | 'spreadMinutes'
type FlagKey = 'allowPrivateTargets' | 'showEndpoint'

/** The budget overrides and the two opt-ins, folded away until asked for. */
export function BudgetFields({ options, values, problems, onChange }: BudgetFieldsProps) {
  const profile = options.profiles.find((option) => option.profile === values.profile)
  const hasProblem =
    problems.maxRequests !== undefined ||
    problems.maxTokens !== undefined ||
    problems.spreadMs !== undefined
  const setText = (key: TextKey, text: string) => onChange({ ...values, [key]: text })
  const setFlag = (key: FlagKey, flag: boolean) => onChange({ ...values, [key]: flag })

  const numberInput =
    (id: string, key: TextKey, placeholder: string) =>
    (describedBy: string | undefined, invalid: boolean) => (
      <input
        id={id}
        className="form-line max-w-48"
        type="text"
        inputMode={key === 'spreadMinutes' ? 'decimal' : 'numeric'}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={values[key]}
        onChange={(event) => setText(key, event.target.value)}
        aria-describedby={describedBy}
        aria-invalid={invalid}
      />
    )

  return (
    <details open={hasProblem} className="group">
      <summary className="disclosure cursor-pointer py-2 font-mono text-sm text-ink-soft select-none">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>{' '}
        Override the profile’s budget, or allow private addresses
      </summary>
      <Field
        id="max-requests"
        number="3.1"
        label="Request budget"
        hint={`At most ${formatCount(options.limits.maxRequests)}. Blank keeps the profile’s budget.`}
        problems={problems.maxRequests}
      >
        {numberInput('max-requests', 'maxRequests', String(profile?.maxRequests ?? ''))}
      </Field>
      <Field
        id="max-tokens"
        number="3.2"
        label="Token budget"
        hint={`At most ${formatCount(options.limits.maxTokens)}. Blank keeps the profile’s budget.`}
        problems={problems.maxTokens}
      >
        {numberInput('max-tokens', 'maxTokens', String(profile?.maxTokens ?? ''))}
      </Field>
      <Field
        id="spread"
        number="3.3"
        label="Spread, in minutes"
        hint={`How long to spread the routing-dilution draws over, at most ${formatCount(
          options.limits.maxSpreadMs / MS_PER_MINUTE,
        )} minutes.`}
        problems={problems.spreadMs}
      >
        {numberInput('spread', 'spreadMinutes', String((profile?.spreadMs ?? 0) / MS_PER_MINUTE))}
      </Field>
      <div className="grid gap-3 py-3 sm:grid-cols-[13rem_1fr] sm:gap-x-6">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-ink-faint">3.4</span>
          <span className="font-semibold">Options</span>
        </span>
        <div className="space-y-2">
          <Flag
            id="allow-private"
            label="Allow private and loopback addresses"
            note="For an endpoint on your own network. Off, the daemon refuses them."
            checked={values.allowPrivateTargets}
            onChange={(flag) => setFlag('allowPrivateTargets', flag)}
          />
          <Flag
            id="show-endpoint"
            label="Print the endpoint in the report"
            note="Off, the report names the endpoint by its hash only."
            checked={values.showEndpoint}
            onChange={(flag) => setFlag('showEndpoint', flag)}
          />
        </div>
      </div>
    </details>
  )
}

interface FlagProps {
  readonly id: string
  readonly label: string
  readonly note: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

function Flag({ id, label, note, checked, onChange }: FlagProps) {
  return (
    <div className="flex items-baseline gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={`${id}-note`}
        className="accent-ink"
      />
      <label htmlFor={id}>
        <span className="block">{label}</span>
        <span id={`${id}-note`} className="block text-sm text-ink-faint">
          {note}
        </span>
      </label>
    </div>
  )
}
