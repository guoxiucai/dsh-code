import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UpdateInvocation } from './args.ts'

interface ProductManifest {
  name?: unknown
  version?: unknown
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function npmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function runNpm(args: readonly string[], stdio: 'pipe' | 'inherit' = 'pipe'): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(npmExecutable(), [...args], { shell: false, stdio })
    child.once('error', (error) => {
      process.stderr.write(`dsh-code update: failed to run npm: ${error.message}\n`)
      resolve(1)
    })
    child.once('exit', code => resolve(code ?? 1))
  })
}

function installedManifest(): { manifest: { name: string; version: string }; root: string } {
  const path = fileURLToPath(new URL('../../package.json', import.meta.url))
  const value = JSON.parse(readFileSync(path, 'utf8')) as ProductManifest
  if (typeof value.name !== 'string' || typeof value.version !== 'string') {
    throw new Error('installed package manifest has no valid name/version')
  }
  return { manifest: { name: value.name, version: value.version }, root: fileURLToPath(new URL('../..', import.meta.url)) }
}

function globalPackageRoot(name: string): string | undefined {
  const result = spawnSync(npmExecutable(), ['root', '--global'], { encoding: 'utf8', shell: false })
  if (result.status !== 0) return undefined
  return join(result.stdout.trim(), ...name.split('/'))
}

function isGlobalInstall(name: string, root: string): boolean {
  const expected = globalPackageRoot(name)
  if (expected === undefined || !existsSync(expected)) return false
  try {
    return realpathSync(expected) === realpathSync(root)
  } catch {
    return false
  }
}

function queryVersion(spec: string): string {
  const result = spawnSync(npmExecutable(), ['view', spec, 'version', '--json'], {
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
  })
  if (result.status !== 0) {
    const detail = result.stderr.trim() || 'registry query failed'
    throw new Error(detail)
  }
  const value = JSON.parse(result.stdout) as unknown
  if (typeof value !== 'string' || !SEMVER.test(value)) throw new Error(`registry returned an invalid version: ${result.stdout.trim()}`)
  return value
}

async function confirmUpdate(current: string, target: string): Promise<boolean> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) return false
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await terminal.question(`Update dsh-code ${current} → ${target}? [y/N] `)
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
  } finally {
    terminal.close()
  }
}

/** Check or update an npm-global dsh-code installation without invoking a shell. */
export async function runUpdate(invocation: UpdateInvocation): Promise<number> {
  let installed: ReturnType<typeof installedManifest>
  try {
    installed = installedManifest()
  } catch (error) {
    process.stderr.write(`dsh-code update: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  const { name, version: current } = installed.manifest
  if (!isGlobalInstall(name, installed.root)) {
    process.stderr.write('dsh-code update: this copy is not an npm global installation; update it with the tool that installed it\n')
    return 1
  }

  const requested = invocation.version ?? invocation.channel
  let target: string
  try {
    if (invocation.version !== undefined && !SEMVER.test(invocation.version)) throw new Error(`invalid version ${JSON.stringify(invocation.version)}`)
    target = queryVersion(`${name}@${requested}`)
  } catch (error) {
    process.stderr.write(`dsh-code update: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  if (target === current) {
    process.stdout.write(`dsh-code ${current} is already current (${requested})\n`)
    return 0
  }
  process.stdout.write(`dsh-code update available: ${current} → ${target}\n`)
  if (invocation.check) return 0

  const approved = invocation.yes || await confirmUpdate(current, target)
  if (!approved) {
    if (process.stdin.isTTY !== true) process.stderr.write('dsh-code update: non-interactive updates require --yes\n')
    else process.stdout.write('Update cancelled\n')
    return process.stdin.isTTY === true ? 0 : 1
  }

  const code = await runNpm(['install', '--global', `${name}@${target}`], 'inherit')
  if (code !== 0) return code
  process.stdout.write(`Updated ${name} to ${target}. Restart dsh-code to use the new version.\n`)
  return 0
}
