import { Abort } from "../deps/abortable.ts";
import { EventEmitter } from "../deps/mutevents.ts";
import { Timeout } from "../deps/timeout.ts";

import * as UUIDs from "../deps/uuid.ts";

import {
  WebSocketPingEvent,
  WebSocketPongEvent
} from "../deps/ws.ts";

import { WSChannel } from "./channel.ts";

import {
  ChannelCloseError,
  CloseError,
  ConnectionCloseError
} from "./errors.ts";

import {
  UUID,
  WSMessage,
  WSOpenMessage
} from "./types.ts";

export interface Message<T = unknown> {
  channel: WSChannel,
  data: T
}

export interface WSConnectionEvents {
  open: undefined
  error: Error
  ping: WebSocketPingEvent
  pong: WebSocketPongEvent
  message: WSMessage
  close: CloseError
}

export abstract class WSConn extends EventEmitter<WSConnectionEvents> {
  readonly channels = new Map<UUID, WSChannel>()

  readonly paths = new EventEmitter<{
    [path: string]: Message<unknown>
  }>()

  /**
   * Create a new connection from a socket
   * @param socket Socket
   */
  constructor() {
    super();

    this.on(["message"],
      this.onwsmessage.bind(this))
  }

  abstract get closed(): boolean;

  abstract async send(msg: WSMessage): Promise<void>
  abstract async close(reason?: string): Promise<void>

  async catch(e: unknown) {
    console.error(e)

    if (e instanceof CloseError && !this.closed)
      await this.close(e.reason)
    else if (e instanceof Error && !this.closed)
      await this.close(e.message)
  }

  private async onwsopen(msg: WSOpenMessage) {
    if (this.channels.has(msg.uuid))
      throw new Error("UUID already exists")

    const { uuid, path, data } = msg;
    const channel = new WSChannel(this, uuid)
    this.channels.set(uuid, channel)

    channel.once(["close"], () =>
      this.channels.delete(uuid))

    try {
      await this.paths.emit(path, { channel, data })
    } catch (e: unknown) {
      await channel.catch(e)
    }
  }

  private async onwsmessage(msg: WSMessage) {
    if (msg.type === "open") {
      await this.onwsopen(msg)
      return
    }

    const channel = this.channels.get(msg.uuid)
    if (!channel) throw new Error("Invalid UUID")

    if (msg.type === undefined) {
      try {
        await channel.emit("message", msg.data)
      } catch (e: unknown) {
        await channel.catch(e)
      }
    }

    if (msg.type === "close") {
      try {
        await channel.emit("close", msg.data)
      } catch (e: unknown) {
        await this.catch(e)
      }
    }

    if (msg.type === "error") {
      try {
        await channel.emit("close",
          new ChannelCloseError(msg.reason))
      } catch (e: unknown) {
        await this.catch(e)
      }
    }
  }

  /**
   * Wait for an open message on a path
   * @param path Path to listen on
   * @param delay Timeout delay
   * @throws CloseError | TimeoutError
   */
  async waitpath(path: string, delay = 0) {
    const message = this.paths.wait([path])
    const close = this.error(["close"])

    const msg = delay > 0
      ? await Timeout.race([message, close], 1000)
      : await Abort.race([message, close])

    return msg
  }

  private genUUID() {
    while (true) {
      const uuid = UUIDs.generate()
      if (!this.channels.has(uuid))
        return uuid
    }
  }

  /**
   * Open a channel
   * @param path Path
   * @param data Data to send
   */
  async open(path: string, data?: unknown) {
    const uuid = this.genUUID()
    const channel = new WSChannel(this, uuid)

    const message: WSMessage =
      { uuid, type: "open", path, data }

    await this.send(message)

    this.channels.set(uuid, channel)

    channel.once(["close"], () =>
      this.channels.delete(uuid))

    return channel
  }

  /**
   * Open a channel and wait for a close message
   * @param path Path
   * @param data Data to send
   * @param delay Timeout delay
   * @returns Data received
   */
  async request<T>(path: string, data?: unknown, delay = 1000) {
    const channel = await this.open(path, data)
    return await channel.final<T>(delay)
  }
}