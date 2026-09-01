const mode = process.argv[2]

if (mode === 'ready') {
  process.stdout.write('dsh ')
  setTimeout(() => {
    process.stdout.write('web: http://127.0.0.1:45678/?token=test-token\n')
  }, 10)
  const keepAlive = setInterval(() => {}, 1_000)
  process.on('SIGINT', () => {
    clearInterval(keepAlive)
    process.exitCode = 0
  })
} else if (mode === 'failed') {
  process.stderr.write('web boot failed\n')
  process.exitCode = 7
} else {
  process.stdout.write('ordinary output without readiness\n')
}
