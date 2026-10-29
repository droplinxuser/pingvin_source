import api from "./api.service";

export interface SystemInfo {
  used: number;
  total: number;
}

export interface CountryCount {
  country: string;
  count: number;
}

export interface SystemStats {
  userCount: number;
  shareCount: number;
  fileCount: number;
  storageSizeBytes: number;
  pageViewsLastDay: number;
  topCountriesLastDay: CountryCount[];
}

export interface ValkeyMetrics {
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
}

export interface ReferrerEntry {
  domain: string;
  views: number;
}

export interface ReferrerPage {
  referrers: ReferrerEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DependencyCheck {
  key: string;
  type: "required" | "optional";
  available: boolean;
  enabled?: boolean;
  version?: string;
  detail?: string;
}

export interface DatabaseMetrics {
  configured: boolean;
  file: string | null;
  sizeBytes: number | null;
  walSizeBytes: number | null;
  shmSizeBytes: number | null;
  pageSize: number | null;
  pageCount: number | null;
  freePages: number | null;
  fragmentation: number | null;
  journalMode: string | null;
  version: string | null;
  detail?: string;
}

const getSystemInfo = async (): Promise<SystemInfo | null> => {
  return (await api.get("system/info")).data;
};

const getSystemStats = async (): Promise<SystemStats> => {
  return (await api.get("system/stats")).data;
};

const getValkeyMetrics = async (): Promise<ValkeyMetrics> => {
  return (await api.get("system/valkey")).data;
};

const getDependencies = async (): Promise<DependencyCheck[]> => {
  return (await api.get("system/dependencies")).data;
};

const getDatabaseMetrics = async (): Promise<DatabaseMetrics> => {
  return (await api.get("system/database")).data;
};

const recordPageView = async (): Promise<SystemStats> => {
  return (await api.post("system/pageview")).data;
};

const getReferrers = async (
  page = 1,
  pageSize = 50,
): Promise<ReferrerPage> => {
  return (
    await api.get("system/referrers", { params: { page, pageSize } })
  ).data;
};

export default {
  getSystemInfo,
  getSystemStats,
  getValkeyMetrics,
  getDependencies,
  getDatabaseMetrics,
  recordPageView,
  getReferrers,
};
