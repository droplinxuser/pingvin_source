import { NextFunction, Request, Response } from "express";

const UNKNOWN_IP = "unknown";

type VisitorRequest = Request & {
  visitorKey?: string;
};

type VisitorIdentityRequest = {
  ip?: string;
  headers?: { "user-agent"?: string | string[] };
  socket?: { remoteAddress?: string };
};

/**
 * Stable rate-limit key for every request: the client IP only. The
 * User-Agent is attacker-controlled, so including it would let a script rotate
 * its own bucket and bypass every route limit. No visitor cookie is issued.
 * The throttler hashes this value before it is stored, so raw IP data never
 * reaches Valkey.
 */
export function getVisitorKey(request: VisitorIdentityRequest) {
  // req.ip honors Express trust proxy (TRUST_PROXY=true behind Angie/Cloudflare).
  const ip = request.ip || request.socket?.remoteAddress || UNKNOWN_IP;
  return `ip:${ip}`;
}

export function createVisitorIdentityMiddleware() {
  return (request: Request, _response: Response, next: NextFunction) => {
    (request as VisitorRequest).visitorKey = getVisitorKey(request);
    next();
  };
}
