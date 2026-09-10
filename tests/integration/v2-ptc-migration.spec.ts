/**
 * Run the pinned upstream migration contract against built workspace exports.
 * The downstream Vitest config deliberately has no source-path aliases: this
 * exercises the shipped verification worker, including import.meta resolution.
 * Requires build:lib, like the other downstream integration suites.
 */
import '../../deepseek-harness/packages/session/session-persistence-jsonl/tests/v2-ptc-migration.spec.ts'
