export type StatCountry = {
  country: string;
  count: number;
};

export type StatName = {
  name: string;
  count: number;
};

export type StatShare = {
  id: string;
  name?: string;
  fileCount: number;
  createdAt: string;
  views?: number;
  downloads?: number;
};

export type SiteStats = {
  totals: {
    userCount: number;
    shareCount: number;
    fileCount: number;
    storageSizeBytes: number;
    pageViews: number;
    shareViews: number;
    downloads: number;
  };
  pageViewsLastDay: number;
  topCountries: StatCountry[];
  topOperatingSystems: StatName[];
  topBrowsers: StatName[];
  mostViewed: StatShare[];
  mostDownloaded: StatShare[];
};
