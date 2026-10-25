import { ShareComment, ShareCommentPage } from "../types/share.type";
import api from "./api.service";

export const COMMENTS_PAGE_SIZE = 20;

const isValidId = (id: string) => /^[a-zA-Z0-9_-]+$/.test(id);

const list = async (
  shareId: string,
  page = 1,
  version = 0,
): Promise<ShareCommentPage> => {
  if (!isValidId(shareId)) throw new Error("Invalid ID");
  return (
    await api.get(`shares/${shareId}/comments`, {
      // The version is part of the URL so a new comment always bypasses the
      // Cloudflare edge copy while unchanged pages stay cached.
      params: { page, pageSize: COMMENTS_PAGE_SIZE, v: version },
    })
  ).data;
};

const create = async (
  shareId: string,
  content: string,
): Promise<{ comment: ShareComment; version: number; total: number }> => {
  if (!isValidId(shareId)) throw new Error("Invalid ID");
  return (await api.post(`shares/${shareId}/comments`, { content })).data;
};

export default { list, create };
