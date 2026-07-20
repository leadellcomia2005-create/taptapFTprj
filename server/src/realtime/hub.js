export function createRealtimeHub() {
  let io = null;
  return {
    attach(instance) {
      io = instance;
    },
    emit(rooms, event, payload) {
      if (!io) return false;
      const destinations = Array.isArray(rooms) ? rooms.filter(Boolean) : [rooms].filter(Boolean);
      let operator = io;
      for (const room of destinations) operator = operator.to(room);
      operator.emit(event, payload);
      return true;
    },
    instance() {
      return io;
    }
  };
}
