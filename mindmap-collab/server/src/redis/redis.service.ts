import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis 用途：
 * 1. 在线状态：presence:doc:{documentId} 集合保存当前在线用户
 * 2. Pub/Sub：presence-events 频道广播上下线事件（多实例部署时各实例可订阅转发）
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  public client: Redis;
  public publisher: Redis;
  public subscriber: Redis;

  onModuleInit() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = new Redis(url);
    this.publisher = new Redis(url);
    this.subscriber = new Redis(url);
  }

  onModuleDestroy() {
    this.client?.disconnect();
    this.publisher?.disconnect();
    this.subscriber?.disconnect();
  }

  private presenceKey(documentId: string) {
    return `presence:doc:${documentId}`;
  }

  async addPresence(
    documentId: string,
    user: { id: string; name: string; color?: string },
  ) {
    await this.client.sadd(this.presenceKey(documentId), JSON.stringify(user));
    await this.client.expire(this.presenceKey(documentId), 60 * 60 * 24);
    await this.publisher.publish(
      'presence-events',
      JSON.stringify({ type: 'join', documentId, user }),
    );
  }

  async removePresence(documentId: string, userId: string) {
    const members = await this.client.smembers(this.presenceKey(documentId));
    for (const m of members) {
      try {
        if (JSON.parse(m).id === userId) {
          await this.client.srem(this.presenceKey(documentId), m);
        }
      } catch {
        /* ignore malformed entries */
      }
    }
    await this.publisher.publish(
      'presence-events',
      JSON.stringify({ type: 'leave', documentId, userId }),
    );
  }

  async getPresence(
    documentId: string,
  ): Promise<Array<{ id: string; name: string; color?: string }>> {
    const members = await this.client.smembers(this.presenceKey(documentId));
    return members
      .map((m) => {
        try {
          return JSON.parse(m);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  /* ---------- 分布式锁（合并锁等多实例互斥） ---------- */

  /** 尝试获取锁，成功返回 token，失败返回 null */
  async acquireLock(key: string, ttlMs = 30000): Promise<string | null> {
    const token = `${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const ok = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? token : null;
  }

  /** 仅当持锁者是自己时释放（Lua 保证原子性） */
  async releaseLock(key: string, token: string) {
    await this.client.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("del", KEYS[1])
       else
         return 0
       end`,
      1,
      key,
      token,
    );
  }

  /** 带过期时间的幂等标记：首次设置返回 true */
  async markOnce(key: string, ttlMs = 10 * 60 * 1000): Promise<boolean> {
    const ok = await this.client.set(key, '1', 'PX', ttlMs, 'NX');
    return ok === 'OK';
  }

  /* ---------- 失效通知（多实例事件广播） ---------- */

  async publishEvent(channel: string, event: Record<string, unknown>) {
    await this.publisher.publish(channel, JSON.stringify(event));
  }

  subscribe(channel: string, handler: (event: any) => void) {
    this.subscriber.subscribe(channel).catch(() => {});
    this.subscriber.on('message', (ch: string, message: string) => {
      if (ch !== channel) return;
      try {
        handler(JSON.parse(message));
      } catch {
        /* ignore malformed events */
      }
    });
  }
}
