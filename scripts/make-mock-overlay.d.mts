/**
 * Type declaration for scripts/make-mock-overlay.mjs, so the TypeScript test
 * can import the shared overlay builder without a missing-declaration error.
 */

/** Build the keyless mock-LLM `--patch` overlay; `mockAdapterPath` is embedded as the plugin `name` (absolute `file://` URL). */
export declare function mockOverlay(mockAdapterPath: string): string
