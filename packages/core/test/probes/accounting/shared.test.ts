import { describe, expect, it } from 'vitest'
import type { Usage } from '../../../src/adapters/types.js'
import { ACCOUNTING_PROBES } from '../../../src/probes/accounting/index.js'
import {
  BASELINE_COST,
  baseline,
  baselinePrompt,
  distinctCitations,
  reportedInput,
} from '../../../src/probes/accounting/shared.js'
import { smallestOutputLimit } from '../../../src/probes/output-floor.js'
import { TOKENIZER_PROBES } from '../../../src/probes/tokenizer/index.js'
import { ProbeLost } from '../../../src/runner/errors.js'
import { ANTHROPIC_USAGE_TOTAL_INPUT } from '../../../src/sources/anthropic.js'
import { OPENAI_CHAT_TOTAL_TOKENS } from '../../../src/sources/openai.js'
import type { Protocol } from '../../../src/types/target.js'
import { exchange, inOrder, probeContext, sentJson } from '../../fakes/context.js'
import { limitOf, refusingOneToken, reply } from './replies.js'

const PROTOCOLS: readonly Protocol[] = ['anthropic-messages', 'openai-chat', 'openai-responses']

function usage(fields: Partial<Usage>): Usage {
  return {
    input: undefined,
    output: undefined,
    total: undefined,
    cacheRead: undefined,
    cacheCreation: undefined,
    reasoning: undefined,
    ...fields,
  }
}

describe('accounting/shared', () => {
  it.each(PROTOCOLS)(
    'sends the %s baseline once, under the smallest output limit',
    async (protocol) => {
      const fake = probeContext(inOrder(reply(protocol)), { protocol })

      const first = await baseline(fake.context)
      const second = await baseline(fake.context)

      expect(second).toBe(first)
      expect(fake.requests).toHaveLength(1)
      expect(first.outputLimit).toBe(smallestOutputLimit(protocol))
      expect(first).not.toHaveProperty('refusedLimit')
      expect(first.prompt).toBe(baselinePrompt('n0nce7test'))
      expect(fake.requests[0]?.generates).toBe(true)
      expect(fake.requests[0]?.tokens).toBeLessThanOrEqual(BASELINE_COST.tokens)
      expect(JSON.stringify(sentJson(fake.requests[0]))).toContain('Reference n0nce7test.')
      expect(Object.isFrozen(first)).toBe(true)
    },
  )

  it('sends the baseline again at 16 to a platform that refuses one output token', async () => {
    const fake = probeContext(refusingOneToken(inOrder(reply('openai-chat'))), {
      protocol: 'openai-chat',
    })

    const found = await baseline(fake.context)

    expect(fake.requests.map(limitOf)).toEqual([1, 16])
    expect(found).toMatchObject({ outputLimit: 16, refusedLimit: 1 })
    expect(found.request).toBe(fake.requests[1])
    expect(found.generation.usage?.input).toBe(300)
  })

  it('bounds what the baseline bills for the longest nonce', async () => {
    const fake = probeContext(inOrder(reply('openai-responses')), {
      protocol: 'openai-responses',
      nonce: 'z'.repeat(64),
    })

    await baseline(fake.context)

    expect(fake.requests[0]?.tokens).toBeLessThanOrEqual(BASELINE_COST.tokens)
  })

  it('bounds what finding the floor bills, for the longest nonce', async () => {
    const fake = probeContext(refusingOneToken(inOrder(reply('openai-chat'))), {
      protocol: 'openai-chat',
      nonce: 'z'.repeat(64),
    })

    await baseline(fake.context)

    const billed = fake.requests.reduce((sum, request) => sum + (request.tokens ?? 0), 0)
    expect(fake.requests).toHaveLength(BASELINE_COST.requests)
    expect(billed).toBeLessThanOrEqual(BASELINE_COST.tokens)
  })

  it.each([
    ['an error status', exchange(500, 'upstream failed')],
    ['a body that is not a generation', exchange(200, '<html>ok</html>')],
  ])('loses the probe on %s', async (_label, answer) => {
    const fake = probeContext(inOrder(answer))

    await expect(baseline(fake.context)).rejects.toBeInstanceOf(ProbeLost)
  })

  it("adds Anthropic's cache reads and writes to input_tokens, and takes OpenAI's as reported", () => {
    const counted = usage({ input: 10, cacheRead: 200, cacheCreation: 30 })

    expect(reportedInput('anthropic-messages', counted)).toBe(240)
    expect(reportedInput('anthropic-messages', usage({ input: 10 }))).toBe(10)
    expect(reportedInput('openai-chat', counted)).toBe(10)
    expect(reportedInput('openai-responses', usage({ output: 3 }))).toBeUndefined()
    expect(reportedInput('openai-chat', undefined)).toBeUndefined()
  })

  it('cites each source once, in first-seen order, and refuses to cite none', () => {
    expect(
      distinctCitations([
        OPENAI_CHAT_TOTAL_TOKENS,
        ANTHROPIC_USAGE_TOTAL_INPUT,
        OPENAI_CHAT_TOTAL_TOKENS,
      ]),
    ).toEqual([OPENAI_CHAT_TOTAL_TOKENS, ANTHROPIC_USAGE_TOTAL_INPUT])
    expect(() => distinctCitations([])).toThrow(TypeError)
  })
})

describe('Group B and C registries', () => {
  it.each([
    ['accounting', 'B', ACCOUNTING_PROBES],
    ['tokenizer', 'C', TOKENIZER_PROBES],
  ] as const)('lists every %s probe once, in group %s', (directory, group, probes) => {
    const ids = probes.map((probe) => probe.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.isFrozen(probes)).toBe(true)
    for (const probe of probes) {
      expect(probe.id.startsWith(`${directory}/`)).toBe(true)
      expect(probe.group).toBe(group)
      expect(probe.needsKey).toBe(true)
      expect(probe.cost.tokens).toBeGreaterThan(0)
      expect(probe.cost.requests).toBeGreaterThanOrEqual(BASELINE_COST.requests)
      expect(probe.citations.length).toBeGreaterThan(0)
      expect(Object.isFrozen(probe)).toBe(true)
    }
  })

  it('carries the seven accounting probes and the two tokenizer probes', () => {
    expect(ACCOUNTING_PROBES.map((probe) => probe.id)).toEqual([
      'accounting/usage-arithmetic',
      'accounting/output-limit',
      'accounting/id-format',
      'accounting/snapshot-echo',
      'accounting/system-fingerprint',
      'accounting/count-tokens-agreement',
      'accounting/hidden-input',
    ])
    expect(TOKENIZER_PROBES.map((probe) => probe.id)).toEqual([
      'tokenizer/openai-local-count',
      'tokenizer/anthropic-differential',
    ])
  })
})
