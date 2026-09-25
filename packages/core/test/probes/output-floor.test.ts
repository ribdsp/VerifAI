import { describe, expect, it } from 'vitest'
import {
  discoveryCost,
  MAX_OUTPUT_FLOOR,
  sendAtOutputFloor,
  smallestOutputLimit,
} from '../../src/probes/output-floor.js'
import { estimateTokens } from '../../src/probes/shared.js'
import { ProbeLost } from '../../src/runner/errors.js'
import type { Protocol } from '../../src/types/target.js'
import { exchange, inOrder, jsonExchange, probeContext, sentJson } from '../fakes/context.js'
import { limitOf, ONE_TOKEN_REFUSAL, reply } from './accounting/replies.js'

const PROTOCOLS: readonly Protocol[] = ['anthropic-messages', 'openai-chat', 'openai-responses']
const PROMPT = 'Reference n0nce7test. Reply with one word.'

describe('probes/output-floor', () => {
  it('starts from 1 output token, or 16 on Responses', () => {
    expect(PROTOCOLS.map(smallestOutputLimit)).toEqual([1, 1, 16])
    expect(MAX_OUTPUT_FLOOR).toBe(16)
  })

  it.each(PROTOCOLS)('sends one %s request at the smallest limit it accepts', async (protocol) => {
    const fake = probeContext(inOrder(reply(protocol)), { protocol })

    const sent = await sendAtOutputFloor(fake.context, PROMPT)

    expect(fake.requests).toHaveLength(1)
    expect(limitOf(fake.requests[0])).toBe(smallestOutputLimit(protocol))
    expect(sent).toMatchObject({ outputLimit: smallestOutputLimit(protocol) })
    expect(sent).not.toHaveProperty('refusedLimit')
    expect(sent.request).toBe(fake.requests[0])
    expect(sent.exchange.status).toBe(200)
    expect(Object.isFrozen(sent)).toBe(true)
  })

  it('tries the same prompt once more at 16 when one output token is refused with a 400', async () => {
    const fake = probeContext(inOrder(ONE_TOKEN_REFUSAL, reply('openai-chat')), {
      protocol: 'openai-chat',
    })

    const sent = await sendAtOutputFloor(fake.context, PROMPT)

    expect(fake.requests.map(limitOf)).toEqual([1, 16])
    for (const request of fake.requests) {
      expect(JSON.stringify(sentJson(request))).toContain(PROMPT)
    }
    expect(sent).toMatchObject({ outputLimit: 16, refusedLimit: 1 })
    expect(sent.request).toBe(fake.requests[1])
    expect(sent.exchange.status).toBe(200)
  })

  it('sends every later prompt once, at the limit the endpoint accepted', async () => {
    const fake = probeContext(inOrder(ONE_TOKEN_REFUSAL, reply('anthropic-messages')))

    await sendAtOutputFloor(fake.context, PROMPT)
    const later = await sendAtOutputFloor(fake.context, `${PROMPT} Again.`)

    expect(fake.requests.map(limitOf)).toEqual([1, 16, 16])
    expect(later).toMatchObject({ outputLimit: 16, refusedLimit: 1 })
    expect(later.request).toBe(fake.requests[2])
  })

  it('keeps the smallest limit when 16 is refused as well: the limit was not the objection', async () => {
    const fake = probeContext(inOrder(ONE_TOKEN_REFUSAL), { protocol: 'openai-chat' })

    const sent = await sendAtOutputFloor(fake.context, PROMPT)
    await sendAtOutputFloor(fake.context, PROMPT)

    expect(fake.requests.map(limitOf)).toEqual([1, 16, 1])
    expect(sent).toMatchObject({ outputLimit: 1 })
    expect(sent).not.toHaveProperty('refusedLimit')
    expect(sent.request).toBe(fake.requests[0])
    expect(sent.exchange.status).toBe(400)
  })

  it.each([
    ['another error status', exchange(500, 'upstream failed')],
    ['a 422', jsonExchange(422, { message: 'unprocessable' })],
    ['a success that is not a generation', exchange(200, '<html>ok</html>')],
  ])('does not try again after %s', async (_label, answer) => {
    const fake = probeContext(inOrder(answer), { protocol: 'openai-chat' })

    const sent = await sendAtOutputFloor(fake.context, PROMPT)

    expect(fake.requests).toHaveLength(1)
    expect(sent.exchange).toBe(answer)
  })

  it('never tries again on Responses, whose smallest limit is already 16', async () => {
    const fake = probeContext(inOrder(ONE_TOKEN_REFUSAL), { protocol: 'openai-responses' })

    const sent = await sendAtOutputFloor(fake.context, PROMPT)

    expect(fake.requests.map(limitOf)).toEqual([16])
    expect(sent.exchange.status).toBe(400)
  })

  it('decides nothing when the request is lost, so the next prompt finds the floor afresh', async () => {
    const fake = probeContext(inOrder(new ProbeLost(), ONE_TOKEN_REFUSAL, reply('openai-chat')), {
      protocol: 'openai-chat',
    })

    await expect(sendAtOutputFloor(fake.context, PROMPT)).rejects.toBeInstanceOf(ProbeLost)
    const sent = await sendAtOutputFloor(fake.context, PROMPT)

    expect(fake.requests.map(limitOf)).toEqual([1, 1, 16])
    expect(sent).toMatchObject({ outputLimit: 16, refusedLimit: 1 })
  })

  it('bills one request at MAX_OUTPUT_FLOOR plus, when it finds the floor, its discovery cost', async () => {
    const fake = probeContext(inOrder(ONE_TOKEN_REFUSAL, reply('openai-chat')), {
      protocol: 'openai-chat',
    })

    await sendAtOutputFloor(fake.context, PROMPT)
    await sendAtOutputFloor(fake.context, PROMPT)

    const promptTokens = estimateTokens(PROMPT)
    const [refused, found, later] = fake.requests.map((request) => request.tokens)
    expect(discoveryCost(promptTokens)).toEqual({ requests: 1, tokens: promptTokens + 1 })
    expect(refused).toBe(discoveryCost(promptTokens).tokens)
    expect(found).toBe(promptTokens + MAX_OUTPUT_FLOOR)
    expect(later).toBe(promptTokens + MAX_OUTPUT_FLOOR)
  })

  it('bills no request for more than MAX_OUTPUT_FLOOR tokens of output', async () => {
    const fake = probeContext(inOrder(ONE_TOKEN_REFUSAL, reply('openai-chat')), {
      protocol: 'openai-chat',
    })

    await sendAtOutputFloor(fake.context, PROMPT)

    for (const request of fake.requests) {
      expect(request.tokens).toBeLessThanOrEqual(estimateTokens(PROMPT) + MAX_OUTPUT_FLOOR)
      expect(request.generates).toBe(true)
    }
  })
})
