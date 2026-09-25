/**
 * The canonical document, as written to `report.verifai.json`. Nothing is
 * added or dropped: every other view is read from this.
 */

import type { Report } from './types.js'

export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
