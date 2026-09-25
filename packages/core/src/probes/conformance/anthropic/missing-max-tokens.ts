/**
 * What the endpoint does with a Messages request that leaves out `max_tokens`.
 * Anthropic's API reference marks every optional body parameter `optional`
 * and leaves `max_tokens` unmarked: the API requires it and refuses a request
 * without it. A layer that fills in a default of its own lets the model
 * answer.
 */

import { adapterFor } from '../../../adapters/adapter.js'
import {
  ANTHROPIC_ERROR_400,
  ANTHROPIC_MAX_TOKENS_PARAMETER,
  ANTHROPIC_OPTIONAL_PARAMETER,
} from '../../../sources/anthropic-conformance.js'
import { errorOf, estimateTokens, isSuccess } from '../../shared.js'
import type { Probe, ProbeContext, ProbeRequest, ProbeTarget, Signal } from '../../types.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  conformanceSignal,
  describeAnswer,
  PROMPT,
} from './shared.js'

const ID = 'conformance/anthropic/missing-max-tokens'

/** A layer's default is unknown; the prompt asks for one word, so this bounds what it bills. */
const DEFAULTED_TOKENS = 1024
const TOKENS = estimateTokens(PROMPT) + DEFAULTED_TOKENS

const CITATIONS = [
  ANTHROPIC_MAX_TOKENS_PARAMETER,
  ANTHROPIC_OPTIONAL_PARAMETER,
  ANTHROPIC_ERROR_400,
] as const

function withoutMaxTokens(target: ProbeTarget): ProbeRequest {
  return Object.freeze({
    path: adapterFor('anthropic-messages').generatePath,
    body: {
      json: { model: target.requestedModel, messages: [{ role: 'user', content: PROMPT }] },
    },
    protocol: 'anthropic-messages',
    generates: true,
    provokes: [400],
    tokens: TOKENS,
  })
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const exchange = await context.send(withoutMaxTokens(context.target))
  const common = {
    probeId: ID,
    calibration: 'documented' as const,
    observed: `A request without max_tokens was answered with ${describeAnswer(exchange)}.`,
    expected: 'A 400 invalid_request_error: max_tokens is a required parameter.',
    citations: CITATIONS,
  }
  if (isSuccess(exchange)) {
    return [
      conformanceSignal({
        ...common,
        signalId: 'accepted',
        llr: { platform: { 'first-party': -0.4 }, translation: { translated: 0.3 } },
        plainLanguage:
          "The endpoint answered a request that leaves out max_tokens. Anthropic's API requires that setting and refuses such a request.",
      }),
    ]
  }
  if (exchange.status !== 400 || errorOf(exchange)?.dialect !== 'anthropic') {
    return []
  }
  return [
    conformanceSignal({
      ...common,
      signalId: 'refused',
      llr: { translation: { direct: 0.2 }, platform: { 'first-party': 0.1 } },
      plainLanguage:
        "The endpoint refused a request that leaves out max_tokens, as Anthropic's API does.",
    }),
  ]
}

export const missingMaxTokens: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Anthropic's required max_tokens",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  needsKey: true,
  cost: { requests: 1, tokens: TOKENS },
  citations: CITATIONS,
  run,
})
