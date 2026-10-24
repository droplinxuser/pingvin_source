export type ValkeyMetrics = {
  configured: boolean;
  connected: boolean;
  version: string | null;
  uptimeSeconds: number | null;
  memoryUsedBytes: number | null;
  memoryPeakBytes: number | null;
  totalKeys: number | null;
  hits: number | null;
  misses: number | null;
  hitRatio: number | null;
  connectedClients: number | null;
};

const EMPTY_METRICS: Omit<ValkeyMetrics, "configured" | "connected"> = {
  version: null,
  uptimeSeconds: null,
  memoryUsedBytes: null,
  memoryPeakBytes: null,
  totalKeys: null,
  hits: null,
  misses: null,
  hitRatio: null,
  connectedClients: null,
};

export function emptyValkeyMetrics(configured: boolean): ValkeyMetrics {
  return { configured, connected: false, ...EMPTY_METRICS };
}

/**
 * Parses the fields used by the admin dashboard from a Valkey/Redis INFO
 * response. A single INFO command is the only request needed.
 */
export function parseValkeyInfo(info: string): ValkeyMetrics {
  const fields = new Map<string, string>();
  for (const line of info.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }

  const number = (key: string): number | null => {
    const value = Number(fields.get(key));
    return fields.has(key) && Number.isFinite(value) ? value : null;
  };

  let totalKeys = 0;
  for (const [key, value] of fields) {
    if (!/^db\d+$/.test(key)) continue;
    const match = /(?:^|,)keys=(\d+)/.exec(value);
    if (match) totalKeys += Number(match[1]);
  }

  const hits = number("keyspace_hits");
  const misses = number("keyspace_misses");
  const hitRatio =
    hits !== null && misses !== null && hits + misses > 0
      ? hits / (hits + misses)
      : null;

  return {
    configured: true,
    connected: true,
    version:
      fields.get("valkey_version") ?? fields.get("redis_version") ?? null,
    uptimeSeconds: number("uptime_in_seconds"),
    memoryUsedBytes: number("used_memory"),
    memoryPeakBytes: number("used_memory_peak"),
    totalKeys,
    hits,
    misses,
    hitRatio,
    connectedClients: number("connected_clients"),
  };
}
