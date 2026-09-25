import {
  AUTH_CHOICES,
  type CreateCheckResponse,
  type OptionsResponse,
  PROTOCOL_CHOICES,
  VENDOR_CHOICES,
} from '@verifai/core'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type ApiClient, ApiClientError, type ClientErrorCode, messageOf } from '../lib/api'
import { formatCount } from '../lib/format'
import { AUTH_LABELS, labelOf, PROTOCOL_LABELS, VENDOR_LABELS } from '../lib/labels'
import {
  buildCheckRequest,
  type CheckFormValues,
  type FormField,
  problemsByField,
} from '../lib/request'
import { BudgetFields } from './BudgetFields'
import { Field } from './Field'
import { Notice } from './Notice'
import { ProfilePicker } from './ProfilePicker'
import { Section } from './Section'

/** Daemon errors that are about one field, shown under that field. */
const ERROR_FIELDS: Partial<Record<ClientErrorCode, FormField>> = {
  'invalid-endpoint': 'endpoint',
  'blocked-target': 'endpoint',
  unreachable: 'endpoint',
  'invalid-api-key': 'apiKey',
  'invalid-key': 'apiKey',
  'invalid-model': 'model',
  'model-not-found': 'model',
  'detection-failed': 'protocol',
}

function problemsOf(error: unknown): readonly string[] {
  if (!(error instanceof ApiClientError)) {
    return [messageOf(error)]
  }
  const field = ERROR_FIELDS[error.code]
  return [field === undefined ? error.message : `${field}: ${error.message}`]
}

interface CheckFormProps {
  readonly client: ApiClient
  readonly options: OptionsResponse
  readonly values: CheckFormValues
  readonly onValuesChange: (values: CheckFormValues) => void
  readonly onCreated: (created: CreateCheckResponse) => void
}

export function CheckForm({ client, options, values, onValuesChange, onCreated }: CheckFormProps) {
  // The key lives here and nowhere else: not in `values`, not in the App, not in storage.
  const [apiKey, setApiKey] = useState('')
  const [problems, setProblems] = useState<readonly string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const byField = problemsByField(problems)
  const set = <K extends keyof CheckFormValues>(key: K, value: CheckFormValues[K]) =>
    onValuesChange({ ...values, [key]: value })

  useEffect(() => {
    if (problems.length === 0) return
    // After a refusal, the reader starts again at the first field that needs them.
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [problems])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const built = buildCheckRequest(values, apiKey)
    if (!built.ok) {
      setProblems(built.problems)
      return
    }
    setProblems([])
    setIsSubmitting(true)
    try {
      const created = await client.createCheck(built.request)
      setApiKey('')
      onCreated(created)
    } catch (error) {
      setProblems(problemsOf(error))
      setIsSubmitting(false)
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={submit} aria-busy={isSubmitting} className="space-y-2">
      <Section
        mark="1"
        title="Particulars of the endpoint"
        aside="Required unless marked"
        order={0}
      >
        <Field
          id="endpoint"
          number="1.1"
          label="Endpoint URL"
          hint="The base URL the seller gave you, such as https://api.example.com/v1."
          problems={byField.endpoint}
        >
          {(describedBy, invalid) => (
            <input
              id="endpoint"
              className="form-line"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={options.limits.maxEndpointLength}
              value={values.endpoint}
              onChange={(event) => set('endpoint', event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              required
            />
          )}
        </Field>
        <Field
          id="api-key"
          number="1.2"
          label="API key"
          hint="Optional. Kept in this tab’s memory only, sent once to the local daemon, and cleared from the page as soon as the estimate is ready."
          problems={byField.apiKey}
        >
          {(describedBy, invalid) => (
            <input
              id="api-key"
              className="form-line"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
        <Field
          id="model"
          number="1.3"
          label="Model"
          hint="The model ID you were sold, exactly as the seller writes it."
          problems={byField.model}
        >
          {(describedBy, invalid) => (
            <input
              id="model"
              className="form-line"
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={options.limits.maxModelLength}
              value={values.model}
              onChange={(event) => set('model', event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              required
            />
          )}
        </Field>
        <Field id="vendor" number="1.4" label="Claimed vendor" problems={byField.vendor}>
          {(describedBy, invalid) => (
            <select
              id="vendor"
              className="form-line"
              value={values.vendor}
              onChange={(event) => {
                const { value } = event.target
                if (VENDOR_CHOICES.has(value)) {
                  set('vendor', value)
                }
              }}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              {options.vendors.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {labelOf(VENDOR_LABELS, vendor)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="protocol" number="1.5" label="Protocol" problems={byField.protocol}>
          {(describedBy, invalid) => (
            <select
              id="protocol"
              className="form-line"
              value={values.protocol}
              onChange={(event) => {
                const { value } = event.target
                if (PROTOCOL_CHOICES.has(value)) {
                  set('protocol', value)
                }
              }}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              {options.protocols.map((protocol) => (
                <option key={protocol} value={protocol}>
                  {labelOf(PROTOCOL_LABELS, protocol)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="auth" number="1.6" label="Key header" problems={byField.auth}>
          {(describedBy, invalid) => (
            <select
              id="auth"
              className="form-line"
              value={values.auth}
              onChange={(event) => {
                const { value } = event.target
                if (AUTH_CHOICES.has(value)) {
                  set('auth', value)
                }
              }}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              {options.authChoices.map((auth) => (
                <option key={auth} value={auth}>
                  {labelOf(AUTH_LABELS, auth)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Section>

      <Section mark="2" title="Profile" aside="How thorough, and how costly" order={1}>
        <ProfilePicker
          profiles={options.profiles}
          value={values.profile}
          onChange={(profile) => set('profile', profile)}
        />
      </Section>

      <Section mark="3" title="Budget and options" aside="Optional" order={2}>
        <BudgetFields
          options={options}
          values={values}
          problems={byField}
          onChange={onValuesChange}
        />
      </Section>

      <div className="reveal flex flex-wrap items-center gap-4 border-t border-ink pt-4">
        <button type="submit" className="button button-primary" disabled={isSubmitting}>
          {isSubmitting ? 'Preparing…' : 'Prepare estimate'}
        </button>
        <p className="text-sm text-ink-faint">
          No probe runs until you confirm the estimate. Budgets cap at{' '}
          {formatCount(options.limits.maxRequests)} requests.
        </p>
      </div>
      {byField.form === undefined ? null : (
        <Notice tone="fail" title="The check could not be prepared" role="alert">
          {byField.form.join(' ')}
        </Notice>
      )}
    </form>
  )
}
