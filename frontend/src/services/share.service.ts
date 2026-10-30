import { deleteCookie, setCookie } from "cookies-next/client";
import axios from "axios";
import { translateOutsideContext } from "../hooks/useTranslate.hook";
import { FileUploadResponse } from "../types/File.type";
import {
  CreateShare,
  MyReverseShare,
  MyShare,
  Share,
  TrendingCountry,
  TrendingShare,
  UpdateShare,
} from "../types/share.type";
import { generateUUID } from "../utils/crypto.util";
import { getShareFileUrl, getShareZipUrl } from "../utils/file.util";
import {
  type UploadProgressHandler,
  withUploadInactivityTimeout,
} from "../utils/upload.util";
import { withBuildVersion } from "../utils/version.util";
import api from "./api.service";

const isValidId = (id: string) => {
  return /^[a-zA-Z0-9_-]+$/.test(id);
};

const TRENDING_COUNTRIES_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedShareList = {
  at: number;
  limit: number;
  items: TrendingShare[];
};

/**
 * Small browser cache for the public listing endpoints. The same shape and
 * "keep an empty response out of the cache" rule is used by trending and the
 * newest-shares list.
 */
const cachedShareList = (
  endpoint: string,
  defaultLimit: number,
  ttlMs: number,
) => {
  let cache: CachedShareList | undefined;

  return async (limit?: number): Promise<TrendingShare[]> => {
    const requested = limit && limit > 0 ? limit : defaultLimit;
    if (cache && Date.now() - cache.at < ttlMs && cache.limit >= requested)
      return cache.items.slice(0, requested);

    const items = (await api.get(endpoint, { params: { limit: requested } }))
      .data as TrendingShare[];
    // An empty response can be a transient backend/cache miss; retry next time
    // instead of keeping the page empty for the rest of the browser session.
    cache =
      items.length > 0
        ? { at: Date.now(), limit: requested, items }
        : undefined;
    return items.slice(0, requested);
  };
};

let trendingCountriesCache:
  | { at: number; items: TrendingCountry[] }
  | undefined;

const list = async (
  page = 1,
  pageSize = 20,
  search?: string,
  sortBy?: string,
  sortDirection?: string,
): Promise<{
  shares: MyShare[];
  total: number;
  page: number;
  pageSize: number;
}> => {
  return (
    await api.get(`shares/all`, {
      params: {
        page,
        pageSize,
        search: search || undefined,
        sortBy,
        sortDirection,
      },
    })
  ).data;
};

const create = async (share: CreateShare, isReverseShare = false) => {
  if (!isReverseShare) {
    deleteCookie("reverse_share_token");
  }
  return (await api.post("shares", share)).data;
};

const completeShare = async (id: string) => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  const response = (await api.post(`shares/${id}/complete`)).data;
  deleteCookie("reverse_share_token");
  return response;
};

const revertComplete = async (id: string) => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  return (await api.delete(`shares/${id}/complete`)).data;
};

const get = async (id: string): Promise<Share> => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  const referrer =
    typeof document !== "undefined" ? document.referrer : undefined;
  let encodedReferrer: string | undefined;
  if (referrer) {
    try {
      encodedReferrer = encodeURIComponent(referrer.slice(0, 2048));
    } catch {
      // A malformed referrer must not break the share request.
    }
  }
  return (
    await api.get(`shares/${id}`, {
      headers: encodedReferrer
        ? { "x-visitor-referrer": encodedReferrer }
        : undefined,
    })
  ).data;
};

const getFromOwner = async (id: string): Promise<Share> => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  return (await api.get(`shares/${id}/from-owner`)).data;
};

const getTrending = cachedShareList(
  withBuildVersion("shares/trending"),
  12,
  60_000,
);

const getTrendingCountries = async (): Promise<TrendingCountry[]> => {
  if (
    trendingCountriesCache &&
    Date.now() - trendingCountriesCache.at < TRENDING_COUNTRIES_CACHE_TTL_MS
  ) {
    return trendingCountriesCache.items;
  }

  const items = (await api.get("shares/trending/countries"))
    .data as TrendingCountry[];
  trendingCountriesCache =
    items.length > 0 ? { at: Date.now(), items } : undefined;
  return items;
};

