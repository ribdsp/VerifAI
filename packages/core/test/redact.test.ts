import { describe, expect, it } from 'vitest'
import {
  createRedactor,
  MIN_TRUNCATED_LENGTH,
  PARTIAL_MATCH_LENGTH,
  REDACTION_MARKER,
} from '../src/credentials/redact.js'

// Keys are assembled at runtime so this file never holds a credential-shaped
// literal for `test/no-secrets.test.ts` to find.
const ANTHROPIC_SHAPED = ['sk', 'ant', 'api03', 'Q7vK2mZp9xLr4TbN8cWf3HjD6sYg1EaU5oIqR0nVkM'].join(
  '-',
)
const OPENAI_SHAPED = ['sk', 'proj', 'Hq3Zt8Lw1Nc6Vb0Xm5Ks9Pd2Rf7Gj4Ya_Te-Uo'].join('-')

// Every character that JSON or a URL would escape, so the encoded forms differ
// from the raw key.
const BACKSLASH = String.fromCharCode(92)
const TRICKY = `Zr8+Pq/2Lw=Kd"Mv${BACKSLASH}Tn7#Bx4&Yc9?Hs1%Gf`

const MARKER = REDACTION_MARKER

/** No run of the key long enough to count as key material survived. */
function expectNoFragment(text: string, key: string): void {
  for (let at = 0; at + PARTIAL_MATCH_LENGTH <= key.length; at += 1) {
    expect(text).not.toContain(key.slice(at, at + PARTIAL_MATCH_LENGTH))
  }
}

