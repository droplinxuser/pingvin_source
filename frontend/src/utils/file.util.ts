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
