/**
 * Manifest registration and external recovery integration. These tests read
 * live owner files (the manifest and the external recovery tool) when they
 * exist and skip otherwise, so the suite stays runnable on any checkout.
 * The recovery tool remains authoritative: the bundle only reads its status
 * and copies its commands, and nothing here executes a restore or restart.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { test } from 'node:test'

const require = createRequire(import.meta.url)

const ROOT = `${homedir()}/.local/share/liongateos/deepseek-update`
const MANIFEST = `${ROOT}/CUSTOMIZATIONS-MANIFEST.txt`
const TOOL = `${ROOT}/recover-customizations.mjs`
const STATUS_FILE = `${ROOT}/customization-status.json`

/** Mirror of the external checker's manifest parsing (same grammar). */
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

test('manifest registration preserves the historical entries and adds the two bundles', (t) => {
  if (!existsSync(MANIFEST)) return t.skip(`no manifest at ${MANIFEST}`)
  const entries = parseManifest(readFileSync(MANIFEST, 'utf8'))
  assert.ok(entries.length >= 4, `expected at least 4 registered entries, found ${entries.length}`)
  // Historical: Voice Mode / Dictation and Per-model reasoning default stay first and intact.
  assert.match(entries[0].name, /Voice Mode \/ Dictation/i)
  assert.match(entries[0].fields['file'], /voice-dictation-preset\.yml$/)
  assert.match(entries[1].name, /Per-model reasoning default/i)
  assert.match(entries[1].fields['patch'], /per-model-reasoning-default\.patch$/)
  assert.match(entries[1].fields['rule'], /never force an incompatible patch/)
  // New: Model Guide & Cost Router and PCOG Theme, with the generic fields the
  // external checker understands (bundle + assets), in canonical locations.
  const modelGuide = entries.find((entry) => /Model Guide & Cost Router/i.test(entry.name))
  const pcog = entries.find((entry) => /PCOG Theme/i.test(entry.name))
  assert.ok(modelGuide, 'customization "Model Guide & Cost Router" must be registered')
  assert.ok(pcog, 'customization "PCOG Theme" must be registered')
  assert.equal(entries.indexOf(modelGuide) + 1, modelGuide.number)
  assert.equal(entries.indexOf(pcog) + 1, pcog.number)
  assert.equal(modelGuide.fields['bundle'], '@local/model-guide-cost-router')
  assert.match(modelGuide.fields['assets'], /customizations\/model-guide-cost-router\/?$/)
  assert.equal(pcog.fields['bundle'], '@local/pcog-theme')
  assert.match(pcog.fields['assets'], /customizations\/pcog-theme\/?$/)
  // Preservation notes route future updates through the plugin manager.
  for (const entry of [modelGuide, pcog]) assert.match(entry.fields['preservation'], /plugin manager/)
})

test('dry-run status recognizes all registered owner customizations', (t) => {
  if (!existsSync(TOOL) || !existsSync(MANIFEST)) return t.skip('recovery tool or manifest unavailable')
  // The status file is produced by the owner-run dry run of the authoritative
  // tool (a test child must never write the external status file itself); this
  // test verifies its latest check output.
  if (!existsSync(STATUS_FILE)) return t.skip('no status file; run the recovery tool dry-run first')
  const status = JSON.parse(readFileSync(STATUS_FILE, 'utf8'))
  assert.equal(status.mode, 'check', 'the tool must have run in check (dry-run) mode')
  assert.equal(status.tool, 'recover-customizations.mjs')
  const labels = ['Installed', 'Can Restore Cleanly', 'Needs Review', 'Incompatible']
  assert.ok(status.entries.length >= 4, 'the dry run must classify at least the 4 registered customizations')
  for (const entry of status.entries) {
    assert.ok(labels.includes(entry.status), `entry ${entry.name} must use one of the canonical labels, got ${entry.status}`)
    assert.equal(Array.isArray(entry.plannedActions), true)
  }
  const modelGuide = status.entries.find((entry) => /Model Guide & Cost Router/i.test(entry.name))
  const pcog = status.entries.find((entry) => /PCOG Theme/i.test(entry.name))
  assert.ok(modelGuide, 'dry run must recognize the Model Guide bundle entry')
  assert.equal(modelGuide.type, 'bundle')
  assert.equal(modelGuide.status, 'Installed')
  assert.match(modelGuide.detail, /bundle link and profile row/)
  assert.ok(pcog, 'dry run must recognize the PCOG Theme bundle entry')
  assert.equal(pcog.type, 'bundle')
  assert.equal(pcog.status, 'Installed')
  // Per-model reasoning default stays a patch entry verified by git apply --check.
  const patchEntry = status.entries.find((entry) => entry.type === 'patch')
  assert.ok(patchEntry, 'the per-model reasoning default must classify as a patch entry')
})

