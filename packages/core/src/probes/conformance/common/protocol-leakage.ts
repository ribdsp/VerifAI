/**
 * Whether a successful answer carries fields of an API other than the one it
 * was asked in. Each API documents its own markers - `"type": "message"` for
 * Anthropic's Messages, `"object": "chat.completion"` or `"response"` and a
 * `system_fingerprint` for OpenAI's two - and a layer that builds its answer by
 * copying another API's response, then renaming what it knows, leaves the rest
 * behind. A gateway serving one OpenAI API by calling the other leaks the same
 * way.
 *
 * The markers say how the answer was assembled, not which model wrote it, so
 * no identity finding moves.
 */

import { isJsonObject, type JsonObject, member, readString } from '../../../adapters/json.js'
import { ANTHROPIC_MESSAGE_TYPE } from '../../../sources/anthropic-conformance-common.js'
import type { Citation } from '../../../sources/citation.js'
import {
  OPENAI_CHAT_COMPLETION_OBJECT,
  OPENAI_RESPONSE_OBJECT,
  OPENAI_SYSTEM_FINGERPRINT,
} from '../../../sources/openai-conformance.js'
import type { Protocol } from '../../../types/target.js'
import { generationRequest, isSuccess, jsonOf, signal } from '../../shared.js'
import type { Probe, ProbeContext, ProbeTarget, Signal } from '../../types.js'
import { TINY_PROMPT, TINY_REQUEST_TOKENS } from './shared.js'

const ID = 'conformance/common/protocol-leakage'

const FINGERPRINT = 'system_fingerprint'

interface Marker {
  /** Reads `body` and says whether the marker is there. */
  readonly present: (body: JsonObject) => boolean
  readonly label: string
  readonly source: Citation
}

const OBJECT_CHAT: Marker = {
  present: (body) => readString(body, 'object') === 'chat.completion',
  label: '"object": "chat.completion"',
  source: OPENAI_CHAT_COMPLETION_OBJECT,
}
const OBJECT_RESPONSE: Marker = {
  present: (body) => readString(body, 'object') === 'response',
  label: '"object": "response"',
  source: OPENAI_RESPONSE_OBJECT,
}
const TYPE_MESSAGE: Marker = {
  present: (body) => readString(body, 'type') === 'message',
  label: '"type": "message"',
  source: ANTHROPIC_MESSAGE_TYPE,
}
const SYSTEM_FINGERPRINT: Marker = {
  present: (body) => member(body, FINGERPRINT) !== undefined,
  label: `a "${FINGERPRINT}" field`,
  source: OPENAI_SYSTEM_FINGERPRINT,
}

/**
 * What would be foreign in each protocol's answer. A Chat Completions answer
 * named `response`, or a Responses one named `chat.completion`, contradicts
 * the route's own documented object type, which is the citation it carries.
 */
const FOREIGN: Readonly<Record<Protocol, readonly Marker[]>> = Object.freeze({
  'anthropic-messages': [OBJECT_CHAT, OBJECT_RESPONSE, SYSTEM_FINGERPRINT],
  'openai-chat': [TYPE_MESSAGE, { ...OBJECT_RESPONSE, source: OPENAI_CHAT_COMPLETION_OBJECT }],
  'openai-responses': [TYPE_MESSAGE, { ...OBJECT_CHAT, source: OPENAI_RESPONSE_OBJECT }],
})

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { protocol } = context.target
  const exchange = await context.send(
    generationRequest(context.target, { prompt: TINY_PROMPT, maxTokens: 1 }),
  )
  const body = jsonOf(exchange)
  if (!isSuccess(exchange) || !isJsonObject(body)) {
    return []
  }
  const found = FOREIGN[protocol].filter((marker) => marker.present(body))
  const [first, ...rest] = found
  if (first === undefined) {
    return []
  }
  const labels = found.map((marker) => marker.label).join(', ')
  return [
    signal({
      probeId: ID,
      signalId: 'foreign-markers',
      family: 'protocol-conformance',
      calibration: 'documented',
      observed: `A successful ${protocol} answer carries ${labels}.`,
      expected: `None of ${FOREIGN[protocol].map((marker) => marker.label).join(', ')}: each belongs to another API.`,
      llr: {
        platform: { 'first-party': -0.5 },
        translation: { translated: 0.8, direct: -0.5 },
      },
      plainLanguage: `The endpoint's answer carries ${labels}, which another API documents as its own and the API you called does not send. That is what a layer that converts one API's answers into another's leaves behind. It says nothing about which model answers.`,
      citations: [first.source, ...rest.map((marker) => marker.source)],
    }),
  ]
}

export const protocolLeakage: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Another API's fields in the answer",
  group: 'A',
  protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
  vendors: ['anthropic', 'openai'],
  applies: (target: ProbeTarget) => target.pairing === 'native',
  needsKey: true,
  cost: { requests: 1, tokens: TINY_REQUEST_TOKENS },
  citations: [
    OPENAI_CHAT_COMPLETION_OBJECT,
    OPENAI_RESPONSE_OBJECT,
    OPENAI_SYSTEM_FINGERPRINT,
    ANTHROPIC_MESSAGE_TYPE,
  ],
  run,
})
