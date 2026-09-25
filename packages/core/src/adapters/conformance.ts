/**
 * How far a body strays from the shape its vendor documents.
 *
 * Each protocol module declares the documented shape as a valibot schema, and
 * a body is read twice: leniently for its values, and against the schema for
 * its deviations. A deviation is an observation, never a verdict. Vendors add
 * fields and values over time, so schemas here assert what the documentation
 * says must be present and must have a type, and are silent about keys they do
 * not name.
 */

import * as v from 'valibot'

export interface Deviation {
  /** Dotted path from the body's root, array indices included; `''` for the root. */
  readonly path: string
  /** What the documented shape requires there, or `present` for a required key. */
  readonly expected: string
  /** What the body had, or `absent`. Cut to `MAX_RECEIVED_LENGTH`. */
  readonly received: string
}

/**
 * Enough to characterise any body, few enough that a million-element array of
 * wrong items cannot turn one finding into a million.
 */
export const MAX_DEVIATIONS = 32

/** A received string value is endpoint content; past this it is truncated. */
export const MAX_RECEIVED_LENGTH = 80

const ELLIPSIS = '…'

function truncate(text: string): string {
  return text.length <= MAX_RECEIVED_LENGTH
    ? text
    : `${text.slice(0, MAX_RECEIVED_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`
}

function toDeviation(issue: v.BaseIssue<unknown>): Deviation {
  const path = issue.path?.map((item) => String(item.key)).join('.') ?? ''
  // JSON cannot contain `undefined`, so receiving it below the root means the
  // key was absent. valibot reports a missing required key as an object issue
  // that expects the key's name, which reads better as `present`.
  const absent = issue.received === 'undefined' && path !== ''
  return Object.freeze({
    path,
    expected: absent && issue.type === 'object' ? 'present' : (issue.expected ?? issue.type),
    received: absent ? 'absent' : truncate(issue.received),
  })
}

/** In schema order, at most `MAX_DEVIATIONS`. */
export function deviationsFrom(schema: v.GenericSchema, value: unknown): readonly Deviation[] {
  const result = v.safeParse(schema, value)
  if (result.success) {
    return Object.freeze([])
  }
  return Object.freeze(result.issues.slice(0, MAX_DEVIATIONS).map(toDeviation))
}

/**
 * A documented `T or null`. As a union rather than `v.nullable`, so a
 * deviation reads `expected (string | null)` instead of forgetting the null.
 * For objects, use `v.nullable`, which keeps the nested deviations.
 */
export function orNull<const T extends v.GenericSchema>(
  schema: T,
): v.UnionSchema<[T, v.NullSchema<undefined>], undefined> {
  return v.union([schema, v.null()])
}

/** A count, an index, or a Unix time in whole seconds. */
export const WHOLE_NUMBER = v.pipe(v.number(), v.safeInteger(), v.minValue(0))

export const TOKEN_COUNT = WHOLE_NUMBER

/**
 * A list member told apart from its siblings by `key`, as content blocks and
 * output items are. A member of a kind named in `known` is checked against that
 * kind's entries; a member of any other kind passes, because vendors add
 * kinds faster than a schema can follow and an unfamiliar block is not a
 * deviation from the documented ones.
 *
 * The catch-all refuses the known kinds explicitly: valibot tries a variant's
 * options in order, so a catch-all that accepted any string would also accept
 * a known kind that failed its own schema.
 */
export function openVariant(
  key: string,
  known: Readonly<Record<string, v.ObjectEntries>>,
): v.GenericSchema {
  const kinds = Object.keys(known)
  const options = [
    ...kinds.map((kind) => v.object({ ...known[kind], [key]: v.literal(kind) })),
    v.object({ [key]: v.pipe(v.string(), v.notValues(kinds)) }),
  ]
  return v.variant(key, options)
}
