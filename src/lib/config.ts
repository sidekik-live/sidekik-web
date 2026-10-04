// Public endpoints only (CLAUDE.md: never put vendor keys in the browser).
export const API_URL: string = import.meta.env["VITE_API_URL"] ?? "https://api.sidekik.live";
export const INGEST_URL: string = import.meta.env["VITE_INGEST_URL"] ?? "wss://ingest.sidekik.live";
