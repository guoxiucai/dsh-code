import { describe, expect, it } from 'vitest'
import { credentialEnvName } from '../../src/tui/config-wizard.ts'

describe('credentialEnvName', () => {
  it('generates the DeepSeek example default', () => {
    expect(credentialEnvName('deepseek')).toBe('DEEPSEEK_API_KEY')
  })

  it('normalizes separators and casing', () => {
    expect(credentialEnvName('my-gateway.dev')).toBe('MY_GATEWAY_DEV_API_KEY')
  })
})
