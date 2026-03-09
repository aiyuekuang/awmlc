/**
 * Umi/Max Framework Adapter
 *
 * Extracts route definitions, proxy configuration, and page metadata
 * from .umirc.ts or config/config.ts files.
 */

import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import type { Page, NavItem, ServerConfig, AppMeta, AuthConfig } from '../schema.js';

interface UmiConfig {
  routes: UmiRoute[];
  proxy: Record<string, { target: string; changeOrigin?: boolean }>;
  layout?: { title?: string };
}

interface UmiRoute {
  path: string;
  name?: string;
  icon?: string;
  component?: string;
  redirect?: string;
  layout?: boolean;
  routes?: UmiRoute[];
}

/**
 * Parse .umirc.ts and extract configuration
 */
export function parseUmiConfig(source: string): UmiConfig {
  const ast = parse(source, {
    loc: true,
    range: true,
    jsx: true,
  });

  let config: UmiConfig = { routes: [], proxy: {} };

  // Find the default export: export default defineConfig({ ... })
  for (const stmt of ast.body) {
    if (stmt.type === 'ExportDefaultDeclaration') {
      const expr = stmt.declaration;
      let configObj: TSESTree.ObjectExpression | null = null;

      if (expr.type === 'CallExpression' && expr.arguments[0]?.type === 'ObjectExpression') {
        // export default defineConfig({ ... })
        configObj = expr.arguments[0];
      } else if (expr.type === 'ObjectExpression') {
        // export default { ... }
        configObj = expr;
      }

      if (configObj) {
        config = extractConfig(configObj);
      }
    }
  }

  return config;
}

function extractConfig(obj: TSESTree.ObjectExpression): UmiConfig {
  const config: UmiConfig = { routes: [], proxy: {} };

  for (const prop of obj.properties) {
    if (prop.type !== 'Property' || prop.key.type !== 'Identifier') continue;

    if (prop.key.name === 'routes' && prop.value.type === 'ArrayExpression') {
      config.routes = extractRoutes(prop.value);
    }

    if (prop.key.name === 'proxy' && prop.value.type === 'ObjectExpression') {
      config.proxy = extractProxy(prop.value);
    }

    if (prop.key.name === 'layout' && prop.value.type === 'ObjectExpression') {
      config.layout = extractSimpleObject(prop.value) as { title?: string };
    }
  }

  return config;
}

function extractRoutes(arr: TSESTree.ArrayExpression): UmiRoute[] {
  const routes: UmiRoute[] = [];

  for (const elem of arr.elements) {
    if (elem?.type !== 'ObjectExpression') continue;

    const route: UmiRoute = { path: '' };

    for (const prop of elem.properties) {
      if (prop.type !== 'Property' || prop.key.type !== 'Identifier') continue;

      const key = prop.key.name;
      const val = prop.value;

      if (key === 'path' && val.type === 'Literal') route.path = String(val.value);
      if (key === 'name' && val.type === 'Literal') route.name = String(val.value);
      if (key === 'icon' && val.type === 'Literal') route.icon = String(val.value);
      if (key === 'component' && val.type === 'Literal') route.component = String(val.value);
      if (key === 'redirect' && val.type === 'Literal') route.redirect = String(val.value);
      if (key === 'layout' && val.type === 'Literal') route.layout = val.value as boolean;
      if (key === 'routes' && val.type === 'ArrayExpression') {
        route.routes = extractRoutes(val);
      }
    }

    routes.push(route);
  }

  return routes;
}

function extractProxy(
  obj: TSESTree.ObjectExpression,
): Record<string, { target: string; changeOrigin?: boolean }> {
  const proxy: Record<string, { target: string }> = {};

  for (const prop of obj.properties) {
    if (prop.type !== 'Property') continue;

    let key: string;
    if (prop.key.type === 'Literal') {
      key = String(prop.key.value);
    } else if (prop.key.type === 'Identifier') {
      key = prop.key.name;
    } else {
      continue;
    }

    if (prop.value.type === 'ObjectExpression') {
      const val = extractSimpleObject(prop.value);
      if (val.target) {
        proxy[key] = { target: String(val.target) };
      }
    }
  }

  return proxy;
}

function extractSimpleObject(obj: TSESTree.ObjectExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const prop of obj.properties) {
    if (prop.type !== 'Property' || prop.key.type !== 'Identifier') continue;
    if (prop.value.type === 'Literal') {
      result[prop.key.name] = prop.value.value;
    }
  }

  return result;
}

/**
 * Convert Umi routes to WebSchema pages (without modules - those are added by page parser)
 */
export function routesToPages(routes: UmiRoute[], sourceDir: string): Page[] {
  const pages: Page[] = [];

  for (const route of routes) {
    if (route.redirect) {
      pages.push({
        id: route.path,
        path: route.path,
        name: route.name || route.path,
        sourceFile: '',
        redirect: route.redirect,
        modules: [],
      });
      continue;
    }

    if (route.component) {
      const sourceFile = resolveComponentPath(route.component, sourceDir);
      pages.push({
        id: route.path,
        path: route.path,
        name: route.name || route.path,
        icon: route.icon,
        sourceFile,
        layout: route.layout,
        modules: [],
      });
    }

    // Recurse into nested routes
    if (route.routes) {
      pages.push(...routesToPages(route.routes, sourceDir));
    }
  }

  return pages;
}

/**
 * Convert Umi routes to navigation items
 */
export function routesToNav(routes: UmiRoute[]): NavItem[] {
  const items: NavItem[] = [];

  for (const route of routes) {
    // Skip login, redirects, and routes without names
    if (!route.name || route.redirect || route.layout === false) continue;

    const item: NavItem = {
      name: route.name,
      path: route.path,
      icon: route.icon,
    };

    if (route.routes) {
      item.children = routesToNav(route.routes);
    }

    items.push(item);
  }

  return items;
}

/**
 * Convert Umi proxy config to server configs
 */
export function proxyToServers(
  proxy: Record<string, { target: string }>,
): ServerConfig[] {
  // Group prefixes by target
  const serverMap = new Map<string, string[]>();

  for (const [prefix, config] of Object.entries(proxy)) {
    const target = config.target;
    if (!serverMap.has(target)) {
      serverMap.set(target, []);
    }
    serverMap.get(target)!.push(prefix);
  }

  return Array.from(serverMap.entries()).map(([baseUrl, prefixes], index) => ({
    id: `server-${index}`,
    baseUrl,
    prefixes,
  }));
}

/**
 * Extract app metadata from Umi config
 */
export function extractAppMeta(config: UmiConfig, sourceDir: string): AppMeta {
  return {
    name: config.layout?.title || 'Umi App',
    title: config.layout?.title || 'Umi App',
    framework: 'umi',
    sourceDir,
  };
}

/**
 * Resolve Umi component path to actual file path
 * './Login' -> 'src/pages/Login/index.tsx'
 */
function resolveComponentPath(component: string, sourceDir: string): string {
  // Remove leading ./ if present
  const clean = component.replace(/^\.\//, '');
  return `${sourceDir}/pages/${clean}/index.tsx`;
}
