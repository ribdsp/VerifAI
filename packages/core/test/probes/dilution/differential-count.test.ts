import { describe, expect, it } from 'vitest'
import {
  basePrompt,
  differentialCount,
  testPrompt,
  testString,
} from '../../../src/probes/dilution/differential-count.js'
import { DILUTION_PROBES } from '../../../src/probes/dilution/index.js'
import { BATTERY } from '../../../src/probes/tokenizer/shared.js'
import { ProbeLost, ProbeNotApplicable } from '../../../src/runner/errors.js'
import { PROTOCOLS, type Protocol } from '../../../src/types/target.js'
import { jsonExchange, probeContext, sentJson } from '../../fakes/context.js'
import { countingEndpoint, limitOf, promptOf, refusingOneToken } from '../accounting/replies.js'

const LONG_NONCE = 'z'.repeat(64)

/** Counts one token per four bytes, as a stand-in tokenizer. */
function roughCount(prompt: string): number {
  return Math.ceil(new TextEncoder().encode(prompt).length / 4) + 7
}

function fakeFor(protocol: Protocol, count = roughCount, nonce = 'n0nce7test') {
  return probeContext(countingEndpoint(protocol, count), { protocol, nonce })
}

describe('dilution/differential-count', () => {
  it('runs for every claim over every protocol, two requests a draw', () => {
    expect(differentialCount).toMatchObject({
      group: 'F',
      protocols: [...PROTOCOLS.values],
      vendors: ['anthropic', 'openai'],
      needsKey: true,
      requestsPerDraw: 2,
      cost: { requests: 2 },
    })
    expect(Object.isFrozen(differentialCount)).toBe(true)
    expect(DILUTION_PROBES).toEqual([differentialCount])
  })

  it('keeps one test string for a run and changes it between runs', () => {
    const strings = new Set(['aaaaaaaa', 'aaaaaaab', 'aaaaaaac', 'bbbbbbbb'].map(testString))
    expect(strings.size).toBeGreaterThan(1)
    expect(testString('n0nce7test')).toBe(testString('n0nce7test'))
    for (const text of strings) {
      expect(BATTERY.some((item) => text.startsWith(item.text))).toBe(true)
    }
  })

  it('pairs the last battery string with the first', () => {
    const last = BATTERY.length - 1
    // A one-character nonce chooses the pair starting at its code point, round the battery.
    const printable = Array.from({ length: 94 }, (_unused, offset) =>
      String.fromCodePoint(33 + offset),
    )
    const nonce = printable.find((char) => (char.codePointAt(0) ?? 0) % BATTERY.length === last)

    expect(nonce).toBeDefined()
    expect(testString(nonce ?? '')).toBe(`${BATTERY[last]?.text} ${BATTERY[0]?.text}`)
  })

  it('numbers each prompt and appends the test string to the second', () => {
    expect(basePrompt('n0nce7test', 3)).toContain('Draw 3, reference n0nce7test.')
    expect(testPrompt('n0nce7test', 3)).toBe(
      `${basePrompt('n0nce7test', 3)}\n\n${testString('n0nce7test')}`,
    )
  })

  it('prepares a majority basis with one generation', async () => {
    const fake = fakeFor('anthropic-messages')
    const plan = await differentialCount.prepare(fake.context)

    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]).toMatchObject({ generates: true })
    expect(promptOf(fake.requests[0] as never)).toBe(basePrompt('n0nce7test', 0))
    expect(plan).toMatchObject({ basis: 'mode', measures: expect.stringContaining('test string') })
    expect(plan.reference).toBeUndefined()
    expect(plan.conclude(['12', '12'])).toEqual([])
    expect(Object.isFrozen(plan)).toBe(true)
  })

  it('loses the group when the endpoint answers no generation', async () => {
    const fake = probeContext(() => jsonExchange(500, { error: { message: 'down' } }))
    await expect(differentialCount.prepare(fake.context)).rejects.toBeInstanceOf(ProbeLost)
  })

  it('skips the group when generations report no input count', async () => {
    const fake = fakeFor('openai-chat', () => undefined as unknown as number)
    await expect(differentialCount.prepare(fake.context)).rejects.toBeInstanceOf(ProbeNotApplicable)
  })

  it.each([...PROTOCOLS.values])('reads what the test string adds over %s', async (protocol) => {
    const fake = fakeFor(protocol)
    const plan = await differentialCount.prepare(fake.context)
    const first = await plan.read(fake.context)
    const second = await plan.read(fake.context)

    const added = String(
      roughCount(testPrompt('n0nce7test', 1)) - roughCount(basePrompt('n0nce7test', 1)),
    )
    expect(first).toBe(added)
    expect(second).toMatch(/^\d+$/)
    expect(fake.requests).toHaveLength(5)
    const prompts = fake.requests.map((request) => promptOf(request))
    expect(new Set(prompts).size).toBe(5)
    expect(prompts[1]).toBe(basePrompt('n0nce7test', 1))
    expect(prompts[2]).toBe(testPrompt('n0nce7test', 1))
    expect(prompts[3]).toBe(basePrompt('n0nce7test', 2))
  })

  it('asks the Responses API for its sixteen-token floor and the others for one', async () => {
    const limits = await Promise.all(
      [...PROTOCOLS.values].map(async (protocol) => {
        const fake = fakeFor(protocol)
        await differentialCount.prepare(fake.context)
        const body = sentJson(fake.requests[0]) as Record<string, unknown>
        return body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens
      }),
    )
    expect(limits).toEqual([1, 1, 16])
  })

  it('draws at 16 on a platform that refuses one output token', async () => {
    const fake = probeContext(refusingOneToken(countingEndpoint('openai-chat', roughCount)), {
      protocol: 'openai-chat',
    })

    const plan = await differentialCount.prepare(fake.context)
    const drawn = await plan.read(fake.context)

    expect(drawn).toMatch(/^\d+$/)
    expect(fake.requests.map(limitOf)).toEqual([1, 16, 16, 16])
  })

  it('prepares within one draw of its cost when it finds the floor, for the longest nonce', async () => {
    const fake = probeContext(refusingOneToken(countingEndpoint('openai-chat', roughCount)), {
      protocol: 'openai-chat',
      nonce: LONG_NONCE,
    })

    await differentialCount.prepare(fake.context)

    const billed = fake.requests.reduce((sum, request) => sum + (request.tokens ?? 0), 0)
    expect(fake.requests.length).toBeLessThanOrEqual(differentialCount.cost.requests)
    expect(billed).toBeLessThanOrEqual(differentialCount.cost.tokens)
  })

  it('loses a draw whose second count is missing', async () => {
    let calls = 0
    const fake = fakeFor('anthropic-messages', (prompt) => {
      calls += 1
      return calls === 3 ? (undefined as unknown as number) : roughCount(prompt)
    })
    const plan = await differentialCount.prepare(fake.context)
    expect(await plan.read(fake.context)).toBeUndefined()
    expect(await plan.read(fake.context)).toMatch(/^\d+$/)
  })

  it('does not send the second request of a draw whose first is lost', async () => {
    let calls = 0
    const answer = countingEndpoint('openai-chat', roughCount)
    const fake = probeContext(
      (request, index) => {
        calls += 1
        return calls === 2
          ? jsonExchange(429, { error: { message: 'slow down' } })
          : answer(request, index)
      },
      { protocol: 'openai-chat' },
    )
    const plan = await differentialCount.prepare(fake.context)
    expect(await plan.read(fake.context)).toBeUndefined()
    expect(fake.requests).toHaveLength(2)
  })

  it('declares at least what its dearest draw asks the budget for', async () => {
    for (const protocol of PROTOCOLS.values) {
      for (const nonce of ['aaaaaaaa', 'aaaaaaab', 'aaaaaaac', 'aaaaaaad', LONG_NONCE]) {
        const fake = fakeFor(protocol, roughCount, nonce)
        const plan = await differentialCount.prepare(fake.context)
        await plan.read(fake.context)
        const drawTokens = fake.requests
          .slice(1)
          .reduce((sum, request) => sum + (request.tokens ?? 0), 0)
        expect(drawTokens).toBeLessThanOrEqual(differentialCount.cost.tokens)
      }
    }
  })
})
