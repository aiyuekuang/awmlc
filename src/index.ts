/**
 * awmlc - AWML Compiler
 *
 * Compiles web application source code into AWML (AI Web Markup Language).
 * AWML is to AI browsers what HTML is to traditional browsers.
 */

export type { AWMLDocument } from './schema.js';
export * from './schema.js';
export { buildAWML } from './builder.js';
export { defineAWMLConfig } from './config.js';
export type { AWMLConfig } from './config.js';
