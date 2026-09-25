/**
 * VerifAI's self-measured accuracy: the real probe catalogue, run end to end
 * through `prepareCheck` / `PreparedCheck.execute`, against adversarial
 * in-memory backends built from documented vendor facts (never from a probe
 * id or nonce). Each backend answers one question: does VerifAI's own
 * verdict match what a truthful description of that backend would say?
 *
 * `thin-pass-through` is the most important case here: it is the one backend
 * that is not lying about anything, and the whole point of the suite is that
 * VerifAI must not cry wolf at it.
 */

import { describe, expect, it } from 'vitest'
import { differentialCount } from '../src/probes/dilution/differential-count.js'
import { PROBE_CATALOGUE } from '../src/probes/registry.js'
import { type CheckEnvironment, prepareCheck } from '../src/service/check.js'
import type { CheckRequest } from '../src/service/contract.js'
import { evasiveBackend } from './fakes/backends/evasive.js'
import { fractionalRouterBackend } from './fakes/backends/fractional-router.js'
import { legitTranslationGatewayBackend } from './fakes/backends/legit-translation-gateway.js'
import {
  DOWNGRADE_ANSWERING_MODEL,
  modelDowngradeBackend,
  OPENAI_DOWNGRADE_ANSWERING_MODEL,
  openaiModelDowngradeBackend,
} from './fakes/backends/model-downgrade.js'
import { openaiTranslatedBackend } from './fakes/backends/openai-translated.js'
import { signatureForgerBackend } from './fakes/backends/signature-forger.js'
import {
  thinPassThroughBackend,
  thinPassThroughOpenaiBackend,
} from './fakes/backends/thin-pass-through.js'
import { harness } from './fakes/environment.js'
import type { Answer } from './fakes/transport.js'
import { fakeTransport } from './fakes/transport.js'

const KEY = ['sk', 'ant', 'api03', 'accuracytestkey0123456789abcdef'].join('-')
const CLAIMED_MODEL = 'claude-opus-5-5'
const GPT_MODEL = 'gpt-5.2-2025-12-11'

function request(overrides: Partial<CheckRequest> = {}): CheckRequest {
  return {
    endpoint: 'https://gateway.example/v1',
    apiKey: KEY,
    model: CLAIMED_MODEL,
    vendor: 'anthropic',
    protocol: 'anthropic-messages',
    profile: 'deep',
    ...overrides,
  }
}

function environment(answer: Answer, overrides: Partial<CheckEnvironment> = {}): CheckEnvironment {
  let drawn = 0
  return {
    transport: fakeTransport(answer),
    dilutionSupported: true,
    toolVersion: '0.1.0',
    catalogue: PROBE_CATALOGUE,
    randomId: (length) => {
      drawn += 1
      return String(drawn).repeat(length).slice(0, length)
    },
    ...overrides,
  }
}

/** Prepares and runs one check against `answer`, returning the finished report. */
async function runCheck(answer: Answer, overrides: Partial<CheckRequest> = {}) {
  const preparation = await prepareCheck(request(overrides), environment(answer))
  if (!preparation.ok) {
    throw new Error(`Test check refused: ${preparation.error.code}`)
  }
  const outcome = await preparation.check.execute({ environment: harness().environment })
  if (outcome.state !== 'finished') {
    throw new Error(`Test check did not finish: ${outcome.state}`)
  }
  return outcome.report
}

describe('accuracy: thin-pass-through', () => {
  it('is cleared as a genuine endpoint - the false-positive test', async () => {
    const report = await runCheck(thinPassThroughBackend(CLAIMED_MODEL))
    expect(report.verdict.headline).toBe('pass')
    expect(report.verdict.assessment.identity).toBe('matches-claim')
    expect(report.verdict.assessment.consistency).toBe('uniform')
  })

  it('is never accused for a claimed GPT model, even though it cannot yet clear to pass', async () => {
    const report = await runCheck(thinPassThroughOpenaiBackend(GPT_MODEL), {
      model: GPT_MODEL,
      vendor: 'openai',
      protocol: 'openai-chat',
    })
    expect(report.skipped).toEqual([])
    expect(report.verdict.assessment.identity).toBe('matches-claim')
    expect(report.verdict.assessment.consistency).toBe('uniform')
    expect(report.verdict.headline).not.toBe('fail')
  })

  // A limit of what OpenAI documents, reported rather than routed around. Anthropic's four
  // parameter-rejection matrices (sampling-matrix/assistant-prefill/thinking-matrix/
  // forced-tool-choice) carry +1.2 LLR onto identity. OpenAI documents one such matrix,
  // conformance/openai/reasoning-matrix, and GPT-5.1 answers it exactly as GPT-5.2 does, so it
  // reads +0.3 for the claim and +0.3 for a cheaper model alike. A wholly genuine GPT-5.2
  // backend's confidence stays near 0.45, under MINIMUM_PASS_CONFIDENCE (0.8); only a documented
  // fact that sets GPT-5.2 apart from every cheaper GPT model would clear it.
  it.fails('clears a genuine GPT-5 endpoint to a full pass, not just caution', async () => {
    const report = await runCheck(thinPassThroughOpenaiBackend(GPT_MODEL), {
      model: GPT_MODEL,
      vendor: 'openai',
      protocol: 'openai-chat',
    })
    expect(report.verdict.headline).toBe('pass')
  })
})

