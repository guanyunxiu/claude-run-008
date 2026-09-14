import { Injectable } from '@nestjs/common';

/**
 * 基础指标（进程内）：
 * - updates: Yjs 更新总数
 * - persistLatencyMs: 变更 → 落库延迟（滑动窗口均值）
 * - conflicts: 合并冲突总数
 * - errors: 5xx 错误与 WS 鉴权失败总数
 * 连接数由 CollaborationService 实时读取 hocuspocus。
 */
@Injectable()
export class MetricsService {
  updates = 0;
  conflicts = 0;
  errors = 0;
  wsAuthFailures = 0;
  private latencies: number[] = [];
  private readonly window = 200;

  recordUpdate() {
    this.updates += 1;
  }

  recordPersistLatency(ms: number) {
    this.latencies.push(ms);
    if (this.latencies.length > this.window) this.latencies.shift();
  }

  recordConflicts(n: number) {
    this.conflicts += n;
  }

  recordError() {
    this.errors += 1;
  }

  recordWsAuthFailure() {
    this.wsAuthFailures += 1;
  }

  snapshot(connections: number, documents: number) {
    const avg =
      this.latencies.length > 0
        ? Math.round(
            this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length,
          )
        : 0;
    return {
      connections,
      documents,
      updates: this.updates,
      syncLatencyMs: { avg: avg, samples: this.latencies.length },
      conflicts: this.conflicts,
      errors: this.errors,
      wsAuthFailures: this.wsAuthFailures,
      uptime: Math.round(process.uptime()),
    };
  }
}
