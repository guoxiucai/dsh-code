import { describe, expect, it } from 'vitest'
import { appendNodeImport } from '../../src/bootstrap/node-options.ts'

describe('delegated Node options', () => {
  it('adds the warning-filter preload to an empty environment', () => {
    expect(appendNodeImport(undefined, 'file:///tmp/filter.js')).toBe('--import=file:///tmp/filter.js')
  })

  it('preserves caller-supplied Node options', () => {
    expect(appendNodeImport(' --trace-warnings ', 'file:///tmp/filter.js'))
      .toBe('--trace-warnings --import=file:///tmp/filter.js')
  })
})
