import type { RPCClient } from './RPCClient'

/** A parsed JSON-RPC 2.0 response. */
export interface RPCResponse {
  jsonrpc?: string
  id?: number
  result?: any
  error?: { code: number; message: string; data?: any }
}

/**
 * High-level, typed API over the Switchboard SDK's JSON-RPC interface.
 *
 * Wraps an {@link RPCClient} and exposes the SDK's object model — getValue /
 * setValue / callAction / event listeners — without callers having to hand-roll
 * JSON-RPC envelopes. Every Switchboard object (the engine, nodes, the SDK
 * itself) is addressed by a string `objectURI`.
 */
export class SwitchboardClient {
  constructor(private readonly rpcClient: RPCClient) {}

  /** Subscribe to SDK events (delivered as JSON strings) via the transport. */
  setEventReceivedCallback(callback: (data: string) => void): void {
    this.rpcClient.setEventReceivedCallback(callback)
  }

  /** Read a property from a Switchboard object. */
  getValue(objectUri: string, key: string): RPCResponse {
    return this.send('getValue', { objectURI: objectUri, key })
  }

  /** Write a property on a Switchboard object. */
  setValue(objectUri: string, key: string, value: any): RPCResponse {
    return this.send('setValue', { objectURI: objectUri, key, value })
  }

  /** Invoke an action on a Switchboard object (e.g. 'initialize', 'start'). */
  callAction(objectUri: string, action: string, data: object = {}): RPCResponse {
    return this.send('callAction', {
      objectURI: objectUri,
      actionName: action,
      params: data,
    })
  }

  /**
   * Listen for events from an object. Use '*' for the object and/or event name
   * to match all. Events arrive through {@link setEventReceivedCallback}.
   */
  addEventListener(objectUri: string, eventName: string): RPCResponse {
    return this.send('addEventListener', {
      objectURI: objectUri,
      eventName,
    })
  }

  /** Remove a listener previously registered with {@link addEventListener}. */
  removeEventListener(objectUri: string, listenerID: number): RPCResponse {
    return this.send('removeEventListener', {
      objectURI: objectUri,
      listenerID,
    })
  }

  /** Serialize, send, and parse a single JSON-RPC call. */
  private send(method: string, params: object): RPCResponse {
    const response = this.rpcClient.sendCommand(method, params)
    return JSON.parse(response) as RPCResponse
  }
}
