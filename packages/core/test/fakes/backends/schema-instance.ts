/**
 * A minimal instance that satisfies a JSON Schema well enough for the
 * structured-output probes: it exercises the schema's own constraints
 * (`const`, `enum`, `required`) rather than any probe's field names, so it
 * conforms to whatever schema a request carries, including one built around
 * a nonce the probe must see echoed back.
 */

import { isJsonObject, type JsonObject } from './shared.js'

function firstOf(values: unknown): unknown {
  return Array.isArray(values) && values.length > 0 ? values[0] : undefined
}

/** Best-effort: schema features this does not model (`pattern`, `format`, ...) are ignored. */
export function instanceFor(schema: unknown): unknown {
  if (!isJsonObject(schema)) {
    return null
  }
  if ('const' in schema) {
    return schema.const
  }
  const enumerated = firstOf(schema.enum)
  if (enumerated !== undefined) {
    return enumerated
  }
  switch (schema.type) {
    case 'object':
      return objectInstance(schema)
    case 'array':
      return schema.items === undefined ? [] : [instanceFor(schema.items)]
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return true
    default:
      return 'ok'
  }
}

function objectInstance(schema: JsonObject): JsonObject {
  const properties = isJsonObject(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : Object.keys(properties)
  const out: Record<string, unknown> = {}
  for (const key of required) {
    if (typeof key === 'string') {
      out[key] = instanceFor(properties[key])
    }
  }
  return out
}
