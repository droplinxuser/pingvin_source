import { NextFunction, Request, Response } from "express";

const UNKNOWN_IP = "unknown";
const UNKNOWN_USER_AGENT = "unknown";

type VisitorRequest = Request & {
  visitorKey?: string;
};

type VisitorIdentityRequest = {
  ip?: string;
  headers?: { "user-agent"?: string | string[] };
  socket?: { remoteAddress?: string };
};

/**
 * Stable rate-limit key for every request: client IP plus the browser's
 * User-Agent. No visitor cookie is issued. The throttler hashes this value
 * before it is stored, so raw IP/User-Agent data never reaches Valkey.
 */
export function getVisitorKey(request: VisitorIdentityRequest) {
  const header = request.headers?.["user-agent"];
  const userAgent = (Array.isArray(header) ? header[0] : header)?.trim();
  // req.ip honors Express trust proxy (TRUST_PROXY=true behind Angie/Cloudflare).
  const ip = request.ip || request.socket?.remoteAddress || UNKNOWN_IP;

  return `ipua:${ip}\n${userAgent || UNKNOWN_USER_AGENT}`;
}

export function createVisitorIdentityMiddleware() {
  return (request: Request, _response: Response, next: NextFunction) => {
    (request as VisitorRequest).visitorKey = getVisitorKey(request);
    next();
  };
}
