import type { EventSubscription } from 'react-native'
import NativeEdgeSpeech from './NativeEdgeSpeech'
import type { RPCClient } from './RPCClient'

/**
 * React Native implementation of {@link RPCClient}.
 *
 * Bridges to the EdgeSpeech C++ TurboModule: serializes JSON-RPC 2.0 requests to
 * the synchronous `processCommand` channel, and forwards SDK events from the
 * module's `onEventReceived` emitter to a single subscriber.
 */
export class NativeModuleRPCClient implements RPCClient {
  /** Monotonic id for JSON-RPC requests. */
  private nextCommandId = 0

  /** Active event subscriber, if any. */
  private eventReceivedCallback?: (data: string) => void

  /** Subscription to the native event emitter. */
  private eventSubscription?: EventSubscription | null

  setEventReceivedCallback(callback: (data: string) => void): void {
    // Replace any existing subscription so we never double-deliver.
    if (this.eventSubscription) {
      this.eventSubscription.remove()
      this.eventSubscription = null
    }

    this.eventReceivedCallback = callback
    this.eventSubscription = NativeEdgeSpeech.onEventReceived((eventJSON) => {
      this.eventReceivedCallback?.(eventJSON)
    })
  }

  sendCommand(method: string, params: object): string {
    const rpcCommand = {
      jsonrpc: '2.0',
      id: ++this.nextCommandId,
      method,
      params,
    }
    return NativeEdgeSpeech.processCommand(JSON.stringify(rpcCommand))
  }
}
