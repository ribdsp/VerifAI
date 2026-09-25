import { describe, expect, it } from 'vitest'
import type { CheckRequest } from '../src/service/contract.js'
import { BLOCKED_TARGET_MESSAGE, resolveTarget } from '../src/service/target.js'
import type { TransportResult } from '../src/transport/types.js'
import { failure, fakeTransport, jsonResponse, response } from './fakes/transport.js'

const KEY = ['sk', 'ant', 'api03', 'resolvetestkey0123456789abcdef'].join('-')
const ROOT = 'https://gateway.example/v1'

function request(overrides: Partial<CheckRequest> = {}): CheckRequest {
  return {
    endpoint: ROOT,
    apiKey: KEY,
    model: 'claude-opus-5-5',
    vendor: 'auto',
    protocol: 'anthropic-messages',
    profile: 'standard',
    ...overrides,
  }
}

const anthropicError = jsonResponse(
  400,
  JSON.parse(
    '{"type":"error","error":{"type":"invalid_request_error","message":"model: Field required"}}',
  ),
)

async function resolve(
  overrides: Partial<CheckRequest>,
  answer: (url: string) => TransportResult = () => response(404),
) {
  const transport = fakeTransport((sent) => answer(sent.url))
  const resolution = await resolveTarget(request(overrides), transport)
  return { resolution, transport }
}

describe('resolveTarget, choosing how the key travels', () => {
  it('keeps the scheme the buyer chose on the target', async () => {
    const { resolution } = await resolve({ auth: 'bearer' })
    expect(resolution.ok && resolution.value.target.auth).toBe('bearer')
  })

  it('leaves the scheme to each protocol when the buyer chose auto', async () => {
    const { resolution } = await resolve({ auth: 'auto' })
    expect(resolution.ok && 'auth' in resolution.value.target).toBe(false)
  })

  it('refuses a scheme the protocol does not take, naming the one it does', async () => {
    const { resolution, transport } = await resolve({ auth: 'x-api-key', protocol: 'openai-chat' })
    expect(resolution).toEqual({
      ok: false,
      error: { code: 'invalid-request', message: 'auth: openai-chat takes only bearer' },
    })
    expect(transport.requests).toEqual([])
  })

  it('detects the protocol with the key in the chosen scheme', async () => {
    const { resolution, transport } = await resolve({ auth: 'bearer', protocol: 'auto' }, (url) =>
      url.endsWith('/messages') ? anthropicError : response(404),
    )
    expect(resolution.ok && resolution.value.target.protocol).toBe('anthropic-messages')
    const [messages] = transport.requests
    expect(messages?.headers).toContainEqual(['Authorization', `Bearer ${KEY}`])
  })
})

