/**
 * Transport abstraction over the native JSON-RPC channel.
 *
 * Decouples the high-level {@link SwitchboardClient} from the concrete transport
 * so it can be backed by the native TurboModule in the app and by a mock in
 * tests.
 */
export interface RPCClient {
  /**
   * Serialize a JSON-RPC 2.0 request for `method`/`params`, send it over the
   * native channel, and return the raw JSON-RPC response string.
   */
  sendCommand(method: string, params: object): string

  /** Register the single subscriber for native → JS event JSON strings. */
  setEventReceivedCallback(callback: (data: string) => void): void
}
