/**
 * Build an Error carrying a machine `code`, to reject a failing action with. The
 * useEdgeSpeech hook catches the rejection and surfaces the message as `error`.
 * Mirrors the original native module, which rejected action promises and did not
 * additionally emit onError for action failures.
 */
export function makeError(code: string, message: string): Error {
  const error = new Error(message)
  ;(error as { code?: string }).code = code
  return error
}
