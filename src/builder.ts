/**
 * AWML Compiler Core
 *
 * Orchestrates the full compilation process:
 * 1. Detect framework (Umi, Next.js, Vite, etc.)
 * 2. Parse framework config (routes, proxy)
 * 3. Parse API definitions
 * 4. Parse page components
 * 5. Assemble into AWMLDocument
 */

import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import type { AWMLDocument, AuthConfig } from './schema.js';
import {
  parseUmiConfig,
  routesToPages,
  routesToNav,
  proxyToServers,
  extractAppMeta,
} from './adapters/umi.js';
import { parseApiFile } from './parsers/api-parser.js';
import { parsePageModules } from './parsers/page-parser.js';

export interface BuildOptions {
  /** Project root directory */
  projectDir: string;
  /** Override API server base URL (e.g. "http://production.example.com") */
  serverUrl?: string;
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
 * Compile a web application into an AWML document
 */
export async function buildAWML(options: BuildOptions): Promise<AWMLDocument> {
  const { projectDir, serverUrl } = options;

  // 1. Detect framework
  const framework = options.framework || detectFramework(projectDir);
  if (framework !== 'umi') {
    throw new Error(`Framework "${framework}" is not yet supported. Currently only "umi" is supported.`);
  }

  // 2. Parse framework config
  const configPath = findUmiConfig(projectDir);
  if (!configPath) {
    throw new Error('Could not find .umirc.ts or config/config.ts');
  }
  const configSource = fs.readFileSync(configPath, 'utf-8');
  const umiConfig = parseUmiConfig(configSource);

  // 3. Resolve servers from proxy config
  let servers = proxyToServers(umiConfig.proxy);
  if (serverUrl) {
    servers = servers.map((s) => ({ ...s, baseUrl: serverUrl }));
  }

  // 4. Parse API files
  const sourceDir = detectSourceDir(projectDir);
  const apiFiles = await glob('**/api/**/*.{ts,tsx}', {
    cwd: path.join(projectDir, sourceDir),
    absolute: true,
    ignore: ['**/node_modules/**', '**/*.d.ts'],
  });

  const apis = apiFiles.flatMap((file) => {
    const source = fs.readFileSync(file, 'utf-8');
    return parseApiFile(source, servers);
  });

  // Apply response convention to all APIs
  if (options.response) {
    const wrapper = {
      codeField: options.response.codeField,
      messageField: options.response.messageField,
      dataField: options.response.dataField,
      successCode: options.response.successCode,
    };
    for (const api of apis) {
      api.response = { wrapper };
    }
  }

  const apiEndpointIds = apis.map((a) => a.id);

  // 5. Build pages from routes
  const pages = routesToPages(umiConfig.routes, sourceDir);

  // 6. Parse each page component to extract modules
  for (const page of pages) {
    if (!page.sourceFile || page.redirect) continue;

    const fullPath = path.join(projectDir, page.sourceFile);
    if (!fs.existsSync(fullPath)) continue;

    const source = fs.readFileSync(fullPath, 'utf-8');
    page.modules = parsePageModules(source, apiEndpointIds);
  }

  // 7. Build navigation
  const nav = routesToNav(umiConfig.routes);

  // 8. Extract app metadata
  const appMeta = extractAppMeta(umiConfig, sourceDir);

  // 9. Detect auth config
  const auth = detectAuthConfig(apis);

  // 10. Assemble AWML document
  const doc: AWMLDocument = {
    version: '0.1',
    app: appMeta,
    servers,
    auth,
    pages,
    apis,
    nav,
  };

  return doc;
}

function detectFramework(projectDir: string): string {
  if (
    fs.existsSync(path.join(projectDir, '.umirc.ts')) ||
    fs.existsSync(path.join(projectDir, 'config/config.ts'))
  ) {
    return 'umi';
  }

  if (
    fs.existsSync(path.join(projectDir, 'next.config.js')) ||
    fs.existsSync(path.join(projectDir, 'next.config.ts'))
  ) {
    return 'next';
  }

  if (
    fs.existsSync(path.join(projectDir, 'vite.config.ts')) ||
    fs.existsSync(path.join(projectDir, 'vite.config.js'))
  ) {
    return 'vite';
  }

  throw new Error(
    'Could not detect framework. Supported: umi, next, vite. ' +
    'Use --framework to specify manually.',
  );
}

function findUmiConfig(projectDir: string): string | null {
  const candidates = [
    path.join(projectDir, '.umirc.ts'),
    path.join(projectDir, 'config/config.ts'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function detectSourceDir(projectDir: string): string {
  if (fs.existsSync(path.join(projectDir, 'src'))) return 'src';
  return '.';
}

function detectAuthConfig(apis: AWMLDocument['apis']): AuthConfig | undefined {
  const loginApi = apis.find(
    (a) => a.id.includes('auth.login') || a.id.includes('login'),
  );

  if (!loginApi) return undefined;

  return {
    type: 'token',
    loginApi: loginApi.id,
    tokenStorage: 'localStorage',
    tokenKey: 'access_token',
    tokenTransport: {
      type: 'header',
      name: 'Authorization',
      prefix: 'Bearer ',
    },
  };
}
