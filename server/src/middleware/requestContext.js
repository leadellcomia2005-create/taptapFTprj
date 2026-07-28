import { randomUUID } from "node:crypto";

const requestIdPattern = /^[A-Za-z0-9._-]{8,128}$/;

export function requestContext(logger, metrics) {
  return (req, res, next) => {
    const supplied = String(req.headers["x-request-id"] || "").trim();
    const requestId = requestIdPattern.test(supplied) ? supplied : randomUUID();
    const startedAt = Date.now();
    req.context = { requestId, startedAt };
    res.setHeader("X-Request-ID", requestId);
    res.once("finish", () => {
      const details = {
        requestId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        userId: req.user?.uid || null,
        role: req.user?.role || null
      };
      metrics?.observeRequest(details);
      if (res.statusCode >= 500) logger.error("http_request_completed", details);
      else if (res.statusCode >= 400) logger.warn("http_request_completed", details);
      else logger.info("http_request_completed", details);
    });
    next();
  };
}
