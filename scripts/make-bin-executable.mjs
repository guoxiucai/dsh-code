import { chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const bin = fileURLToPath(new URL('../lib/bin.js', import.meta.url))

// Windows ignores POSIX mode bits. chmodSync is still a portable no-op there,
// while npm preserves the executable bit in tarballs built on Unix.
if (process.platform !== 'win32') chmodSync(bin, 0o755)
