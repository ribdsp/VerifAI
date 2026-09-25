/**
 * The built web UI, read into memory once when the daemon starts.
 *
 * Only `index.html` and the flat `assets/` directory are served, and only
 * under the exact paths they were read from, so no request path is ever
 * joined onto a directory: there is nothing for `..` or an encoded slash to
 * climb out of.
 */

import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

export interface Asset {
  readonly type: string
  readonly body: Uint8Array
}

export type Assets = ReadonlyMap<string, Asset>

const INDEX_PATH = '/index.html'

const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
})

/** Built asset names: hashed, flat, and nothing a path could hide in. */
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export class MissingWebUi extends Error {
  override readonly name = 'MissingWebUi'
}

async function assetFiles(root: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(join(root, 'assets'), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && ASSET_NAME.test(entry.name))
      .filter((entry) => MEDIA_TYPES[extname(entry.name)] !== undefined)
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** @throws MissingWebUi when `root` holds no `index.html`. */
export async function loadAssets(root: string): Promise<Assets> {
  let index: Uint8Array
  try {
    index = await readFile(join(root, 'index.html'))
  } catch {
    throw new MissingWebUi('The web UI is not built')
  }
  const assets = new Map<string, Asset>([
    [INDEX_PATH, Object.freeze({ type: MEDIA_TYPES['.html'] ?? '', body: index })],
  ])
  for (const name of await assetFiles(root)) {
    const body = await readFile(join(root, 'assets', name))
    assets.set(`/assets/${name}`, Object.freeze({ type: MEDIA_TYPES[extname(name)] ?? '', body }))
  }
  return assets
}

/** The asset a path names; `/` is the page itself. */
export function assetFor(assets: Assets, path: string): Asset | undefined {
  return assets.get(path === '/' ? INDEX_PATH : path)
}