const getRecent = cachedShareList("shares/recent", 200, 30_000);

const getRecentFiles = cachedShareList("shares/recent-files", 200, 30_000);

const searchShares = async (
  query: string,
  limit = 200,
): Promise<TrendingShare[]> => {
  const term = query.trim();
  if (!term) return [];
  const items = (await api.get("shares/search", { params: { q: term, limit } }))
    .data as TrendingShare[];
  return items;
};

const remove = async (id: string) => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  await api.delete(`shares/${id}`);
};

const report = async (id: string, reason: string, message?: string) => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  await api.post(`shares/${id}/report`, { reason, message });
};

const update = async (id: string, share: UpdateShare): Promise<MyShare> => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  return (await api.patch(`shares/${id}`, share)).data;
};

const expire = async (id: string) => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  await api.post(`shares/${id}/expire`);
};

const getMyShares = async (): Promise<MyShare[]> => {
  return (await api.get("shares")).data;
};

const getReceivedShares = async (): Promise<any[]> => {
  return (await api.get("shares/received")).data;
};

const getShareToken = async (id: string, password?: string) => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  await api.post(`/shares/${id}/token`, { password });
};

const isShareIdAvailable = async (id: string): Promise<boolean> => {
  if (!isValidId(id)) throw new Error("Invalid Share ID");
  return (await api.get(`/shares/isShareIdAvailable/${id}`)).data.isAvailable;
};

const getFileText = async (
  shareId: string,
  fileId: string,
  signal?: AbortSignal,
): Promise<string> => {
  if (!isValidId(shareId) || !isValidId(fileId)) throw new Error("Invalid ID");
  return (
    await api.get(`shares/${shareId}/files/${fileId}`, {
      params: { download: false },
      signal,
    })
  ).data as string;
};

const downloadFile = async (
  shareId: string,
  fileId: string,
  recipientId?: string,
  fileName?: string,
) => {
  const link = document.createElement("a");
  link.href = `${window.location.origin}${getShareFileUrl(shareId, fileId, {
    download: true,
    recipientId,
  })}`;
  // The explicit attribute keeps a blocked/pending download from becoming a
  // navigation that reloads the share page or opens extra tabs.
  link.setAttribute("download", fileName || "");
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  void recordDownload(shareId, [fileId]);
};

/**
 * Download-count beacon. The bytes are usually served from the Cloudflare edge
 * (and the browser's HTTP cache), so the origin never sees most downloads. This
 * small no-store request is sent on each download click and keeps the counters
 * accurate, mirroring how share views stay accurate. It is best-effort: a
 * failure must never surface to the visitor.
 */
const recordDownload = async (shareId: string, fileIds?: string[]) => {
  if (!isValidId(shareId)) return;
  try {
    await api.post(`shares/${shareId}/download`, {
      fileIds: fileIds?.length ? fileIds : undefined,
    });
  } catch {
    // Counting is best-effort.
  }
};

/**
 * Downloads a whole share, or the given subset, as one streamed ZIP. The
 * browser follows the server's Content-Disposition filename, so no explicit
 * download name is set here.
 */
const downloadZip = async (
  shareId: string,
  recipientId?: string,
  fileIds?: string[],
) => {
  const link = document.createElement("a");
  link.href = `${window.location.origin}${getShareZipUrl(shareId, {
    recipientId,
    fileIds,
  })}`;
  link.setAttribute("download", "");
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  void recordDownload(shareId, fileIds);
};

const removeFile = async (shareId: string, fileId: string) => {
  if (!isValidId(shareId)) throw new Error("Invalid Share ID");
  await api.delete(`shares/${shareId}/files/${fileId}`);
};

