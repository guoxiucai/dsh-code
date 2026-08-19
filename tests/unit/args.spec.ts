import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.ts'

describe('parseArgs', () => {
  it('CLI-001: --help', () => { expect(parseArgs(['--help'])).toEqual({ mode: 'help' }) })
  it('CLI-002: --version', () => { expect(parseArgs(['--version'])).toEqual({ mode: 'version' }) })
  it('defaults to the interactive TUI', () => { expect(parseArgs([])).toEqual({ mode: 'tui' }) })
  it('resume without id opens the selector', () => { expect(parseArgs(['resume'])).toEqual({ mode: 'tui', resumePicker: true }) })
  it('resume with id', () => { expect(parseArgs(['resume', 'abc'])).toEqual({ mode: 'tui', resume: 'abc' }) })
  it('-r opens the session picker', () => { expect(parseArgs(['-r'])).toEqual({ mode: 'tui', resumePicker: true }) })
  it('--resume opens the session picker', () => { expect(parseArgs(['--resume'])).toEqual({ mode: 'tui', resumePicker: true }) })
  it('-c resumes the latest session', () => { expect(parseArgs(['-c'])).toEqual({ mode: 'tui', continueLatest: true }) })
  it('--continue resumes the latest session', () => { expect(parseArgs(['--continue'])).toEqual({ mode: 'tui', continueLatest: true }) })

  it('-p with a prompt', () => {
    expect(parseArgs(['-p', 'fix tests'])).toEqual({ mode: 'prompt', prompt: 'fix tests', verbose: false, approve: false })
  })

  it('-p with --verbose and --approve', () => {
    expect(parseArgs(['-p', 'x', '--verbose', '--approve']))
      .toEqual({ mode: 'prompt', prompt: 'x', verbose: true, approve: true })
  })

  it('--prompt= form', () => {
    expect(parseArgs(['--prompt=hi'])).toEqual({ mode: 'prompt', prompt: 'hi', verbose: false, approve: false })
  })

  it('CLI-003: unknown command is an error', () => {
    expect(parseArgs(['bogus']).mode).toBe('error')
  })

  it('plugin forwards the rest verbatim', () => {
    expect(parseArgs(['plugin', 'add', 'some-pkg'])).toEqual({ mode: 'plugin', args: ['add', 'some-pkg'] })
  })

  it('import dsh', () => { expect(parseArgs(['import', 'dsh'])).toEqual({ mode: 'import-dsh' }) })
  it('update defaults to the stable channel', () => {
    expect(parseArgs(['update'])).toEqual({ mode: 'update', check: false, yes: false, channel: 'latest' })
  })

  it('parses update flags', () => {
    expect(parseArgs(['update', '--check', '--channel', 'next']))
      .toEqual({ mode: 'update', check: true, yes: false, channel: 'next' })
    expect(parseArgs(['update', '--yes', '--version=0.1.0']))
      .toEqual({ mode: 'update', check: false, yes: true, channel: 'latest', version: '0.1.0' })
  })

  it('rejects conflicting update selectors', () => {
    expect(parseArgs(['update', '--channel=next', '--version', '0.1.0']).mode).toBe('error')
  })
})
