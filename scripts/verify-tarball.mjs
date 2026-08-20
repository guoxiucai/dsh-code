import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  DIST,
  PACKAGE_NAME,
  SEMVER,
  STAGE,
  candidateMetadata,
  readJson,
  run,
  sha256,
} from './release-utils.mjs'

const metadata = candidateMetadata()
const tarball = join(DIST, basename(metadata.tarball))
const manifest = readJson(join(STAGE, 'package.json'))
const sbom = readJson(join(DIST, 'sbom.cdx.json'))
const shrinkwrap = readFileSync(join(STAGE, 'npm-shrinkwrap.json'), 'utf8')

if (manifest.name !== PACKAGE_NAME || manifest.version !== metadata.version) throw new Error('candidate name/version mismatch')
if (manifest.private === true) throw new Error('release manifest must not be private')
if (metadata.size > 1024 * 1024) throw new Error(`tarball exceeds 1 MiB budget: ${metadata.size}`)
if (sha256(tarball) !== metadata.sha256) throw new Error('candidate SHA-256 mismatch')
if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components) || sbom.components.length === 0) {
  throw new Error('candidate CycloneDX SBOM is missing or invalid')
}

for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
  if (typeof version !== 'string' || !SEMVER.test(version)) throw new Error(`dependency ${name} is not exactly pinned: ${version}`)
}
const baselineVersion = manifest.dependencies?.['@deepseek-ai/dsh']
const pinnedDsh = Object.entries(manifest.dependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
if (pinnedDsh.length < 100) throw new Error(`release manifest pins only ${pinnedDsh.length} DSH packages; expected the reachable runtime closure`)
for (const [name, version] of pinnedDsh) {
  if (version !== baselineVersion) throw new Error(`${name}@${version} does not match baseline ${baselineVersion}`)
}
if (/\b(?:workspace:|link:|file:|git\+|github:)/.test(shrinkwrap)) throw new Error('shrinkwrap contains a local or Git dependency')
for (const marker of ['darwin-arm64', 'win32-x64']) {
  if (!shrinkwrap.includes(marker)) throw new Error(`shrinkwrap is missing ${marker} optional dependency metadata`)
}
const lock = JSON.parse(shrinkwrap)
for (const [path, value] of Object.entries(lock.packages ?? {})) {
  const name = path.split('node_modules/').at(-1)
  if (name?.startsWith('@deepseek-ai/dsh') && value.version !== baselineVersion) {
    throw new Error(`shrinkwrap mixed DSH baseline: ${name}@${value.version}`)
  }
}

const dryRun = run('npm', ['pack', '--dry-run', '--json'], { cwd: STAGE, capture: true, timeout: 120_000 })
const report = JSON.parse(dryRun.stdout)
const files = report[0]?.files?.map(file => file.path)
if (!Array.isArray(files)) throw new Error('npm pack dry-run returned no file list')
const allowedRoots = new Set([
  'lib',
  'package.json',
  'README.md',
  'README.zh-CN.md',
  'docs',
  'CHANGELOG.md',
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'UPSTREAM_THIRD_PARTY_NOTICES.md',
  'UPSTREAM_BASELINE.md',
  'npm-shrinkwrap.json',
])
for (const file of files) {
  const root = file.split('/')[0]
  if (!allowedRoots.has(root)) throw new Error(`unexpected file in npm package: ${file}`)
  if (/(?:^|\/)(?:\.env|\.git|node_modules|src|tests)(?:\/|$)/.test(file)) throw new Error(`forbidden path in npm package: ${file}`)
}
if (!files.includes('lib/bin.js')) throw new Error('npm package is missing lib/bin.js')

const secretPattern = /(?:sk-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|gh[opsu]_[A-Za-z0-9]{20,})/
for (const file of files.filter(file => /\.(?:js|json|md|txt)$/.test(file) || ['LICENSE', 'NOTICE'].includes(file))) {
  if (secretPattern.test(readFileSync(join(STAGE, file), 'utf8'))) throw new Error(`possible credential in ${file}`)
}

const auditResult = run('npm', ['audit', '--omit=dev', '--json'], {
  cwd: STAGE,
  capture: true,
  allowFailure: true,
  timeout: 120_000,
})
let audit
try {
  audit = JSON.parse(auditResult.stdout)
} catch {
  throw new Error(`npm audit did not return JSON: ${auditResult.stderr.trim()}`)
}
const vulnerabilities = audit.metadata?.vulnerabilities
if (typeof vulnerabilities !== 'object' || vulnerabilities === null) throw new Error('npm audit report has no vulnerability summary')
if ((vulnerabilities.high ?? 0) > 0 || (vulnerabilities.critical ?? 0) > 0) {
  throw new Error(`npm audit found ${vulnerabilities.high ?? 0} high and ${vulnerabilities.critical ?? 0} critical vulnerabilities`)
}

process.stdout.write(`Verified ${metadata.package}@${metadata.version}\n`)
process.stdout.write(`Tarball: ${metadata.tarball} (${metadata.size} bytes)\n`)
process.stdout.write(`SHA-256: ${metadata.sha256}\n`)
process.stdout.write(`npm audit: ${vulnerabilities.total ?? 0} known vulnerabilities (${vulnerabilities.high ?? 0} high, ${vulnerabilities.critical ?? 0} critical)\n`)
process.stdout.write(`CycloneDX SBOM: ${sbom.components.length} components\n`)
process.stdout.write(`Pinned DSH closure: ${pinnedDsh.length} packages at ${baselineVersion}\n`)
