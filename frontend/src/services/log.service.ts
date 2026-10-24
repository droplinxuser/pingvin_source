import api from "./api.service";

export type ErrorLogSource = "backend" | "frontend";

export interface ErrorLogEntry {
  id: string;
  at: string;
  source: ErrorLogSource;
  level: "error" | "fatal";
  message: string;
  stack?: string;
  context?: string;
  url?: string;
  userAgent?: string;
}

export interface ErrorLogPage {
  source: ErrorLogSource;
  entries: ErrorLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  storage: "valkey" | "memory";
}

const list = async (
  source: ErrorLogSource,
  page = 1,
  pageSize = 20,
): Promise<ErrorLogPage> => {
  return (
    await api.get("admin/logs", {
      params: { source, page, pageSize },
    })
  ).data;
};

export default { list };
