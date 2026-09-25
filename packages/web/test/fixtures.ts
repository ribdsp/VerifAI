/**
 * Shared fixtures for the web tests: daemon responses as the contract types
 * them, and a fake `fetch` that records every call it is handed.
 */

import {
  type CheckEvent,
  type CheckStatusResponse,
  type CreateCheckResponse,
  type OptionsResponse,
  REPORT_VERSION,
  type Report,
  type RunEvent,
  type Signal,
} from '@verifai/core'
import type { FetchLike } from '../src/lib/api'

export const TOKEN = 'session-token-0123456789abcdef'

export const OPTIONS: OptionsResponse = {
  version: '0.1.0',
  profiles: [
    {
      profile: 'quick',
      description: 'Conformance only.',
      groups: ['A'],
      draws: 0,
      spreadMs: 0,
      maxRequests: 40,
      maxTokens: 20_000,
    },
    {
      profile: 'standard',
      description: 'Every group, a short dilution run.',
      groups: ['A', 'B', 'C', 'D', 'E', 'F'],
      draws: 24,
      spreadMs: 0,
      maxRequests: 200,
      maxTokens: 120_000,
    },
  ],
  vendors: ['auto', 'anthropic', 'openai'],
  protocols: ['auto', 'anthropic-messages', 'openai-chat', 'openai-responses'],
  authChoices: ['auto', 'x-api-key', 'bearer'],
  defaults: { profile: 'standard', vendor: 'auto', protocol: 'auto', auth: 'auto' },
  limits: {
    maxRequests: 2000,
    maxTokens: 2_000_000,
    maxSpreadMs: 3_600_000,
    maxEndpointLength: 2048,
    maxModelLength: 256,
  },
}

export const CREATED: CreateCheckResponse = {
  checkId: 'chk_01',
  estimate: {
    protocol: 'anthropic-messages',
    vendor: 'anthropic',
    pairing: 'native',
    auth: 'x-api-key',
    profile: 'standard',
    requests: 120,
    tokens: 80_000,
    maxRequests: 200,
    maxTokens: 120_000,
    draws: 30,
    spreadMs: 0,
    probes: [
      { id: 'A1', title: 'Envelope shape', group: 'A' },
      { id: 'F1', title: 'Fresh-connection draws', group: 'F' },
    ],
    skipped: [{ probeId: 'D2', reason: 'needs-api-key' }],
    warnings: ['plain-http'],
  },
}

export const SIGNAL: Signal = {
  probeId: 'A1',
  signalId: 'envelope-shape',
  family: 'protocol-conformance',
  calibration: 'documented',
  observed: 'The body carried a `type` of `message`.',
  expected: 'A Messages response carries `type: "message"`.',
  llr: { identity: { 'matches-claim': 0.2 } },
  plainLanguage: 'The response is shaped the way the vendor documents.',
  citations: [
    {
      url: 'https://docs.example.com/messages',
      quote: 'The response object has a "type" of "message".',
      retrievedAt: '2026-09-01',
    },
  ],
}

export const REPORT: Report = {
  reportVersion: REPORT_VERSION,
  tool: { name: 'verifai', version: '0.1.0' },
  fingerprintsVersion: '2026.09.1',
  run: {
    startedAt: '2026-09-24T10:00:00.000Z',
    finishedAt: '2026-09-24T10:04:00.000Z',
    profile: 'standard',
    spreadMs: 0,
    nonce: 'nonce-1',
    probeOrderSeed: 'seed-1',
    privateTargetsAllowed: false,
  },
  target: {
    endpointHash: `sha256:${'ab'.repeat(32)}`,
    endpoint: null,
    protocol: 'anthropic-messages',
    claimedVendor: 'anthropic',
    claimedModel: 'claude-sonnet-5',
    requestedModel: 'claude-sonnet-5',
    pairing: 'native',
    auth: 'x-api-key',
  },
  verdict: {
    headline: 'pass',
    assessment: {
      identity: 'matches-claim',
      consistency: 'uniform',
      platform: 'first-party',
      translation: 'direct',
      evidence: 'sufficient',
    },
    confidence: 0.82,
    confidenceCeiling: 0.9,
    ceilingReasons: ['group-d-not-run'],
    plainLanguage: 'The endpoint behaves like the model it claims to be.',
    epsilon: {
      probeId: 'F1',
      basis: 'reference',
      disagreements: 1,
      trials: 23,
      lost: 1,
      estimate: 0.0435,
      interval: [0.002, 0.19],
      clustered: false,
      draws: [
        { draw: 1, outcome: 'agree' },
        { draw: 2, outcome: 'disagree' },
        { draw: 3, outcome: 'lost' },
      ],
    },
  },
  posteriors: {
    identity: {
      'matches-claim': 0.91,
      'same-vendor-cheaper': 0.05,
      'different-vendor': 0.02,
      'not-a-live-model': 0.01,
      unknown: 0.01,
    },
    consistency: { uniform: 0.88, fractional: 0.1, unknown: 0.02 },
    platform: { 'first-party': 0.7, 'partner-cloud': 0.2, unknown: 0.1 },
    translation: { direct: 0.95, translated: 0.04, unknown: 0.01 },
  },
  signals: [SIGNAL],
  skipped: [{ probeId: 'D2', reason: 'needs-api-key' }],
  evidence: [],
}

export function checkEvent(seq: number, event: RunEvent): CheckEvent {
  return { seq, event }
}

export function statusOf(overrides: Partial<CheckStatusResponse> = {}): CheckStatusResponse {
  return {
    checkId: CREATED.checkId,
    state: 'running',
    progress: { done: 0, total: 2, requests: 0, tokens: 0 },
    events: [],
    nextEvent: 0,
    ...overrides,
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export interface FetchCall {
  readonly input: string
  readonly init: RequestInit
}

export interface FakeFetch {
  readonly fetch: FetchLike
  readonly calls: readonly FetchCall[]
}

/** A `fetch` that answers from `respond` and records what it was asked. */
export function fakeFetch(
  respond: (call: FetchCall) => Response | Promise<Response> = () => jsonResponse({}),
): FakeFetch {
  const calls: FetchCall[] = []
  return {
    calls,
    fetch: async (input, init) => {
      const call = { input, init }
      calls.push(call)
      return respond(call)
    },
  }
}

/** The headers of a recorded call, as the plain object the client sends. */
export function headersOf(call: FetchCall | undefined): Readonly<Record<string, string>> {
  return (call?.init.headers ?? {}) as Readonly<Record<string, string>>
}
