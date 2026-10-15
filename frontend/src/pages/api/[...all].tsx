import { NextApiRequest, NextApiResponse } from "next";
import httpProxyMiddleware from "next-http-proxy-middleware";

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

const apiURL = process.env.API_URL || "http://localhost:8080";

// A proxy to the API server only used in development.
// In production this route gets overridden by Caddy.
export default (req: NextApiRequest, res: NextApiResponse) => {
  httpProxyMiddleware(req, res, {
    headers: {
      // Forward the visitor's real IP chain instead of overwriting it with the
      // local socket address, so the backend rate limiter sees real client IPs
      "X-Forwarded-For":
        (req.headers["x-forwarded-for"] as string) ||
        req.socket?.remoteAddress ||
        "",
    },
    target: apiURL,
  });
};
