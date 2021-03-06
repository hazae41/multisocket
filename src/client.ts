import { Abort } from "../deps/abortable.ts";

import { WSConn, WSConnectionEvents } from "./conn.ts";
import { ConnectionCloseError } from "./errors.ts";
import { WSMessage } from "./types.ts";

export interface WSClientConnEvents extends WSConnectionEvents {
  open: undefined
  error: Error
}

export class WSClientConn extends WSConn<WSClientConnEvents> {
  readonly waitready = this._waitready().catch()
  readonly socket = new WebSocket(this.url)

  constructor(
    readonly url: string
  ) {
    super()

    this.socket.onopen = this.onopen.bind(this)
    this.socket.onerror = this.onerror.bind(this)
    this.socket.onclose = this.onclose.bind(this)
    this.socket.onmessage = this.onmessage.bind(this)
  }

  get closed() {
    return this.socket.readyState === WebSocket.CLOSED
  }

  private async onopen(e: Event) {
    this.emit("open", undefined)
      .catch(console.error)
  }

  private async onclose(e: CloseEvent) {
    this.emit("close",
      new ConnectionCloseError(e.reason))
      .catch(console.error)
  }

  private async onerror(e: Event) {
    this.emit("error", new Error())
      .catch(console.error)
  }

  private async onmessage(e: MessageEvent) {
    const data = JSON.parse(e.data)
    this.emit("message", data)
      .catch(console.error)
  }

  private async _waitready() {
    const open = this.wait(["open"])
    const error = this.error(["error"])
    await Abort.race([open, error])
  }

  async send(msg: WSMessage) {
    const text = JSON.stringify(msg)
    this.socket.send(text)
  }

  async close(reason?: string) {
    if (this.closed) return
    this.socket.close(1000, reason)
  }
}