/**
 * Preservation integration. Like the other owner bundles, these tests read
 * the live owner files (manifest, profile, canonical bundle, recovery tool)
 * when they exist and skip otherwise, so the suite stays runnable on any
 * checkout. The recovery tool stays authoritative; nothing here executes a
 * restore or a restart.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'

const require = createRequire(import.meta.url)

const ROOT = `${homedir()}/.local/share/liongateos/deepseek-update`
const MANIFEST = `${ROOT}/CUSTOMIZATIONS-MANIFEST.txt`
const CANONICAL = `${ROOT}/customizations/local-model-manager`
const PROFILE = `${homedir()}/.dsh/profiles/web`

/** Manifest grammar mirror (same parser the recovery tool uses). */
const parseManifest = (text) => {
  const entries = []
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const heading = rawLine.match(/^(\d+)\.\s+(.*)$/)
    if (heading !== null) {
      current = { number: Number(heading[1]), name: heading[2].trim(), fields: {} }
      entries.push(current)
      continue
    }
    const field = rawLine.match(/^\s+([a-zA-Z][a-zA-Z0-9 _-]*?):\s*(.*)$/)
    if (current !== null && field !== null) current.fields[field[1].trim()] = field[2].trim()
  }
  return entries
}

test('the worktree implementation carries the bundle contract files', () => {
  const here = new URL('..', import.meta.url).pathname
  for (const file of ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'core/config.js', 'core/catalog.js', 'core/runtime.js', 'core/gpus.js', 'core/actions.js', 'core/profiles.js', 'core/discovery.js']) {
    assert.ok(existsSync(`${here}${file}`), `${file} must exist`)
  }
  const pkg = require('../package.json')
  assert.equal(pkg.name, '@local/local-model-manager')
  assert.ok(pkg.dsh?.bundle?.patch, 'the bundle must declare its profile patch')
})

test('package.json files array includes every module imported by index.js', () => {
  const pkg = require('../package.json')
  assert.ok(pkg.files.includes('core/engine-adapter.js'), 'core/engine-adapter.js must be in files (imported by index.js)')
  assert.ok(pkg.files.includes('core/model-advisor-adapter.js'), 'core/model-advisor-adapter.js must be in files (imported by index.js)')
  assert.ok(pkg.files.includes('core/discovery.js'), 'core/discovery.js must be in files (imported by index.js)')
})

test('the manifest registers the Local Model Manager bundle with verifiable assets', (t) => {
  if (!existsSync(MANIFEST)) return t.skip(`no manifest at ${MANIFEST}`)
  const entries = parseManifest(readFileSync(MANIFEST, 'utf8'))
  const entry = entries.find((e) => /local model manager/i.test(e.name))
  if (entry === undefined) return t.skip('the Local Model Manager is not registered yet (activation pending)')
  assert.equal(entry.fields['bundle'], '@local/local-model-manager', 'the bundle row must name the package')
  const assets = entry.fields['assets']?.split(',').map((part) => part.trim()).filter(Boolean) ?? []
  const manifest = entry.fields['sha256']
  assert.ok(manifest !== undefined, 'the entry must carry a checksum')
  for (const path of assets) {
    assert.ok(existsSync(path), `asset ${path} must exist`)
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
    assert.equal(actual, manifest, `the recovery tool's checksum must match ${path}`)
  }
  // The checksummed artifact must cover the bundle files it names.
  const sums = readFileSync(assets[0], 'utf8')
  for (const line of sums.trim().split(/\r?\n/)) {
    const [expected, rel] = line.trim().split(/\s+/)
    assert.equal(createHash('sha256').update(readFileSync(`${CANONICAL}/${rel}`)).digest('hex'), expected, `recorded checksum must match ${rel}`)
  }
})

test('the canonical bundle directory matches the worktree implementation', (t) => {
  if (!existsSync(CANONICAL)) return t.skip('canonical bundle not staged yet')
  const source = new URL('..', import.meta.url).pathname
  const pkg = require('../package.json')
  for (const file of pkg.files) {
    const sourceText = readFileSync(`${source}${file}`)
    const canonicalText = readFileSync(`${CANONICAL}/${file}`)
    assert.deepEqual(createHash('sha256').update(sourceText).digest('hex'), createHash('sha256').update(canonicalText).digest('hex'), `${file} must match the worktree copy byte-for-byte`)
  }
})

test('the profile registration (when staged) is complete and plugin-manager owned', (t) => {
  if (!existsSync(`${PROFILE}/node_modules/@local/local-model-manager`)) return t.skip('profile registration not staged yet (activation pending)')
  const packageJson = JSON.parse(readFileSync(`${PROFILE}/package.json`, 'utf8'))
  assert.ok(packageJson.dsh.profile.bundles.includes('@local/local-model-manager'), 'profile bundle list must include the package')
  assert.ok(packageJson.dependencies['@local/local-model-manager']?.startsWith('link:'), 'the dependency must be a link registration')
  // The profile uses patch-based composition: cordis.yml is permanently empty ([]);
  // plugin rows live in each bundle's own cordis.patch.yml and are merged at Harness
  // load time. The registration is verified by checking the bundle's patch file directly.
  const bundlePatch = readFileSync(`${PROFILE}/node_modules/@local/local-model-manager/cordis.patch.yml`, 'utf8')
  assert.match(bundlePatch, /name: '@local\/local-model-manager'/, "the bundle's cordis.patch.yml must declare the plugin registration")
})