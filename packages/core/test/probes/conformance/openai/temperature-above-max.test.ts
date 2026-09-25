import { describe, expect, it } from 'vitest'
import { permissiveValidator } from '../../../../src/probes/conformance/common/permissive-validator.js'
import { temperatureAboveMax } from '../../../../src/probes/conformance/openai/temperature-above-max.js'
import type { Exchange } from '../../../../src/probes/types.js'
import {
  MEASURED_OPENAI_TEMPERATURE_ABOVE_MAX,
  MEASURED_OPENAI_TEMPERATURE_BY_ROUTE,
} from '../../../../src/sources/measured-conformance.js'
import type { Protocol } from '../../../../src/types/target.js'
import { exchange, inOrder, jsonExchange, probeContext, sentJson } from '../../../fakes/context.js'
import { jsonText, openaiErrorExchange } from './edge.js'

const ABOVE_MAX =
  "Invalid 'temperature': decimal above maximum value. Expected a value <= 2, but got 99.0 instead."
const CHAT_DEFAULT_ONLY =
  "Unsupported value: 'temperature' does not support 99 with this model. Only the default (1) value is supported."
const RESPONSES_DEFAULT_ONLY =
  "Unsupported parameter: 'temperature' is not supported with this model."

async function runWith(answer: Exchange, protocol: Protocol = 'openai-chat') {
  const fake = probeContext(inOrder(answer), { protocol })
  const signals = await temperatureAboveMax.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/openai/temperature-above-max', () => {
  it('sends one tiny generation at temperature 99', async () => {
    const { requests } = await runWith(exchange(500))

    expect(requests).toHaveLength(1)
    expect(sentJson(requests[0])).toMatchObject({ temperature: 99 })
    expect(requests[0]?.tokens).toBeLessThanOrEqual(temperatureAboveMax.cost.tokens)
  })

  it.each([
    ['99.0', ABOVE_MAX],
    ['99', ABOVE_MAX.replace('99.0', '99')],
  ])("matches OpenAI's range error with the value written %s", async (_label, message) => {
    const { signals } = await runWith(
      openaiErrorExchange(400, message, { param: 'temperature', code: 'decimal_above_max_value' }),
    )

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'above-max',
      calibration: 'heuristic',
      llr: { platform: { 'first-party': 0.3 }, translation: { direct: 0.2 } },
      citations: [MEASURED_OPENAI_TEMPERATURE_ABOVE_MAX],
    })
  })

  it.each([
    ['openai-chat', openaiErrorExchange(400, CHAT_DEFAULT_ONLY, { code: 'unsupported_value' })],
    ['openai-responses', openaiErrorExchange(400, RESPONSES_DEFAULT_ONLY)],
  ] as const)("matches %s's own wording for a default-only model", async (protocol, answer) => {
    const { signals } = await runWith(answer, protocol)

    expect(signals[0]).toMatchObject({
      signalId: 'own-route',
      llr: { platform: { 'first-party': 0.2 }, translation: { direct: 0.1 } },
      citations: [MEASURED_OPENAI_TEMPERATURE_BY_ROUTE],
    })
  })

  it.each([
    ['openai-chat', openaiErrorExchange(400, RESPONSES_DEFAULT_ONLY)],
    [
      'openai-responses',
      openaiErrorExchange(400, CHAT_DEFAULT_ONLY, { code: 'unsupported_value' }),
    ],
  ] as const)(
    "reads the other route's wording on %s as a translation",
    async (protocol, answer) => {
      const { signals } = await runWith(answer, protocol)

      expect(signals[0]).toMatchObject({
        signalId: 'other-route',
        llr: { platform: { 'first-party': -0.2 }, translation: { translated: 0.2 } },
      })
    },
  )

  it('reads any other refusal as one of its own', async () => {
    const withCode = await runWith(
      openaiErrorExchange(400, RESPONSES_DEFAULT_ONLY, { code: 'unsupported_parameter' }),
      'openai-responses',
    )
    const wrongCode = await runWith(openaiErrorExchange(400, ABOVE_MAX, { code: 'invalid_value' }))
    const anthropic = await runWith(
      jsonText(400, '{"type":"error","error":{"type":"invalid_request_error","message":"m"}}'),
    )
    const plain = await runWith(exchange(400, 'Bad Request'))
    const unprocessable = await runWith(
      openaiErrorExchange(422, ABOVE_MAX, { code: 'decimal_above_max_value' }),
    )

    for (const { signals } of [withCode, wrongCode, anthropic, plain, unprocessable]) {
      expect(signals[0]).toMatchObject({
        signalId: 'other',
        llr: { platform: { 'first-party': -0.1 } },
      })
    }
  })

  it('leaves an answer and a server error to other readings', async () => {
    expect((await runWith(jsonExchange(200, {}))).signals).toEqual([])
    expect((await runWith(exchange(500))).signals).toEqual([])
  })

  it('shares its request with the permissive-validator probe', async () => {
    const fake = probeContext(
      inOrder(openaiErrorExchange(400, ABOVE_MAX, { code: 'decimal_above_max_value' })),
      { protocol: 'openai-chat' },
    )

    const [wording, validator] = await Promise.all([
      temperatureAboveMax.run(fake.context),
      permissiveValidator.run(fake.context),
    ])

    expect(fake.requests).toHaveLength(1)
    expect(wording[0]?.signalId).toBe('above-max')
    expect(validator[0]?.signalId).toBe('rejected')
  })
})
