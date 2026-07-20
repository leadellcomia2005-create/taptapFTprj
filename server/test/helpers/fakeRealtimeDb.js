function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function pathParts(path = "") {
  return String(path).split("/").filter(Boolean);
}

function valueAt(root, path = "") {
  let value = root;
  for (const part of pathParts(path)) {
    if (value == null || typeof value !== "object") return undefined;
    value = value[part];
  }
  return value;
}

function setValue(root, path, value) {
  const parts = pathParts(path);
  if (parts.length === 0) {
    for (const key of Object.keys(root)) delete root[key];
    if (value && typeof value === "object") Object.assign(root, clone(value));
    return;
  }
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    if (!parent[part] || typeof parent[part] !== "object") parent[part] = {};
    parent = parent[part];
  }
  const key = parts.at(-1);
  if (value === null || value === undefined) delete parent[key];
  else parent[key] = clone(value);
}

function resolveServerValue(root, path, value) {
  const increment = value?.[".sv"]?.increment;
  if (increment === undefined) return value;
  return Number(valueAt(root, path) || 0) + Number(increment || 0);
}

function firebaseValueRank(value) {
  if (value === null || value === undefined) return 0;
  if (value === false) return 1;
  if (value === true) return 2;
  if (typeof value === "number") return 3;
  if (typeof value === "string") return 4;
  return 5;
}

function compareFirebaseValues(left, right) {
  const rankDifference = firebaseValueRank(left) - firebaseValueRank(right);
  if (rankDifference) return rankDifference;
  if (firebaseValueRank(left) === 0) return 0;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareQueryEntry(left, right, query) {
  const leftValue = query.orderBy === "key" ? left[0] : valueAt(left[1], query.child);
  const rightValue = query.orderBy === "key" ? right[0] : valueAt(right[1], query.child);
  return compareFirebaseValues(leftValue, rightValue) || left[0].localeCompare(right[0]);
}

function compareEntryToBoundary(entry, value, key, query) {
  const entryValue = query.orderBy === "key" ? entry[0] : valueAt(entry[1], query.child);
  const valueComparison = compareFirebaseValues(entryValue, value);
  if (valueComparison) return valueComparison;
  if (key === undefined) return 0;
  return entry[0].localeCompare(key);
}

class FakeSnapshot {
  constructor(value) {
    this.value = clone(value);
  }

  val() {
    return clone(this.value);
  }

  exists() {
    return this.value !== undefined && this.value !== null;
  }

  child(path) {
    return new FakeSnapshot(valueAt(this.value, path));
  }
}

class FakeReference {
  constructor(database, path = "", query = {}) {
    this.database = database;
    this.path = pathParts(path).join("/");
    this.query = query;
  }

  get key() {
    return pathParts(this.path).at(-1) || null;
  }

  orderByChild(child) {
    return new FakeReference(this.database, this.path, { ...this.query, orderBy: "child", child });
  }

  orderByKey() {
    return new FakeReference(this.database, this.path, { ...this.query, orderBy: "key" });
  }

  equalTo(equal) {
    return new FakeReference(this.database, this.path, { ...this.query, equal, hasEqual: true });
  }

  startAt(start, key) {
    return new FakeReference(this.database, this.path, { ...this.query, start, startKey: key, hasStart: true });
  }

  endAt(end, key) {
    return new FakeReference(this.database, this.path, { ...this.query, end, endKey: key, hasEnd: true });
  }

  limitToLast(limit) {
    return new FakeReference(this.database, this.path, { ...this.query, limitToLast: limit });
  }

  async once() {
    let value = valueAt(this.database.data, this.path);
    if (this.query.orderBy && value && typeof value === "object") {
      let entries = Object.entries(value).sort((left, right) => compareQueryEntry(left, right, this.query));
      if (this.query.hasEqual) {
        entries = entries.filter((entry) => compareEntryToBoundary(entry, this.query.equal, undefined, this.query) === 0);
      }
      if (this.query.hasStart) {
        entries = entries.filter((entry) => compareEntryToBoundary(entry, this.query.start, this.query.startKey, this.query) >= 0);
      }
      if (this.query.hasEnd) {
        entries = entries.filter((entry) => compareEntryToBoundary(entry, this.query.end, this.query.endKey, this.query) <= 0);
      }
      if (this.query.limitToLast) entries = entries.slice(-this.query.limitToLast);
      value = Object.fromEntries(entries);
    }
    return new FakeSnapshot(value);
  }

  push(value) {
    const key = `key-${String(++this.database.sequence).padStart(4, "0")}`;
    const reference = new FakeReference(this.database, [this.path, key].filter(Boolean).join("/"));
    if (arguments.length) setValue(this.database.data, reference.path, value);
    return reference;
  }

  async set(value) {
    setValue(this.database.data, this.path, value);
  }

  async update(values) {
    for (const [relativePath, value] of Object.entries(values || {})) {
      const targetPath = [this.path, relativePath].filter(Boolean).join("/");
      setValue(this.database.data, targetPath, resolveServerValue(this.database.data, targetPath, value));
    }
  }

  async remove() {
    setValue(this.database.data, this.path, null);
  }

  async transaction(updater) {
    const current = clone(valueAt(this.database.data, this.path) ?? null);
    const next = updater(current);
    if (next === undefined) return { committed: false, snapshot: new FakeSnapshot(current) };
    setValue(this.database.data, this.path, next);
    return { committed: true, snapshot: new FakeSnapshot(next) };
  }
}

export class FakeRealtimeDatabase {
  constructor(initialData = {}) {
    this.data = clone(initialData) || {};
    this.sequence = 0;
  }

  ref(path = "") {
    return new FakeReference(this, path);
  }

  read(path = "") {
    return clone(valueAt(this.data, path));
  }
}
