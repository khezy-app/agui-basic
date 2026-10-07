export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
  aguiUrl: import.meta.env.VITE_AGUI_URL ?? '/agent',
  aguiEnabled: import.meta.env.VITE_AGUI_ENABLED !== 'false',
  /**
   * Optional model hint for the panel's status strip. No default: the frontend cannot
   * know which `OPENAI_MODEL` the backend runs, and an invented label would be wrong more
   * often than right. Set it when the deployment wants the hint shown.
   */
  aguiModel: import.meta.env.VITE_AGUI_MODEL,
} as const
