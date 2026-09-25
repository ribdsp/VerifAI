import { describe, expect, it } from 'vitest'
import {
  describeError,
  layoutOf,
  NO_KEY_ROUTES,
  noKeyExchange,
  notFoundExchange,
  observedSignal,
  openaiError,
  routeLabel,
} from '../../../../src/probes/conformance/openai/shared.js'
import { MEASURED_OPENAI_EMPTY_404 } from '../../../../src/sources/measured-conformance.js'
import { exchange, inOrder, probeContext, sentJson } from '../../../fakes/context.js'
import { errorText, jsonText, openaiErrorExchange } from './edge.js'

describe('layoutOf', () => {
  it.each([
    ['compact', errorText('m'), 'compact'],
    ['2-space', errorText('m', 2), 'indent-2'],
    ['4-space', errorText('m', 4), 'indent-4'],
    ['3-space', errorText('m', 3), 'other'],
    ['CRLF 2-space', errorText('m', 2).replaceAll('\n', '\r\n'), 'indent-2'],
    ['a pretty-printed array', '[\n  1\n]', 'other'],
  ])('reads %s JSON', (_label, text, layout) => {
    expect(layoutOf(jsonText(401, text))).toBe(layout)
  })

  it('has no layout for a body that is not JSON', () => {
    expect(layoutOf(exchange(401, 'Unauthorized'))).toBeUndefined()
    expect(layoutOf(exchange(401))).toBeUndefined()
  })
})

describe('openaiError and describeError', () => {
  it("describes an error in OpenAI's envelope with its code", () => {
    const answered = openaiErrorExchange(400, 'Bad thing', { code: 'bad_thing' })

    expect(openaiError(answered)?.message).toBe('Bad thing')
    expect(describeError(answered)).toBe('status 400, code "bad_thing": "Bad thing"')
  })

  it('says so when the code is null or missing', () => {
    expect(describeError(openaiErrorExchange(400, 'm'))).toBe('status 400, code null: "m"')
    const noCode = jsonText(400, JSON.stringify({ error: { message: 'm', type: 't' } }))
    expect(describeError(noCode)).toBe('status 400, no code: "m"')
  })

  it("does not read Anthropic's envelope as OpenAI's", () => {
    const anthropic = jsonText(
      400,
      '{"type":"error","error":{"type":"invalid_request_error","message":"m"}}',
    )

    expect(openaiError(anthropic)).toBeUndefined()
    expect(describeError(anthropic)).toBe("status 400, no error in OpenAI's envelope")
  })
})

describe('the shared no-key requests', () => {
  it('labels every route by method and path', () => {
    expect(NO_KEY_ROUTES.map(routeLabel)).toEqual([
      'GET models',
      'GET chat/completions',
      'POST chat/completions',
      'POST responses',
    ])
  })

  it('asks each route once per run, without a credential, provoking the 401', async () => {
    const fake = probeContext(inOrder(exchange(401)), { protocol: 'openai-chat' })

    await noKeyExchange(fake.context, 'get-models')
    await noKeyExchange(fake.context, 'get-models')
    await noKeyExchange(fake.context, 'post-responses')

    expect(fake.requests).toHaveLength(2)
    const [get, post] = fake.requests
    expect(get).toEqual({ path: 'models', method: 'GET', credential: 'none', provokes: [401] })
    expect(post).toMatchObject({ path: 'responses', method: 'POST', credential: 'none' })
    expect(sentJson(post)).toEqual({})
  })

  it("asks for a path carrying the run's nonce once per run, provoking the 404", async () => {
    const fake = probeContext(inOrder(exchange(404)), { protocol: 'openai-chat' })

    await notFoundExchange(fake.context)
    await notFoundExchange(fake.context)

    expect(fake.requests).toEqual([
      { path: 'nonexistent-n0nce7test', method: 'GET', credential: 'none', provokes: [404] },
    ])
  })
})

describe('observedSignal', () => {
  it('builds a frozen heuristic conformance signal citing one observation', () => {
    const built = observedSignal('conformance/openai/example', MEASURED_OPENAI_EMPTY_404, {
      signalId: 'match',
      observed: 'o',
      expected: 'e',
      llr: { platform: { 'first-party': 0.1 } },
      plainLanguage: 'p',
    })

    expect(built).toMatchObject({
      probeId: 'conformance/openai/example',
      family: 'protocol-conformance',
      calibration: 'heuristic',
      citations: [MEASURED_OPENAI_EMPTY_404],
    })
    expect(Object.isFrozen(built)).toBe(true)
  })
})
