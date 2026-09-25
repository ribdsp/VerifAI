import { describe, expect, it } from 'vitest'
import { readErrorBody } from '../src/adapters/error-body.js'

const json = (text: string): unknown => JSON.parse(text)

describe('readErrorBody', () => {
  it("reads Anthropic's documented envelope", () => {
    const body = json(
      '{"type":"error","error":{"type":"not_found_error","message":"The requested resource could not be found."},"request_id":"req_011CSHoEeqs5C35K2UUqR7Fy"}',
    )
    expect(readErrorBody(body)).toEqual({
      dialect: 'anthropic',
      message: 'The requested resource could not be found.',
      type: 'not_found_error',
      code: undefined,
      param: undefined,
      requestId: 'req_011CSHoEeqs5C35K2UUqR7Fy',
      deviations: [],
    })
  })

  it('treats a missing request_id as documented, and a missing error type as a deviation', () => {
    const withoutId = readErrorBody(
      json('{"type":"error","error":{"type":"api_error","message":"m"}}'),
    )
    expect(withoutId?.requestId).toBeUndefined()
    expect(withoutId?.deviations).toEqual([])

    const withoutType = readErrorBody(json('{"type":"error","error":{"message":"m"}}'))
    expect(withoutType?.dialect).toBe('anthropic')
    expect(withoutType?.type).toBeUndefined()
    expect(withoutType?.deviations).toEqual([
      { path: 'error.type', expected: 'present', received: 'absent' },
    ])
  })

  it("reads OpenAI's documented envelope, keeping null apart from absent", () => {
    const body = json(
      '{"error":{"message":"The model `gpt-4` does not exist or you do not have access to it.","type":"invalid_request_error","param":null,"code":"model_not_found"}}',
    )
    expect(readErrorBody(body)).toEqual({
      dialect: 'openai',
      message: 'The model `gpt-4` does not exist or you do not have access to it.',
      type: 'invalid_request_error',
      code: 'model_not_found',
      param: null,
      requestId: undefined,
      deviations: [],
    })
  })

  it('reports the documented OpenAI fields a body leaves out', () => {
    const result = readErrorBody(json('{"error":{"message":"m","type":"server_error"}}'))
    expect(result?.dialect).toBe('openai')
    expect(result?.code).toBeUndefined()
    expect(result?.param).toBeUndefined()
    expect(result?.deviations).toEqual([
      { path: 'error.param', expected: 'present', received: 'absent' },
      { path: 'error.code', expected: 'present', received: 'absent' },
    ])
  })

  it('reads a numeric OpenAI code as a deviation rather than a value', () => {
    const result = readErrorBody(
      json('{"error":{"message":"m","type":"t","param":null,"code":429}}'),
    )
    expect(result?.code).toBeUndefined()
    expect(result?.deviations).toEqual([
      { path: 'error.code', expected: '(string | null)', received: '429' },
    ])
  })

  it('recognises neither dialect in the shapes other stacks use', () => {
    for (const text of [
      '{"error":"Not Found"}',
      '{"detail":"Not Found"}',
      '{"message":"Unauthorized"}',
      '{"error":{"code":5}}',
      '{"error":{"message":5}}',
      '{"type":"error"}',
      '{"type":"error","error":{"message":null}}',
      '{"error":[{"message":"m"}]}',
      '[{"error":{"message":"m"}}]',
      'null',
      '"error"',
    ]) {
      expect(readErrorBody(json(text)), text).toBeUndefined()
    }
  })

  it('never reads an envelope out of an inherited key', () => {
    expect(readErrorBody(json('{"__proto__":{"error":{"message":"m"}}}'))).toBeUndefined()
  })

  it('freezes what it returns', () => {
    const result = readErrorBody(json('{"error":{"message":"m"}}'))
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result?.deviations)).toBe(true)
  })
})
