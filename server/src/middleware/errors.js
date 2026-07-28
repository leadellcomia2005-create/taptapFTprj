import { errorResponse } from "../security.js";

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: "API route not found.",
    code: "NOT_FOUND",
    requestId: req.context?.requestId || null
  });
}

export function createErrorHandler(logger, metrics) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const response = errorResponse(error);
    if (response.status === 409 && /stock|inventory|oversell|available/i.test(String(error?.message || ""))) {
      metrics?.increment("stockConflicts");
    }
    const publicError = response.status < 500;
    if (response.status >= 500) {
      logger.error("http_request_failed", {
        requestId: req.context?.requestId || null,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        errorName: error?.name || "Error",
        errorCode: error?.code || "INTERNAL_ERROR"
      });
    }
    return res.status(response.status).json({
      error: response.message,
      code: publicError ? error?.code || "REQUEST_FAILED" : "INTERNAL_ERROR",
      ...(publicError && error?.details ? { details: error.details } : {}),
      requestId: req.context?.requestId || null
    });
  };
}
