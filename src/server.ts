import {
  HTTPOptions,
  HTTPSOptions,
  serve,
  ServerRequest,
  serveTLS,
} from "../deps/server.ts";

import {
  acceptWebSocket,
  isWebSocketCloseEvent,
  isWebSocketPingEvent,
  isWebSocketPongEvent,
  WebSocket,
  WebSocketEvent,
  WebSocketPingEvent,
  WebSocketPongEvent
} from "../deps/ws.ts";

import { EventEmitter } from "../deps/mutevents.ts";

import { WSConn, WSConnectionEvents } from "./conn.ts";
import { WSMessage } from "./types.ts";
import { ConnectionCloseError } from "./errors.ts";

export interface ListenOptions {
  port: number,
  hostname?: string
  certFile?: string
  keyFile?: string
}

function isHTTPS(options: ListenOptions): options is HTTPSOptions {
  return Boolean(options.certFile) && Boolean(options.keyFile)
}

export interface WSServerEvents {
  accept: WSServerConn
}

export class WSServer extends EventEmitter<WSServerEvents> {
  constructor(
    options: ListenOptions,
  ) {
    super();

    if (isHTTPS(options))
      this.listenTLS(options);
    else
      this.listen(options)
  }

  private async listen(options: HTTPOptions) {
    while (true) {
      try {
        for await (const req of serve(options))
          this.handle(req).catch(console.error)
        return
      } catch (e: unknown) {
        console.error(e)
      }
    }
  }

  private async listenTLS(options: HTTPSOptions) {
    while (true) {
      try {
        for await (const req of serveTLS(options))
          this.handle(req).catch(console.error)
        return
      } catch (e: unknown) {
        console.error(e)
      }
    }
  }

  private async handle(req: ServerRequest) {
    let socket: WebSocket

    try {
      socket = await acceptWebSocket({
        conn: req.conn,
        bufReader: req.r,
        bufWriter: req.w,
        headers: req.headers,
      })
    } catch (e: unknown) {
      await req.respond({ status: 400 });
      return;
    }

    const conn = new WSServerConn(socket)
    await this.emit("accept", conn)
  }
}

export interface WSServerConnEvents extends WSConnectionEvents {
  ping: WebSocketPingEvent
  pong: WebSocketPongEvent
}

export class WSServerConn extends WSConn<WSServerConnEvents> {
  constructor(readonly socket: WebSocket) {
    super()

    this._listen()
      .catch(console.error)
  }

  get closed() { return this.socket.isClosed }

  async ping() {
    await this.socket.ping()
  }

  async send(msg: WSMessage) {
    const text = JSON.stringify(msg);
    await this.socket.send(text);
  }

  async close(reason?: string) {
    await this.socket.close(1000, reason ?? "");
    await this.emit("close",
      new ConnectionCloseError(reason))
  }

  private async _listen() {
    for await (const e of this.socket) {
      this._handle(e)
        .catch(console.error)
    }

    await this.emit("close",
      new ConnectionCloseError())
  }

  private async _handle(e: WebSocketEvent) {
    if (isWebSocketPingEvent(e))
      await this.emit("ping", e)

    if (isWebSocketPongEvent(e))
      await this.emit("pong", e)

    if (isWebSocketCloseEvent(e))
      await this.emit("close",
        new ConnectionCloseError(e.reason))

    if (typeof e === "string")
      await this.emit("message",
        JSON.parse(e) as WSMessage)
  }
}