/**
 * The admission decision for a set of resolved addresses.
 *
 * Every address a name resolves to is checked, not just the first. A name with
 * one public and one internal record is a rebinding attack that has already
 * happened: whichever record the socket ends up using, the guard has to have
 * approved it, so one refusal refuses the whole set.
 */

import { type AddressScope, classifyAddress } from './address.js'

/** Per-run settings for the outbound guard. Never read from a config file. */
export interface TargetPolicy {
  /**
   * Admits the `private` scope for this run - a gateway on the buyer's own
   * machine or network. `forbidden` space stays refused regardless.
   */
  readonly allowPrivateTargets: boolean
}

export type RefusedScope = Exclude<AddressScope, 'public'>

export type AddressVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly scope: RefusedScope }

const ADMITTED: AddressVerdict = Object.freeze({ admitted: true })
const REFUSED_PRIVATE: AddressVerdict = Object.freeze({ admitted: false, scope: 'private' })
const REFUSED_FORBIDDEN: AddressVerdict = Object.freeze({ admitted: false, scope: 'forbidden' })

export function admitsScope(scope: AddressScope, policy: TargetPolicy): boolean {
  return scope === 'public' || (scope === 'private' && policy.allowPrivateTargets)
}

/**
 * @returns the refusal with the strictest scope found, so the message a buyer
 * sees never suggests `--allow-private-targets` for a set that includes an
 * address no flag would admit.
 */
export function checkAddresses(addresses: readonly string[], policy: TargetPolicy): AddressVerdict {
  // Nothing to connect to is not the same as nothing to refuse.
  if (addresses.length === 0) {
    return REFUSED_FORBIDDEN
  }

  let verdict = ADMITTED
  for (const address of addresses) {
    const { scope } = classifyAddress(address)
    if (scope === 'forbidden') {
      return REFUSED_FORBIDDEN
    }
    if (!admitsScope(scope, policy)) {
      verdict = REFUSED_PRIVATE
    }
  }
  return verdict
}
