import { describe, expect, it } from 'vitest'
import { parseTargetUrl } from '../src/net/target-url.js'

const STRICT = { allowPrivateTargets: false }
const PERMISSIVE = { allowPrivateTargets: true }

function accepted(input: string, policy = STRICT) {
  const result = parseTargetUrl(input, policy)
  if (!result.ok) {
    throw new Error(`expected ${input} to be accepted, got ${result.problem}`)
  }
  return result.target
}

describe('parseTargetUrl', () => {
  it('accepts an https endpoint and exposes what the transport needs', () => {
    expect(accepted('https://api.example.com/v1')).toEqual({
      href: 'https://api.example.com/v1',
      protocol: 'https:',
      hostname: 'api.example.com',
      host: 'api.example.com',
      port: 443,
      path: '/v1',
      addressLiteral: undefined,
    })
  })

  it('keeps the query, drops the fragment, and applies the default port per scheme', () => {
    const target = accepted('http://gateway.example.com:8080/openai?api-version=2025-01-01#top')
    expect(target.href).toBe('http://gateway.example.com:8080/openai?api-version=2025-01-01')
    expect(target.path).toBe('/openai?api-version=2025-01-01')
    expect(target.port).toBe(8080)
    expect(target.host).toBe('gateway.example.com:8080')
    expect(accepted('http://gateway.example.com/').port).toBe(80)
  })

  it('canonicalises the hostname the way the WHATWG URL parser does', () => {
    expect(accepted('https://API.Example.COM./v1').hostname).toBe('api.example.com.')
  })

  it('refuses schemes other than http and https', () => {
    for (const input of [
      'ftp://example.com/',
      'file:///etc/passwd',
      'ws://example.com/',
      'data:text/plain,hi',
      'javascript:alert(1)',
      'gopher://example.com/',
    ]) {
      expect(parseTargetUrl(input, PERMISSIVE), input).toEqual({
        ok: false,
        problem: 'unsupported-scheme',
      })
    }
  })

  it('refuses text that is not an absolute URL', () => {
    for (const input of ['', 'api.example.com', '/v1/messages', 'https://', 'http://[::1']) {
      expect(parseTargetUrl(input, PERMISSIVE), JSON.stringify(input)).toEqual({
        ok: false,
        problem: 'not-a-url',
      })
    }
  })

  it('refuses credentials embedded in the URL', () => {
    // They would be written into logs and reports verbatim, and the key has its
    // own channel: an environment variable or a prompt.
    for (const input of ['https://user:pass@api.example.com/', 'https://token@api.example.com/']) {
      expect(parseTargetUrl(input, PERMISSIVE), input).toEqual({
        ok: false,
        problem: 'embedded-credentials',
      })
    }
  })

  describe('address literals', () => {
    it('classifies an IPv4 literal before anything resolves it', () => {
      expect(parseTargetUrl('http://169.254.169.254/latest/meta-data/', PERMISSIVE)).toEqual({
        ok: false,
        problem: 'blocked-address',
        scope: 'forbidden',
      })
      expect(parseTargetUrl('http://10.0.0.8:4000/', STRICT)).toEqual({
        ok: false,
        problem: 'blocked-address',
        scope: 'private',
      })
      expect(accepted('http://10.0.0.8:4000/', PERMISSIVE).addressLiteral).toEqual({
        range: 'private',
        scope: 'private',
      })
    })

    it('sees through the numeric forms the URL parser canonicalises', () => {
      // WHATWG URL turns every one of these into 127.0.0.1, which is why the
      // classifier only has to understand canonical dotted quads.
      for (const input of ['http://0x7f.0.0.1/', 'http://2130706433/', 'http://127.1/']) {
        expect(parseTargetUrl(input, STRICT), input).toEqual({
          ok: false,
          problem: 'blocked-address',
          scope: 'private',
        })
      }
    })

    it('strips the brackets from an IPv6 literal but keeps them in the Host header', () => {
      const target = accepted('http://[::1]:8787/v1', PERMISSIVE)
      expect(target.hostname).toBe('::1')
      expect(target.host).toBe('[::1]:8787')
      expect(target.addressLiteral).toEqual({ range: 'loopback', scope: 'private' })
    })

    it('classifies IPv4-mapped IPv6 literals by the address they map', () => {
      expect(parseTargetUrl('http://[::ffff:169.254.169.254]/', PERMISSIVE)).toEqual({
        ok: false,
        problem: 'blocked-address',
        scope: 'forbidden',
      })
    })

    it('treats a public literal as an ordinary target', () => {
      expect(accepted('https://104.18.6.192/v1').addressLiteral).toEqual({
        range: 'public',
        scope: 'public',
      })
    })
  })

  it('leaves names to the resolver, so localhost is judged by what it resolves to', () => {
    // Refusing the literal string "localhost" here would be a second, weaker
    // copy of the address check. The transport checks every resolved address.
    expect(accepted('http://localhost:4000/').addressLiteral).toBeUndefined()
  })

  it('returns frozen results', () => {
    const result = parseTargetUrl('https://api.example.com/', STRICT)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(accepted('https://api.example.com/'))).toBe(true)
  })
})
