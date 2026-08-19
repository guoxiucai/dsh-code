import { basename, join } from 'node:path'
import { DIST, PACKAGE_NAME, candidateMetadata, option, run, sha256 } from './release-utils.mjs'

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('registry publishing is restricted to GitHub Actions')
const tag = option(process.argv.slice(2), '--tag')
if (tag !== 'next' && tag !== 'latest') throw new Error('--tag must be next or latest')

const metadata = candidateMetadata()
if (metadata.package !== PACKAGE_NAME) throw new Error(`unexpected package ${metadata.package}`)
if (metadata.version.includes('-') !== (tag === 'next')) throw new Error('release version and npm tag do not match')
const tarball = join(DIST, basename(metadata.tarball))
if (sha256(tarball) !== metadata.sha256) throw new Error('candidate SHA-256 mismatch before publish')

const existing = run('npm', ['view', `${PACKAGE_NAME}@${metadata.version}`, 'version', '--json'], {
  capture: true,
  allowFailure: true,
  timeout: 30_000,
})
if (existing.status === 0) throw new Error(`${PACKAGE_NAME}@${metadata.version} already exists`)
if (!`${existing.stdout}\n${existing.stderr}`.includes('E404')) throw new Error(`registry preflight failed: ${existing.stderr}`)

run('npm', ['publish', tarball, '--access', 'public', '--tag', tag, '--provenance'], { timeout: 300_000 })
const published = run('npm', ['view', `${PACKAGE_NAME}@${metadata.version}`, 'version', '--json'], {
  capture: true,
  timeout: 60_000,
}).stdout.trim()
if (JSON.parse(published) !== metadata.version) throw new Error('post-publish registry verification failed')
process.stdout.write(`Published ${PACKAGE_NAME}@${metadata.version} with npm tag ${tag}\n`)