describe('accuracy: openai-translated', () => {
  it('is caught as another vendor, behind a layer, on a full, unobstructed run', async () => {
    const report = await runCheck(
      openaiTranslatedBackend({ claimedModel: CLAIMED_MODEL, answeringModel: GPT_MODEL }),
    )
    expect(report.skipped).toEqual([])
    // Not a cheaper Claude model: accepting what the claimed model refuses is what any layer that
    // drops the setting does, so only the o200k_base counts say who answered.
    expect(report.verdict.assessment.identity).toBe('different-vendor')
    expect(report.verdict.assessment.translation).toBe('translated')
    // Caution, not fail: a layer that recounts tokens itself would show the same counts, and
    // nothing decisive rules the claim out, so what is unresolved is not held against the seller.
    expect(report.verdict.headline).toBe('caution')
  })
})

describe('accuracy: model-downgrade', () => {
  it('is caught as the claimed vendor, but a cheaper model', async () => {
    const report = await runCheck(modelDowngradeBackend())
    expect(report.verdict.headline).not.toBe('pass')
    expect(report.verdict.assessment.identity).toBe('same-vendor-cheaper')
    // A genuine Anthropic endpoint, only the wrong model: nothing sits between it and the buyer.
    expect(report.verdict.assessment.translation).toBe('direct')
    expect(DOWNGRADE_ANSWERING_MODEL).not.toBe(CLAIMED_MODEL)
  })
})

describe('accuracy: model-downgrade, GPT', () => {
  it('is caught as a cheaper GPT model, though every answer reports the one sold', async () => {
    const report = await runCheck(openaiModelDowngradeBackend(GPT_MODEL), {
      model: GPT_MODEL,
      vendor: 'openai',
      protocol: 'openai-chat',
    })
    expect(report.skipped).toEqual([])
    expect(report.verdict.headline).not.toBe('pass')
    expect(report.verdict.assessment.identity).toBe('same-vendor-cheaper')
    expect(report.verdict.assessment.translation).toBe('direct')
    expect(OPENAI_DOWNGRADE_ANSWERING_MODEL).not.toBe(GPT_MODEL)
  })
})

describe('accuracy: signature-forger', () => {
  it('is caught by a tampered thinking signature it never verifies', async () => {
    const report = await runCheck(signatureForgerBackend(CLAIMED_MODEL))
    // The accepted tamper vetoes every Claude model, so nothing unresolved is left for the claim.
    expect(report.verdict.headline).toBe('fail')
    expect(report.verdict.assessment.identity).toBe('different-vendor')
  })
})

/**
 * The share of Group F checks this router sends off the majority's answer. It picks a backend
 * per request and a check is several, so a check reads as the majority only when every one of
 * its requests reaches the majority's model; a mixed check reads as neither.
 */
function offMajorityShare(epsilon: number): number {
  const requests = differentialCount.requestsPerDraw
  return 1 - Math.max((1 - epsilon) ** requests, epsilon ** requests)
}

describe('accuracy: fractional-router', () => {
  it.each([0.1, 0.3, 0.7])(
    'never passes at epsilon=%s, and reads as fractional',
    async (epsilon) => {
      const report = await runCheck(
        fractionalRouterBackend({
          claimedModel: CLAIMED_MODEL,
          cheaperModel: DOWNGRADE_ANSWERING_MODEL,
          epsilon,
        }),
      )
      expect(report.verdict.headline).not.toBe('pass')
      expect(report.verdict.assessment.consistency).toBe('fractional')
      const [lower, upper] = report.verdict.epsilon?.interval ?? [1, 0]
      expect(offMajorityShare(epsilon)).toBeGreaterThanOrEqual(lower)
      expect(offMajorityShare(epsilon)).toBeLessThanOrEqual(upper)
    },
  )
})

describe('accuracy: evasive', () => {
  it('is neither cleared nor condemned - caution over obstructed evidence', async () => {
    const report = await runCheck(evasiveBackend(CLAIMED_MODEL))
    expect(report.verdict.headline).toBe('caution')
    expect(report.verdict.assessment.evidence).toBe('obstructed')
  })
})

describe('accuracy: legit-translation-gateway', () => {
  it('is read as translated and never accused, though not yet cleared', async () => {
    const report = await runCheck(
      legitTranslationGatewayBackend({ answeringModel: CLAIMED_MODEL }),
      { protocol: 'openai-chat' },
    )
    expect(report.verdict.assessment.translation).toBe('translated')
    // Unresolved rather than cleared: over OpenAI Chat nothing measured yet says how Claude's
    // tokenizer counts, so the probes that would name the model have no reference to read against.
    expect(report.verdict.assessment.identity).toBe('unknown')
    expect(report.verdict.headline).toBe('caution')
  })
})