const uploadFromUrl = async (
  shareId: string,
  url: string,
  name?: string,
  signal?: AbortSignal,
): Promise<{ files: FileUploadResponse[] }> => {
  if (!isValidId(shareId)) throw new Error("Invalid Share ID");
  // The backend may import more than one file (e.g. a Bunkr album page).
  return (
    await api.post(
      `shares/${shareId}/files/from-url`,
      {
        url,
        name: name || undefined,
      },
      { signal },
    )
  ).data;
};

interface S3UploadSession {
  uploadId: string;
  urls: string[];
  parts: Array<{ ETag: string; PartNumber: number }>;
  fileId: string;
}

const s3UploadSessions: Record<string, S3UploadSession> = {};
const s3UploadSupportedShares: Record<string, boolean> = {};

const uploadFileDirectS3 = async (
  shareId: string,
  chunk: Blob,
  file: { id?: string; name: string },
  chunkIndex: number,
  totalChunks: number,
  onUploadProgress?: UploadProgressHandler,
  signal?: AbortSignal,
): Promise<FileUploadResponse> => {
  const fileId = file.id || generateUUID();
  const sessionKey = `${shareId}:${file.name}`;

  try {
    if (chunkIndex === 0 && !s3UploadSessions[sessionKey]) {
      const initResponse = await api.post(
        `shares/${shareId}/files/upload-init`,
        {
          id: fileId,
          name: file.name,
          totalChunks,
        },
      );

      s3UploadSessions[sessionKey] = {
        uploadId: initResponse.data.uploadId,
        urls: initResponse.data.urls,
        parts: [],
        fileId: fileId,
      };
    }

    const session = s3UploadSessions[sessionKey];
    if (!session) {
      throw new Error(
        translateOutsideContext()(
          "upload.modal.link.error.s3-session-not-found",
        ),
      );
    }

    const url = session.urls[chunkIndex];
    const response = await withUploadInactivityTimeout(
      (signal, handleUploadProgress) =>
        axios.put(url, chunk, {
          signal,
          headers: { "Content-Type": "application/octet-stream" },
          onUploadProgress: handleUploadProgress,
        }),
      onUploadProgress,
      signal,
    );

    const etag = response.headers["etag"];
    if (!etag) {
      throw new Error(
        translateOutsideContext()("upload.modal.link.error.s3-etag-missing"),
      );
    }

    session.parts.push({
      ETag: etag,
      PartNumber: chunkIndex + 1,
    });

    if (chunkIndex === totalChunks - 1) {
      const completeResponse = await api.post(
        `shares/${shareId}/files/upload-complete`,
        {
          id: session.fileId || fileId,
          name: file.name,
          uploadId: session.uploadId,
          parts: session.parts,
        },
      );
      delete s3UploadSessions[sessionKey];
      return completeResponse.data;
    }

    return {
      id: session.fileId || fileId,
      name: file.name,
    } as FileUploadResponse;
  } catch (error) {
    const session = s3UploadSessions[sessionKey];
    if (session) {
      try {
        await api.post(`shares/${shareId}/files/upload-abort`, {
          name: file.name,
          uploadId: session.uploadId,
        });
      } catch {
        // The original upload error is reported to the caller; a failed abort
        // is a best-effort cleanup and must not add console noise.
      }
      delete s3UploadSessions[sessionKey];
    }
    throw error;
  }
};

const uploadFileProxied = async (
  shareId: string,
  chunk: Blob,
  file: { id?: string; name: string },
  chunkIndex: number,
  totalChunks: number,
  onUploadProgress?: UploadProgressHandler,
  signal?: AbortSignal,
): Promise<FileUploadResponse> => {
  const response = await withUploadInactivityTimeout(
    (signal, handleUploadProgress) =>
      api.post(`shares/${shareId}/files`, chunk, {
        signal,
        headers: { "Content-Type": "application/octet-stream" },
        params: {
          id: file.id,
          name: file.name,
          chunkIndex,
          totalChunks,
        },
        onUploadProgress: handleUploadProgress,
      }),
    onUploadProgress,
    signal,
  );
  return response.data;
};

