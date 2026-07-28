function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createFirebaseRepository(db) {
  return {
    createKey(path) {
      return db.ref(path).push().key;
    },
    async read(path) {
      return (await db.ref(path).once("value")).val();
    },
    async readPage(path, { orderBy = "createdAt", equalTo, limit, cursor } = {}) {
      let target = orderBy === "key"
        ? db.ref(path).orderByKey()
        : db.ref(path).orderByChild(orderBy);
      if (equalTo !== undefined) {
        target = target.startAt(equalTo);
        target = cursor?.id ? target.endAt(equalTo, cursor.id) : target.endAt(equalTo);
      } else if (cursor) {
        target = target.endAt(cursor.value, cursor.id);
      }
      const extra = cursor ? 2 : 1;
      return (await target.limitToLast(limit + extra).once("value")).val() || {};
    },
    async set(path, value) {
      await db.ref(path).set(value);
      return value;
    },
    async update(updates) {
      await db.ref().update(updates);
      return updates;
    },
    async updateAt(path, values) {
      await db.ref(path).update(values);
      return values;
    },
    async transaction(path, updater) {
      const target = db.ref(path);
      const initial = (await target.once("value")).val();
      let firstCall = true;
      return target.transaction((current) => {
        const value = firstCall && current === null && initial !== null ? clone(initial) : current;
        firstCall = false;
        return updater(value);
      }, undefined, false);
    }
  };
}
