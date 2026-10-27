export type AvatarUser = {
  id?: string | null;
  username?: string | null;
  displayName?: string | null;
  avatarUpdatedAt?: string | Date | null;
};

/**
 * Same-origin versioned avatar URL. The timestamp changes on every upload or
 * removal, so the browser/CDN can keep the old URL immutable and still show
 * the new picture immediately.
 */
export const getUserAvatarUrl = (
  user?: AvatarUser | null,
): string | undefined => {
  if (!user?.id || !user.avatarUpdatedAt) return undefined;
  const version = new Date(user.avatarUpdatedAt).getTime();
  if (!Number.isFinite(version)) return undefined;
  return `/api/users/${encodeURIComponent(user.id)}/avatar.webp?v=${version}`;
};

export const getUserInitials = (user?: AvatarUser | null): string => {
  const name = (user?.displayName?.trim() || user?.username || "").trim();
  return name.charAt(0).toUpperCase() || "?";
};
