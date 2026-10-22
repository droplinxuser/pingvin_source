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
  pageViewsLastHour: number;
  topCountriesLastHour: CountryCount[];
}

const getSystemInfo = async (): Promise<SystemInfo | null> => {
  return (await api.get("system/info")).data;
};

const getSystemStats = async (): Promise<SystemStats> => {
  return (await api.get("system/stats")).data;
};

const recordPageView = async (): Promise<SystemStats> => {
  return (await api.post("system/pageview")).data;
};

export default { getSystemInfo, getSystemStats, recordPageView };
