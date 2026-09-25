import { ANTHROPIC_REJECTIONS, type AnthropicModel } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import {
  CELL_TOKENS,
  describeAnswer,
  documentsAny,
  malformedBody,
  outcomeOf,
  PROMPT,
  type RejectionCell,
  refusableRequest,
  runMatrix,
  uniqueCitations,
} from '../../../../src/probes/conformance/anthropic/shared.js'
import type { Exchange, ProbeTarget } from '../../../../src/probes/types.js'
import { ANTHROPIC_ERROR_ENVELOPE } from '../../../../src/sources/anthropic.js'
import {
  ANTHROPIC_ERROR_400,
  ANTHROPIC_ERROR_404,
} from '../../../../src/sources/anthropic-conformance.js'
import { exchange, inOrder, probeContext, probeTarget, sentJson } from '../../../fakes/context.js'
import { anthropicError, invalidRequest, messageOk, openaiError } from './edge.js'

const ID = 'conformance/anthropic/test-matrix'
const PREFILL_WORDING = ANTHROPIC_REJECTIONS.prefill.value.message
const ACCEPTANCE_ALONE =
  'A layer that drops these settings accepts them too, whatever model is behind it, so acceptance alone does not show which model answered.'

const rejectsPrefill = (model: AnthropicModel) => model.rejectsPrefill

function prefillCells(target: ProbeTarget): readonly RejectionCell[] {
  return [
    {
      sends: 'a prefill',
      request: refusableRequest(target, {}),
      rejects: rejectsPrefill,
      messages: [ANTHROPIC_REJECTIONS.prefill],
    },
  ]
}

async function matrix(model: string, ...answers: readonly Exchange[]) {
  const fake = probeContext(inOrder(...answers), { model })
  const signals = await runMatrix(fake.context, ID, prefillCells(fake.context.target))
  return { signals, requests: fake.requests }
}

describe('describeAnswer', () => {
  it('names a success and a response without an error envelope', () => {
    expect(describeAnswer(messageOk())).toBe('a 200')
    expect(describeAnswer(exchange(502, '<html>Bad gateway</html>'))).toBe(
      'a 502 without an error envelope',
    )
  })

  it('names the dialect, type and message of an error envelope', () => {
    expect(describeAnswer(invalidRequest('m'))).toBe(
      'a 400 invalid_request_error in Anthropic\'s error envelope, "m"',
    )
    expect(describeAnswer(openaiError(400, 'm'))).toBe(
      'a 400 invalid_request_error in OpenAI\'s error envelope, "m"',
    )
    expect(describeAnswer(exchange(400, '{"type":"error","error":{"message":"m"}}'))).toBe(
      'a 400 in Anthropic\'s error envelope, "m"',
    )
  })
})

describe('uniqueCitations', () => {
  it('keeps each source once, in first-seen order, frozen', () => {
    const unique = uniqueCitations([ANTHROPIC_ERROR_400, ANTHROPIC_ERROR_404, ANTHROPIC_ERROR_400])

    expect(unique).toEqual([ANTHROPIC_ERROR_400, ANTHROPIC_ERROR_404])
    expect(Object.isFrozen(unique)).toBe(true)
  })

  it('refuses an empty list', () => {
    expect(() => uniqueCitations([])).toThrow(TypeError)
  })
})

describe('outcomeOf', () => {
  it.each([
    ['a 200', messageOk(), 'accepted'],
    ['a 500', anthropicError(500, 'api_error', 'm'), 'other'],
    ["Anthropic's invalid_request_error", invalidRequest('m'), 'rejected'],
    [
      "another type in Anthropic's envelope",
      anthropicError(400, 'api_error', 'm'),
      'foreign-rejection',
    ],
    ["OpenAI's envelope", openaiError(400, 'm'), 'foreign-rejection'],
    ['no envelope', exchange(400, 'Bad Request'), 'foreign-rejection'],
  ])('reads %s', (_label, answered, outcome) => {
    expect(outcomeOf(answered)).toBe(outcome)
  })
})

describe('refusableRequest and malformedBody', () => {
  it('asks for one token of the prompt, expecting a 400', () => {
    const request = refusableRequest(probeTarget(), { seed: 7 })

    expect(request.provokes).toEqual([400])
    expect(request.tokens).toBe(CELL_TOKENS)
    expect(sentJson(request)).toMatchObject({
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: PROMPT }],
      seed: 7,
    })
  })

  it('sends the malformed body once per run, as bytes', async () => {
    const fake = probeContext(inOrder(invalidRequest('m')))

    const [first, second] = await Promise.all([
      malformedBody(fake.context),
      malformedBody(fake.context),
    ])

    expect(first).toBe(second)
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]).toMatchObject({ path: 'messages', provokes: [400] })
    expect(fake.requests[0]?.body).toHaveProperty('bytes')
    expect(sentJson(fake.requests[0])).toBeUndefined()
  })
})

