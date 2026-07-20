export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    if (code) this.code = code;
    if (details) this.details = details;
  }
}