describe('resolveTarget', () => {
  it('builds the target from what the buyer typed, sending nothing', async () => {
    const { resolution, transport } = await resolve({})
    expect(transport.requests).toEqual([])
    expect(resolution).toEqual({
      ok: true,
      value: {
        target: {
          endpoint: { root: ROOT, protocolHint: undefined },
          protocol: 'anthropic-messages',
          claimedVendor: 'anthropic',
          claimedModel: 'claude-opus-5-5',
          requestedModel: 'claude-opus-5-5',
          pairing: 'native',
        },
        apiKey: KEY,
        warnings: ['vendor-inferred'],
      },
    })
    expect(Object.isFrozen(resolution)).toBe(true)
  })

  it.each([
    [{ endpoint: 'not a url' }, 'invalid-endpoint'],
    [{ endpoint: 'ftp://gateway.example/v1' }, 'invalid-endpoint'],
    [{ endpoint: `https://user:${KEY}@gateway.example/v1` }, 'invalid-endpoint'],
    [{ endpoint: `${ROOT}?key=${KEY}` }, 'invalid-endpoint'],
    [{ model: '   ' }, 'invalid-model'],
    [{ model: `claude${String.fromCodePoint(0x200b)}opus` }, 'invalid-model'],
    [{ apiKey: 'abc' }, 'invalid-api-key'],
    [{ apiKey: `${KEY}${String.fromCodePoint(0x7f)}` }, 'invalid-api-key'],
    [{ model: 'llama-4-maverick' }, 'invalid-request'],
  ] as const)('refuses %o as %s, naming the field, never the value', async (overrides, code) => {
    const { resolution, transport } = await resolve(overrides)
    expect(resolution.ok).toBe(false)
    if (resolution.ok) {
      return
    }
    expect(resolution.error.code).toBe(code)
    expect(resolution.error.message).not.toContain(KEY)
    expect(resolution.error.message).not.toContain('gateway.example')
    expect(transport.requests).toEqual([])
  })

  it("keeps the gateway's model name for requests and files the claim under the vendor's", async () => {
    const { resolution } = await resolve({ model: 'reseller/claude-opus-4.6' })
    expect(resolution.ok && resolution.value.target).toMatchObject({
      claimedVendor: 'anthropic',
      claimedModel: 'claude-opus-4-6',
      requestedModel: 'reseller/claude-opus-4.6',
    })
    expect(resolution.ok && resolution.value.warnings).toEqual(['model-mapped', 'vendor-inferred'])
  })

  it("maps a platform's vendor prefix within the vendor the buyer chose", async () => {
    const { resolution } = await resolve({
      model: 'openai-gpt-5.4',
      vendor: 'openai',
      protocol: 'openai-chat',
    })
    expect(resolution.ok && resolution.value.target).toMatchObject({
      claimedVendor: 'openai',
      claimedModel: 'gpt-5.4',
      requestedModel: 'openai-gpt-5.4',
      pairing: 'native',
    })
    expect(resolution.ok && resolution.value.warnings).toEqual(['model-mapped'])
  })

  it('leaves a name no catalog knows as the claim, unmapped', async () => {
    const { resolution } = await resolve({ model: 'reseller/claude-9-9' })
    expect(resolution.ok && resolution.value.target).toMatchObject({
      claimedModel: 'reseller/claude-9-9',
      requestedModel: 'reseller/claude-9-9',
    })
    expect(resolution.ok && resolution.value.warnings).toEqual(['vendor-inferred'])
  })

  it('reads a blank key as no key', async () => {
    const { resolution } = await resolve({ apiKey: '  ' })
    expect(resolution.ok && resolution.value.apiKey).toBeUndefined()
    expect(resolution.ok && resolution.value.warnings).toContain('no-api-key')
  })

  it('refuses a private address literal unless the run allows private targets', async () => {
    const blocked = await resolve({ endpoint: 'http://10.0.0.7:8080/v1' })
    expect(blocked.resolution).toEqual({
      ok: false,
      error: { code: 'blocked-target', message: BLOCKED_TARGET_MESSAGE },
    })

    const allowed = await resolve({
      endpoint: 'http://10.0.0.7:8080/v1',
      allowPrivateTargets: true,
      vendor: 'anthropic',
    })
    expect(allowed.resolution.ok && allowed.resolution.value.warnings).toEqual([
      'plain-http',
      'private-targets-allowed',
    ])
  })

  it('never admits a forbidden address, allowed private targets or not', async () => {
    const { resolution } = await resolve({
      endpoint: 'http://169.254.169.254/v1',
      allowPrivateTargets: true,
    })
    expect(resolution.ok ? undefined : resolution.error.code).toBe('blocked-target')
  })

  it('takes the protocol from the pasted operation before detecting', async () => {
    const { resolution, transport } = await resolve({
      endpoint: `${ROOT}/chat/completions`,
      protocol: 'auto',
    })
    expect(transport.requests).toEqual([])
    expect(resolution.ok && resolution.value.target).toMatchObject({
      protocol: 'openai-chat',
      pairing: 'cross-protocol',
    })
    expect(resolution.ok && resolution.value.warnings).toEqual([
      'cross-protocol',
      'vendor-inferred',
    ])
  })

  it('detects the protocol when nothing names it, and says so', async () => {
    const { resolution, transport } = await resolve(
      { protocol: 'auto', vendor: 'anthropic' },
      (url) => (url === `${ROOT}/messages` ? anthropicError : response(404)),
    )
    expect(transport.requests).toHaveLength(3)
    expect(
      transport.requests.every((sent) => sent.headers.some(([, value]) => value.includes(KEY))),
    ).toBe(true)
    expect(resolution.ok && resolution.value.target.protocol).toBe('anthropic-messages')
    expect(resolution.ok && resolution.value.warnings).toEqual(['protocol-detected'])
  })

  it.each([
    [() => failure('dns-failure'), 'unreachable'],
    [() => failure('blocked-target'), 'blocked-target'],
    [() => response(404), 'detection-failed'],
  ] as const)('refuses a detection that finds nothing (%#) as %s', async (answer, code) => {
    const { resolution } = await resolve({ protocol: 'auto' }, answer)
    expect(resolution.ok ? undefined : resolution.error.code).toBe(code)
  })
})
