/**
 * The two lookups every vendor's model table needs: a model by any `model`
 * value that names it, and the priced models a reseller could serve instead.
 */

import type { Fact } from './source.js'

/** Base prices in USD per million tokens, before caching or batch discounts. */
export interface PerMillionTokens {
  readonly inputPerMTok: number
  readonly outputPerMTok: number
}

export interface PricedModel {
  readonly id: string
  readonly pricing: Fact<PerMillionTokens> | undefined
}

/** @throws Error at module load if two entries claim the same name. */
export function indexByName<M extends { readonly id: string }>(
  vendor: string,
  models: readonly M[],
  namesOf: (model: M) => readonly string[],
): ReadonlyMap<string, M> {
  const index = new Map<string, M>()
  for (const model of models) {
    for (const name of [model.id, ...namesOf(model)]) {
      const taken = index.get(name)
      if (taken !== undefined) {
        throw new Error(`${vendor} model ID ${name} is claimed by ${taken.id} and ${model.id}`)
      }
      index.set(name, model)
    }
  }
  return index
}

/**
 * Priced models that are at least as cheap on input and output and strictly
 * cheaper on one: the substitutes a reseller billing for `target` would gain
 * by serving instead. Cheapest first. Empty if `target` is missing or unpriced.
 */
export function cheaperThan<M extends PricedModel>(
  models: readonly M[],
  target: M | undefined,
): readonly M[] {
  const price = target?.pricing?.value
  if (price === undefined) {
    return Object.freeze([])
  }
  const cheaper = models.flatMap((model) => {
    const pricing = model.pricing?.value
    return pricing !== undefined && isCheaper(pricing, price) ? [{ model, pricing }] : []
  })
  return Object.freeze(cheaper.toSorted(byPrice).map(({ model }) => model))
}

function isCheaper(candidate: PerMillionTokens, target: PerMillionTokens): boolean {
  const input = candidate.inputPerMTok - target.inputPerMTok
  const output = candidate.outputPerMTok - target.outputPerMTok
  return input <= 0 && output <= 0 && (input < 0 || output < 0)
}

interface Priced {
  readonly model: PricedModel
  readonly pricing: PerMillionTokens
}

function byPrice(a: Priced, b: Priced): number {
  return (
    a.pricing.inputPerMTok - b.pricing.inputPerMTok ||
    a.pricing.outputPerMTok - b.pricing.outputPerMTok ||
    a.model.id.localeCompare(b.model.id)
  )
}