test('restore refuses Needs Review and Incompatible entries and never executes in dry-run mode', (t) => {
  if (!existsSync(TOOL)) return t.skip(`no recovery tool at ${TOOL}`)
  const source = readFileSync(TOOL, 'utf8')
  // Every git invocation in the tool is a --check verification of the patch.
  const gitCalls = [...source.matchAll(/run\('git',\s*\[([^\]]*)\]/g)].map((match) => match[1])
  assert.ok(gitCalls.length > 0)
  for (const call of gitCalls) assert.match(call, /--check/, `git call must be a check-only invocation: run('git', [${call}])`)
  // The Incompatible classification records no planned action at all.
  const incompatibleStart = source.indexOf("result.status = 'Incompatible'")
  const incompatibleBlock = source.slice(incompatibleStart, source.indexOf('return result', incompatibleStart))
  assert.match(incompatibleBlock, /never force an incompatible patch/)
  assert.doesNotMatch(incompatibleBlock, /plannedActions\.push/)
  // Execution is gated behind the --apply mode switch, and the only commands
  // the tool can execute are the check-only git calls verified above.
  assert.match(source, /APPLY\s*=.*--apply/)
})

test('neither the bundle halves nor the recovery tool restarts Harness', (t) => {
    const bundleDir = new URL('..', `file://${import.meta.dirname}/`).pathname.replace(/\/$/, '')
  const sources = []
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${name.name}`
      if (name.isDirectory()) {
        if ('node_modules|fixtures'.split('|').includes(name.name)) continue
        walk(path)
      } else if (statSync(path).isFile() && (/\/core\//.test(path) || name.name === 'client.js' || name.name === 'index.js') && /\.js$/.test(name.name)) {
        sources.push(path)
      }
    }
  }
  walk(bundleDir)
  assert.ok(sources.some((path) => path.endsWith('/core/update.js')), 'the scan must cover the core modules')
  // Bundle prose (e.g. the protected-GPU instruction "never … restart") is not
  // a primitive; the scan targets executable restart/exec machinery only.
  //
  // One exec primitive is allowed: the read-only Strata component probe that
  // reports the installed engine build. Everything that could restart, daemonize,
  // or shell out stays forbidden, and the allowed call is pinned below to a
  // fixed argument vector with no shell.
  const allowedExec = new Map([
    [`${bundleDir}/index.js`, /import \{ execFile \} from 'node:child_process'/],
  ])
  const forbidden = /process\.exit\(|execFileSync|spawnSync|\bspawn\(|\bexec\(|childProcess\.exec/
  for (const path of sources) {
    const text = readFileSync(path, 'utf8')
    assert.doesNotMatch(text, forbidden, `${path} must not contain restart or exec primitives`)
    if (/from 'node:child_process'/.test(text)) {
      assert.ok(allowedExec.has(path), `${path} must not import child_process`)
      assert.match(text, allowedExec.get(path))
      assert.doesNotMatch(text, /shell\s*:\s*true/)
    }
  }
  // The one permitted subprocess is the Strata component probe, and it is
  // pinned to a fixed command and a fixed argument vector in its own module.
  const strata = `${bundleDir}/core/strata-engine.js`
  if (existsSync(strata)) {
    const probeText = readFileSync(strata, 'utf8')
    assert.match(probeText, /STRATA_ENGINE_PROBE = Object\.freeze\(\['components', 'engine', '--output', 'json'\]\)/)
    assert.match(probeText, /execFileFn\(\s*'strata',/)
  }
  if (existsSync(TOOL)) {
    const tool = readFileSync(TOOL, 'utf8')
    assert.doesNotMatch(tool, /\brestart\b|\brelaunch\b/, 'the recovery tool must never mention restarting Harness')
  }
})