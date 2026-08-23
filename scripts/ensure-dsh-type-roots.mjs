#!/usr/bin/env node

import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'node_modules', '@types')
const target = resolve(root, 'deepseek-harness', 'node_modules', '@types')

if (!existsSync(source)) {
  throw new Error(`Missing installed type definitions: ${source}`)
}

if (existsSync(target)) {
  process.exit(0)
}

mkdirSync(dirname(target), { recursive: true })
const linkTarget = process.platform === 'win32'
  ? realpathSync(source)
  : relative(dirname(target), source)
symlinkSync(linkTarget, target, process.platform === 'win32' ? 'junction' : 'dir')
