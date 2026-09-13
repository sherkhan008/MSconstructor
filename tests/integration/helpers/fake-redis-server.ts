import net from 'node:net';
import { parseReply } from '@/lib/redis/resp-client';

/**
 * In-process RESP2 server implementing only the commands the rate limiter
 * sends (AUTH, SELECT, MULTI/EXEC, SET … PX … NX, INCR, PTTL, PEXPIRE) with
 * a controllable clock, so the real MinimalRedisClient + RedisRateLimitStore
 * are exercised over a real socket, deterministically, without a Redis
 * install. MULTI/EXEC runs queued commands back-to-back on Node's single
 * thread, matching Redis's atomic transaction semantics.
 */

interface Entry {
  value: string;
  expiresAt: number | null;
}

export interface FakeRedisServer {
  url: string;
  port: number;
  now: { value: number };
  data: Map<string, Entry>;
  commandLog: string[][];
  connections: () => number;
  mode: { value: 'normal' | 'error' | 'hang' };
  close: () => Promise<void>;
}

export async function startFakeRedisServer(options: { password?: string } = {}): Promise<FakeRedisServer> {
  const data = new Map<string, Entry>();
  const commandLog: string[][] = [];
  const now = { value: 1_000_000 };
  const mode: FakeRedisServer['mode'] = { value: 'normal' };
  const sockets = new Set<net.Socket>();

  const live = (key: string): Entry | undefined => {
    const entry = data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now.value) {
      data.delete(key);
      return undefined;
    }
    return entry;
  };

  const execute = (args: string[]): string => {
    const [name, ...rest] = args;
    switch (name.toUpperCase()) {
      case 'AUTH':
        return rest[rest.length - 1] === options.password ? '+OK\r\n' : '-WRONGPASS invalid password\r\n';
      case 'SELECT':
        return '+OK\r\n';
      case 'SET': {
        const [key, value, ...flags] = rest;
        const upper = flags.map((f) => f.toUpperCase());
        if (upper.includes('NX') && live(key)) return '$-1\r\n';
        const pxIndex = upper.indexOf('PX');
        const expiresAt = pxIndex >= 0 ? now.value + Number(flags[pxIndex + 1]) : null;
        data.set(key, { value, expiresAt });
        return '+OK\r\n';
      }
      case 'INCR': {
        const entry = live(rest[0]);
        const next = (entry ? Number(entry.value) : 0) + 1;
        data.set(rest[0], { value: String(next), expiresAt: entry?.expiresAt ?? null });
        return `:${next}\r\n`;
      }
      case 'PTTL': {
        const entry = live(rest[0]);
        if (!entry) return ':-2\r\n';
        return entry.expiresAt === null ? ':-1\r\n' : `:${entry.expiresAt - now.value}\r\n`;
      }
      case 'PEXPIRE': {
        const entry = live(rest[0]);
        if (!entry) return ':0\r\n';
        entry.expiresAt = now.value + Number(rest[1]);
        return ':1\r\n';
      }
      default:
        return `-ERR unknown command '${name}'\r\n`;
    }
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = Buffer.alloc(0);
    let queue: string[][] | null = null;
    let authed = !options.password;

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let offset = 0;
      let out = '';
      for (;;) {
        const parsed = parseReply(buffer, offset);
        if (!parsed) break;
        offset = parsed.next;
        const args = parsed.value as string[];
        commandLog.push(args);
        if (mode.value === 'hang') continue;
        if (mode.value === 'error') {
          out += '-ERR simulated failure\r\n';
          continue;
        }
        const name = args[0].toUpperCase();
        if (!authed && name !== 'AUTH') {
          out += '-NOAUTH Authentication required.\r\n';
        } else if (name === 'AUTH') {
          const reply = execute(args);
          authed = reply.startsWith('+');
          out += reply;
        } else if (name === 'MULTI') {
          queue = [];
          out += '+OK\r\n';
        } else if (name === 'EXEC') {
          const replies = (queue ?? []).map(execute);
          queue = null;
          out += `*${replies.length}\r\n${replies.join('')}`;
        } else if (queue) {
          queue.push(args);
          out += '+QUEUED\r\n';
        } else {
          out += execute(args);
        }
      }
      buffer = buffer.subarray(offset);
      if (out) socket.write(out);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  const auth = options.password ? `:${encodeURIComponent(options.password)}@` : '';

  return {
    url: `redis://${auth}127.0.0.1:${port}`,
    port,
    now,
    data,
    commandLog,
    connections: () => sockets.size,
    mode,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
