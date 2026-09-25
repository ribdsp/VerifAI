/**
 * What the web UI may ask for: the profiles, the choices and their limits.
 *
 * Built from core's own definitions, so the form offers exactly what
 * `parseCheckRequest` accepts and never a value it would then refuse.
 */

import {
  AUTH_CHOICES,
  DEFAULT_PROFILE,
  MAX_ENDPOINT_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_REQUESTS_LIMIT,
  MAX_SPREAD_MS,
  MAX_TOKENS_LIMIT,
  type OptionsResponse,
  PROFILES,
  PROTOCOL_CHOICES,
  profileDefinition,
  VENDOR_CHOICES,
} from '@verifai/core'

export function optionsResponse(version: string): OptionsResponse {
  return Object.freeze({
    version,
    profiles: Object.freeze(
      PROFILES.values.map((profile) => {
        const definition = profileDefinition(profile)
        return Object.freeze({
          profile,
          description: definition.description,
          groups: definition.groups,
          draws: definition.draws,
          spreadMs: definition.spreadMs,
          maxRequests: definition.maxRequests,
          maxTokens: definition.maxTokens,
        })
      }),
    ),
    vendors: VENDOR_CHOICES.values,
    protocols: PROTOCOL_CHOICES.values,
    authChoices: AUTH_CHOICES.values,
    defaults: Object.freeze({
      profile: DEFAULT_PROFILE,
      vendor: 'auto',
      protocol: 'auto',
      auth: 'auto',
    }),
    limits: Object.freeze({
      maxRequests: MAX_REQUESTS_LIMIT,
      maxTokens: MAX_TOKENS_LIMIT,
      maxSpreadMs: MAX_SPREAD_MS,
      maxEndpointLength: MAX_ENDPOINT_LENGTH,
      maxModelLength: MAX_MODEL_ID_LENGTH,
    }),
  })
}
