import { describe, expect, it } from 'vitest'
import { checkAddresses } from '../src/net/guard.js'

const STRICT = { allowPrivateTargets: false }
const PERMISSIVE = { allowPrivateTargets: true }

describe('checkAddresses', () => {
  it('admits a set of public addresses under either policy', () => {
    for (const policy of [STRICT, PERMISSIVE]) {
      expect(checkAddresses(['104.18.6.192', '2606:4700::6810:6c0'], policy)).toEqual({
        admitted: true,
      })
    }
  })

  it('refuses private space by default and admits it under --allow-private-targets', () => {
    expect(checkAddresses(['127.0.0.1'], STRICT)).toEqual({ admitted: false, scope: 'private' })
    expect(checkAddresses(['127.0.0.1', '::1'], PERMISSIVE)).toEqual({ admitted: true })
    expect(checkAddresses(['10.0.0.8'], PERMISSIVE)).toEqual({ admitted: true })
  })

  it('refuses forbidden space under every policy', () => {
    for (const policy of [STRICT, PERMISSIVE]) {
      expect(checkAddresses(['169.254.169.254'], policy)).toEqual({
        admitted: false,
        scope: 'forbidden',
      })
      expect(checkAddresses(['::ffff:169.254.169.254'], policy)).toEqual({
        admitted: false,
        scope: 'forbidden',
      })
    }
  })

  it('refuses the whole set when any one address is refused', () => {
    // A name that resolves to one public and one internal address is how a
    // rebinding attack survives a guard that checks only the first answer.
    expect(checkAddresses(['104.18.6.192', '10.0.0.1'], STRICT)).toEqual({
      admitted: false,
      scope: 'private',
    })
    expect(checkAddresses(['10.0.0.1', '169.254.169.254'], PERMISSIVE)).toEqual({
      admitted: false,
      scope: 'forbidden',
    })
  })

  it('reports forbidden over private when both are present', () => {
    expect(checkAddresses(['10.0.0.1', '0.0.0.0'], STRICT)).toEqual({
      admitted: false,
      scope: 'forbidden',
    })
  })

  it('fails closed on an empty set and on anything that is not an address', () => {
    expect(checkAddresses([], PERMISSIVE)).toEqual({ admitted: false, scope: 'forbidden' })
    expect(checkAddresses(['localhost'], PERMISSIVE)).toEqual({
      admitted: false,
      scope: 'forbidden',
    })
  })

  it('returns frozen verdicts', () => {
    expect(Object.isFrozen(checkAddresses(['8.8.8.8'], STRICT))).toBe(true)
    expect(Object.isFrozen(checkAddresses(['10.0.0.1'], STRICT))).toBe(true)
  })
})
