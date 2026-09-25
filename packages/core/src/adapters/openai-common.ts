/**
 * What OpenAI's Chat Completions and Responses protocols share. The OpenAI
 * OpenAPI specification's only security scheme for them is `ApiKeyAuth`, HTTP
 * `bearer`, and the curl examples of both endpoints send
 * `-H "Content-Type: application/json"` then
 * `-H "Authorization: Bearer $OPENAI_API_KEY"`.
 */

import type { HeaderPair } from '../transport/types.js'
import { credentialHeaders, JSON_ACCEPT, JSON_CONTENT_TYPE } from './request-headers.js'
import type { AuthSchemes, HeaderOptions } from './types.js'

export const OPENAI_AUTH_SCHEMES: AuthSchemes = Object.freeze(['bearer'] as const)

export function openaiHeaders({ apiKey, auth, hasBody }: HeaderOptions): readonly HeaderPair[] {
  return Object.freeze([
    ...(hasBody ? [JSON_CONTENT_TYPE] : []),
    JSON_ACCEPT,
    ...credentialHeaders(OPENAI_AUTH_SCHEMES, auth, apiKey),
  ])
}
