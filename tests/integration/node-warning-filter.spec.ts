import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const filter = fileURLToPath(new URL('../../lib/bootstrap/node-warning-filter.js', import.meta.url))

describe.skipIf(!existsSync(filter))('built Node warning filter', () => {
  it('suppresses only the PTC type-strip warning', async () => {
    const script = `
      const { stripTypeScriptTypes } = await import('node:module')
      stripTypeScriptTypes('const value: number = 1')
      process.emitWarning('keep this warning', 'CompatibilityWarning')
    `
    const { exitCode, stderr } = await execa(process.execPath, ['--import', filter, '--input-type=module', '-e', script], {
      reject: false,
    })

    expect(exitCode).toBe(0)
    expect(stderr).not.toContain('ExperimentalWarning: stripTypeScriptTypes')
    expect(stderr).toContain('CompatibilityWarning: keep this warning')
  })

  it('recognizes only the upstream Windows PTC worker entry', async () => {
    const { isWindowsPtcWorkerPath } = await import('../../lib/bootstrap/node-warning-filter.js')
    const upstream = 'C:\\Users\\runner\\node_modules\\@deepseek-ai\\dsh-code-runtime-worker-thread\\lib\\worker.cjs'

    expect(isWindowsPtcWorkerPath(upstream, 'win32')).toBe(true)
    expect(isWindowsPtcWorkerPath('C:\\tmp\\other\\worker.cjs', 'win32')).toBe(false)
    expect(isWindowsPtcWorkerPath(upstream, 'darwin')).toBe(false)
  })
})
