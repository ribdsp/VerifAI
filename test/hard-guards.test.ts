import { readFile } from 'node:fs/promises'
import { relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIGNAL_FAMILIES, type Signal } from '../packages/core/src/probes/types.js'
import { aggregate } from '../packages/core/src/scoring/aggregate.js'
import { CODE_EXTENSIONS, repoFiles, repoRoot } from './helpers/repo-files.js'

/**
 * The hard guards of `docs/scoring.md#hard-guards` that live outside the
 * verdict rules. A model's account of itself and the style of its prose are
 * the two readings any proxy can fake by asking the claimed model once and
 * replaying the answer, so neither may reach the log-odds sum by any route:
 * not as a family, not as a probe that asks, not as a signal without a source.
 *
 * Guards 3 and 4, which are about the verdict, are in
 * `packages/core/test/assessment.test.ts`.
 */

/** Families a self-report or stylometric reading would be filed under. */
const FORBIDDEN_FAMILY = /self|identity|claim|style|stylo|persona|voice|tone/i

/**
 * Prompts that ask the model who it is. A text scan, so it is a guard against
 * forgetting rather than against someone working around it - the aggregator
 * refusing unknown families is what makes working around it pointless.
 */
const SELF_IDENTIFICATION = [
  /what (?:model|ai|llm|language model|assistant) (?:are you|is this)/i,
  /which (?:model|ai|llm|company|vendor) (?:are you|made you|built you|trained you)/i,
  /who (?:made|created|trained|built|developed|are) you/i,
  /identify yourself/i,
  /are you (?:claude|gpt|chatgpt|an? openai|an? anthropic)/i,
  /(?:tell me|state|what is) your (?:model )?(?:name|identity)/i,
  /your (?:underlying|base) model/i,
]

const PROBES = `${['packages', 'core', 'src', 'probes'].join(sep)}${sep}`

function valid(): Signal {
  return {
    probeId: 'guard/probe',
    signalId: 'reading',
    family: 'causal-capability',
    calibration: 'measured',
    observed: 'observed',
    expected: 'expected',
    llr: { identity: { 'matches-claim': 2 } },
    plainLanguage: 'A test reading.',
    citations: [
      {
        url: 'https://platform.claude.com/docs/en/api/messages',
        quote: 'A test quote.',
        retrievedAt: '2026-09-01',
      },
    ],
  }
}

describe('no self-identification, no style', () => {
  it('has no signal family a self-report or a style reading could be filed under', () => {
    expect(SIGNAL_FAMILIES.values.filter((family) => FORBIDDEN_FAMILY.test(family))).toEqual([])
  })

  it('gives a signal from any family off the list no path into the sum', () => {
    for (const family of ['self-report', 'self-identification', 'stylometry', 'style']) {
      const smuggled = { ...valid(), family } as unknown as Signal
      expect(() => aggregate([smuggled], 'native')).toThrow(TypeError)
      expect(() => aggregate([valid(), smuggled], 'native')).toThrow(TypeError)
    }
  })

  it('has no probe that asks the model who it is', async () => {
    const probes = (await repoFiles(CODE_EXTENSIONS)).filter((file) =>
      relative(repoRoot, file).startsWith(PROBES),
    )
    const offenders: string[] = []
    for (const file of probes) {
      const source = await readFile(file, 'utf8')
      for (const pattern of SELF_IDENTIFICATION) {
        if (pattern.test(source)) {
          offenders.push(`${relative(repoRoot, file)}: ${pattern}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('catches the prompts it is meant to catch', () => {
    const asks = [
      'What model are you?',
      'Who created you?',
      'Please identify yourself.',
      'Are you Claude or GPT?',
      'Tell me your model name.',
      'Which company trained you?',
    ]
    for (const ask of asks) {
      expect(SELF_IDENTIFICATION.some((pattern) => pattern.test(ask))).toBe(true)
    }
  })
})

describe('every signal carries a citation', () => {
  it('refuses a signal that cites nothing, rather than scoring it low', () => {
    const uncited = { ...valid(), citations: [] } as unknown as Signal
    expect(() => aggregate([uncited], 'native')).toThrow(/must cite/)
    const missing = { ...valid(), citations: undefined } as unknown as Signal
    expect(() => aggregate([missing], 'native')).toThrow(/must cite/)
    expect(() => aggregate([valid()], 'native')).not.toThrow()
  })
})
