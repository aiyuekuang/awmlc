/**
 * AWML Configuration
 *
 * Defines the awml.config.ts format used in web application projects.
 */

export interface AWMLConfig {
  /** Override API server base URL */
  server?: string;

  /** Output file path (default: app.awml.json) */
  output?: string;

  /** Framework override (auto-detected if not specified) */
  framework?: 'umi' | 'next' | 'vite';

  /** API response format convention */
  response?: {
    codeField: string;
    messageField: string;
    dataField: string;
    successCode: number | string;
  };
}

/**
 * Helper function for type-safe awml.config.ts
 */
export function defineAWMLConfig(config: AWMLConfig): AWMLConfig {
  return config;
}
