import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const DIST = join(ROOT, 'dist', 'npm')
export const STAGE = join(DIST, 'package')
export const CANDIDATE = join(DIST, 'candidate.json')
export const PACKAGE_NAME = '@tsingwill/dsh-code'
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function option(args, name) {
  const exact = args.indexOf(name)
  if (exact !== -1) return args[exact + 1]
  const prefix = `${name}=`
  return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
}

export function hasFlag(args, name) {
  return args.includes(name)
}

function executable(command, args) {
  if (command === 'npm') {
    const nodeDir = dirname(process.execPath)
    const candidates = [
      join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]
    const cli = candidates.find(existsSync)
    if (cli !== undefined) return { command: process.execPath, args: [cli, ...args] }
  }
  if (command === 'pnpm' && typeof process.env.npm_execpath === 'string' && existsSync(process.env.npm_execpath)) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] }
  }
  return { command, args }
}

export function run(command, args, options = {}) {
  const env = { ...(options.env ?? process.env) }
  if (command === 'npm') {
    delete env.npm_config_manage_package_manager_versions
    delete env.NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS
  }
  const invocation = executable(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env,
    shell: false,
    stdio: options.capture === true ? 'pipe' : 'inherit',
    timeout: options.timeout,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0 && options.allowFailure !== true) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}${detail === '' ? '' : `\n${detail}`}`)
  }
  return result
}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function sha512Integrity(path) {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
}

export function candidateMetadata() {
  return readJson(CANDIDATE)
}
