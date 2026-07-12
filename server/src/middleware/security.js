export function bearerToken(header = "") {
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

export function hasVerifiedEmail(user) {
  return user?.email_verified === true;
}

export function requireVerifiedEmail(req, res, next) {
  if (!hasVerifiedEmail(req.user)) {
    return res.status(403).json({
      error: "Verify your email address before continuing.",
      code: "EMAIL_VERIFICATION_REQUIRED"
    });
  }
  return next();
}

export function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({ error: `${allowedRoles.join(" or ")} access required.` });
    }
    return next();
  };
}

export function errorResponse(error) {
  return {
    status: error?.status || 500,
    message: error?.status ? error.message : "The server could not complete the request."
  };
}
