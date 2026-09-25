import { documented, type Fact, source } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import {
  type MatrixControl,
  type MatrixVendor,
  type RejectionCell,
  refusableRequest,
  rejectionMatrix,
} from '../../../src/probes/conformance/shared.js'
import type { Exchange, ProbeTarget } from '../../../src/probes/types.js'
import { citation } from '../../../src/sources/citation.js'
import { inOrder, jsonExchange, probeContext, probeTarget } from '../../fakes/context.js'
import { anthropicError, invalidRequest, messageOk, openaiError } from './anthropic/edge.js'

/** A vendor made up for the test, so the reading is checked apart from any real table. */
interface ToyModel {
  readonly id: string
  readonly rejectsA: Fact<boolean> | undefined
}

const DOCS = 'https://docs.example.com/models'
const says = (value: boolean) =>
  documented(value, [source(DOCS, `A is ${value ? 'refused' : 'taken'}.`)])

const MODELS: Readonly<Record<string, ToyModel>> = {
  big: { id: 'big', rejectsA: says(true) },
  refusing: { id: 'refusing', rejectsA: says(true) },
  taking: { id: 'taking', rejectsA: says(false) },
  silent: { id: 'silent', rejectsA: undefined },
}

const REFUSAL_DOCS = citation(DOCS, 'A refusal is a 400.', '2026-09-25')

function vendor(cheaper: readonly string[]): MatrixVendor<ToyModel> {
  return {
    name: 'Toy',
    family: 'Toy',
    dialect: 'openai',
    model: (id) => MODELS[id],
    cheaper: (id) => (id === 'big' ? cheaper.flatMap((name) => MODELS[name] ?? []) : []),
    refusal: [REFUSAL_DOCS],
  }
}

const target = (model = 'big') => probeTarget({ protocol: 'openai-chat', model })

function cells(on: ProbeTarget): readonly RejectionCell<ToyModel>[] {
  return [
    {
      sends: 'A',
      request: refusableRequest(on, { a: 1 }),
      rejects: (model) => model.rejectsA,
      messages: [],
    },
  ]
}

function control(on: ProbeTarget): MatrixControl {
  return {
    sends: 'the control',
    request: refusableRequest(on, { control: 1 }),
    expected: 'The control is accepted.',
    plainLanguage: 'Every Toy model takes the control.',
    citations: [REFUSAL_DOCS],
  }
}

const REFUSED = openaiError(400, 'A is not supported.')

async function run(
  cheaper: readonly string[],
  answers: readonly Exchange[],
  options: { readonly model?: string; readonly controlled?: boolean } = {},
) {
  const on = target(options.model)
  const fake = probeContext(inOrder(...answers), { target: on })
  const matrix = rejectionMatrix(vendor(cheaper))
  const signals = await matrix.runMatrix(
    fake.context,
    'conformance/toy/matrix',
    cells(on),
    options.controlled === true ? () => control(on) : undefined,
  )
  return { signals, requests: fake.requests }
}

