import { readdir, readFile, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * Every probe must say where its expected behaviour came from.
 *
 * This is the enforcement mechanism for the project's central credibility
 * claim: VerifAI only asserts things that a vendor documented, a paper
 * described, or we measured ourselves. A probe with no provenance entry is a
 * probe whose expected behaviour is a guess, and a guess that flags a
 * reseller as fraudulent is worse than no tool at all.
 *
 * The test passes trivially while `src/probes/` is empty and starts biting the
 * moment the first probe lands.
 */

const PROBES_DIR = new URL('../packages/core/src/probes/', import.meta.url)
const PROVENANCE_DOC = new URL('../docs/PROVENANCE.md', import.meta.url)

/**
 * Basenames under `probes/` that are plumbing rather than a probe. Matched on
 * the basename, not the path, so `probes/anthropic/index.ts` is skipped too.
 */
const NON_PROBE_BASENAMES = new Set(['index', 'registry', 'types', 'shared', 'output-floor'])

/**
 * A probe must declare a non-empty `citations`. `docs/report-format.md` states
 * that "a signal with an empty `citations` array is a construction error, not a
 * low-confidence signal", so `citations: []` has to fail here.
 *
 * The second branch accepts `citations: SHARED_ANTHROPIC_CITATIONS`, which is
 * how a probe reuses a citation block. Known limit: this is a text scan, not a
 * parse, so a citation written inside a comment would satisfy it. It is a guard
 * against forgetting, not against a contributor actively working around it.
 */
const NON_EMPTY_CITATIONS = /citations\s*:\s*(?:\[\s*[^\s\]]|[A-Za-z_$])/

interface ProbeModule {
  /** Path relative to `probes/`, without extension - e.g. `anthropic/signature`. */
  readonly id: string
  readonly url: URL
}

async function directoryExists(url: URL): Promise<boolean> {
  try {
    return (await stat(url)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    // A permissions error is a broken checkout, not an empty probe directory.
    throw error
  }
}

/**
 * The module name a probe file contributes, or `null` if the file is not a
 * probe. `.mts` counts: a probe author reaching for an explicit ESM extension
 * should not accidentally opt out of the provenance requirement.
 */
function probeBasename(fileName: string): string | null {
  const base = fileName.endsWith('.mts')
    ? fileName.slice(0, -'.mts'.length)
    : fileName.endsWith('.ts')
      ? fileName.slice(0, -'.ts'.length)
      : null

  if (base === null || base.endsWith('.test') || base.endsWith('.d')) {
    return null
  }
  return NON_PROBE_BASENAMES.has(base) ? null : base
}

/**
 * Walks `probes/` recursively. Probes will be grouped by vendor long before
 * Phase 2 ends, and a non-recursive scan would stop enforcing provenance the
 * moment the first subdirectory appears - silently, and in the direction that
 * reports green.
 */
async function probeModules(): Promise<readonly ProbeModule[]> {
  if (!(await directoryExists(PROBES_DIR))) {
    return []
  }

  const modules: ProbeModule[] = []

  async function walk(dir: URL, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
        continue
      }

      const base = probeBasename(entry.name)
      if (base !== null) {
        modules.push({ id: `${prefix}${base}`, url: new URL(entry.name, dir) })
      }
    }
  }

  await walk(PROBES_DIR, '')
  return modules
}

describe('probe provenance', () => {
  it('documents every probe module in docs/PROVENANCE.md', async () => {
    const modules = await probeModules()
    const provenance = await readFile(PROVENANCE_DOC, 'utf8')

    // The heading must match exactly. A bare substring search passes on any
    // incidental mention: `seed` and `identity` both appear in the "Rejected
    // candidates" table, so probes with those names would have been certified
    // by the very rows explaining why they are not valid signals.
    const undocumented = modules
      .filter((module) => !provenance.includes(`### \`${module.id}\``))
      .map((module) => module.id)

    expect(
      undocumented,
      'Add a PROVENANCE.md entry (source URL + verbatim quote, paper, or measurement date) for each of these probes',
    ).toEqual([])
  })

  it('requires each probe module to carry at least one citation', async () => {
    const withoutCitations: string[] = []

    for (const module of await probeModules()) {
      const source = await readFile(module.url, 'utf8')
      if (!NON_EMPTY_CITATIONS.test(source)) {
        withoutCitations.push(module.id)
      }
    }

    expect(
      withoutCitations,
      'Each probe must declare a non-empty `citations` so the report can show the buyer why a flag is a flag',
    ).toEqual([])
  })

  it('states the allowed provenance sources so a contributor cannot miss them', async () => {
    const provenance = await readFile(PROVENANCE_DOC, 'utf8')

    // The four tiers the scoring model recognises, in the doc that defines them.
    for (const tier of ['measured', 'documented', 'derived', 'heuristic']) {
      expect(provenance).toContain(tier)
    }
  })

  it('keeps the probe-entry template that the heading check depends on', async () => {
    // `documents every probe module` matches on `### \`<name>\``. If the
    // template in PROVENANCE.md ever drifts to a different heading shape,
    // contributors will follow the template, the check will stop matching, and
    // it will report green while enforcing nothing.
    const provenance = await readFile(PROVENANCE_DOC, 'utf8')

    expect(provenance).toContain('### `<probe-module-name>`')
    expect(provenance).toContain('## Probe entries')
  })
})
