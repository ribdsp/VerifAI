/**
 * An error envelope, read in the dialect of the vendor whose shape it has.
 *
 * Anthropic: `{"type":"error","error":{"type":"not_found_error","message":"..."},"request_id":"req_..."}`
 * per https://platform.claude.com/docs/en/api/errors.
 * OpenAI: `{"error":{"message":"...","type":"invalid_request_error","param":null,"code":null}}`
 * per the `ErrorResponse` schema of the OpenAI OpenAPI specification.
 *
 * The dialect is a finding in its own right: an endpoint that claims to speak
 * `/v1/messages` and fails in OpenAI's envelope is a translation layer or a
 * substitute, whatever its successful responses look like. So an envelope is
 * recognised by the least that identifies it - a top-level `"type": "error"`
 * for Anthropic, an `error` object for OpenAI, each with a string message -
 * and everything else it documents is reported as deviations rather than
 * required for recognition.
 */

import * as v from 'valibot'
import { type Member, vocabulary } from '../types/vocabulary.js'
import { type Deviation, deviationsFrom, orNull } from './conformance.js'
import { isJsonObject, readNullableString, readObject, readString } from './json.js'

export const ERROR_DIALECTS = vocabulary(['anthropic', 'openai'])
export type ErrorDialect = Member<typeof ERROR_DIALECTS>

export interface ErrorBody {
  readonly dialect: ErrorDialect
  readonly message: string
  /** `error.type` in both dialects. */
  readonly type: string | undefined
  /** OpenAI's `error.code`. Absent and `null` are different findings. */
  readonly code: string | null | undefined
  /** OpenAI's `error.param`. */
  readonly param: string | null | undefined
  /** Anthropic's top-level `request_id`. */
  readonly requestId: string | undefined
  readonly deviations: readonly Deviation[]
}

// biome-ignore-start lint/style/useNamingConvention: the vendors' wire names.
const ANTHROPIC_ERROR = v.object({
  type: v.literal('error'),
  error: v.object({
    type: v.string(),
    message: v.string(),
  }),
  request_id: v.optional(v.string()),
})

const OPENAI_ERROR = v.object({
  error: v.object({
    type: v.string(),
    message: v.string(),
    param: orNull(v.string()),
    code: orNull(v.string()),
  }),
})
// biome-ignore-end lint/style/useNamingConvention: the vendors' wire names.

/** `undefined` when the body is in neither dialect, which is a finding for the caller. */
export function readErrorBody(value: unknown): ErrorBody | undefined {
  if (!isJsonObject(value)) {
    return undefined
  }
  const error = readObject(value, 'error')
  const message = error === undefined ? undefined : readString(error, 'message')
  if (error === undefined || message === undefined) {
    return undefined
  }

  if (readString(value, 'type') === 'error') {
    return Object.freeze({
      dialect: 'anthropic',
      message,
      type: readString(error, 'type'),
      code: undefined,
      param: undefined,
      requestId: readString(value, 'request_id'),
      deviations: deviationsFrom(ANTHROPIC_ERROR, value),
    })
  }
  return Object.freeze({
    dialect: 'openai',
    message,
    type: readString(error, 'type'),
    code: readNullableString(error, 'code'),
    param: readNullableString(error, 'param'),
    requestId: undefined,
    deviations: deviationsFrom(OPENAI_ERROR, value),
  })
}
