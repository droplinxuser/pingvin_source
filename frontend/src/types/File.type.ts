export type FileUpload = File & {
  uploadingProgress: number;
  // Set for "upload from URL" entries: the backend fetches the URL after the
  // share exists, so the browser never has to reach the remote host.
  remoteUrl?: string;
};

export type FileUploadResponse = { id: string; name: string };

export type VirusTotalFileReport = {
  verdict: "clean" | "suspicious";
  malicious?: number;
  suspicious?: number;
  harmless?: number;
  undetected?: number;
  engines?: number;
  hash?: string;
  scannedAt: string;
};

export type FileMetaData = {
  id: string;
  name: string;
  size: string;
  virustotal?: VirusTotalFileReport;
};

export type FileListItem = FileUpload | (FileMetaData & { deleted?: boolean });
