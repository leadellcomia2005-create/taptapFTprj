/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_DATABASE_URL?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_VAPID_KEY?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_ENABLE_FIREBASE_STORAGE?: "true" | "false";
  readonly VITE_ENABLE_ANALYTICS?: "true" | "false";
  readonly VITE_ENABLE_PERFORMANCE_MONITORING?: "true" | "false";
  readonly VITE_ENABLE_PWA?: "true" | "false";
  readonly VITE_USE_FIREBASE_EMULATORS?: "true" | "false";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
