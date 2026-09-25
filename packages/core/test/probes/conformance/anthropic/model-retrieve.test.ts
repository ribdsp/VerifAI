import { describe, expect, it } from 'vitest'
import { modelRetrieve } from '../../../../src/probes/conformance/anthropic/model-retrieve.js'
import type { Exchange } from '../../../../src/probes/types.js'
import {
  ANTHROPIC_BEDROCK_MODEL_IDS,
  ANTHROPIC_VERTEX_DATED_IDS,
} from '../../../../src/sources/anthropic-conformance.js'
import { inOrder, jsonExchange, probeContext } from '../../../fakes/context.js'
import { anthropicError, modelObject } from './edge.js'

const NOT_FOUND = anthropicError(404, 'not_found_error', 'model: missing')

async function run(model: string, ...answers: readonly Exchange[]) {
  const fake = probeContext(inOrder(...answers), { model })
  const signals = await modelRetrieve.run(fake.context)
  return { signals, requests: fake.requests }
}

const described = (id: string) => jsonExchange(200, modelObject(JSON.stringify({ id })))

describe('conformance/anthropic/model-retrieve', () => {
  it('reads the documented model object under the claimed id as the first-party API', async () => {
    const { signals, requests } = await run('claude-opus-5-5', jsonExchange(200, modelObject()))

    expect(requests).toEqual([{ path: 'models/claude-opus-5-5' }])
    expect(signals).toMatchObject([
      {
        signalId: 'model-object',
        calibration: 'documented',
        family: 'protocol-conformance',
        llr: { platform: { 'first-party': 0.2 } },
      },
      {
        signalId: 'claimed-id',
        calibration: 'documented',
        observed: 'Asked for claude-opus-5-5, the endpoint reported the id "claude-opus-5-5".',
        llr: { platform: { 'first-party': 0.1 } },
      },
    ])
  })

  it("looks the model up under the gateway's name, and asks no alias it cannot know", async () => {
    const fake = probeContext(inOrder(described('reseller/claude-opus-4.5')), {
      model: 'claude-opus-4-5-20251101',
      requestedModel: 'reseller/claude-opus-4.5',
    })
    const signals = await modelRetrieve.run(fake.context)

    expect(fake.requests).toEqual([{ path: 'models/reseller%2Fclaude-opus-4.5' }])
    expect(signals.find((each) => each.signalId === 'claimed-id')).toMatchObject({
      observed:
        'Asked for reseller/claude-opus-4.5, the endpoint reported the id "reseller/claude-opus-4.5".',
      expected: 'The id claude-opus-4-5-20251101.',
      calibration: 'heuristic',
    })
  })

  it('lists each field that is missing or of the wrong type', async () => {
    const object = JSON.parse(
      '{"type":"models","id":5,"created_at":"yesterday","capabilities":[],"max_tokens":"many"}',
    )
    const { signals } = await run('claude-opus-5-5', jsonExchange(200, object))

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'model-object',
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.2 } },
      observed:
        'In the model object, `type` is not "model"; `id` is not a string; `display_name` is not a string; `created_at` is not an RFC 3339 datetime; `capabilities` has the wrong type; `max_input_tokens` is missing; `max_tokens` has the wrong type.',
    })
  })

  it.each([
    ['Amazon Bedrock', 'anthropic.claude-opus-5-5', ANTHROPIC_BEDROCK_MODEL_IDS],
    ['Google Cloud', 'claude-opus-5-5@20260501', ANTHROPIC_VERTEX_DATED_IDS],
  ])('reads an id in the form %s uses as a partner cloud', async (cloud, id, source) => {
    const { signals } = await run('claude-opus-5-5', described(id))

    expect(signals[1]).toMatchObject({
      signalId: 'claimed-id',
      calibration: 'documented',
      llr: { platform: { 'partner-cloud': 0.4, 'first-party': -0.4 } },
      citations: [source],
    })
    expect(signals[1]?.plainLanguage).toContain(cloud)
  })

  it('reads any other id only as a hint about the layer, never about the model', async () => {
    const { signals } = await run('claude-opus-5-5', described('opus-latest'))

    expect(signals[1]).toMatchObject({
      calibration: 'heuristic',
      llr: { translation: { translated: 0.2 } },
    })
    expect(signals[1]?.llr.identity).toBeUndefined()
  })

  it.each([
    ['a 404', NOT_FOUND],
    ['a success that is not an object', jsonExchange(200, [])],
  ])('reads %s as a model the endpoint does not describe', async (_label, answered) => {
    const { signals, requests } = await run('claude-haiku-4-5-20251001', answered)

    expect(requests).toHaveLength(1)
    expect(signals).toMatchObject([
      {
        signalId: 'claimed-id-unresolved',
        calibration: 'heuristic',
        llr: { platform: { 'first-party': -0.2 } },
      },
    ])
  })

  it('checks that the alias of a claimed snapshot resolves to it', async () => {
    const { signals, requests } = await run(
      'claude-haiku-4-5-20251001',
      described('claude-haiku-4-5-20251001'),
    )

    expect(requests.map((request) => request.path)).toEqual([
      'models/claude-haiku-4-5-20251001',
      'models/claude-haiku-4-5',
    ])
    expect(signals.map((entry) => entry.signalId)).toEqual([
      'model-object',
      'claimed-id',
      'alias-id',
    ])
    expect(signals[2]).toMatchObject({
      observed:
        'Asked for claude-haiku-4-5, the endpoint reported the id "claude-haiku-4-5-20251001".',
      llr: { platform: { 'first-party': 0.1 } },
    })
  })

  it('reads an alias the endpoint does not resolve', async () => {
    const { signals } = await run(
      'claude-haiku-4-5-20251001',
      described('claude-haiku-4-5-20251001'),
      NOT_FOUND,
    )

    expect(signals[2]).toMatchObject({ signalId: 'alias-id-unresolved' })
  })

  it('expects a claimed alias to come back as its snapshot, and asks once', async () => {
    const { signals, requests } = await run(
      'claude-haiku-4-5',
      described('claude-haiku-4-5-20251001'),
    )

    expect(requests).toHaveLength(1)
    expect(signals[1]).toMatchObject({
      expected: 'The id claude-haiku-4-5-20251001.',
      llr: { platform: { 'first-party': 0.1 } },
    })
  })

  it('expects a model the docs do not list under its own id', async () => {
    const { signals } = await run('claude-custom', described('claude-custom'))

    expect(signals[1]).toMatchObject({ llr: { platform: { 'first-party': 0.1 } } })
  })
})
