import { Abort } from "../deps/abortable.ts";
import { EventEmitter } from "../deps/mutevents.ts";
import { Timeout } from "../deps/timeout.ts";

import * as UUIDs from "../deps/uuid.ts";

import { WSChannel } from "./channel.ts";

import {
  ChannelCloseError,
  CloseError,
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
  message: WSMessage
  close: CloseError
}

export abstract class WSConn<E extends WSConnectionEvents = WSConnectionEvents> extends EventEmitter<E> {
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

  abstract send(msg: WSMessage): Promise<void>
  abstract close(reason?: string): Promise<void>

  private async onwsopen(msg: WSOpenMessage) {
    if (this.channels.has(msg.uuid))
      throw new Error("UUID already exists")

    const { uuid, path, data } = msg;
    const channel = this.create(uuid)

    await channel.emit("open", undefined)
    await this.paths.emit(path, { channel, data })
  }

  private async onwsmessage(msg: WSMessage) {
    if (msg.type === "open") {
      await this.onwsopen(msg)
      return
    }

    const channel = this.channels.get(msg.uuid)
    if (!channel) throw new Error("Invalid UUID")

    if (msg.type === undefined) {
      await channel.emit("message", msg.data)
    }

    if (msg.type === "close") {
      await channel.emit("close", msg.data)
    }

    if (msg.type === "error") {
      await channel.emit("close",
        new ChannelCloseError(msg.reason))
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
   * Create a channel
   * @returns a new channel
   */
  create(uuid = this.genUUID()): WSChannel {
    const channel = new WSChannel(this, uuid)

    channel.once(["open"], () =>
      this.channels.set(uuid, channel))

    channel.once(["close"], () =>
      this.channels.delete(uuid))

    return channel
  }

  /**
   * Create and open a channel
   * @param path Path
   * @param data Data to send
   */
  async open(path: string, data?: unknown) {
    const channel = this.create()
    await channel.open(path, data)
    return channel
  }

  /**
   * Open a channel and wait for a close message
   * @param path Path
   * @param data Data to send
   * @param delay Timeout delay
   * @returns Data received
   */
  async request(path: string, data?: unknown, delay = 1000) {
    const channel = await this.open(path, data)
    return await channel.final(delay)
  }
}