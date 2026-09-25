import { describe, expect, it } from 'vitest'
import { errorEnvelope } from '../../../../src/probes/conformance/anthropic/error-envelope.js'
import { errorVocabulary } from '../../../../src/probes/conformance/anthropic/error-vocabulary.js'
import type { Exchange } from '../../../../src/probes/types.js'
import {
  ANTHROPIC_ERROR_400,
  ANTHROPIC_ERROR_401,
  ANTHROPIC_ERROR_404,
  ANTHROPIC_ERROR_TYPES_MAY_GROW,
} from '../../../../src/sources/anthropic-conformance.js'
import { inOrder, jsonExchange, probeContext } from '../../../fakes/context.js'
import { anthropicError, invalidRequest, modelObject, openaiError } from './edge.js'

const NOT_FOUND = anthropicError(404, 'not_found_error', 'model: verifai-absent-n0nce7test')

async function run(malformed: Exchange, absent: Exchange) {
  const fake = probeContext(inOrder(malformed, absent))
  const signals = await errorVocabulary.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/anthropic/error-vocabulary', () => {
  it('asks for a model no one serves, expecting a 404, and spends no tokens', async () => {
    const { requests } = await run(invalidRequest('m'), NOT_FOUND)

    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ path: 'messages', provokes: [400] })
    expect(requests[1]).toEqual({ path: 'models/verifai-absent-n0nce7test', provokes: [404] })
    expect(errorVocabulary.cost).toEqual({ requests: 2, tokens: 0 })
  })

  it('reads error types on their documented statuses as the first-party API', async () => {
    const { signals } = await run(invalidRequest('m'), NOT_FOUND)

    expect(signals).toMatchObject([
      {
        signalId: 'malformed-body-type',
        calibration: 'documented',
        expected: 'A 400 carries invalid_request_error.',
        llr: { platform: { 'first-party': 0.2 } },
        citations: [ANTHROPIC_ERROR_400],
      },
      {
        signalId: 'absent-model-type',
        calibration: 'documented',
        expected: 'A 404 carries not_found_error or invalid_request_error.',
        llr: { platform: { 'first-party': 0.2 } },
        citations: [ANTHROPIC_ERROR_404],
      },
    ])
  })

  it('takes invalid_request_error on any 4XX', async () => {
    const { signals } = await run(
      invalidRequest('m'),
      anthropicError(422, 'invalid_request_error', 'm'),
    )

    expect(signals[1]).toMatchObject({
      expected:
        'A 422 carries invalid_request_error, which Anthropic uses for 4XX statuses its list does not name.',
      llr: { platform: { 'first-party': 0.2 } },
      citations: [ANTHROPIC_ERROR_400],
    })
  })

  it('reads a known type on the wrong status as a remapped error', async () => {
    const { signals } = await run(
      invalidRequest('m'),
      anthropicError(404, 'authentication_error', 'm'),
    )

    expect(signals[1]).toMatchObject({
      calibration: 'documented',
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.3 } },
      plainLanguage: 'The endpoint labelled a 404 with the error type Anthropic uses for a 401.',
      citations: [ANTHROPIC_ERROR_404, ANTHROPIC_ERROR_401],
    })
  })

  it('names no type for a status the list does not have', async () => {
    const { signals } = await run(invalidRequest('m'), anthropicError(502, 'api_error', 'm'))

    expect(signals[1]).toMatchObject({
      expected: "Anthropic's list names no error type for a 502.",
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.3 } },
    })
  })

  it('reads a type the list does not have only as a hint, since the list may grow', async () => {
    const { signals } = await run(
      anthropicError(400, 'malformed_json', 'm'),
      anthropicError(418, 'teapot_error', 'm'),
    )

    expect(signals).toMatchObject([
      {
        calibration: 'heuristic',
        llr: { translation: { translated: 0.1 } },
        citations: [ANTHROPIC_ERROR_400, ANTHROPIC_ERROR_TYPES_MAY_GROW],
      },
      { calibration: 'heuristic', citations: [ANTHROPIC_ERROR_TYPES_MAY_GROW] },
    ])
  })

  it('reads a success for a model no one serves as a layer that answers for it', async () => {
    const { signals } = await run(invalidRequest('m'), jsonExchange(200, modelObject()))

    expect(signals[1]).toMatchObject({
      signalId: 'absent-model-type',
      calibration: 'documented',
      observed: 'A request for a model id no one serves was answered 200.',
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.2 } },
      citations: [ANTHROPIC_ERROR_404],
    })
  })

  it("leaves answers outside Anthropic's envelope to error-envelope", async () => {
    const { signals } = await run(
      openaiError(400, 'm'),
      jsonExchange(404, { type: 'error', error: { message: 'no type' } }),
    )

    expect(signals).toEqual([])
  })

  it('shares the malformed request with error-envelope', async () => {
    const fake = probeContext(inOrder(invalidRequest('m'), NOT_FOUND))

    await errorEnvelope.run(fake.context)
    await errorVocabulary.run(fake.context)

    expect(fake.requests.map((request) => request.path)).toEqual([
      'messages',
      'models/verifai-absent-n0nce7test',
    ])
  })
})
