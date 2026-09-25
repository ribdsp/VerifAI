import { describe, expect, it } from 'vitest'
import {
  BATTERY,
  BATTERY_COST,
  basePrompt,
  describeDeltas,
  isConstant,
  isExact,
  itemPrompt,
  localDeltas,
  matchingEstimator,
  meanAbsoluteDeviation,
  measuredDeltas,
  rewrittenCounts,
} from '../../../src/probes/tokenizer/shared.js'
import { ProbeLost } from '../../../src/runner/errors.js'
import { MEASURED_ESTIMATED_USAGE } from '../../../src/sources/measured-accounting.js'
import { type LocalEncoding, loadTokenizer } from '../../../src/tokenizer/local.js'
import { exchange, probeContext, sentJson } from '../../fakes/context.js'
import { countingEndpoint, limitOf, refusingOneToken } from '../accounting/replies.js'

const NONCE = 'n0nce7test'
const ENCODINGS: readonly LocalEncoding[] = ['o200k_base', 'cl100k_base']

describe('tokenizer/shared', () => {
  it.each([
    ['openai-chat', 'max_completion_tokens', 1],
    ['openai-responses', 'max_output_tokens', 16],
    ['anthropic-messages', 'max_tokens', 1],
  ] as const)('measures the battery once per run over %s', async (protocol, field, limit) => {
    const fake = probeContext(
      countingEndpoint(protocol, (prompt) => 20 + prompt.length),
      { protocol },
    )

    const first = await measuredDeltas(fake.context)
    const second = await measuredDeltas(fake.context)

    expect(second).toBe(first)
    expect(first).toEqual(BATTERY.map((item) => item.text.length + 2))
    expect(fake.requests).toHaveLength(BATTERY.length + 1)
    expect(sentJson(fake.requests[0])).toMatchObject({ [field]: limit })
  })

  it('measures the battery at 16 on a platform that refuses one output token', async () => {
    const fake = probeContext(
      refusingOneToken(countingEndpoint('openai-chat', (prompt) => 20 + prompt.length)),
      { protocol: 'openai-chat' },
    )

    const deltas = await measuredDeltas(fake.context)

    expect(deltas).toEqual(BATTERY.map((item) => item.text.length + 2))
    expect(fake.requests.map(limitOf)).toEqual([1, ...Array(BATTERY.length + 1).fill(16)])
  })

  it('bills no more than its cost when it finds the floor, for the longest nonce', async () => {
    const fake = probeContext(
      refusingOneToken(countingEndpoint('openai-chat', (prompt) => 20 + prompt.length)),
      { protocol: 'openai-chat', nonce: 'q'.repeat(64) },
    )

    await measuredDeltas(fake.context)

    const billed = fake.requests.reduce((sum, request) => sum + (request.tokens ?? 0), 0)
    expect(fake.requests).toHaveLength(BATTERY_COST.requests)
    expect(billed).toBeLessThanOrEqual(BATTERY_COST.tokens)
  })

  it('sends the base prompt first, then each battery string after it', async () => {
    const fake = probeContext(
      countingEndpoint('openai-chat', () => 1),
      { protocol: 'openai-chat' },
    )

    await measuredDeltas(fake.context)

    const prompts = fake.requests.map(
      (request) => (sentJson(request) as { messages: { content: string }[] }).messages[0]?.content,
    )
    expect(prompts).toEqual([basePrompt(NONCE), ...BATTERY.map((item) => itemPrompt(NONCE, item))])
  })

  it('bills no more than its cost, for the longest nonce', async () => {
    const fake = probeContext(
      countingEndpoint('openai-responses', () => 1),
      {
        protocol: 'openai-responses',
        nonce: 'q'.repeat(64),
      },
    )

    await measuredDeltas(fake.context)

    const tokens = fake.requests.map((request) => request.tokens)
    expect(tokens).not.toContain(undefined)
    const billed = tokens.reduce<number>((sum, count) => sum + (count ?? 0), 0)
    expect(billed).toBeLessThanOrEqual(BATTERY_COST.tokens)
  })

  it.each([
    ['the base prompt', (prompt: string) => (prompt === basePrompt(NONCE) ? undefined : 5)],
    ['one battery string', (prompt: string) => (prompt.includes('Pasang') ? undefined : 5)],
  ])('has no deltas when %s is answered without a count', async (_label, count) => {
    const fake = probeContext(countingEndpoint('openai-chat', count), { protocol: 'openai-chat' })

    await expect(measuredDeltas(fake.context)).resolves.toBeUndefined()
  })

  it('is lost when a prompt is not answered with a generation', async () => {
    const counting = countingEndpoint('openai-chat', () => 5)
    const fake = probeContext(
      (request, index) => (index < 3 ? counting(request, index) : exchange(503)),
      { protocol: 'openai-chat' },
    )

    await expect(measuredDeltas(fake.context)).rejects.toBeInstanceOf(ProbeLost)
    expect(fake.requests).toHaveLength(4)
  })

  it.each(ENCODINGS)(
    'computes %s deltas that are neither constant nor a length estimate',
    async (encoding) => {
      const tokenizer = await loadTokenizer(encoding)
      const deltas = await localDeltas(encoding, NONCE)

      expect(deltas).toHaveLength(BATTERY.length)
      expect(Object.isFrozen(deltas)).toBe(true)
      expect(deltas[0]).toBe(
        tokenizer.count(itemPrompt(NONCE, BATTERY[0] ?? { name: '', text: '' })) -
          tokenizer.count(basePrompt(NONCE)),
      )
      expect(isConstant(deltas)).toBe(false)
      expect(matchingEstimator(deltas)).toBeUndefined()
      expect(rewrittenCounts('tokenizer/test', deltas, [MEASURED_ESTIMATED_USAGE])).toBeUndefined()
    },
  )

  it('tells the two public encodings apart on the battery', async () => {
    const [o200k, cl100k] = await Promise.all(
      ENCODINGS.map((encoding) => localDeltas(encoding, NONCE)),
    )

    expect(isExact(o200k ?? [], cl100k ?? [])).toBe(false)
  })

  it('compares deltas', () => {
    expect(meanAbsoluteDeviation([1, 2, 3], [1, 4, 0])).toBeCloseTo(5 / 3)
    expect(meanAbsoluteDeviation([2], [])).toBe(2)
    expect(meanAbsoluteDeviation([], [])).toBe(0)
    expect(isExact([1, 2], [1, 2])).toBe(true)
    expect(isExact([1, 2], [1, 2, 3])).toBe(false)
    expect(isExact([1, 2], [1, 3])).toBe(false)
    expect(isConstant([4, 4, 4])).toBe(true)
    expect(isConstant([4, 5])).toBe(false)
  })

  it.each([3, 4])('recognises counts of characters / %i', (divisor) => {
    const deltas = BATTERY.map((item) => Math.round((item.text.length + 2) / divisor))

    expect(matchingEstimator(deltas)).toBe(`characters / ${divisor}`)
  })

  it('recognises counts of UTF-8 bytes / 4', () => {
    const bytes = new TextEncoder()
    const deltas = BATTERY.map((item) => Math.ceil(bytes.encode(`\n\n${item.text}`).length / 4))

    expect(matchingEstimator(deltas)).toBe('UTF-8 bytes / 4')
  })

  it('matches no estimate when a delta is missing', () => {
    const deltas = BATTERY.map((item) => Math.round((item.text.length + 2) / 4)).slice(1)

    expect(matchingEstimator(deltas)).toBeUndefined()
  })

  it('describes each delta by its string', () => {
    expect(describeDeltas([3, 4])).toBe(
      'chinese 3, emoji 4, cyrillic absent, arabic absent, whitespace absent, base64 absent, code absent, indonesian absent',
    )
  })

  it('reads counts that do not follow the text as written by a layer', () => {
    const constant = rewrittenCounts(
      'tokenizer/test',
      [6, 6, 6, 6, 6, 6, 6, 6],
      [MEASURED_ESTIMATED_USAGE],
    )
    const estimated = rewrittenCounts(
      'tokenizer/test',
      BATTERY.map((item) => Math.round((item.text.length + 2) / 3)),
      [MEASURED_ESTIMATED_USAGE],
    )

    expect(constant).toMatchObject({
      signalId: 'constant-counts',
      family: 'tokenizer',
      calibration: 'derived',
      llr: { identity: { 'not-a-live-model': 0.2 }, translation: { translated: 0.5 } },
    })
    expect(estimated).toMatchObject({
      signalId: 'estimated-counts',
      llr: { translation: { translated: 0.5 } },
    })
    expect(estimated?.llr.identity).toBeUndefined()
    expect(estimated?.plainLanguage).toContain('characters / 3')
  })
})
