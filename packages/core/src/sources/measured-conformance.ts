/**
 * What `api.openai.com` was observed to do where its documentation is silent:
 * how it fails without a key, on routes it does not serve, and on parameters
 * it rejects.
 *
 * None of this is vendor documentation, and none of it was recorded with
 * `verifai record`, so every signal citing it is `heuristic`. Each quote is a
 * line of `docs/PROVENANCE.md`, under the entry of the probe that relies on it.
 */

import { citation } from './citation.js'

const PROVENANCE = 'https://github.com/ribdsp/VerifAI/blob/main/docs/PROVENANCE.md'
const WRITTEN = '2026-09-24'

export const MEASURED_OPENAI_ROUTE_SERIALIZERS = citation(
  PROVENANCE,
  "Without a key, api.openai.com answers `GET /v1/models` with 2-space-indented JSON saying `Missing bearer authentication in header`, `GET /v1/chat/completions` with compact JSON saying `Missing bearer or basic authentication in header`, `POST /v1/chat/completions` with 4-space-indented JSON whose message begins `You didn't provide an API key.`, and `POST /v1/responses` with 2-space-indented JSON saying `Missing bearer or basic authentication in header`.",
  WRITTEN,
)

export const MEASURED_OPENAI_PROXY_WASM = citation(
  PROVENANCE,
  'api.openai.com sends an `x-openai-proxy-wasm` header on the 401 a routed path returns without a key, and does not send it on the 404 a path it does not route returns.',
  WRITTEN,
)

export const MEASURED_OPENAI_EMPTY_404 = citation(
  PROVENANCE,
  'api.openai.com answers `POST /v1/models`, and a path it does not route, with a 404 whose body is empty.',
  WRITTEN,
)

export const MEASURED_OPENAI_PREFLIGHT = citation(
  PROVENANCE,
  'api.openai.com answers a CORS preflight with 200, `access-control-allow-methods: GET, OPTIONS, POST` and `access-control-max-age: 86400`.',
  WRITTEN,
)

export const MEASURED_OPENAI_EXPOSE_HEADERS_TWICE = citation(
  PROVENANCE,
  'api.openai.com sends the header `Access-Control-Expose-Headers: CF-Ray` twice in the same response.',
  WRITTEN,
)

export const MEASURED_OPENAI_UNAUTHENTICATED_HEADERS = citation(
  PROVENANCE,
  'On a 401 to a request without a key, api.openai.com sends `x-request-id` as `req_` and 32 lowercase hex digits, and sends none of `openai-organization`, `openai-processing-ms` or `openai-version`, which appear only on authenticated requests.',
  WRITTEN,
)

export const MEASURED_OPENAI_UNKNOWN_PARAMETER = citation(
  PROVENANCE,
  "OpenAI rejects an unknown body parameter with a 400 whose message is `Unknown parameter: '<name>'.` and whose `code` is `unknown_parameter`; older routes say `Unrecognized request argument supplied: <name>` instead.",
  WRITTEN,
)

export const MEASURED_OPENAI_MODEL_NOT_FOUND = citation(
  PROVENANCE,
  'OpenAI answers a request for a model that does not exist with a 404 whose message is: The model `<id>` does not exist or you do not have access to it. Its `type` is `invalid_request_error`, its `param` is null and its `code` is `model_not_found`.',
  WRITTEN,
)

export const MEASURED_OPENAI_TEMPERATURE_ABOVE_MAX = citation(
  PROVENANCE,
  "OpenAI answers `temperature: 99` with a 400 whose message is `Invalid 'temperature': decimal above maximum value. Expected a value <= 2, but got 99.0 instead.` and whose `code` is `decimal_above_max_value`.",
  WRITTEN,
)

export const MEASURED_OPENAI_TEMPERATURE_BY_ROUTE = citation(
  PROVENANCE,
  "For a model that takes only the default temperature, Chat Completions says `Unsupported value: 'temperature' does not support <value> with this model. Only the default (1) value is supported.` where the Responses API says `Unsupported parameter: 'temperature' is not supported with this model.` with a null `code`.",
  WRITTEN,
)
