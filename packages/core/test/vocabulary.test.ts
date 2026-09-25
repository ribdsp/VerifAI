import { describe, expect, it } from 'vitest'
import { subset, vocabulary } from '../src/types/vocabulary.js'

describe('vocabulary', () => {
  it('freezes its members so a published build cannot be mutated', () => {
    // `as const` is erased by the build. Without the freeze, anything importing
    // the compiled package can append a member and change how every later run
    // scores - verified against the built `dist`, not assumed from the source.
    const colours = vocabulary(['red', 'green'])

    expect(() => (colours.values as string[]).push('blue')).toThrow(TypeError)
    expect(colours.values).toEqual(['red', 'green'])
  })

  it('rejects a duplicate member at construction, naming it', () => {
    // A value listed twice inside a scoring subset is counted twice by the
    // aggregator, which manufactures confidence out of a typo. Failing at import
    // is the only point at which this is cheap to notice.
    expect(() => vocabulary(['a', 'b', 'a'])).toThrow(/duplicate members: a/)
  })

  it('narrows an untrusted value and rejects everything else', () => {
    const colours = vocabulary(['red', 'green'])

    expect(colours.has('red')).toBe(true)
    expect(colours.has('blue')).toBe(false)
    // The realistic boundary inputs: a JSON body or a CLI flag can supply any of
    // these, and `LOOKUP[value]` would hand back `undefined` for all of them.
    expect(colours.has(undefined)).toBe(false)
    expect(colours.has(null)).toBe(false)
    expect(colours.has(0)).toBe(false)
    expect(colours.has(['red'])).toBe(false)
  })

  it('does not treat inherited object properties as members', () => {
    const colours = vocabulary(['red'])

    // The reason `has` is backed by a Set rather than an object lookup.
    expect(colours.has('toString')).toBe(false)
    expect(colours.has('constructor')).toBe(false)
    expect(colours.has('__proto__')).toBe(false)
  })

  it('keeps declaration order, because reports render these lists', () => {
    expect(vocabulary(['c', 'a', 'b']).values).toEqual(['c', 'a', 'b'])
  })

  it('copies its input, so a later mutation of the caller array cannot leak in', () => {
    const source = ['red', 'green']
    const colours = vocabulary(source)

    source.push('blue')

    expect(colours.values).toEqual(['red', 'green'])
    expect(colours.has('blue')).toBe(false)
  })
})

describe('subset', () => {
  it('rejects a member that is not in the parent vocabulary', () => {
    // Only reachable through a cast, which is exactly how it would arrive: a
    // member gets renamed in the parent and the subset keeps the old spelling,
    // silently matching nothing for the rest of the project's life.
    const colours = vocabulary(['red', 'green'])

    expect(() => subset(colours, ['blue' as unknown as 'red'])).toThrow(
      /outside its parent vocabulary: blue/,
    )
  })

  it('inherits the parent checks it needs', () => {
    const colours = vocabulary(['red', 'green'])

    expect(() => subset(colours, ['red', 'red'])).toThrow(/duplicate members: red/)
    expect(() => (subset(colours, ['red']).values as string[]).push('green')).toThrow(TypeError)
  })
})
