import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assetFor, loadAssets, MissingWebUi } from '../src/daemon/assets.js'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'verifai-assets-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function webRoot(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(root, 'web-'))
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    await writeFile(join(dir, name), content)
  }
  return dir
}

const text = (body: Uint8Array | undefined) => new TextDecoder().decode(body)

describe('loadAssets', () => {
  it('reads the page and the flat assets directory, typed by extension', async () => {
    const dir = await webRoot({
      'index.html': '<!doctype html>',
      'assets/index-abc123.js': 'export {}',
      'assets/index-abc123.css': 'body{}',
      'assets/logo.svg': '<svg/>',
    })
    const assets = await loadAssets(dir)
    expect([...assets.keys()].sort()).toEqual([
      '/assets/index-abc123.css',
      '/assets/index-abc123.js',
      '/assets/logo.svg',
      '/index.html',
    ])
    expect(assets.get('/assets/index-abc123.css')?.type).toBe('text/css; charset=utf-8')
    expect(assets.get('/assets/logo.svg')?.type).toBe('image/svg+xml')
    expect(text(assets.get('/index.html')?.body)).toBe('<!doctype html>')
  })

  it('leaves out hidden names, unknown types, subdirectories and anything outside assets/', async () => {
    const dir = await webRoot({
      'index.html': '<!doctype html>',
      'secret.js': 'nope',
      'assets/.env.js': 'nope',
      'assets/notes.md': 'nope',
      'assets/sub/deep.js': 'nope',
      'assets/app.js': 'export {}',
    })
    expect([...(await loadAssets(dir)).keys()].sort()).toEqual(['/assets/app.js', '/index.html'])
  })

  it('serves the page alone when there is no assets directory', async () => {
    const dir = await webRoot({ 'index.html': '<!doctype html>' })
    expect([...(await loadAssets(dir)).keys()]).toEqual(['/index.html'])
  })

  it('says the UI is missing when there is no page', async () => {
    const dir = await webRoot({ 'assets/app.js': 'export {}' })
    await expect(loadAssets(dir)).rejects.toBeInstanceOf(MissingWebUi)
    await expect(loadAssets(join(root, 'nowhere'))).rejects.toThrow('The web UI is not built')
  })
})

describe('assetFor', () => {
  it('maps / to the page and every other path to itself', async () => {
    const assets = await loadAssets(
      await webRoot({ 'index.html': '<!doctype html>', 'assets/app.js': 'export {}' }),
    )
    expect(assetFor(assets, '/')).toBe(assets.get('/index.html'))
    expect(assetFor(assets, '/assets/app.js')).toBe(assets.get('/assets/app.js'))
    expect(assetFor(assets, '/app.js')).toBeUndefined()
  })
})
