import { HttpError } from "../domain/errors.js";

function validationError(source, issues) {
  return new HttpError(400, `Invalid ${source}.`, {
    code: "VALIDATION_ERROR",
    details: issues.slice(0, 8).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }))
  });
}

function validate(schema, source) {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(validationError(source, result.error.issues));
    if (source === "query") req.validatedQuery = result.data;
    else req[source] = result.data;
    return next();
  };
}

export const validateBody = (schema) => validate(schema, "body");
export const validateParams = (schema) => validate(schema, "params");
export const validateQuery = (schema) => validate(schema, "query");
