/**
 * Whether the counts in a response's `usage` add up the way the protocol's
 * vendor defines them: a total that is the sum of its parts, a cached or
 * reasoning share no larger than the count it is a share of, an output count
 * that is never zero.
 *
 * Only the translation axis moves. Inconsistent counts were written by
 * something other than the vendor's own accounting - a layer that rebuilt
 * `usage` - and say nothing about which model produced the text. Consistent
 * counts prove nothing either: a careful layer adds up correctly.
 */

import type { Usage } from '../../adapters/types.js'
import { ANTHROPIC_USAGE_TOTAL_INPUT } from '../../sources/anthropic.js'
import {
  ANTHROPIC_OUTPUT_BREAKDOWN,
  ANTHROPIC_OUTPUT_INCLUSIVE,
  ANTHROPIC_OUTPUT_NON_ZERO,
  ANTHROPIC_USAGE_BILLING,
} from '../../sources/anthropic-accounting.js'
import type { Citation } from '../../sources/citation.js'
import { OPENAI_CHAT_PROMPT_TOKENS, OPENAI_CHAT_TOTAL_TOKENS } from '../../sources/openai.js'
import {
  OPENAI_CHAT_CACHED_TOKENS,
  OPENAI_CHAT_COMPLETION_BREAKDOWN,
  OPENAI_CHAT_COMPLETION_TOKENS,
  OPENAI_CHAT_PROMPT_BREAKDOWN,
  OPENAI_CHAT_REASONING_TOKENS,
  OPENAI_CHAT_USAGE,
  OPENAI_RESPONSES_CACHED_TOKENS,
  OPENAI_RESPONSES_INPUT_BREAKDOWN,
  OPENAI_RESPONSES_INPUT_TOKENS,
  OPENAI_RESPONSES_OUTPUT_BREAKDOWN,
  OPENAI_RESPONSES_TOTAL_TOKENS,
} from '../../sources/openai-accounting.js'
import type { Protocol } from '../../types/target.js'
import {
  CALIBRATIONS,
  type Calibration,
  type Probe,
  type ProbeContext,
  type Signal,
} from '../types.js'
import { accountingSignal, BASELINE_COST, baseline, distinctCitations } from './shared.js'

const ID = 'accounting/usage-arithmetic'

/** One relation between counts. `holds` is `undefined` when a count it needs is absent. */
interface Rule {
  readonly holds: (usage: Usage) => boolean | undefined
  readonly describe: (usage: Usage) => string
  readonly calibration: Calibration
  /** The translation ratio a violation carries. */
  readonly weight: number
  readonly citations: readonly [Citation, ...Citation[]]
}

function count(value: number | undefined): string {
  return value === undefined ? 'absent' : String(value)
}

function present(value: number | undefined): boolean {
  return value !== undefined
}

function atMost(part: number | undefined, whole: number | undefined): boolean | undefined {
  return part === undefined || whole === undefined ? undefined : part <= whole
}

function sumOf(
  total: number | undefined,
  first: number | undefined,
  second: number | undefined,
): boolean | undefined {
  if (total === undefined || first === undefined || second === undefined) {
    return undefined
  }
  return total === first + second
}

