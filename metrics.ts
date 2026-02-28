/**
 * monitoring/metrics.ts — Singleton metrics registry
 * Drop-in replacement/extension of existing metrics.ts
 */
import { EventEmitter } from 'events';

interface Threshold {
  metric: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte';
  value: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  cooldownMs: number;
}

class MetricsRegistry extends EventEmitter {
  private gauges     = new Map<string, number>();
  private counters   = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private lastAlert  = new Map<string, number>();

  private readonly THRESHOLDS: Threshold[] = [
    { metric: 'http.error_rate',               operator: 'gt', value: 0.03,       severity: 'HIGH',     cooldownMs: 60_000 },
    { metric: 'http.p95_latency_ms',           operator: 'gt', value: 500,        severity: 'HIGH',     cooldownMs: 60_000 },
    { metric: 'db.active_connections',         operator: 'gt', value: 18,         severity: 'HIGH',     cooldownMs: 120_000 },
    { metric: 'db.healthy',                    operator: 'lt', value: 1,          severity: 'CRITICAL', cooldownMs: 30_000 },
    { metric: 'db.connection_saturation_pct',  operator: 'gt', value: 85,         severity: 'HIGH',     cooldownMs: 120_000 },
    { metric: 'system.health_score',           operator: 'lt', value: 50,         severity: 'HIGH',     cooldownMs: 300_000 },
    { metric: 'system.safe_mode',              operator: 'gt', value: 0,          severity: 'CRITICAL', cooldownMs: 300_000 },
    { metric: 'perf.overload_score',           operator: 'gt', value: 70,         severity: 'HIGH',     cooldownMs: 300_000 },
    { metric: 'security.auto_blocks',          operator: 'gt', value: 10,         severity: 'HIGH',     cooldownMs: 300_000 },
    { metric: 'process.heap_mb',               operator: 'gt', value: 1024,       severity: 'MEDIUM',   cooldownMs: 600_000 },
  ];

  gauge(name: string, value: number, tags: Record<string, string> = {}): void {
    this.gauges.set(name, value);
    this.emit('metric', { name, value, tags, timestamp: Date.now() });
    this.checkThresholds(name, value);
  }

  increment(name: string, by = 1, tags: Record<string, string> = {}): void {
    const next = (this.counters.get(name) ?? 0) + by;
    this.counters.set(name, next);
    this.emit('metric', { name, value: next, tags, timestamp: Date.now() });
  }

  histogram(name: string, value: number, tags: Record<string, string> = {}): void {
    const arr = this.histograms.get(name) ?? [];
    arr.push(value);
    if (arr.length > 2000) arr.shift();
    this.histograms.set(name, arr);
    this.emit('metric', { name, value, tags, timestamp: Date.now() });
  }

  getGauge(name: string): number   { return this.gauges.get(name) ?? 0; }
  getCounter(name: string): number { return this.counters.get(name) ?? 0; }

  getPercentile(name: string, p: number): number {
    const arr = [...(this.histograms.get(name) ?? [])].sort((a, b) => a - b);
    if (arr.length === 0) return 0;
    const idx = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, idx)];
  }

  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.gauges)   out[k] = v;
    for (const [k, v] of this.counters) out[`${k}_total`] = v;
    for (const [k] of this.histograms) {
      out[`${k}_p50`] = this.getPercentile(k, 50);
      out[`${k}_p95`] = this.getPercentile(k, 95);
      out[`${k}_p99`] = this.getPercentile(k, 99);
    }
    return out;
  }

  prometheusExport(): string {
    const lines: string[] = [];
    for (const [k, v] of this.gauges) {
      const s = k.replace(/[.\-]/g, '_');
      lines.push(`# TYPE ${s} gauge\n${s} ${v}`);
    }
    for (const [k, v] of this.counters) {
      const s = `${k.replace(/[.\-]/g, '_')}_total`;
      lines.push(`# TYPE ${s} counter\n${s} ${v}`);
    }
    for (const [k] of this.histograms) {
      const s = k.replace(/[.\-]/g, '_');
      lines.push(`# TYPE ${s} summary`);
      lines.push(`${s}{quantile="0.5"} ${this.getPercentile(k, 50)}`);
      lines.push(`${s}{quantile="0.95"} ${this.getPercentile(k, 95)}`);
      lines.push(`${s}{quantile="0.99"} ${this.getPercentile(k, 99)}`);
    }
    return lines.join('\n');
  }

  private checkThresholds(name: string, value: number): void {
    for (const t of this.THRESHOLDS) {
      if (t.metric !== name) continue;
      const breached =
        t.operator === 'gt'  ? value >  t.value :
        t.operator === 'lt'  ? value <  t.value :
        t.operator === 'gte' ? value >= t.value :
                               value <= t.value;

      if (breached) {
        const last = this.lastAlert.get(t.metric) ?? 0;
        if (Date.now() - last > t.cooldownMs) {
          this.lastAlert.set(t.metric, Date.now());
          this.emit('threshold_breach', { ...t, actualValue: value });
        }
      }
    }
  }
}

export const metrics = new MetricsRegistry();

export function bindMetricAlerts(emitter: NodeJS.EventEmitter): void {
  emitter.on('threshold_breach', (event: any) => {
    // Import lazily to avoid circular
    const { alertWebhook } = require('./alerts');
    alertWebhook({
      severity:    event.severity,
      title:       `Metric Threshold: ${event.metric}`,
      body:        `${event.metric} = ${event.actualValue} (threshold: ${event.operator} ${event.value})`,
      metric:      event.metric,
      actualValue: event.actualValue,
      threshold:   event.value,
    });
  });
}
