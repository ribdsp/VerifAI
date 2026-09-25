import type { Profile, ProfileOption } from '@verifai/core'
import { formatCount, formatDuration, plural } from '../lib/format'

interface ProfilePickerProps {
  readonly profiles: readonly ProfileOption[]
  readonly value: Profile
  readonly onChange: (profile: Profile) => void
}

function particulars(option: ProfileOption): string {
  const parts = [
    `Groups ${option.groups.join(' ')}`,
    `${formatCount(option.maxRequests)} requests`,
    `${formatCount(option.maxTokens)} tokens`,
    ...(option.groups.includes('F') ? [plural(option.draws, 'draw')] : []),
    option.spreadMs > 0 ? `spread over ${formatDuration(option.spreadMs)}` : 'no spread',
  ]
  return parts.join(' · ')
}

/** The profiles as a ruled list of radio lines, each with what it costs. */
export function ProfilePicker({ profiles, value, onChange }: ProfilePickerProps) {
  return (
    <fieldset>
      <legend className="sr-only">Profile</legend>
      <ul className="divide-y divide-rule border-y border-rule">
        {profiles.map((option) => {
          const id = `profile-${option.profile}`
          const isChosen = option.profile === value
          return (
            <li key={option.profile}>
              <label
                htmlFor={id}
                className={`grid cursor-pointer grid-cols-[1.5rem_8rem_1fr] items-baseline gap-x-3 gap-y-1 px-2 py-3 ${
                  isChosen ? 'bg-rule-soft' : 'hover:bg-(--color-rule-soft)/50'
                }`}
              >
                <input
                  id={id}
                  type="radio"
                  name="profile"
                  value={option.profile}
                  checked={isChosen}
                  onChange={() => onChange(option.profile)}
                  aria-describedby={`${id}-note`}
                  className="accent-ink"
                />
                <span className="font-mono text-sm font-semibold uppercase tracking-wider">
                  {option.profile}
                </span>
                <span id={`${id}-note`} className="col-start-3">
                  <span className="block">{option.description}</span>
                  <span className="block font-mono text-xs text-ink-faint">
                    {particulars(option)}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
