// The build hash is inlined by Next (see next.config.js). Public config and
// provider responses are edge-cached, so including the build in the URL keeps
// a deployment from inheriting a stale CDN entry written by the previous one.
export const BUILD_VERSION =
  process.env.COMMIT_HASH || process.env.VERSION || "";

export function withBuildVersion(path: string): string {
  if (!BUILD_VERSION) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(BUILD_VERSION)}`;
}
