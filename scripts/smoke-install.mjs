import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'
import {
  DIST,
  candidateMetadata,
  hasFlag,
  option,
  run,
} from './release-utils.mjs'

function annotationValue(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

process.once('uncaughtException', (error) => {
  process.stderr.write(`::error title=dsh-code release smoke failed::${annotationValue(error instanceof Error ? error.stack : error)}\n`)
  process.exitCode = 1
})

const args = process.argv.slice(2)
const expectedPlatform = option(args, '--platform')
const actualPlatform = `${process.platform}-${process.arch}`
if (expectedPlatform !== undefined && expectedPlatform !== actualPlatform) {
  throw new Error(`smoke expected ${expectedPlatform}, running on ${actualPlatform}`)
}
if (!['darwin-arm64', 'win32-x64'].includes(actualPlatform)) {
  throw new Error(`release smoke is unsupported on ${actualPlatform}`)
}

const metadata = candidateMetadata()
const tarball = join(DIST, basename(metadata.tarball))
const prefix = mkdtempSync(join(tmpdir(), 'dsh-code-npm-smoke-'))
const globalRoot = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
const productRoot = join(globalRoot, '@tsingwill', 'dsh-code')
const bin = process.platform === 'win32' ? join(prefix, 'dsh-code.cmd') : join(prefix, 'bin', 'dsh-code')
const dshBin = process.platform === 'win32' ? join(prefix, 'dsh.cmd') : join(prefix, 'bin', 'dsh')
const coexist = hasFlag(args, '--coexist')
const upstreamVersion = '0.0.0-smoke'

function runCommandBin(command, arguments_) {
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec ?? 'cmd.exe'
    // child_process already applies Windows argument quoting. Adding literal quotes
    // here makes cmd.exe look for a file whose name itself starts with `"`.
    return run(shell, ['/d', '/s', '/c', command, ...arguments_], { capture: true, timeout: 60_000 })
  }
  return run(command, arguments_, { capture: true, timeout: 60_000 })
}

const runBin = arguments_ => runCommandBin(bin, arguments_)

try {
  if (coexist) {
    const fixture = join(prefix, 'fixture-upstream-dsh')
    const fixtureBin = join(fixture, 'bin.js')
    mkdirSync(fixture, { recursive: true })
    writeFileSync(join(fixture, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh',
      version: upstreamVersion,
      type: 'module',
      bin: { dsh: 'bin.js' },
    }, null, 2)}\n`)
    writeFileSync(fixtureBin, `#!/usr/bin/env node\nprocess.stdout.write('${upstreamVersion}\\n')\n`)
    if (process.platform !== 'win32') chmodSync(fixtureBin, 0o755)
    process.stdout.write(`Seeding simulated pre-existing upstream @deepseek-ai/dsh@${upstreamVersion}...\n`)
    run('npm', ['install', '--global', '--prefix', prefix, fixture, '--no-audit', '--no-fund'], { timeout: 120_000 })
    statSync(dshBin)
    const initialDshVersion = runCommandBin(dshBin, ['--version']).stdout.trim()
    if (initialDshVersion !== upstreamVersion) throw new Error(`upstream dsh --version returned ${initialDshVersion}`)
  }

  process.stdout.write(`Installing candidate on ${actualPlatform}...\n`)
  run('npm', ['install', '--global', '--prefix', prefix, tarball, '--no-audit', '--no-fund'], { timeout: 1_200_000 })
  process.stdout.write('Candidate installation completed; checking CLI and bundled runtime...\n')
  const version = runBin(['--version']).stdout.trim()
  if (version !== metadata.version) throw new Error(`--version returned ${JSON.stringify(version)}, expected ${metadata.version}`)
  const help = runBin(['--help']).stdout
  if (!help.includes('terminal coding agent') || !help.includes('dsh-code update')) throw new Error('--help smoke failed')

  if (process.platform !== 'win32' && (statSync(bin).mode & 0o111) === 0) throw new Error('dsh-code bin is not executable')
  const productManifest = JSON.parse(readFileSync(join(productRoot, 'package.json'), 'utf8'))
  if (productManifest.name !== '@tsingwill/dsh-code') throw new Error('installed product manifest has the wrong name')
  run('npm', ['list', '--global', '--prefix', prefix, '@tsingwill/dsh-code', '--all', '--json'], {
    capture: true,
    timeout: 120_000,
  })
  const productRequire = createRequire(join(productRoot, 'package.json'))
  const dshManifest = JSON.parse(readFileSync(productRequire.resolve('@deepseek-ai/dsh/package.json'), 'utf8'))
  if (typeof dshManifest.version !== 'string') throw new Error('installed product cannot resolve its DSH runtime')

  if (coexist) {
    const globalDshVersion = runCommandBin(dshBin, ['--version']).stdout.trim()
    if (globalDshVersion !== upstreamVersion) throw new Error(`upstream dsh --version returned ${globalDshVersion}`)
    const after = runBin(['--version']).stdout.trim()
    if (after !== metadata.version) throw new Error('installing upstream dsh changed the dsh-code product')
    const nestedAfter = JSON.parse(readFileSync(productRequire.resolve('@deepseek-ai/dsh/package.json'), 'utf8'))
    if (nestedAfter.version !== dshManifest.version) {
      throw new Error(`installing upstream dsh changed the product runtime from ${dshManifest.version} to ${nestedAfter.version}`)
    }
  }

  process.stdout.write(`Smoke passed: ${metadata.package}@${metadata.version} on ${actualPlatform}\n`)
  process.stdout.write(`Resolved @deepseek-ai/dsh@${dshManifest.version} from the product installation\n`)
} finally {
  if (hasFlag(args, '--keep')) process.stdout.write(`Kept smoke prefix: ${prefix}\n`)
  else {
    process.stdout.write('Removing temporary npm prefix...\n')
    rmSync(prefix, { recursive: true, force: true })
  }
}
