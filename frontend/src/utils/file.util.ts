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
      .map(getNormalizedFileName),
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
