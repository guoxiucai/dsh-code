const mode = process.argv[2]
if (mode === 'valid' || mode === 'valid-failed') process.send?.({ type: 'dsh-code/session-switch', sessionId: 'session-target' })
if (mode === 'invalid') process.send?.({ type: 'dsh-code/session-switch', sessionId: '' })
setImmediate(() => { process.exitCode = mode === 'failed' || mode === 'valid-failed' ? 7 : 0 })
