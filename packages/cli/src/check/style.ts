/**
 * The terminal report's colours, or none.
 *
 * Colour is used only where the output is a terminal and `NO_COLOR` is unset
 * (https://no-color.org). The renderer never leans on colour alone - each
 * stance has a text mark - so a plain report says everything a coloured one does.
 */

import { PLAIN_STYLE, type TerminalStyle } from '@verifai/core'
import { createColors } from 'picocolors'

export function wantsColour(isTTY: boolean, env: Readonly<Record<string, string | undefined>>) {
  const noColour = env.NO_COLOR
  return isTTY && (noColour === undefined || noColour === '')
}

export function terminalStyle(colour: boolean): TerminalStyle {
  if (!colour) {
    return PLAIN_STYLE
  }
  const paint = createColors(true)
  return Object.freeze({
    pass: paint.green,
    caution: paint.yellow,
    fail: paint.red,
    supports: paint.green,
    against: paint.red,
    context: paint.dim,
    bold: paint.bold,
    dim: paint.dim,
  })
}
