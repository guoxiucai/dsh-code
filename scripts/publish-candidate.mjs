import { basename, join } from 'node:path'
import { DIST, PACKAGE_NAME, candidateMetadata, option, run, sha256, sha512Integrity } from './release-utils.mjs'

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('registry publishing is restricted to GitHub Actions')
const tag = option(process.argv.slice(2), '--tag')
if (tag !== 'next' && tag !== 'latest') throw new Error('--tag must be next or latest')

const metadata = candidateMetadata()
if (metadata.package !== PACKAGE_NAME) throw new Error(`unexpected package ${metadata.package}`)
if (metadata.version.includes('-') !== (tag === 'next')) throw new Error('release version and npm tag do not match')
const tarball = join(DIST, basename(metadata.tarball))
if (sha256(tarball) !== metadata.sha256) throw new Error('candidate SHA-256 mismatch before publish')
const expectedIntegrity = sha512Integrity(tarball)

function registryState() {
  const result = run('npm', [
    'view',
    `${PACKAGE_NAME}@${metadata.version}`,
    'version',
    'dist.integrity',
    'dist-tags',
    '--json',
  ], {
    capture: true,
    allowFailure: true,
    timeout: 30_000,
  })
  if (result.status === 0) return JSON.parse(result.stdout)
  if (`${result.stdout}\n${result.stderr}`.includes('E404')) return undefined
  throw new Error(`registry query failed: ${result.stderr}`)
}

function isExpectedArtifact(state) {
  return state?.version === metadata.version
    && state?.['dist.integrity'] === expectedIntegrity
}

function isExpectedRelease(state) {
  return isExpectedArtifact(state)
    && state?.['dist-tags']?.[tag] === metadata.version
}

async function waitForRegistry() {
  const deadline = Date.now() + 120_000
  let state
  while (Date.now() < deadline) {
    state = registryState()
    if (isExpectedRelease(state)) return
    await new Promise(resolve => setTimeout(resolve, 3_000))
  }
  throw new Error(`registry did not expose the expected version, integrity, and ${tag} tag within 120 seconds: ${JSON.stringify(state)}`)
}

const existing = registryState()
if (existing === undefined) {
  run('npm', ['publish', tarball, '--access', 'public', '--tag', tag, '--provenance'], { timeout: 300_000 })
} else if (!isExpectedArtifact(existing)) {
  throw new Error(`${PACKAGE_NAME}@${metadata.version} already exists but does not match the candidate integrity: ${JSON.stringify(existing)}`)
} else {
  process.stdout.write(`${PACKAGE_NAME}@${metadata.version} is already published with the expected integrity; resuming verification.\n`)
}

await waitForRegistry()
process.stdout.write(`Published and verified ${PACKAGE_NAME}@${metadata.version} with npm tag ${tag}\n`)
