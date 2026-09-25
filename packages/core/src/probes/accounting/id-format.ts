/**
 * Whether the response's `id` has the shape of the IDs OpenAI's own API
 * issues: `chatcmpl-` and 29 letters and digits for a chat completion, `resp_`
 * and 48 hex digits for a response. The shapes are read off the reference's
 * examples, not specified, so the signal is heuristic.
 *
 * An ID in another shape was minted by something other than OpenAI's API - a
 * layer that answers in OpenAI's format. One with Anthropic's `msg_` prefix
 * was minted by Anthropic's. Claude's own IDs are not checked the same way:
 * Anthropic says their format and length may change.
 */

import { ProbeNotApplicable } from '../../runner/errors.js'
import { ANTHROPIC_MESSAGE_ID_EXAMPLE } from '../../sources/anthropic-accounting.js'
import type { Citation } from '../../sources/citation.js'
import {
  OPENAI_CHAT_ID_EXAMPLE,
  OPENAI_RESPONSES_ID_EXAMPLE,
} from '../../sources/openai-accounting.js'
import type { Protocol } from '../../types/target.js'
import { quoted } from '../shared.js'
import type { LlrTable, Probe, ProbeContext, Signal } from '../types.js'
import { accountingSignal, BASELINE_COST, baseline } from './shared.js'

const ID = 'accounting/id-format'

type OpenAIProtocol = Exclude<Protocol, 'anthropic-messages'>

interface Shape {
  readonly prefix: string
  readonly pattern: RegExp
  readonly describe: string
  readonly example: Citation
}

const SHAPES: Readonly<Record<OpenAIProtocol, Shape>> = Object.freeze({
  'openai-chat': {
    prefix: 'chatcmpl-',
    pattern: /^chatcmpl-[A-Za-z0-9]{29}$/,
    describe: '"chatcmpl-" followed by 29 letters and digits',
    example: OPENAI_CHAT_ID_EXAMPLE,
  },
  'openai-responses': {
    prefix: 'resp_',
    pattern: /^resp_[0-9a-f]{48}$/,
    describe: '"resp_" followed by 48 lowercase hex digits',
    example: OPENAI_RESPONSES_ID_EXAMPLE,
  },
})

const ANTHROPIC_PREFIX = 'msg_'

interface Verdict {
  readonly signalId: string
  readonly llr: LlrTable
  readonly plainLanguage: string
}

function verdict(id: string | undefined, shape: Shape): Verdict {
  if (id === undefined) {
    return {
      signalId: 'missing',
      llr: { translation: { translated: 0.3 } },
      plainLanguage:
        "The response had no ID. OpenAI's API gives every response one; a layer between you and the model built this response without it.",
    }
  }
  if (id.startsWith(ANTHROPIC_PREFIX)) {
    return {
      signalId: 'anthropic-shaped',
      llr: { identity: { 'different-vendor': 0.3 }, translation: { translated: 0.3 } },
      plainLanguage:
        "The response's ID has the form Anthropic's API gives its messages, not the form OpenAI's API gives its responses.",
    }
  }
  if (!id.startsWith(shape.prefix)) {
    return {
      signalId: 'foreign-prefix',
      llr: { translation: { translated: 0.3 } },
      plainLanguage:
        "The response's ID does not start the way the IDs of OpenAI's API do. It was issued by a layer that answers in OpenAI's format.",
    }
  }
  if (!shape.pattern.test(id)) {
    return {
      signalId: 'foreign-shape',
      llr: { translation: { translated: 0.2 } },
      plainLanguage:
        "The response's ID starts the way OpenAI's do but is not shaped like the examples OpenAI publishes. Servers that imitate OpenAI's format often issue IDs like this; OpenAI could also change its format.",
    }
  }
  return {
    signalId: 'openai-shaped',
    llr: {},
    plainLanguage:
      "The response's ID has the shape of the IDs OpenAI's API issues. Anything that copies the format can produce the same shape, so this does not show who answered.",
  }
}

function isOpenAIProtocol(protocol: Protocol): protocol is OpenAIProtocol {
  return protocol !== 'anthropic-messages'
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { protocol } = context.target
  if (!isOpenAIProtocol(protocol)) {
    throw new ProbeNotApplicable('Only OpenAI protocols issue IDs in a published shape.')
  }
  const shape = SHAPES[protocol]
  const { id } = (await baseline(context)).generation
  const { signalId, llr, plainLanguage } = verdict(id, shape)
  const isAnthropic = signalId === 'anthropic-shaped'
  return [
    accountingSignal(ID, {
      signalId,
      calibration: 'heuristic',
      observed: id === undefined ? 'The response had no id.' : `The response id was ${quoted(id)}.`,
      expected: `An id of ${shape.describe}, like the reference's example.`,
      llr,
      plainLanguage,
      citations: isAnthropic ? [shape.example, ANTHROPIC_MESSAGE_ID_EXAMPLE] : [shape.example],
    }),
  ]
}

export const idFormat: Probe = Object.freeze<Probe>({
  id: ID,
  title: "IDs shaped like OpenAI's",
  group: 'B',
  protocols: ['openai-chat', 'openai-responses'],
  vendors: ['openai'],
  needsKey: true,
  cost: BASELINE_COST,
  citations: [OPENAI_CHAT_ID_EXAMPLE, OPENAI_RESPONSES_ID_EXAMPLE],
  run,
})
