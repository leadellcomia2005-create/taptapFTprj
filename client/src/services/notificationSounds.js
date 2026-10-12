const preferenceKey = "taptap-notification-sounds:v1";
const preferenceEvent = "taptap-notification-sounds-changed";
const minimumSoundGapMs = 350;

let audioContext = null;
let lastPlayedAt = 0;

function browserAudioContext() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function contextForPlayback() {
  const AudioContextClass = browserAudioContext();
  if (!AudioContextClass) return null;
  if (!audioContext || audioContext.state === "closed") audioContext = new AudioContextClass({ latencyHint: "interactive" });
  return audioContext;
}

export function notificationSoundsEnabled() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(preferenceKey) !== "off";
  } catch {
    return true;
  }
}

export function setNotificationSoundsEnabled(enabled) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(preferenceKey, enabled ? "on" : "off");
  } catch {
    // Sound remains available for the current page when storage is blocked.
  }
  window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: { enabled } }));
}

export function subscribeNotificationSoundPreference(callback) {
  if (typeof window === "undefined") return () => {};
  const update = (event) => callback(Boolean(event.detail?.enabled));
  const updateFromStorage = (event) => {
    if (event.key === preferenceKey) callback(notificationSoundsEnabled());
  };
  window.addEventListener(preferenceEvent, update);
  window.addEventListener("storage", updateFromStorage);
  return () => {
    window.removeEventListener(preferenceEvent, update);
    window.removeEventListener("storage", updateFromStorage);
  };
}

export function notificationSoundKind(notification) {
  const type = String(notification?.entityType || notification?.type || "").toLowerCase();
  const content = `${notification?.title || ""} ${notification?.message || ""}`.toLowerCase();
  if (["complaint", "inventory"].includes(type) || /failed|overdue|cancelled|low stock|urgent|issue/.test(content)) return "priority";
  if (/\bready\b|prepared|completed|out for delivery|delivery assigned/.test(content)) return "ready";
  if (type === "chat") return "chat";
  if (["order", "sale", "payment", "delivery"].includes(type)) return "order";
  return null;
}

export function highestPriorityNotificationSound(notifications) {
  const priority = { chat: 1, order: 2, ready: 3, priority: 4 };
  return notifications.reduce((selected, notification) => {
    const candidate = notificationSoundKind(notification);
    return (priority[candidate] || 0) > (priority[selected] || 0) ? candidate : selected;
  }, null);
}

function scheduleNote(context, destination, start, frequency, gain, decay = 9, bell = false) {
  const end = start + (bell ? 0.72 : Math.min(0.52, Math.max(0.24, 4.8 / decay)));
  const harmonics = bell
    ? [[1, "sine", 1], [2.72, "sine", 0.28], [4.08, "sine", 0.12]]
    : [[1, "sine", 1], [2.01, "triangle", 0.24]];
  for (const [ratio, wave, level] of harmonics) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency * ratio, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * level), start + 0.007);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }
}

function schedulePattern(context, kind) {
  const master = context.createGain();
  master.gain.setValueAtTime(0.16, context.currentTime);
  master.connect(context.destination);
  const start = context.currentTime + 0.012;
  let duration = 1.05;
  if (kind === "chat") {
    scheduleNote(context, master, start, 659.25, 0.46, 14);
    scheduleNote(context, master, start + 0.13, 880, 0.38, 15);
    duration = 0.8;
  } else if (kind === "ready") {
    scheduleNote(context, master, start, 587.33, 0.42, 8);
    scheduleNote(context, master, start + 0.21, 783.99, 0.43, 8);
    scheduleNote(context, master, start + 0.44, 1174.66, 0.35, 6, true);
    duration = 1.25;
  } else if (kind === "priority") {
    scheduleNote(context, master, start, 329.63, 0.44, 9);
    scheduleNote(context, master, start + 0.23, 329.63, 0.40, 9);
    scheduleNote(context, master, start + 0.46, 392, 0.38, 9);
    duration = 1.1;
  } else {
    scheduleNote(context, master, start, 587.33, 0.44, 7, true);
    scheduleNote(context, master, start + 0.25, 880, 0.42, 6, true);
  }
  window.setTimeout(() => master.disconnect(), duration * 1000);
}

export async function playNotificationSound(kind) {
  if (!kind || !notificationSoundsEnabled()) return false;
  const now = Date.now();
  if (now - lastPlayedAt < minimumSoundGapMs) return false;
  const context = contextForPlayback();
  if (!context) return false;
  try {
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") return false;
    schedulePattern(context, kind);
    lastPlayedAt = now;
    return true;
  } catch {
    return false;
  }
}

export function installNotificationSoundUnlock() {
  if (typeof window === "undefined") return () => {};
  const unlock = () => {
    if (!notificationSoundsEnabled()) return;
    const context = contextForPlayback();
    if (!context) return;
    void context.resume().then(() => {
      if (context.state === "running") removeListeners();
    }).catch(() => {});
  };
  const removeListeners = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  return removeListeners;
}
