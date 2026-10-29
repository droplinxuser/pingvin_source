export type FileUpload = File & {
  uploadingProgress: number;
  // Set for known hosts (file hosts and allowlisted media platforms) that
  // cannot be read cross-origin: the backend resolves or extracts them. Every
  // other URL is fetched by the visitor's browser before upload, so the server
  // IP is never exposed to the remote host.
  remoteUrl?: string;
  remoteViaServer?: boolean;
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