const CHAT_RULES: readonly Rule[] = Object.freeze([
  {
    holds: (usage) => present(usage.input) && present(usage.output) && present(usage.total),
    describe: (usage) =>
      `prompt_tokens ${count(usage.input)}, completion_tokens ${count(usage.output)}, total_tokens ${count(usage.total)}`,
    calibration: 'heuristic',
    weight: 0.3,
    citations: [OPENAI_CHAT_PROMPT_TOKENS, OPENAI_CHAT_COMPLETION_TOKENS, OPENAI_CHAT_TOTAL_TOKENS],
  },
  {
    holds: (usage) => sumOf(usage.total, usage.input, usage.output),
    describe: (usage) =>
      `total_tokens ${count(usage.total)} against prompt_tokens + completion_tokens = ${(usage.input ?? 0) + (usage.output ?? 0)}`,
    calibration: 'documented',
    weight: 0.5,
    citations: [OPENAI_CHAT_TOTAL_TOKENS],
  },
  {
    holds: (usage) => atMost(usage.cacheRead, usage.input),
    describe: (usage) =>
      `cached_tokens ${count(usage.cacheRead)} of prompt_tokens ${count(usage.input)}`,
    calibration: 'documented',
    weight: 0.4,
    citations: [OPENAI_CHAT_PROMPT_BREAKDOWN, OPENAI_CHAT_CACHED_TOKENS],
  },
  {
    holds: (usage) => atMost(usage.reasoning, usage.output),
    describe: (usage) =>
      `reasoning_tokens ${count(usage.reasoning)} of completion_tokens ${count(usage.output)}`,
    calibration: 'documented',
    weight: 0.4,
    citations: [OPENAI_CHAT_COMPLETION_BREAKDOWN, OPENAI_CHAT_REASONING_TOKENS],
  },
])

const RESPONSES_RULES: readonly Rule[] = Object.freeze([
  {
    holds: (usage) => present(usage.input) && present(usage.output),
    describe: (usage) => `input_tokens ${count(usage.input)}, output_tokens ${count(usage.output)}`,
    calibration: 'heuristic',
    weight: 0.3,
    citations: [OPENAI_RESPONSES_INPUT_TOKENS],
  },
  {
    holds: (usage) => sumOf(usage.total, usage.input, usage.output),
    describe: (usage) =>
      `total_tokens ${count(usage.total)} against input_tokens + output_tokens = ${(usage.input ?? 0) + (usage.output ?? 0)}`,
    // The reference calls it only "the total number of tokens used", without naming the parts.
    calibration: 'heuristic',
    weight: 0.3,
    citations: [OPENAI_RESPONSES_TOTAL_TOKENS],
  },
  {
    holds: (usage) => atMost(usage.cacheRead, usage.input),
    describe: (usage) =>
      `cached_tokens ${count(usage.cacheRead)} of input_tokens ${count(usage.input)}`,
    calibration: 'documented',
    weight: 0.4,
    citations: [OPENAI_RESPONSES_INPUT_BREAKDOWN, OPENAI_RESPONSES_CACHED_TOKENS],
  },
  {
    holds: (usage) => atMost(usage.reasoning, usage.output),
    describe: (usage) =>
      `reasoning_tokens ${count(usage.reasoning)} of output_tokens ${count(usage.output)}`,
    calibration: 'documented',
    weight: 0.4,
    citations: [OPENAI_RESPONSES_OUTPUT_BREAKDOWN],
  },
])

const ANTHROPIC_RULES: readonly Rule[] = Object.freeze([
  {
    holds: (usage) => present(usage.input),
    describe: (usage) => `input_tokens ${count(usage.input)}`,
    calibration: 'documented',
    weight: 0.3,
    citations: [ANTHROPIC_USAGE_TOTAL_INPUT],
  },
  {
    holds: (usage) => (usage.output === undefined ? false : usage.output > 0),
    describe: (usage) => `output_tokens ${count(usage.output)}`,
    calibration: 'documented',
    weight: 0.4,
    citations: [ANTHROPIC_OUTPUT_NON_ZERO],
  },
  {
    holds: (usage) => atMost(usage.reasoning, usage.output),
    describe: (usage) =>
      `thinking_tokens ${count(usage.reasoning)} of output_tokens ${count(usage.output)}`,
    calibration: 'documented',
    weight: 0.4,
    citations: [ANTHROPIC_OUTPUT_INCLUSIVE, ANTHROPIC_OUTPUT_BREAKDOWN],
  },
])

const RULES: Readonly<Record<Protocol, readonly Rule[]>> = Object.freeze({
  'anthropic-messages': ANTHROPIC_RULES,
  'openai-chat': CHAT_RULES,
  'openai-responses': RESPONSES_RULES,
})

