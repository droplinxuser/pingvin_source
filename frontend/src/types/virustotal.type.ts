export type VirusTotalStatus = {
  enabled: boolean;
  apiKeyConfigured: boolean;
  running: boolean;
  authFailed: boolean;
  queueBackend: "valkey" | "memory";
  queueDepth: number;
  pendingJobs: number;
  processing?: {
    stage: string;
    shareId: string;
    fileId: string;
    fileName: string;
    size: number;
    attempts: number;
    startedAt: string;
  };
  cooldownSeconds: number;
  rateLimitSeconds: number;
  lastRequestAt?: string;
  lastRequestKind?: "lookup" | "upload" | "analysis";
};

export type VirusTotalAuditStats = {
  calls: {
    lastHour: number;
    today: number;
    last24Hours: number;
    byKindLast24Hours: Record<"lookup" | "upload" | "analysis", number>;
  };
  scans: {
    queued: number;
    uploaded: number;
    clean: number;
    suspicious: number;
    malicious: number;
    removed: number;
    errors: number;
    rateLimited: number;
    authErrors: number;
    skipped: number;
    dropped: number;
  };
};

export type VirusTotalUploader = {
  anonymous: boolean;
  creator?: {
    id: string;
    username: string;
    displayName?: string;
    email: string;
  };
  reverseShareCreator?: {
    id: string;
    username: string;
    displayName?: string;
    email: string;
  };
  country?: string;
  city?: string;
  browser?: string;
  os?: string;
  deviceType?: string;
  uploadedAt?: string;
};

export type VirusTotalEventType =
  | "queued"
  | "uploaded"
  | "clean"
  | "suspicious"
  | "malicious"
  | "error"
  | "rate_limited"
  | "auth_error"
  | "skipped"
  | "dropped";

export type VirusTotalEvent = {
  id: string;
  at: string;
  type: VirusTotalEventType;
  shareId: string;
  fileId?: string;
  fileName?: string;
  size?: number;
  hash?: string;
  verdict?: "clean" | "suspicious" | "malicious";
  stats?: {
    malicious: number;
    suspicious: number;
    harmless: number;
    undetected: number;
  };
  status?: number;
  stage?: string;
  detail?: string;
  analysisId?: string;
  cached?: boolean;
  removed?: boolean;
  cooldownSeconds?: number;
  uploader?: VirusTotalUploader;
};

export type VirusTotalDashboard = {
  generatedAt: string;
  status: VirusTotalStatus;
  stats: VirusTotalAuditStats;
  events: VirusTotalEvent[];
  eventsTotal: number;
  updatedAt: string;
  storage: string;
  timezone: string;
  todayStart: string;
};
