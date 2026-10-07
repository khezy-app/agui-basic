/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_AGUI_URL?: string
  readonly VITE_AGUI_ENABLED?: string
  readonly VITE_AGUI_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