const uploadFile = async (
  shareId: string,
  chunk: Blob,
  file: {
    id?: string;
    name: string;
  },
  chunkIndex: number,
  totalChunks: number,
  onUploadProgress?: UploadProgressHandler,
  signal?: AbortSignal,
): Promise<FileUploadResponse> => {
  if (!isValidId(shareId))
    throw new Error(
      translateOutsideContext()("upload.modal.link.error.invalid"),
    );

  const fileId = file.id || generateUUID();
  const fileWithId = { ...file, id: fileId };
  const sessionKey = `${shareId}:${file.name}`;

  if (s3UploadSessions[sessionKey]) {
    return uploadFileDirectS3(
      shareId,
      chunk,
      fileWithId,
      chunkIndex,
      totalChunks,
      onUploadProgress,
      signal,
    );
  }

  if (s3UploadSupportedShares[shareId] === false) {
    return uploadFileProxied(
      shareId,
      chunk,
      fileWithId,
      chunkIndex,
      totalChunks,
      onUploadProgress,
      signal,
    );
  }

  if (chunkIndex === 0) {
    try {
      const initResponse = await api.post(
        `shares/${shareId}/files/upload-init`,
        {
          id: fileWithId.id,
          name: fileWithId.name,
          totalChunks,
        },
      );

      if (initResponse.data && initResponse.data.directToS3) {
        s3UploadSupportedShares[shareId] = true;
        s3UploadSessions[sessionKey] = {
          uploadId: initResponse.data.uploadId,
          urls: initResponse.data.urls,
          parts: [],
          fileId: fileWithId.id,
        };
        return uploadFileDirectS3(
          shareId,
          chunk,
          fileWithId,
          chunkIndex,
          totalChunks,
          onUploadProgress,
          signal,
        );
      } else {
        s3UploadSupportedShares[shareId] = false;
      }
    } catch {
      // Direct multipart upload is optional. Fall back to the proxied upload
      // without logging a handled failure to the browser console.
      s3UploadSupportedShares[shareId] = false;
    }
  }

  return uploadFileProxied(
    shareId,
    chunk,
    fileWithId,
    chunkIndex,
    totalChunks,
    onUploadProgress,
    signal,
  );
};

const isReverseShareTokenAvailable = async (
  token: string,
): Promise<boolean> => {
  if (!isValidId(token))
    throw new Error(
      translateOutsideContext()("upload.modal.link.error.invalid"),
    );
  return (await api.get(`/reverseShares/isReverseShareTokenAvailable/${token}`))
    .data.isAvailable;
};

const createReverseShare = async (
  maxShareSize: number,
  maxUseCount: number,
  sendEmailNotification: boolean,
  simplified: boolean,
  publicAccess: boolean,
  token?: string,
) => {
  return (
    await api.post("reverseShares", {
      maxShareSize: maxShareSize.toString(),
      maxUseCount,
      sendEmailNotification,
      simplified,
      publicAccess,
      token,
    })
  ).data;
};

const getMyReverseShares = async (): Promise<MyReverseShare[]> => {
  return (await api.get("reverseShares")).data;
};

const setReverseShare = async (reverseShareToken: string) => {
  if (!isValidId(reverseShareToken))
    throw new Error(
      translateOutsideContext()("upload.modal.link.error.invalid"),
    );
  const { data } = await api.get(`/reverseShares/${reverseShareToken}`);
  setCookie("reverse_share_token", reverseShareToken);
  return data;
};

const removeReverseShare = async (id: string) => {
  if (!isValidId(id)) throw new Error("Invalid ID");
  await api.delete(`/reverseShares/${id}`);
};

export default {
  list,
  create,
  completeShare,
  revertComplete,
  getShareToken,
  get,
  getFromOwner,
  update,
  remove,
  report,
  expire,
  getTrending,
  getTrendingCountries,
  getRecent,
  getRecentFiles,
  searchShares,
  getMyShares,
  getReceivedShares,
  isShareIdAvailable,
  isReverseShareTokenAvailable,
  getFileText,
  downloadFile,
  downloadZip,
  removeFile,
  uploadFile,
  uploadFromUrl,
  setReverseShare,
  createReverseShare,
  getMyReverseShares,
  removeReverseShare,
};
