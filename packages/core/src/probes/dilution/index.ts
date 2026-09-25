import type { DilutionProbe } from '../types.js'
import { differentialCount } from './differential-count.js'

export const DILUTION_PROBES: readonly DilutionProbe[] = Object.freeze([differentialCount])
