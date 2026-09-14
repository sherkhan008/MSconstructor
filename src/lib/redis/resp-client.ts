import net from 'node:net';
import tls from 'node:tls';

/**
 * Minimal Redis (RESP2) client — just enough for the shared rate limiter
 * (src/lib/rate-limit.ts): one lazily opened connection, pipelined commands,
 * AUTH/SELECT from the URL, `rediss://` TLS, and hard connect/command
 * timeouts so a slow or unreachable Redis can never hang a request. Kept
 * in-house instead of adding a Redis package because the limiter needs five
 * commands and nothing else in the app uses Redis.
 *
 * Never logs or throws the connection URL (it carries the password).
 */

export class RedisReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisReplyError';
  }
}

export class RedisConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisConnectionError';
  }
}

export type RespValue = string | number | null | RedisReplyError | RespValue[];

export interface RedisClientOptions {
  url: string;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}

interface PendingReply {
  resolve: (value: RespValue) => void;
  reject: (error: Error) => void;
}

interface ParsedUrl {
  tls: boolean;
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
}

export function parseRedisUrl(url: string): ParsedUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RedisConnectionError('REDIS_URL is not a valid URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new RedisConnectionError('REDIS_URL must use redis:// or rediss://');
  }
  const dbText = parsed.pathname.replace(/^\//, '');
  const db = dbText ? Number(dbText) : undefined;
  if (db !== undefined && (!Number.isInteger(db) || db < 0)) {
    throw new RedisConnectionError('REDIS_URL database index is invalid');
  }
  return {
    tls: parsed.protocol === 'rediss:',
    host: parsed.hostname.replace(/^\[|\]$/g, '') || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db,
  };
}

export function encodeCommand(args: readonly string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) out += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
  return out;
}

/** Parses one RESP2 value at `offset`; undefined when the buffer is incomplete. */
export function parseReply(buffer: Buffer, offset = 0): { value: RespValue; next: number } | undefined {
  if (offset >= buffer.length) return undefined;
  const lineEnd = buffer.indexOf('\r\n', offset);
  if (lineEnd === -1) return undefined;
  const type = String.fromCharCode(buffer[offset]);
  const line = buffer.toString('utf8', offset + 1, lineEnd);
  const afterLine = lineEnd + 2;
  switch (type) {
    case '+':
      return { value: line, next: afterLine };
    case '-':
      return { value: new RedisReplyError(line), next: afterLine };
    case ':':
      return { value: Number(line), next: afterLine };
    case '$': {
      const length = Number(line);
      if (length === -1) return { value: null, next: afterLine };
      if (buffer.length < afterLine + length + 2) return undefined;
      return { value: buffer.toString('utf8', afterLine, afterLine + length), next: afterLine + length + 2 };
    }
    case '*': {
      const count = Number(line);
      if (count === -1) return { value: null, next: afterLine };
      const items: RespValue[] = [];
      let cursor = afterLine;
      for (let i = 0; i < count; i += 1) {
        const item = parseReply(buffer, cursor);
        if (!item) return undefined;
        items.push(item.value);
        cursor = item.next;
      }
      return { value: items, next: cursor };
    }
    default:
      throw new RedisConnectionError('Malformed Redis reply');
  }
}

export class MinimalRedisClient {
  private readonly target: ParsedUrl;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private socket: net.Socket | null = null;
  private connecting: Promise<net.Socket> | null = null;
  private pending: PendingReply[] = [];
  private buffer: Buffer = Buffer.alloc(0);

  constructor(options: RedisClientOptions) {
    this.target = parseRedisUrl(options.url);
    this.connectTimeoutMs = options.connectTimeoutMs ?? 1_000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 1_000;
  }

  /** Sends every command in one write and resolves with every reply in order.
   * Error replies are returned as RedisReplyError values, not thrown. */
  async pipeline(commands: readonly (readonly string[])[]): Promise<RespValue[]> {
    const socket = await this.connect();
    return this.send(socket, commands);
  }

  close(): void {
    this.teardown(new RedisConnectionError('Redis client closed'));
  }

  private send(socket: net.Socket, commands: readonly (readonly string[])[]): Promise<RespValue[]> {
    return new Promise<RespValue[]>((resolve, reject) => {
      const replies: RespValue[] = new Array(commands.length);
      let received = 0;
      let settled = false;
      const timer = setTimeout(() => {
        // Replies are matched to requests purely by order, so a timed-out
        // pipeline leaves the stream unusable — drop the whole connection.
        this.teardown(new RedisConnectionError('Redis command timed out'));
      }, this.commandTimeoutMs);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      commands.forEach((_, index) => {
        this.pending.push({
          resolve: (value) => {
            if (settled) return;
            replies[index] = value;
            received += 1;
            if (received === commands.length) {
              settled = true;
              clearTimeout(timer);
              resolve(replies);
            }
          },
          reject: fail,
        });
      });
      socket.write(commands.map(encodeCommand).join(''));
    });
  }

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<net.Socket>((resolve, reject) => {
      const { host, port } = this.target;
      const socket = this.target.tls
        ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host })
        : net.connect({ host, port });
      socket.setNoDelay(true);

      const connectTimer = setTimeout(() => {
        socket.destroy(new RedisConnectionError('Redis connect timed out'));
      }, this.connectTimeoutMs);

      socket.on('data', (chunk: Buffer) => this.onData(chunk));
      socket.on('error', () => {
        /* surfaced through 'close' */
      });
      socket.on('close', () => {
        clearTimeout(connectTimer);
        // A late 'close' from an already-replaced socket must not tear down
        // the connection that superseded it.
        if (this.socket === socket || this.socket === null) {
          this.socket = null;
          this.teardown(new RedisConnectionError('Redis connection closed'));
        }
        reject(new RedisConnectionError('Redis connection failed'));
      });

      socket.once(this.target.tls ? 'secureConnect' : 'connect', async () => {
        clearTimeout(connectTimer);
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        try {
          const handshake: string[][] = [];
          if (this.target.password) {
            handshake.push(
              this.target.username ? ['AUTH', this.target.username, this.target.password] : ['AUTH', this.target.password],
            );
          }
          if (this.target.db !== undefined) handshake.push(['SELECT', String(this.target.db)]);
          if (handshake.length > 0) {
            const replies = await this.send(socket, handshake);
            if (replies.some((reply) => reply instanceof RedisReplyError)) {
              throw new RedisConnectionError('Redis AUTH/SELECT rejected');
            }
          }
          resolve(socket);
        } catch (error) {
          socket.destroy();
          reject(error instanceof Error ? error : new RedisConnectionError('Redis handshake failed'));
        }
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    let offset = 0;
    try {
      for (;;) {
        const parsed = parseReply(this.buffer, offset);
        if (!parsed) break;
        offset = parsed.next;
        const waiter = this.pending.shift();
        if (!waiter) throw new RedisConnectionError('Unexpected Redis reply');
        waiter.resolve(parsed.value);
      }
    } catch (error) {
      this.teardown(error instanceof Error ? error : new RedisConnectionError('Malformed Redis reply'));
      return;
    }
    this.buffer = offset >= this.buffer.length ? Buffer.alloc(0) : this.buffer.subarray(offset);
  }

  private teardown(error: Error): void {
    const waiters = this.pending;
    this.pending = [];
    this.buffer = Buffer.alloc(0);
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) socket.destroy();
    for (const waiter of waiters) waiter.reject(error);
  }
}
