/**
 * dsh-code product argument parsing. The launcher owns only its product verbs;
 * everything else is either a usage error or (for `plugin`) forwarded verbatim.
 * `--version`/`--help` are answered locally and never reach the upstream
 * launcher or the network.
 * @module dsh-code/cli/args
 */

/** Interactive terminal invocation, optionally resuming a specific session. */
export interface TuiInvocation {
  mode: 'tui'
  resume?: string
}

/** One-shot prompt invocation (delegates to the upstream `headless` profile). */
export interface PromptInvocation {
  mode: 'prompt'
  prompt: string
  verbose: boolean
  approve: boolean
}

/** The resolved dsh-code invocation. */
export type Invocation =
  | { mode: 'help' }
  | { mode: 'version' }
  | TuiInvocation
  | PromptInvocation
  | { mode: 'config' }
  | { mode: 'plugin'; args: string[] }
  | { mode: 'import-dsh' }
  | { mode: 'update' }
  | { mode: 'error'; message: string }

const USAGE_HINT = 'run `dsh-code --help` for usage'

/** Parse product argv into one invocation. Never throws. */
export function parseArgs(argv: readonly string[]): Invocation {
  if (argv.length === 0) return { mode: 'tui' }
  const first = argv[0] ?? ''

  if (first === '--help' || first === '-h') return { mode: 'help' }
  if (first === '--version' || first === '-V') return { mode: 'version' }

  if (first === 'resume') {
    const id = argv.slice(1).find(arg => !arg.startsWith('-'))
    return id === undefined ? { mode: 'tui' } : { mode: 'tui', resume: id }
  }

  if (first === 'config') return { mode: 'config' }
  if (first === 'plugin') return { mode: 'plugin', args: argv.slice(1) }
  if (first === 'update') return { mode: 'update' }

  if (first === 'import') {
    if (argv[1] === 'dsh') return { mode: 'import-dsh' }
    return { mode: 'error', message: `import expects 'dsh', got ${JSON.stringify(argv[1] ?? '')}` }
  }

  if (first === '-p' || first === '--prompt' || first.startsWith('--prompt=')) {
    let prompt = ''
    let rest: readonly string[]
    if (first.startsWith('--prompt=')) {
      prompt = first.slice('--prompt='.length)
      rest = argv.slice(1)
    } else {
      prompt = argv[1] ?? ''
      rest = argv.slice(2)
    }
    let verbose = false
    let approve = false
    for (const arg of rest) {
      if (arg === '--verbose') verbose = true
      else if (arg === '--approve') approve = true
      else return { mode: 'error', message: `unknown flag ${JSON.stringify(arg)}` }
    }
    if (prompt.trim() === '') return { mode: 'error', message: '-p requires a non-empty prompt' }
    return { mode: 'prompt', prompt, verbose, approve }
  }

  return { mode: 'error', message: `unknown command ${JSON.stringify(first)} ${USAGE_HINT}` }
}

/** The product help text. */
export const HELP_TEXT = `dsh-code — terminal coding agent powered by DeepSeek Harness

Usage:
  dsh-code                         start the interactive terminal UI
  dsh-code resume [session-id]     resume a persisted session (selector when no id)
  dsh-code -p <prompt>             answer one task and exit
                 [--verbose]       (accepted; verbose tool tracing is not yet wired)
                 [--approve]       accept project startup trust non-interactively
  dsh-code config                  open the model/credential configuration
  dsh-code plugin <add|remove|update|list> ...   manage profile plugins
  dsh-code import dsh              one-time import of an upstream dsh config
  dsh-code update                  check for and apply a dsh-code update
  dsh-code --version               print the version
  dsh-code --help                  print this help
`