describe('rejectionMatrix', () => {
  it('reads a refusal only in the vendor’s own envelope as the model’s', () => {
    const { outcomeOf } = rejectionMatrix(vendor([]))

    expect(outcomeOf(REFUSED)).toBe('rejected')
    expect(outcomeOf(invalidRequest('A is not supported.'))).toBe('foreign-rejection')
    expect(
      outcomeOf(
        jsonExchange(400, {
          error: { message: 'm', type: 'server_error', param: null, code: null },
        }),
      ),
    ).toBe('foreign-rejection')
    expect(outcomeOf(messageOk())).toBe('accepted')
    expect(outcomeOf(openaiError(422, 'm'))).toBe('other')
  })

  it('reads a refusal the docs rule out against the claim', async () => {
    const { signals } = await run([], [REFUSED], { model: 'taking' })

    expect(signals[0]?.llr).toEqual({ identity: { 'matches-claim': -0.4 } })
  })

  it('reads an acceptance the docs rule out as a layer that drops the setting, not against the claim', async () => {
    const { signals } = await run(['taking'], [messageOk()])

    expect(signals.map((entry) => entry.signalId)).toEqual([
      'documented-rejections',
      'accepted-where-documented-rejected',
    ])
    expect(signals[0]?.llr).toEqual({})
    expect(signals[0]?.plainLanguage).toContain('acceptance alone does not show which model')
    expect(signals[1]?.llr).toEqual({ translation: { translated: 0.2 } })
  })

  it('counts against the cheaper models the docs rule out', async () => {
    const { signals } = await run(['taking'], [REFUSED])

    expect(signals[0]?.llr).toEqual({
      identity: { 'matches-claim': 0.3, 'same-vendor-cheaper': -0.4 },
    })
    expect(signals[0]?.plainLanguage).toContain(
      'No cheaper Toy model is documented to answer the same way.',
    )
  })

  it('keeps a substitution open while one cheaper model is one the docs are silent on', async () => {
    const { signals } = await run(['taking', 'silent'], [REFUSED])

    expect(signals[0]?.llr).toEqual({ identity: { 'matches-claim': 0.3 } })
    expect(signals[0]?.plainLanguage).toContain(
      'Toy documents none of these answers for the cheaper silent, so this does not rule them out.',
    )
  })

  it('reads a cheaper model that answers alike for the substitution, whatever the rest', async () => {
    const { signals } = await run(['silent', 'refusing'], [REFUSED])

    expect(signals[0]?.llr).toEqual({
      identity: { 'matches-claim': 0.3, 'same-vendor-cheaper': 0.3 },
    })
    expect(signals[0]?.plainLanguage).toContain(
      'Toy documents the same answers for the cheaper refusing, so these answers do not tell them apart.',
    )
  })

  it('names the vendor in a foreign refusal and cites where it documents its own', async () => {
    const { signals } = await run([], [anthropicError(400, 'invalid_request_error', 'no A')])

    expect(signals).toMatchObject([
      {
        signalId: 'foreign-rejection',
        expected:
          "A request shape a model does not take is refused with a 400 invalid_request_error in Toy's error envelope.",
        citations: [REFUSAL_DOCS],
      },
    ])
  })

  it('sends nothing, control included, for a model the docs settle no cell for', async () => {
    const { signals, requests } = await run([], [messageOk()], {
      model: 'silent',
      controlled: true,
    })

    expect(signals).toEqual([])
    expect(requests).toHaveLength(0)
  })

  it('sends the control first and the cells only once it is accepted', async () => {
    const { signals, requests } = await run([], [messageOk(), REFUSED], { controlled: true })

    expect(requests).toHaveLength(2)
    expect(requests[0]?.body).toMatchObject({ json: { control: 1 } })
    expect(signals.map((entry) => entry.signalId)).toEqual(['documented-rejections'])
  })

  it('reads a refused control as the layer’s, in the probe’s own words', async () => {
    const { signals, requests } = await run([], [REFUSED], { controlled: true })

    expect(requests).toHaveLength(1)
    expect(signals).toMatchObject([
      {
        signalId: 'control-rejected',
        calibration: 'documented',
        observed:
          'the control was refused with a 400 invalid_request_error in OpenAI\'s error envelope, "A is not supported.".',
        expected: 'The control is accepted.',
        plainLanguage: 'Every Toy model takes the control.',
        llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.2 } },
        citations: [REFUSAL_DOCS],
      },
    ])
  })

  it('reads a control refused outside the envelope as a layer, and says nothing of other answers', async () => {
    const foreign = await run([], [invalidRequest('no')], { controlled: true })
    const other = await run([], [openaiError(500, 'down')], { controlled: true })

    expect(foreign.signals.map((entry) => entry.signalId)).toEqual(['foreign-rejection'])
    expect(other.signals).toEqual([])
    expect(other.requests).toHaveLength(1)
  })
})
