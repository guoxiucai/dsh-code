import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import {
  CANDIDATE,
  DIST,
  PACKAGE_NAME,
  ROOT,
  SEMVER,
  STAGE,
  hasFlag,
  option,
  readJson,
  run,
  sha256,
} from './release-utils.mjs'

const args = process.argv.slice(2)
const rootManifest = readJson(join(ROOT, 'package.json'))
const version = option(args, '--version') ?? rootManifest.version
if (typeof version !== 'string' || !SEMVER.test(version)) throw new Error(`invalid release version: ${JSON.stringify(version)}`)

if (!hasFlag(args, '--skip-build')) run('pnpm', ['run', 'build'])

rmSync(DIST, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })

for (const entry of ['lib', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'UPSTREAM_BASELINE.md']) {
  cpSync(join(ROOT, entry), join(STAGE, entry), { recursive: true })
}
cpSync(join(ROOT, 'deepseek-harness', 'THIRD_PARTY_NOTICES.md'), join(STAGE, 'UPSTREAM_THIRD_PARTY_NOTICES.md'))

const require = createRequire(import.meta.url)
const dependencies = {}
for (const name of Object.keys(rootManifest.dependencies).sort()) {
  const manifestPath = require.resolve(`${name}/package.json`)
  const dependency = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof dependency.version !== 'string' || !SEMVER.test(dependency.version)) {
    throw new Error(`cannot resolve an exact version for ${name}`)
  }
  dependencies[name] = dependency.version
}

const manifest = {
  name: PACKAGE_NAME,
  version,
  description: rootManifest.description,
  type: 'module',
  license: 'MIT',
  keywords: rootManifest.keywords,
  bin: { 'dsh-code': 'lib/bin.js' },
  engines: rootManifest.engines,
  repository: rootManifest.repository,
  homepage: rootManifest.homepage,
  bugs: rootManifest.bugs,
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
  files: [
    'lib',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'UPSTREAM_THIRD_PARTY_NOTICES.md',
    'UPSTREAM_BASELINE.md',
    'npm-shrinkwrap.json',
  ],
  dependencies,
}
writeFileSync(join(STAGE, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund'], {
  cwd: STAGE,
  timeout: 300_000,
})
run('npm', ['shrinkwrap'], { cwd: STAGE, timeout: 60_000 })
const sbom = run('npm', ['sbom', '--package-lock-only', '--sbom-format', 'cyclonedx', '--omit', 'dev'], {
  cwd: STAGE,
  capture: true,
  timeout: 120_000,
})
writeFileSync(join(DIST, 'sbom.cdx.json'), `${sbom.stdout.trim()}\n`)

const packed = run('npm', ['pack', '--json', '--pack-destination', DIST], { cwd: STAGE, capture: true, timeout: 120_000 })
const report = JSON.parse(packed.stdout)
if (!Array.isArray(report) || typeof report[0]?.filename !== 'string') throw new Error('npm pack returned no tarball')
const tarball = join(DIST, basename(report[0].filename))
const metadata = {
  package: PACKAGE_NAME,
  version,
  tarball: basename(tarball),
  sha256: sha256(tarball),
  size: report[0].size,
  unpackedSize: report[0].unpackedSize,
}
writeFileSync(CANDIDATE, `${JSON.stringify(metadata, null, 2)}\n`)
writeFileSync(`${tarball}.sha256`, `${metadata.sha256}  ${basename(tarball)}\n`)
process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`)
