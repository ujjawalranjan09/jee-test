/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Full base URL of the backend API, including scheme and host but no
   * trailing slash. Example: "https://pdf-quiz-generator-backend.onrender.com".
   * Set at build time via the VITE_API_URL environment variable.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}