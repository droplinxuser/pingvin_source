export type FileUpload = File & {
  uploadingProgress: number;
  // Set for "upload from URL" entries: the backend fetches the URL after the
  // share exists, so the browser never has to reach the remote host.
  remoteUrl?: string;
};

export type FileUploadResponse = { id: string; name: string };

export type FileMetaData = {
  id: string;
  name: string;
  size: string;
};

export type FileListItem = FileUpload | (FileMetaData & { deleted?: boolean });