const EXPECTED: Readonly<Record<Protocol, string>> = Object.freeze({
  'anthropic-messages':
    'A usage object with input_tokens and a non-zero output_tokens, and any thinking_tokens no larger than output_tokens.',
  'openai-chat':
    'A usage object whose total_tokens is prompt_tokens + completion_tokens, with cached_tokens no larger than prompt_tokens and reasoning_tokens no larger than completion_tokens.',
  'openai-responses':
    'A usage object whose total_tokens is input_tokens + output_tokens, with cached_tokens no larger than input_tokens and reasoning_tokens no larger than output_tokens.',
})

/** Anthropic's `usage` is a required field; OpenAI marks it optional on both APIs. */
function missingUsage(protocol: Protocol): Signal {
  const isAnthropic = protocol === 'anthropic-messages'
  return accountingSignal(ID, {
    signalId: 'no-usage',
    calibration: isAnthropic ? 'documented' : 'heuristic',
    observed: 'The response carried no readable usage object.',
    expected: EXPECTED[protocol],
    llr: { translation: { translated: isAnthropic ? 0.4 : 0.3 } },
    plainLanguage:
      "The response did not say how many tokens it used. The vendor's own API reports this with every answer; something between you and the model left it out.",
    citations: isAnthropic
      ? [ANTHROPIC_USAGE_BILLING]
      : [protocol === 'openai-chat' ? OPENAI_CHAT_USAGE : OPENAI_RESPONSES_TOTAL_TOKENS],
  })
}

function strongest(rules: readonly Rule[]): Calibration {
  const ranks = rules.map((rule) => CALIBRATIONS.values.indexOf(rule.calibration))
  return CALIBRATIONS.values[Math.min(...ranks)] ?? 'heuristic'
}

function citationsOf(rules: readonly Rule[]): readonly [Citation, ...Citation[]] {
  return distinctCitations(rules.flatMap((rule) => rule.citations))
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { protocol } = context.target
  const { usage } = (await baseline(context)).generation
  if (usage === undefined) {
    return [missingUsage(protocol)]
  }
  const rules = RULES[protocol]
  const checked = rules.filter((rule) => rule.holds(usage) !== undefined)
  const broken = checked.filter((rule) => rule.holds(usage) === false)
  const reported = checked.map((rule) => rule.describe(usage)).join('; ')
  if (broken.length === 0) {
    return [
      accountingSignal(ID, {
        signalId: 'consistent',
        calibration: strongest(checked),
        observed: `The usage counts are consistent: ${reported}.`,
        expected: EXPECTED[protocol],
        llr: {},
        plainLanguage:
          'The token counts in the response add up the way the vendor defines them. A layer that rewrites the counts can also add them up correctly, so this says nothing about who answered.',
        citations: citationsOf(checked),
      }),
    ]
  }
  return [
    accountingSignal(ID, {
      signalId: 'inconsistent',
      calibration: strongest(broken),
      observed: `The usage counts do not add up: ${broken.map((rule) => rule.describe(usage)).join('; ')}.`,
      expected: EXPECTED[protocol],
      llr: { translation: { translated: Math.max(...broken.map((rule) => rule.weight)) } },
      plainLanguage:
        "The token counts in the response do not add up the way the vendor defines them. The vendor's own accounting does not produce such numbers, so a layer between you and the model wrote them. It says nothing about which model answered.",
      citations: citationsOf(broken),
    }),
  ]
}

export const usageArithmetic: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Usage counts that add up',
  group: 'B',
  protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
  vendors: ['anthropic', 'openai'],
  needsKey: true,
  cost: BASELINE_COST,
  citations: [ANTHROPIC_USAGE_TOTAL_INPUT, OPENAI_CHAT_TOTAL_TOKENS, OPENAI_RESPONSES_TOTAL_TOKENS],
  run,
})
