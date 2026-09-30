/** Report the inner argv after the real profile Loader settles. */
export const name = 'resume-args-smoke'
export const inject = ['cmdlineArgs']
export function apply(ctx) {
  void ctx.loader.await().then(() => {
    process.stdout.write(JSON.stringify({ args: ctx.cmdlineArgs.get() }) + '\n')
    ctx.get('appExit')?.(0)
  })
}
