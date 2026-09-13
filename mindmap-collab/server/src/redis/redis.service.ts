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
}
