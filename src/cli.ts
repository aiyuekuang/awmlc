#!/usr/bin/env node

/**
 * awmlc - AWML Compiler
 *
 * Compiles web application source code into AWML (AI Web Markup Language).
 *
 * Usage:
 *   awmlc <project-dir> [options]
 *
 * Options:
 *   --server <url>     Override API server base URL
 *   --framework <name> Framework override (umi, next, vite)
 *   --output <path>    Output file path (default: app.awml.json)
 *   --pretty           Pretty-print JSON output
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildAWML } from './builder.js';
import type { AWMLConfig } from './config.js';

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  // First non-flag argument is the project directory, default to cwd
  const projectDir = path.resolve(args.find((a) => !a.startsWith('-')) || '.');

  if (!fs.existsSync(projectDir)) {
    console.error(`Project directory not found: ${projectDir}`);
    process.exit(1);
  }

  // Load awml.config.ts if exists
  const config = await loadConfig(projectDir);

  // CLI args override config file
  const serverUrl = getArg(args, '--server') || config?.server;
  const framework = (getArg(args, '--framework') || config?.framework) as 'umi' | 'next' | 'vite' | undefined;
  const output = getArg(args, '--output') || config?.output || 'app.awml.json';
  const pretty = args.includes('--pretty');

  console.log(`awmlc: compiling ${projectDir}`);
  if (config) {
    console.log(`  config: awml.config.ts`);
  }

  try {
    const doc = await buildAWML({
      projectDir,
      serverUrl,
      framework,
      response: config?.response,
    });

    const json = JSON.stringify(doc, null, pretty ? 2 : undefined);
    const outputPath = path.isAbsolute(output) ? output : path.join(projectDir, output);
    fs.writeFileSync(outputPath, json, 'utf-8');

    console.log(`  -> ${outputPath}`);
    console.log(`     ${doc.pages.length} pages, ${doc.apis.length} APIs, ${doc.nav.length} nav items`);
  } catch (error: any) {
    console.error(`awmlc error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Load awml.config.ts from project directory
 */
async function loadConfig(projectDir: string): Promise<AWMLConfig | null> {
  const configPath = path.join(projectDir, 'awml.config.ts');
  if (!fs.existsSync(configPath)) return null;

  // Read the TS config and extract the object literal
  // Simple approach: strip TS syntax and evaluate as JS
  const source = fs.readFileSync(configPath, 'utf-8');

  // Extract the config object from defineAWMLConfig({ ... }) or export default { ... }
  const defineMatch = source.match(/defineAWMLConfig\s*\(\s*(\{[\s\S]*\})\s*\)/);
  const defaultMatch = source.match(/export\s+default\s+(\{[\s\S]*\})/);
  const objStr = defineMatch?.[1] || defaultMatch?.[1];

  if (!objStr) return null;

  try {
    // Strip TS/comment syntax, then evaluate as JS object literal
    // Remove block comments and line comments (but not // inside strings)
    const cleaned = objStr
      .replace(/\/\*\*[\s\S]*?\*\//g, '')                   // remove block comments
      .replace(/(["'])(?:(?!\1).)*\1|(\/\/.*)/g, (m, q) => q ? m : '');  // remove line comments outside strings

    // Use Function to safely evaluate the JS object literal
    const fn = new Function(`return (${cleaned})`);
    return fn() as AWMLConfig;
  } catch {
    console.warn(`  warning: could not parse awml.config.ts, using defaults`);
    return null;
  }
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function printHelp() {
  console.log(`
awmlc - AWML Compiler (AI Web Markup Language)

Compiles web application source code into AWML, the standard document
format for AI browsers. AWML is to AI browsers what HTML is to Chrome.

Usage:
  awmlc [project-dir] [options]

  If no project-dir is specified, uses the current directory.
  If awml.config.ts exists in the project root, it will be loaded automatically.

Options:
  --server <url>       Override API server base URL
  --framework <name>   Framework override (umi, next, vite)
  --output <path>      Output file path (default: app.awml.json)
  --pretty             Pretty-print JSON output
  --help, -h           Show this help

Examples:
  awmlc                                    # compile current dir with awml.config.ts
  awmlc ./my-app --pretty
  awmlc ./my-app --server http://api.example.com
  `);
}

main();
