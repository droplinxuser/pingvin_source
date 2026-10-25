import User from "./user.type";

export type Share = {
  id: string;
  name?: string;
  files: any;
  creator?: User;
  description?: string;
  createdAt: Date;
  expiration: Date;
  views: number;
  size: number;
  hasPassword: boolean;
  maxViews?: number;
  isZipReady?: boolean;
  uploaderInfo?: UploaderInfo;
  commentsVersion?: number;
};

export type ShareComment = {
  id: string;
  userId: string;
  username: string;
  displayName?: string;
  content: string;
  createdAt: string;
};

export type ShareCommentPage = {
  comments: ShareComment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  version: number;
};

export type ShareVisitor = {
  country?: string;
  city?: string;
  os?: string;
  browser?: string;
  referrer?: string;
  createdAt: string;
};

export type UploaderInfo = {
  country?: string;
  city?: string;
  region?: string;
  timezone?: string;
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  deviceType?: string;
  createdAt: string;
  visitors?: ShareVisitor[];
};

export type CompletedShare = Share & {
  /**
   * undefined means is not reverse share
   * true means server was send email to reverse share creator
   * false means server was not send email to reverse share creator
   * */
  notifyReverseShareCreator: boolean | undefined;
};

export type CreateShare = {
  id: string;
  name?: string;
  description?: string;
  recipients: string[];
  security: ShareSecurity;
  size?: number;
};

export type UpdateShare = {
  name?: string | null;
  description?: string | null;
  security?: {
    password?: string;
    removePassword?: boolean;
    maxViews?: number | null;
  };
};

export type ShareSeo = {
  indexable: boolean;
  id: string;
  name?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  fileCount?: number;
  size?: number;
  files?: { name: string }[];
};

export type TrendingShare = {
  id: string;
  name?: string;
  description?: string;
  views: number;
  previewFileId: string;
  previewKind: "image" | "video";
  fileCount?: number;
  size?: number;
  createdAt: string;
};

export type TrendingCountry = {
  country: string;
  views: number;
  shares: TrendingShare[];
};

export type MyShare = Omit<Share, "hasPassword"> & {
  createdAt: Date;
  recipients: string[];
  security: MyShareSecurity;
};

export type MyReverseShare = {
  id: string;
  maxShareSize: string;
  shareExpiration: Date;
  remainingUses: number;
  token: string;
  shares: MyShare[];
};

export type ShareSecurity = {
  maxViews?: number;
  password?: string;
  restrictToRecipients?: boolean;
};

export type MyShareSecurity = {
  passwordProtected: boolean;
  maxViews?: number;
  restrictToRecipients: boolean;
};
