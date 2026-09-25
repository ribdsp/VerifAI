import { describe, expect, it } from 'vitest'
import { permissiveValidator } from '../../../../src/probes/conformance/common/permissive-validator.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { ANTHROPIC_TEMPERATURE_RANGE } from '../../../../src/sources/anthropic-conformance-common.js'
import {
  OPENAI_CHAT_TEMPERATURE_RANGE,
  OPENAI_RESPONSES_TEMPERATURE_RANGE,
} from '../../../../src/sources/openai-conformance.js'
import type { Protocol } from '../../../../src/types/target.js'
import {
  exchange,
  inOrder,
  jsonExchange,
  probeContext,
  probeTarget,
  sentJson,
} from '../../../fakes/context.js'
import { jsonText, openaiErrorExchange } from '../openai/edge.js'

async function runWith(answer: Exchange, protocol: Protocol = 'anthropic-messages') {
  const fake = probeContext(inOrder(answer), { protocol })
  const signals = await permissiveValidator.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/common/permissive-validator', () => {
  it('asks native pairings only', () => {
    expect(permissiveValidator.applies?.(probeTarget({ protocol: 'anthropic-messages' }))).toBe(
      true,
    )
    expect(permissiveValidator.applies?.(probeTarget({ protocol: 'openai-responses' }))).toBe(true)
    expect(
      permissiveValidator.applies?.(probeTarget({ protocol: 'openai-chat', vendor: 'anthropic' })),
    ).toBe(false)
  })

  it('sends one tiny generation at temperature 99', async () => {
    const { requests } = await runWith(exchange(500))

    expect(requests).toHaveLength(1)
    expect(requests[0]?.generates).toBe(true)
    expect(sentJson(requests[0])).toMatchObject({ temperature: 99, model: 'claude-opus-5-5' })
    expect(requests[0]?.tokens).toBeLessThanOrEqual(permissiveValidator.cost.tokens)
  })

  it.each([
    ['anthropic-messages', ANTHROPIC_TEMPERATURE_RANGE, 1],
    ['openai-chat', OPENAI_CHAT_TEMPERATURE_RANGE, 2],
    ['openai-responses', OPENAI_RESPONSES_TEMPERATURE_RANGE, 2],
  ] as const)(
    'reads an answer on %s as the setting having been rewritten',
    async (protocol, range, ceiling) => {
      const { signals } = await runWith(jsonExchange(200, {}), protocol)

      expect(signals).toHaveLength(1)
      expect(signals[0]).toMatchObject({
        signalId: 'accepted',
        calibration: 'documented',
        llr: {
          platform: { 'first-party': -0.4 },
          translation: { translated: 0.6, direct: -0.6 },
        },
        citations: [range],
      })
      expect(signals[0]?.llr.identity).toBeUndefined()
      expect(signals[0]?.expected).toContain(`is ${ceiling}.`)
      expect(signals[0]?.observed).toContain('answered 200')
    },
  )

  it('reads a refusal as the vendor would refuse, quoting it', async () => {
    const anthropic = await runWith(
      jsonText(
        400,
        '{"type":"error","error":{"type":"invalid_request_error","message":"temperature: range: 0..1"}}',
      ),
    )
    const openai = await runWith(
      openaiErrorExchange(422, 'temperature too high', { param: 'temperature' }),
      'openai-chat',
    )
    const plain = await runWith(exchange(400, 'Bad Request'), 'openai-responses')

    expect(anthropic.signals[0]).toMatchObject({
      signalId: 'rejected',
      llr: { translation: { direct: 0.1 } },
      citations: [ANTHROPIC_TEMPERATURE_RANGE],
    })
    expect(anthropic.signals[0]?.observed).toContain('status 400: "temperature: range: 0..1"')
    expect(openai.signals[0]?.observed).toContain('status 422: "temperature too high"')
    expect(plain.signals[0]?.signalId).toBe('rejected')
    expect(plain.signals[0]?.observed).toContain('refused with status 400.')
  })

  it('says nothing about a server error or a redirect', async () => {
    expect((await runWith(exchange(502))).signals).toEqual([])
    expect((await runWith(exchange(302))).signals).toEqual([])
  })
})
