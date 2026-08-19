import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  PACKAGE_NAME,
  ROOT,
  SEMVER,
  hasFlag,
  option,
  run,
} from './release-utils.mjs'

const args = process.argv.slice(2)
const version = args.find(arg => SEMVER.test(arg))
const tag = option(args, '--tag')
if (version === undefined || !SEMVER.test(version)) throw new Error('usage: pnpm release -- <semver> --tag <next|latest> [--prepare-only]')
if (tag !== 'next' && tag !== 'latest') throw new Error('--tag must be next or latest')
if (version.includes('-') !== (tag === 'next')) throw new Error('prerelease versions must use next; stable versions must use latest')

const npmVersion = run('npm', ['--version'], { capture: true }).stdout.trim().split('.').map(Number)
if ((npmVersion[0] ?? 0) < 11 || ((npmVersion[0] ?? 0) === 11 && (npmVersion[1] ?? 0) < 15)) {
  throw new Error('npm >= 11.15.0 is required')
}
const nodeVersion = process.versions.node
if (!/^22\.(?:19|[2-9]\d)\.|^(?:2[4-9]|[3-9]\d)\./.test(nodeVersion)) {
  throw new Error(`Node 22.19+ (excluding 23) or Node 24+ is required; found ${nodeVersion}`)
}
const pnpmVersion = run('pnpm', ['--version'], { capture: true }).stdout.trim()
if (pnpmVersion !== '11.7.0') throw new Error(`pnpm 11.7.0 is required; found ${pnpmVersion}`)

if (!hasFlag(args, '--allow-dirty')) {
  const status = run('git', ['status', '--porcelain'], { capture: true }).stdout.trim()
  if (status !== '') throw new Error('Git worktree is not clean')
}
const branch = run('git', ['branch', '--show-current'], { capture: true }).stdout.trim()
if (branch !== 'main') throw new Error(`releases must run from main, not ${branch}`)
const origin = run('git', ['remote', 'get-url', 'origin'], { capture: true }).stdout.trim()
if (!/(?:github\.com[:/])guoxiucai\/dsh-code(?:\.git)?$/.test(origin)) throw new Error(`unexpected origin: ${origin}`)
const baseline = readFileSync(join(ROOT, 'UPSTREAM_BASELINE.md'), 'utf8').match(/^commit:\s*([0-9a-f]{40})$/m)?.[1]
if (baseline === undefined) throw new Error('UPSTREAM_BASELINE.md has no immutable commit')
const submodule = run('git', ['-C', 'deepseek-harness', 'rev-parse', 'HEAD'], { capture: true }).stdout.trim()
if (submodule !== baseline) throw new Error(`upstream submodule ${submodule} does not match baseline ${baseline}`)
const gitTag = `v${version}`
const localTag = run('git', ['tag', '--list', gitTag], { capture: true }).stdout.trim()
if (localTag !== '') throw new Error(`Git tag ${gitTag} already exists`)

const existing = run('npm', ['view', `${PACKAGE_NAME}@${version}`, 'version', '--json'], { capture: true, allowFailure: true, timeout: 30_000 })
if (existing.status === 0) throw new Error(`${PACKAGE_NAME}@${version} already exists in npm`)
if (!`${existing.stderr}\n${existing.stdout}`.includes('E404')) throw new Error(`could not verify npm version availability:\n${existing.stderr}`)

run('pnpm', ['run', 'typecheck'])
run('pnpm', ['test'])
run('pnpm', ['run', 'build:lib'])
run('node', [join(ROOT, 'scripts', 'build-release.mjs'), '--version', version])
run('node', [join(ROOT, 'scripts', 'verify-tarball.mjs')])
if (!hasFlag(args, '--skip-smoke')) run('node', [join(ROOT, 'scripts', 'smoke-install.mjs'), '--coexist'])

if (hasFlag(args, '--prepare-only')) {
  process.stdout.write(`Prepared ${PACKAGE_NAME}@${version}; no Git tag or registry state was changed.\n`)
  process.exit(0)
}

run('git', ['tag', '--annotate', gitTag, '--message', `${PACKAGE_NAME} ${version}`])
if (hasFlag(args, '--no-push')) {
  process.stdout.write(`Created local tag ${gitTag}; push it after review.\n`)
} else {
  run('git', ['push', 'origin', 'main', gitTag])
  process.stdout.write(`Pushed ${gitTag}; GitHub Actions will publish it with npm tag ${tag}.\n`)
}
