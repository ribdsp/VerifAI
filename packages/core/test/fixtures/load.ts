/**
 * Loading the documented fixtures, and deriving variants of them without
 * mutating anything: every call parses a fresh copy, and `patched` returns a
 * new value with one path replaced. Paths are dotted, array indices included,
 * which also keeps the vendors' snake_case names out of object literals.
 */

import { readFileSync } from 'node:fs'

/** A file directly in this directory; anything with a path in it is refused. */
const FIXTURE_NAME = /^[\w.-]+\.json$/

export function fixture(name: string): unknown {
  if (!FIXTURE_NAME.test(name) || name.startsWith('.')) {
    throw new TypeError(`Not a fixture name: ${JSON.stringify(name)}`)
  }
  return JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
}

/** As a `patched` replacement: remove the key rather than set it. */
export const REMOVED: unique symbol = Symbol('removed')

export function patched(value: unknown, path: string, replacement: unknown): unknown {
  const [head = '', ...rest] = path.split('.')
  const next = (current: unknown): unknown =>
    rest.length === 0 ? replacement : patched(current, rest.join('.'), replacement)

  if (Array.isArray(value)) {
    const index = Number(head)
    return value.map((item: unknown, at) => (at === index ? next(item) : item))
  }
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Cannot patch ${path} into a non-object`)
  }
  const entries = Object.entries(value)
  const present = entries.some(([key]) => key === head)
  const updated = entries.map(([key, member]): [string, unknown] =>
    key === head ? [key, next(member)] : [key, member],
  )
  const all = present ? updated : [...updated, [head, next(undefined)] as [string, unknown]]
  return Object.fromEntries(all.filter(([, member]) => member !== REMOVED))
}