describe('createRedactor', () => {
  it('is the identity when there is nothing to redact', () => {
    expect(createRedactor([])('Authorization: Bearer nothing')).toBe(
      'Authorization: Bearer nothing',
    )
    expect(createRedactor(['', ''])('abc')).toBe('abc')
  })

  it('replaces every whole occurrence and leaves the rest of the text alone', () => {
    const redact = createRedactor([ANTHROPIC_SHAPED])
    const text = `Authorization: Bearer ${ANTHROPIC_SHAPED}\nx-api-key: ${ANTHROPIC_SHAPED}`

    expect(redact(text)).toBe(`Authorization: Bearer ${MARKER}\nx-api-key: ${MARKER}`)
  })

  it('redacts every secret it was given', () => {
    const redact = createRedactor([ANTHROPIC_SHAPED, OPENAI_SHAPED, ANTHROPIC_SHAPED])

    expect(redact(`${ANTHROPIC_SHAPED} then ${OPENAI_SHAPED}`)).toBe(`${MARKER} then ${MARKER}`)
  })

  it('collapses back-to-back occurrences into one marker', () => {
    const redact = createRedactor([OPENAI_SHAPED])

    expect(redact(`[${OPENAI_SHAPED}${OPENAI_SHAPED}]`)).toBe(`[${MARKER}]`)
  })

  it('redacts the escaped form a key takes inside a JSON error body', () => {
    const redact = createRedactor([TRICKY])
    const body = JSON.stringify({ error: { message: `invalid x-api-key: ${TRICKY}` } })
    expect(body, 'the key must be escaped for this test to mean anything').not.toContain(TRICKY)

    const redacted = redact(body)

    expect(JSON.parse(redacted)).toEqual({ error: { message: `invalid x-api-key: ${MARKER}` } })
    expectNoFragment(redacted, JSON.stringify(TRICKY).slice(1, -1))
  })

  it('redacts the percent-encoded form a key takes inside a URL', () => {
    const redact = createRedactor([TRICKY])
    const encoded = encodeURIComponent(TRICKY)
    expect(encoded).not.toBe(TRICKY)

    expect(redact(`GET /v1/models?key=${encoded}&beta=true`)).toBe(
      `GET /v1/models?key=${MARKER}&beta=true`,
    )
  })

  it('redacts a prefix a gateway echoes back when it rejects the key', () => {
    const redact = createRedactor([OPENAI_SHAPED])
    const echoed = OPENAI_SHAPED.slice(0, 24)
    const message = `Incorrect API key provided: ${echoed}*****. You can find your API key in the dashboard.`

    expect(redact(message)).toBe(
      `Incorrect API key provided: ${MARKER}*****. You can find your API key in the dashboard.`,
    )
  })

  it('redacts a fragment from the middle or the end of a key', () => {
    const redact = createRedactor([ANTHROPIC_SHAPED])
    const middle = ANTHROPIC_SHAPED.slice(14, 14 + PARTIAL_MATCH_LENGTH)
    const tail = ANTHROPIC_SHAPED.slice(-20)

    expect(redact(`seen <${middle}> and <${tail}>`)).toBe(`seen <${MARKER}> and <${MARKER}>`)
  })

  it('leaves fragments shorter than the partial-match length, like a public vendor prefix', () => {
    expect(PARTIAL_MATCH_LENGTH).toBe(16)
    const redact = createRedactor([ANTHROPIC_SHAPED])
    const prefix = ANTHROPIC_SHAPED.slice(0, 13)
    const justShort = ANTHROPIC_SHAPED.slice(20, 20 + PARTIAL_MATCH_LENGTH - 1)
    const justLongEnough = ANTHROPIC_SHAPED.slice(20, 20 + PARTIAL_MATCH_LENGTH)

    expect(redact(`Anthropic keys start with ${prefix}.`)).toBe(
      `Anthropic keys start with ${prefix}.`,
    )
    expect(redact(`<${justShort}>`)).toBe(`<${justShort}>`)
    expect(redact(`<${justLongEnough}>`)).toBe(`<${MARKER}>`)
  })

  it('redacts a short secret where it appears whole, and not a piece of it on its own', () => {
    const redact = createRedactor(['sk-1234'])

    expect(redact('Authorization: Bearer sk-1234')).toBe(`Authorization: Bearer ${MARKER}`)
    expect(redact('prefix sk-12 is not the key')).toBe('prefix sk-12 is not the key')
  })

  it('redacts a short secret cut short beside a truncation marker', () => {
    expect(MIN_TRUNCATED_LENGTH).toBe(4)
    const short = 'Kq7Zt2Lw9Vb4'
    const redact = createRedactor([short])

    expect(redact(`Incorrect API key provided: ${short.slice(0, 8)}****.`)).toBe(
      `Incorrect API key provided: ${MARKER}****.`,
    )
    expect(redact(`key ${short.slice(0, 5)}... rejected`)).toBe(`key ${MARKER}... rejected`)
    expect(redact(`key ${short.slice(0, 4)}… rejected`)).toBe(`key ${MARKER}… rejected`)
    expect(redact(`key ****${short.slice(-4)} rejected`)).toBe(`key ****${MARKER} rejected`)
    expect(redact(`key ...${short.slice(-6)} rejected`)).toBe(`key ...${MARKER} rejected`)
  })

  it('leaves a truncated piece of a short secret shorter than the minimum', () => {
    const short = 'Kq7Zt2Lw9Vb4'
    const redact = createRedactor([short])

    expect(redact(`key ${short.slice(0, 3)}... rejected`)).toBe(
      `key ${short.slice(0, 3)}... rejected`,
    )
    expect(redact(`key ***${short.slice(-3)} rejected`)).toBe(`key ***${short.slice(-3)} rejected`)
  })

  it('redacts a short secret whole even where it reads as another cut short', () => {
    // The first secret, whole, is exactly how the second looks cut to five characters.
    const redact = createRedactor(['abcde...', 'abcdefgh'])

    expect(redact('<abcde...>')).toBe(`<${MARKER}>`)
  })

  it('redacts the escaped form of a short secret cut short', () => {
    const short = 'ab"cd\\ef'
    const redact = createRedactor([short])

    expect(redact('{"message":"key ab\\"cd\\\\... rejected"}')).toBe(
      `{"message":"key ${MARKER}... rejected"}`,
    )
  })

  it('matches secrets literally, never as patterns', () => {
    expect(createRedactor(['.*'])('hello world')).toBe('hello world')
    expect(createRedactor(['.*'])('match .* here')).toBe(`match ${MARKER} here`)

    const patternShaped = '(a+)+$[^]'.repeat(3)
    const redact = createRedactor([patternShaped])
    expect(redact('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!')).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!',
    )
    expect(redact(`x${patternShaped}x`)).toBe(`x${MARKER}x`)
  })

  it('leaves text without any secret byte-for-byte unchanged, markers included', () => {
    const redact = createRedactor([ANTHROPIC_SHAPED, OPENAI_SHAPED])
    const text = `{"type":"error","error":{"message":"${MARKER} was already redacted"}}\r\n\t`

    expect(redact(text)).toBe(text)
  })

  it('never throws, whatever the text or the secret', () => {
    const lone = String.fromCharCode(0xd800)
    const withLoneSurrogate = `abc${lone}defghijklmnopqrstuvwxyz`

    // `encodeURIComponent` throws on a lone surrogate; the redactor must not.
    const redact = createRedactor([withLoneSurrogate])
    expect(redact(`key=${withLoneSurrogate}`)).toBe(`key=${MARKER}`)
    expect(redact('')).toBe('')
    expect(createRedactor([OPENAI_SHAPED])(`${lone}${OPENAI_SHAPED}${lone}`)).toBe(
      `${lone}${MARKER}${lone}`,
    )
  })

  it('is unaffected by later changes to the array it was built from', () => {
    const secrets = [OPENAI_SHAPED]
    const redact = createRedactor(secrets)
    secrets.pop()

    expect(redact(OPENAI_SHAPED)).toBe(MARKER)
  })

  it('stays linear on a large body', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const key = Array.from({ length: 200 }, (_, at) => alphabet.charAt((at * 7919) % 62)).join('')
    const redact = createRedactor([key])
    const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(24_000)
    const body = `${filler}${key}${filler}${key.slice(0, 40)}${filler}`

    const started = performance.now()
    const redacted = redact(body)
    const elapsed = performance.now() - started

    expect(redacted).toBe(`${filler}${MARKER}${filler}${MARKER}${filler}`)
    // Generous on purpose: this guards against a quadratic implementation,
    // which takes minutes here, not against a slow CI machine.
    expect(elapsed).toBeLessThan(3000)
  })

  it('stays linear when the text is nothing but key material', () => {
    const key = 'a'.repeat(200)
    const redact = createRedactor([key])

    const started = performance.now()
    const redacted = redact('a'.repeat(1_000_000))
    const elapsed = performance.now() - started

    expect(redacted).toBe(MARKER)
    expect(elapsed).toBeLessThan(3000)
  })
})
