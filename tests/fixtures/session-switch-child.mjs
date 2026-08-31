const mode = process.argv[2]
if (mode === 'resume' || mode === 'valid-failed') process.send?.({
  type: 'dsh-code/session-switch',
  target: { kind: 'resume', sessionId: 'session-target' },
})
if (mode === 'new') process.send?.({ type: 'dsh-code/session-switch', target: { kind: 'new' } })
if (mode === 'picker') process.send?.({
  type: 'dsh-code/session-switch',
  target: { kind: 'picker', fallbackSessionId: 'session-current' },
})
if (mode === 'invalid') process.send?.({ type: 'dsh-code/session-switch', target: { kind: 'resume', sessionId: '' } })
if (mode === 'discard' || mode === 'resume-discard') {
  process.send?.({ type: 'dsh-code/session-discard', sessionId: 'session-empty' })
}
if (mode === 'resume-discard') process.send?.({
  type: 'dsh-code/session-switch',
  target: { kind: 'resume', sessionId: 'session-target' },
})
setImmediate(() => { process.exitCode = mode === 'failed' || mode === 'valid-failed' ? 7 : 0 })
