/**
 * Lenient readers for an endpoint's JSON.
 *
 * Every value in a response body is something the endpoint chose to send, so
 * none is trusted to have the documented type. These read what is there and
 * report `undefined` for what is missing or mistyped; how far the body strays
 * from the documented shape is `conformance.ts`'s question, asked separately,
 * so that one wrong field never hides the rest of a response.
 *
 * Own properties only. A key the body did not send must never resolve to
 * something inherited from `Object.prototype`.
 */

export type JsonObject = { readonly [key: string]: unknown }

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function member(object: JsonObject, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined
}

export function readString(object: JsonObject, key: string): string | undefined {
  const value = member(object, key)
  return typeof value === 'string' ? value : undefined
}

/**
 * Three answers, because absent and `null` are different findings: GPT-5
 * sends `"system_fingerprint": null` where a proxy replaying an older schema
 * leaves the key out.
 */
export function readNullableString(object: JsonObject, key: string): string | null | undefined {
  const value = member(object, key)
  return typeof value === 'string' || value === null ? value : undefined
}

/** A token count: a non-negative whole number that survives arithmetic exactly. */
export function readCount(object: JsonObject, key: string): number | undefined {
  const value = member(object, key)
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function readArray(object: JsonObject, key: string): readonly unknown[] | undefined {
  const value = member(object, key)
  return Array.isArray(value) ? value : undefined
}

export function readObject(object: JsonObject, key: string): JsonObject | undefined {
  const value = member(object, key)
  return isJsonObject(value) ? value : undefined
}

/**
 * Text parts joined in order, skipping any that did not read as text.
 * `undefined` when there are none, so that a response without text stays
 * apart from one whose text is empty.
 */
export function joinTexts(texts: readonly (string | undefined)[]): string | undefined {
  const present = texts.filter((text) => text !== undefined)
  return present.length === 0 ? undefined : present.join('')
}

/** The elements of an array that are objects, for lists of blocks or items. */
export function objectsIn(values: readonly unknown[] | undefined): readonly JsonObject[] {
  return values === undefined ? [] : values.filter(isJsonObject)
}
