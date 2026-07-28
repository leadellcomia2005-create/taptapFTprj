import { HttpError, validRecordId } from "../security.js";
import { createFirebaseRepository } from "../repositories/firebaseRepository.js";

const collections = Object.freeze({
  "audit-logs": {
    path: "auditLogs",
    roles: ["owner"],
    orderBy: "createdAt"
  },
  reports: {
    path: "reportAggregates/daily",
    roles: ["owner"],
    orderBy: "key"
  },
  complaints: {
    path: "complaints",
    roles: ["owner", "staff", "customer"],
    orderBy: "createdAt",
    userField: "customerId",
    userRoles: ["customer"]
  },
  reviews: {
    path: "reviews",
    roles: ["owner", "staff", "customer"],
    orderBy: "createdAt",
    userField: "customerId",
    userRoles: ["customer"]
  },
  notifications: {
    path: "notifications",
    roles: ["owner", "staff", "rider", "customer"],
    orderBy: "createdAt",
    userField: "targetUserId",
    userRoles: ["owner", "staff", "rider", "customer"]
  },
  "shift-logs": {
    path: "shiftLogs",
    roles: ["owner", "staff"],
    orderBy: "createdAt",
    userField: "staffId",
    userRoles: ["staff"]
  }
});

function encodeCursor(value, id) {
  return Buffer.from(JSON.stringify({ value, id }), "utf8").toString("base64url");
}

function decodeCursor(token) {
  if (!token) return null;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!validRecordId(parsed?.id)) throw new Error("invalid ID");
    if (!Number.isFinite(parsed?.value) && typeof parsed?.value !== "string") throw new Error("invalid value");
    return { value: parsed.value, id: parsed.id };
  } catch {
    throw new HttpError(400, "Invalid history cursor.", { code: "INVALID_HISTORY_CURSOR" });
  }
}

function cursorValue(config, id, record) {
  return config.orderBy === "key" ? id : Number(record?.[config.orderBy] || 0);
}

function compareDescending(config, left, right) {
  if (config.orderBy === "key") return right.id.localeCompare(left.id);
  const valueDifference = cursorValue(config, right.id, right) - cursorValue(config, left.id, left);
  if (Number.isFinite(valueDifference) && valueDifference) return valueDifference;
  return right.id.localeCompare(left.id);
}

export async function listHistoryPage(db, user, collection, options = {}) {
  const config = collections[collection];
  if (!config) throw new HttpError(404, "History collection not found.");
  if (!config.roles.includes(user.role)) throw new HttpError(403, "You are not allowed to view this history.");

  const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
  const cursor = decodeCursor(options.before);
  const userScoped = config.userRoles?.includes(user.role);
  const equalTo = userScoped ? user.uid : undefined;
  const repository = createFirebaseRepository(db);
  const values = await repository.readPage(config.path, {
    orderBy: userScoped ? config.userField : config.orderBy,
    equalTo,
    limit,
    cursor
  });

  let records = Object.entries(values || {})
    .map(([id, record]) => ({ id, ...(record || {}) }))
    .filter((record) => !userScoped || record[config.userField] === user.uid)
    .sort((left, right) => userScoped
      ? right.id.localeCompare(left.id)
      : compareDescending(config, left, right));

  if (cursor) {
    records = records.filter((record) => record.id !== cursor.id);
  }
  const hasMore = records.length > limit;
  const page = records.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = hasMore && last
    ? encodeCursor(userScoped ? equalTo : cursorValue(config, last.id, last), last.id)
    : null;

  return {
    records: page,
    pagination: {
      limit,
      hasMore,
      nextCursor
    }
  };
}