describe('documentsAny', () => {
  it('holds only for a listed model the docs settle a cell for', () => {
    const applies = documentsAny([(model) => model.rejectsForcedToolChoice])

    expect(applies(probeTarget({ model: 'claude-opus-5-5' }))).toBe(true)
    expect(applies(probeTarget({ model: 'claude-haiku-4-5' }))).toBe(false)
    expect(applies(probeTarget({ model: 'claude-custom' }))).toBe(false)
  })
})

describe('runMatrix', () => {
  it('sends nothing for a model the docs do not list', async () => {
    const { signals, requests } = await matrix('claude-custom', messageOk())

    expect(signals).toEqual([])
    expect(requests).toHaveLength(0)
  })

  it('reads a documented refusal as the claim, and names cheaper models that refuse alike', async () => {
    const { signals, requests } = await matrix('claude-opus-5-5', invalidRequest(PREFILL_WORDING))

    expect(requests).toHaveLength(1)
    expect(signals.map((entry) => entry.signalId)).toEqual([
      'documented-rejections',
      'rejection-wording',
    ])
    expect(signals[0]).toMatchObject({
      calibration: 'documented',
      family: 'protocol-conformance',
      observed: 'a prefill was rejected.',
      expected: 'For claude-opus-5-5, Anthropic documents: a prefill rejected.',
      llr: { identity: { 'matches-claim': 0.3, 'same-vendor-cheaper': 0.3 } },
    })
    expect(signals[0]?.plainLanguage).toContain(
      'the cheaper claude-sonnet-5, claude-sonnet-4-6, so these answers do not tell them apart.',
    )
    expect(signals[1]).toMatchObject({
      calibration: 'documented',
      llr: { translation: { direct: 0.3 }, platform: { 'first-party': 0.2 } },
    })
  })

  it('names three cheaper models and says there are others', async () => {
    const { signals } = await matrix('claude-fable-5-1', invalidRequest(PREFILL_WORDING))

    expect(signals[0]?.plainLanguage).toContain(
      'the cheaper claude-sonnet-5, claude-sonnet-4-6, claude-opus-5-5 and others, so',
    )
  })

  it('reads an acceptance the docs rule out as a layer, for no model and against none', async () => {
    const { signals } = await matrix('claude-opus-5-5', messageOk())

    expect(signals.map((entry) => entry.signalId)).toEqual([
      'documented-rejections',
      'accepted-where-documented-rejected',
    ])
    expect(signals[0]?.llr).toEqual({})
    expect(signals[0]?.plainLanguage).toContain(
      'differently from what Anthropic documents for claude-opus-5-5. Anthropic documents the answers this endpoint gave for the cheaper claude-haiku-4-5-20251001, claude-sonnet-4-5-20250929.',
    )
    expect(signals[0]?.plainLanguage).toContain(ACCEPTANCE_ALONE)
    expect(signals[1]).toMatchObject({
      calibration: 'heuristic',
      observed: 'a prefill was answered 200.',
      llr: { translation: { translated: 0.2 } },
    })
  })

  it('counts against cheaper models that would answer differently', async () => {
    const { signals } = await matrix('claude-sonnet-5', invalidRequest(PREFILL_WORDING))

    expect(signals[0]).toMatchObject({
      llr: { identity: { 'matches-claim': 0.3, 'same-vendor-cheaper': -0.4 } },
    })
    expect(signals[0]?.plainLanguage).toContain(
      'No cheaper Claude model is documented to answer the same way.',
    )
  })

  it('says nothing of identity for answers that match the claim by accepting alone', async () => {
    const { signals } = await matrix('claude-haiku-4-5', messageOk())

    expect(signals).toHaveLength(1)
    expect(signals[0]?.llr).toEqual({})
    expect(signals[0]?.plainLanguage).toContain(ACCEPTANCE_ALONE)
  })

  it('reads a refusal in other words as a layer, not as the claim', async () => {
    const { signals } = await matrix('claude-opus-5-5', invalidRequest('prefill is off'))

    expect(signals[1]).toMatchObject({
      signalId: 'rejection-wording',
      calibration: 'heuristic',
      observed: 'a prefill was refused with "prefill is off".',
      llr: { translation: { translated: 0.2 }, platform: { 'first-party': -0.2 } },
      citations: ANTHROPIC_REJECTIONS.prefill.sources,
    })
    expect(signals[1]?.expected).toContain(JSON.stringify(PREFILL_WORDING))
  })

  it('reads a refusal outside the documented envelope only on translation', async () => {
    const { signals } = await matrix('claude-opus-5-5', openaiError(400, 'prefill is off'))

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'foreign-rejection',
      calibration: 'heuristic',
      llr: { translation: { translated: 0.2 } },
      citations: [ANTHROPIC_ERROR_400, ANTHROPIC_ERROR_ENVELOPE],
    })
    expect(signals[0]?.observed).toContain("in OpenAI's error envelope")
  })

  it('says nothing of an answer that is neither a success nor a 400', async () => {
    const { signals } = await matrix('claude-opus-5-5', anthropicError(422, 'x', 'm'))

    expect(signals).toEqual([])
  })
})
