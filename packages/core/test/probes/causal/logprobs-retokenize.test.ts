import { describe, expect, it } from 'vitest'
import { logprobsRetokenize } from '../../../src/probes/causal/logprobs-retokenize.js'
import type { Exchange } from '../../../src/probes/types.js'
import { ProbeLost } from '../../../src/runner/errors.js'
import { OPENAI_LOGPROBS } from '../../../src/sources/openai-causal.js'
import { type LocalEncoding, loadTokenizer } from '../../../src/tokenizer/local.js'
import { exchange, inOrder, probeContext, probeTarget } from '../../fakes/context.js'
import { bodyOf, chat, withinCost } from './replies.js'

const SENTENCE =
  'The lizard drifted past the lighthouse, grinned at the meadow and the orchard, then blinked sequentially.'

interface Entry {
  readonly token: unknown
  readonly logprob?: unknown
  readonly bytes?: unknown
}

function entry(token: string): Entry {
  return { token, logprob: -0.01, bytes: [...new TextEncoder().encode(token)] }
}

async function tokensOf(text: string, encoding: LocalEncoding): Promise<readonly string[]> {
  const tokenizer = await loadTokenizer(encoding)
  return tokenizer.encode(text).map((id) => tokenizer.decode([id]))
}

function withLogprobs(text: string, content: readonly unknown[]): Exchange {
  return chat(text, { logprobs: { content, refusal: null } })
}

async function runWith(answer: Exchange, model = 'gpt-4o') {
  const fake = probeContext(inOrder(answer), { protocol: 'openai-chat', model })
  const signals = await logprobsRetokenize.run(fake.context)
  expect(fake.requests).toHaveLength(1)
  expect(withinCost(logprobsRetokenize, fake)).toBe(true)
  return { fake, signals }
}

describe('causal/logprobs-retokenize', () => {
  it("finds every reported token in the claimed model's encoding", async () => {
    const tokens = await tokensOf(SENTENCE, 'o200k_base')
    const { fake, signals } = await runWith(withLogprobs(SENTENCE, tokens.map(entry)))

    expect(bodyOf(fake.requests[0]).logprobs).toBe(true)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      probeId: 'causal/logprobs-retokenize',
      signalId: 'claimed-tokens',
      calibration: 'derived',
      llr: { identity: { 'matches-claim': 0.2, 'different-vendor': -0.3 } },
    })
    expect(signals[0]?.citations[0]).toBe(OPENAI_LOGPROBS)
  })

  it("finds tokens of OpenAI's other encoding", async () => {
    const tokens = await tokensOf(SENTENCE, 'cl100k_base')
    const { signals } = await runWith(withLogprobs(SENTENCE, tokens.map(entry)))

    expect(signals[0]).toMatchObject({
      signalId: 'foreign-tokens',
      llr: { identity: { 'matches-claim': -0.7, 'same-vendor-cheaper': 0.3 } },
    })
    expect(signals[0]?.observed).toContain('" lizard"')
  })

  it('finds tokens of neither encoding', async () => {
    const tokens = ['The', ' lizarddrifted', ' grinnedblinked', '.']
    const { signals } = await runWith(withLogprobs(tokens.join(''), tokens.map(entry)))

    expect(signals[0]).toMatchObject({
      signalId: 'foreign-tokens',
      llr: { identity: { 'matches-claim': -0.7, 'different-vendor': 0.3 } },
    })
  })

  it('reads the claimed encoding from the claimed model', async () => {
    const tokens = await tokensOf(SENTENCE, 'cl100k_base')
    const { signals } = await runWith(withLogprobs(SENTENCE, tokens.map(entry)), 'gpt-4-turbo')

    expect(signals[0]?.signalId).toBe('claimed-tokens')
  })

  it('skips pieces of a character, whose text cannot equal their bytes', async () => {
    const tokens = await tokensOf(SENTENCE, 'o200k_base')
    const content = [
      ...tokens.map(entry),
      { token: '�', logprob: -1.5, bytes: [226] },
      { token: 'bytes:\\xe2', logprob: -1.5, bytes: [226] },
      { token: '!', logprob: 0, bytes: null },
    ]
    const { signals } = await runWith(withLogprobs(`${SENTENCE}!`, content))

    expect(signals[0]?.signalId).toBe('claimed-tokens')
  })

  it.each([
    ['one stray token', ['The', ' lizarddrifted', ' past', '.']],
    ['only tokens both encodings share', ['The', ' past', ' the', '.']],
  ])('judges nothing from %s', async (_label, tokens) => {
    const { signals } = await runWith(withLogprobs(tokens.join(''), tokens.map(entry)))

    expect(signals).toEqual([])
  })

  it.each([
    ['no logprobs', chat(SENTENCE)],
    ['null logprobs', chat(SENTENCE, { logprobs: null })],
    ['no content list', chat(SENTENCE, { logprobs: { refusal: null } })],
  ])('reads %s as the setting dropped', async (_label, answer) => {
    const { signals } = await runWith(answer)

    expect(signals[0]).toMatchObject({
      signalId: 'logprobs-missing',
      calibration: 'documented',
      llr: { translation: { translated: 0.3 } },
    })
    expect(signals[0]?.llr.identity).toBeUndefined()
  })

  it.each([
    ['an entry that is not an object', ['Hi']],
    ['a token that is not a string', [{ token: 7, logprob: -1, bytes: null }]],
    ['no logprob', [{ token: 'Hi', bytes: null }]],
    ['a positive logprob', [{ token: 'Hi', logprob: 0.5, bytes: null }]],
    ['a logprob that is not a number', [{ token: 'Hi', logprob: '-1', bytes: null }]],
    ['bytes that are not a list', [{ token: 'Hi', logprob: -1, bytes: 'SGk=' }]],
    ['bytes out of range', [{ token: 'Hi', logprob: -1, bytes: [72, 300] }]],
    ['bytes of another text', [{ token: 'Hi', logprob: -1, bytes: [72, 105, 33] }]],
    ['tokens that do not join into the answer', [entry('Hello')]],
    ['no tokens at all', []],
  ])('reads %s as a list OpenAI did not write', async (_label, content) => {
    const { signals } = await runWith(withLogprobs('Hi', content))

    expect(signals[0]).toMatchObject({
      signalId: 'logprobs-malformed',
      calibration: 'documented',
      llr: { identity: { 'matches-claim': -0.3 }, translation: { translated: 0.5 } },
    })
  })

  it.each([
    ['an empty answer', chat('')],
    ['a failed request', exchange(500, 'upstream failed')],
  ])('judges nothing from %s', async (_label, answer) => {
    const { signals } = await runWith(answer)

    expect(signals).toEqual([])
  })

  it('lets runner errors through', async () => {
    const fake = probeContext(inOrder(new ProbeLost()), {
      protocol: 'openai-chat',
      model: 'gpt-4o',
    })

    await expect(logprobsRetokenize.run(fake.context)).rejects.toBeInstanceOf(ProbeLost)
  })

  it('applies to non-reasoning chat models with a local encoding', () => {
    expect(
      logprobsRetokenize.applies?.(probeTarget({ protocol: 'openai-chat', model: 'gpt-4.1' })),
    ).toBe(true)
    expect(
      logprobsRetokenize.applies?.(probeTarget({ protocol: 'openai-chat', model: 'gpt-5' })),
    ).toBe(false)
  })
})
