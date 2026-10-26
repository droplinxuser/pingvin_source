import { fromEvent } from "file-selector";
import { traverseDirectory } from "./folder.util";

export const getNormalizedFileName = (file: {
  name: string;
  webkitRelativePath?: string;
}): string => {
  const pathName = file.webkitRelativePath || file.name;
  return pathName.replace(/\\/g, "/").replace(/^\//, "");
};

export const splitFileName = (pathName: string) => {
  const normalized = pathName.replace(/\\/g, "/").replace(/^\//, "");
  const separator = normalized.lastIndexOf("/");

  return separator === -1
    ? { folderPath: "", baseName: normalized }
    : {
        folderPath: normalized.slice(0, separator),
        baseName: normalized.slice(separator + 1) || normalized,
      };
};

export const getBaseName = (pathName: string): string =>
  splitFileName(pathName).baseName;

export const getShareThumbnailUrl = (
  shareId: string,
  version?: string | number,
): string => {
  const query = version ? `?v=${encodeURIComponent(String(version))}` : "";
  return `/api/shares/${shareId}/thumbnail${query}`;
};

/**
 * Listing cards fall back to the site logo once, then hide a preview that is
 * still unavailable. Shared by every listing surface so a missing thumbnail
 * never shows the browser's broken-image icon or retries in a loop.
 */
export const handleShareThumbnailError = (event: {
  currentTarget: HTMLImageElement;
}) => {
  const image = event.currentTarget;
  if (image.dataset.fallback === "1") {
    image.style.display = "none";
    return;
  }
  image.dataset.fallback = "1";
  image.src = "/img/logo.webp";
};

export const getShareFileUrl = (
  shareId: string,
  fileId: string,
  options: {
    download?: boolean;
    webp?: boolean;
    recipientId?: string;
  } = {},
): string => {
  const params = new URLSearchParams();
  if (options.download === false) params.set("download", "false");
  // The value is versioned so old 1600px CDN/browser caches are bypassed.
  if (options.webp && options.download !== true) params.set("webp", "300");
  if (options.recipientId) params.set("recipient", options.recipientId);

  const query = params.toString();
  return `/api/shares/${shareId}/files/${fileId}${query ? `?${query}` : ""}`;
};

export const filterDuplicateFiles = <T extends File>(
  newFiles: T[],
  existingFilesList: Array<{
    name: string;
    webkitRelativePath?: string;
    deleted?: boolean;
  }>,
  onDuplicateDetected: (name: string) => void,
): T[] => {
  const existingNames = new Set(
    existingFilesList
      .filter((file) => !file.deleted)
      .map((file) => {
        const pathName = file.webkitRelativePath || file.name;
        return pathName.replace(/\\/g, "/").replace(/^\//, "");
      }),
  );

  const filtered: T[] = [];
  const seenInBatch = new Set<string>();

  for (const file of newFiles) {
    const normalizedName = getNormalizedFileName(file);
    if (existingNames.has(normalizedName) || seenInBatch.has(normalizedName)) {
      onDuplicateDetected(normalizedName);
    } else {
      seenInBatch.add(normalizedName);
      filtered.push(file);
    }
  }
  return filtered;
};

export const validateAndFilterFiles = <T extends File>(
  newFiles: T[],
  existingFilesList: Array<{
    name: string;
    webkitRelativePath?: string;
    deleted?: boolean;
    size: number | string;
  }>,
  maxShareSize: number,
  onDuplicateDetected: (name: string) => void,
  onSizeExceeded: () => void,
): T[] => {
  const filtered = filterDuplicateFiles(
    newFiles,
    existingFilesList,
    onDuplicateDetected,
  );
  if (filtered.length === 0) return [];

  const newFilesSize = filtered.reduce((n, { size }) => n + size, 0);
  const baseSize = existingFilesList
    .filter((file) => !file.deleted)
    .reduce((acc, file) => acc + Number(file.size), 0);

  if (newFilesSize + baseSize > maxShareSize) {
    onSizeExceeded();
    return [];
  }

  return filtered;
};

export const getFilesFromEvent = async (event: any): Promise<any[]> => {
  if (Array.isArray(event)) {
    const filePromises = event.map(async (item: any) => {
      if (item && typeof item.getFile === "function") {
        return await item.getFile();
      }
      return item;
    });
    return await Promise.all(filePromises);
  }

  if (event?.dataTransfer || event?.clipboardData) {
    const items = event.dataTransfer?.items || event.clipboardData?.items;
    if (!items) return [];

    const filePromises: Promise<File[]>[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          filePromises.push(traverseDirectory(entry));
        } else {
          const file = item.getAsFile();
          if (file) {
            filePromises.push(Promise.resolve([file]));
          }
        }
      }
    }
    const fileArrays = await Promise.all(filePromises);
    return fileArrays.flat();
  }

  if (event?.target?.files) {
    return Array.from(event.target.files) as File[];
  }

  return await fromEvent(event);
};
