/**
 * A closed set of string values, safe to expose from a published package.
 *
 * The bare `['a', 'b'] as const` idiom is missing three properties, each of which
 * was a real finding in this repository rather than a hypothetical:
 *
 * 1. **Frozen at runtime.** `as const` is a compile-time assertion and is erased
 *    by the build, so a consumer of the published `dist` can `push` onto an
 *    exported vocabulary and silently change how every later run scores. Verified
 *    against the built output, not assumed.
 * 2. **No duplicates.** `satisfies readonly T[]` checks that every member belongs
 *    to the parent type; it does not check that each appears once. A value listed
 *    twice inside a scoring subset gets counted twice by the aggregator, which
 *    manufactures confidence out of a typo. That is a construction error, so it
 *    throws at module load instead of waiting to be noticed in a posterior.
 * 3. **A narrowing guard.** Every one of these values arrives as an untrusted
 *    string at some boundary - a CLI flag, a JSON body, a replayed fixture. The
 *    usual `LOOKUP[value]` returns `undefined` while the type system insists it
 *    cannot, which is how an invalid protocol becomes a confident verdict.
 */
export interface Vocabulary<T extends string> {
  /** The members, in declaration order. Frozen. */
  readonly values: readonly T[]
  /** Narrows an untrusted value to a member of this vocabulary. */
  readonly has: (candidate: unknown) => candidate is T
}

/** The member type of a vocabulary, for declaring the matching exported union. */
export type Member<V> = V extends Vocabulary<infer T> ? T : never

export function vocabulary<const T extends string>(values: readonly T[]): Vocabulary<T> {
  const unique = new Set<string>(values)

  if (unique.size !== values.length) {
    const duplicated = [...new Set(values.filter((value, at) => values.indexOf(value) !== at))]
    throw new Error(`Vocabulary declares duplicate members: ${duplicated.join(', ')}`)
  }

  return Object.freeze({
    values: Object.freeze([...values]),
    has: (candidate: unknown): candidate is T =>
      typeof candidate === 'string' && unique.has(candidate),
  })
}

/**
 * A named sub-vocabulary, checked against its parent at module load.
 *
 * Used for the scoring subsets - "which identity findings are adverse" - where
 * both halves of the mistake matter: a member that is not in the parent is a
 * typo that would never match anything, and a member listed twice is double
 * weight in the aggregate.
 */
export function subset<T extends string, const S extends T>(
  parent: Vocabulary<T>,
  members: readonly S[],
): Vocabulary<S> {
  const strays = members.filter((member) => !parent.has(member))
  if (strays.length > 0) {
    throw new Error(`Subset declares members outside its parent vocabulary: ${strays.join(', ')}`)
  }

  return vocabulary(members)
}
