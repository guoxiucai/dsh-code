import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
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

function runCommandBin(command, arguments_) {
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec ?? 'cmd.exe'
    return run(shell, ['/d', '/s', '/c', `"${command}"`, ...arguments_], { capture: true, timeout: 60_000 })
  }
  return run(command, arguments_, { capture: true, timeout: 60_000 })
}

const runBin = arguments_ => runCommandBin(bin, arguments_)

try {
  run('npm', ['install', '--global', '--prefix', prefix, tarball, '--no-audit', '--no-fund'], { timeout: 600_000 })
  const version = runBin(['--version']).stdout.trim()
  if (version !== metadata.version) throw new Error(`--version returned ${JSON.stringify(version)}, expected ${metadata.version}`)
  const help = runBin(['--help']).stdout
  if (!help.includes('terminal coding agent') || !help.includes('dsh-code update')) throw new Error('--help smoke failed')

  if (process.platform !== 'win32' && (statSync(bin).mode & 0o111) === 0) throw new Error('dsh-code bin is not executable')
  const productManifest = JSON.parse(readFileSync(join(productRoot, 'package.json'), 'utf8'))
  if (productManifest.name !== '@tsingwill/dsh-code') throw new Error('installed product manifest has the wrong name')
  const productRequire = createRequire(join(productRoot, 'package.json'))
  const dshManifest = JSON.parse(readFileSync(productRequire.resolve('@deepseek-ai/dsh/package.json'), 'utf8'))
  if (typeof dshManifest.version !== 'string') throw new Error('installed product cannot resolve its DSH runtime')

  if (hasFlag(args, '--coexist')) {
    const upstreamVersion = option(args, '--upstream-version') ?? '0.1.0-rc.6'
    run('npm', ['install', '--global', '--prefix', prefix, `@deepseek-ai/dsh@${upstreamVersion}`, '--no-audit', '--no-fund'], {
      timeout: 600_000,
    })
    const dshBin = process.platform === 'win32' ? join(prefix, 'dsh.cmd') : join(prefix, 'bin', 'dsh')
    statSync(dshBin)
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
  else rmSync(prefix, { recursive: true, force: true })
}
