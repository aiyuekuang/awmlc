/**
 * API Parser
 *
 * Extracts API endpoint definitions from source code by parsing
 * TypeScript AST. Handles the common pattern:
 *
 *   export const fooAPI = {
 *     list: (params) => request('/path', { method: 'POST', data }),
 *   }
 */

import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import type { ApiEndpoint, ApiParamField, ServerConfig } from '../schema.js';

interface RawApiCall {
  group: string;
  name: string;
  description?: string;
  path: string;
  method: string;
  params: ApiParamField[];
  contentType?: 'json' | 'form' | 'multipart';
  timeout?: number;
}

/**
 * Parse an API source file and extract all endpoint definitions
 */
export function parseApiFile(source: string, servers: ServerConfig[]): ApiEndpoint[] {
  const ast = parse(source, {
    loc: true,
    range: true,
    comment: true,
    jsx: true,
  });

  const rawCalls: RawApiCall[] = [];

  for (const stmt of ast.body) {
    if (
      stmt.type === 'ExportNamedDeclaration' &&
      stmt.declaration?.type === 'VariableDeclaration'
    ) {
      for (const decl of stmt.declaration.declarations) {
        if (
          decl.id.type === 'Identifier' &&
          decl.id.name.endsWith('API') &&
          decl.init?.type === 'ObjectExpression'
        ) {
          const groupName = decl.id.name;
          extractApiGroup(groupName, decl.init, source, rawCalls);
        }
      }
    }
  }

  return rawCalls.map((raw) => resolveEndpoint(raw, servers));
}

function extractApiGroup(
  groupName: string,
  obj: TSESTree.ObjectExpression,
  source: string,
  out: RawApiCall[],
) {
  for (const prop of obj.properties) {
    if (prop.type !== 'Property') continue;
    if (prop.key.type !== 'Identifier') continue;

    const methodName = prop.key.name;

    // Extract JSDoc comment above property
    const description = extractLeadingComment(source, prop.range![0]);

    // The value is either an arrow function or a function expression
    const fn = prop.value;
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') continue;

    // Extract parameters from the function signature
    const params = extractFunctionParams(fn);

    // Find the request() call inside the function body
    const requestCall = findRequestCall(fn.body);
    if (!requestCall) continue;

    const { path, method, contentType, timeout } = extractRequestConfig(requestCall);
    if (!path) continue;

    out.push({
      group: groupName,
      name: methodName,
      description,
      path,
      method,
      params,
      contentType,
      timeout,
    });
  }
}

function extractLeadingComment(source: string, position: number): string | undefined {
  // Look backwards from the property position for the nearest JSDoc comment
  // Only search within a small window before the property
  const searchStart = Math.max(0, position - 300);
  const before = source.substring(searchStart, position);
  // Match the LAST /** ... */ block before the property (greedy outer, capture inside)
  const allComments = [...before.matchAll(/\/\*\*\s*\n?([\s\S]*?)\s*\*\//g)];
  const match = allComments.length > 0 ? allComments[allComments.length - 1] : null;
  if (match) {
    // Clean JSDoc: remove leading * and @param lines, keep description
    const lines = match[1]
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .filter((line) => line && !line.startsWith('@'));
    return lines.join(' ') || undefined;
  }
  // Try single-line comment
  const singleMatch = before.match(/\/\/\s*(.+)\s*\n\s*$/);
  return singleMatch?.[1];
}

function extractFunctionParams(
  fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
): ApiParamField[] {
  const params: ApiParamField[] = [];

  for (const param of fn.params) {
    if (param.type === 'Identifier' && param.typeAnnotation) {
      // Simple typed param: (id: string) or (data: { username: string; ... })
      const annotation = param.typeAnnotation.typeAnnotation;
      const simpleType = tsTypeToSimple(annotation);

      // If param is an object type literal, expand its fields
      if (annotation.type === 'TSTypeLiteral') {
        const children = extractTypeLiteralFields(annotation);
        if (children.length > 0) {
          params.push(...children);
          continue;
        }
      }

      params.push({
        name: param.name,
        type: simpleType,
        required: param.optional !== true,
      });
    } else if (param.type === 'ObjectPattern') {
      // Destructured object param: ({ username, password }: { ... })
      for (const prop of param.properties) {
        if (prop.type === 'Property' && prop.key.type === 'Identifier') {
          const name = prop.key.name;
          let type: ApiParamField['type'] = 'string';

          // Try to get type from type annotation
          if (param.typeAnnotation) {
            const annotation = param.typeAnnotation.typeAnnotation;
            if (annotation.type === 'TSTypeLiteral') {
              const member = annotation.members.find(
                (m: any) => m.type === 'TSPropertySignature' && m.key?.name === name,
              );
              if (member && 'typeAnnotation' in member && member.typeAnnotation) {
                type = tsTypeToSimple(member.typeAnnotation.typeAnnotation);
              }
            }
          }

          params.push({
            name,
            type,
            required: prop.type === 'Property' && (prop.value as any).type !== 'AssignmentPattern',
          });
        }
      }
    } else if (param.type === 'Identifier') {
      // Untyped param - try to infer from name
      params.push({
        name: param.name,
        type: inferTypeFromName(param.name),
        required: param.optional !== true,
      });
    }
  }

  return params;
}

function extractTypeLiteralFields(node: TSESTree.TSTypeLiteral): ApiParamField[] {
  const fields: ApiParamField[] = [];
  for (const member of node.members) {
    if (
      member.type === 'TSPropertySignature' &&
      member.key.type === 'Identifier' &&
      member.typeAnnotation
    ) {
      fields.push({
        name: member.key.name,
        type: tsTypeToSimple(member.typeAnnotation.typeAnnotation),
        required: !member.optional,
      });
    }
  }
  return fields;
}

function tsTypeToSimple(
  node: TSESTree.TypeNode,
): ApiParamField['type'] {
  if (node.type === 'TSStringKeyword') return 'string';
  if (node.type === 'TSNumberKeyword') return 'number';
  if (node.type === 'TSBooleanKeyword') return 'boolean';
  if (node.type === 'TSArrayType') return 'array';
  if (
    node.type === 'TSTypeReference' &&
    'name' in node.typeName &&
    node.typeName.name === 'FormData'
  )
    return 'file';
  return 'object';
}

function inferTypeFromName(name: string): ApiParamField['type'] {
  if (name === 'id' || name.endsWith('Id')) return 'string';
  if (name.includes('count') || name.includes('page') || name.includes('size')) return 'number';
  if (name.startsWith('is') || name.startsWith('has') || name.includes('enable')) return 'boolean';
  if (name.endsWith('Ids') || name.endsWith('List')) return 'array';
  if (name === 'data' || name === 'formData') return 'object';
  return 'string';
}

function findRequestCall(
  body: TSESTree.Expression | TSESTree.BlockStatement,
): TSESTree.CallExpression | null {
  if (body.type === 'CallExpression') {
    if (isRequestCall(body)) return body;
  }
  if (body.type === 'BlockStatement') {
    for (const stmt of body.body) {
      const found = findRequestCallInNode(stmt);
      if (found) return found;
    }
  }
  return null;
}

function findRequestCallInNode(node: TSESTree.Node): TSESTree.CallExpression | null {
  if (node.type === 'ReturnStatement' && node.argument) {
    return findRequestCall(node.argument as any);
  }
  if (node.type === 'ExpressionStatement') {
    return findRequestCall(node.expression as any);
  }
  if (node.type === 'CallExpression' && isRequestCall(node)) {
    return node;
  }
  return null;
}

function isRequestCall(node: TSESTree.CallExpression): boolean {
  return node.callee.type === 'Identifier' && node.callee.name === 'request';
}

function extractRequestConfig(call: TSESTree.CallExpression): {
  path: string;
  method: string;
  contentType?: 'json' | 'form' | 'multipart';
  timeout?: number;
} {
  let path = '';
  let method = 'GET';
  let contentType: 'json' | 'form' | 'multipart' | undefined;
  let timeout: number | undefined;

  // First argument is the URL path
  const pathArg = call.arguments[0];
  if (pathArg?.type === 'Literal' && typeof pathArg.value === 'string') {
    path = pathArg.value;
  } else if (pathArg?.type === 'TemplateLiteral') {
    // Template literal: build path with placeholders
    path = pathArg.quasis.map((q) => q.value.raw).join('{param}');
  }

  // Second argument is the config object
  const configArg = call.arguments[1];
  if (configArg?.type === 'ObjectExpression') {
    for (const prop of configArg.properties) {
      if (prop.type !== 'Property' || prop.key.type !== 'Identifier') continue;

      if (prop.key.name === 'method' && prop.value.type === 'Literal') {
        method = String(prop.value.value);
      }
      if (prop.key.name === 'requestType' && prop.value.type === 'Literal') {
        const val = String(prop.value.value);
        if (val === 'form') contentType = 'multipart';
      }
      if (prop.key.name === 'timeout') {
        timeout = extractNumericValue(prop.value);
      }
    }
  }

  return { path, method, contentType, timeout };
}

function extractNumericValue(node: any): number | undefined {
  if (node.type === 'Literal' && typeof node.value === 'number') {
    return node.value;
  }
  if (node.type === 'BinaryExpression' && node.operator === '*') {
    const left = extractNumericValue(node.left as TSESTree.Expression);
    const right = extractNumericValue(node.right as TSESTree.Expression);
    if (left !== undefined && right !== undefined) return left * right;
  }
  return undefined;
}

/**
 * Resolve a raw API call to a full ApiEndpoint with resolved URL
 */
function resolveEndpoint(raw: RawApiCall, servers: ServerConfig[]): ApiEndpoint {
  // Find matching server by path prefix
  let resolvedUrl = raw.path;
  for (const server of servers) {
    for (const prefix of server.prefixes) {
      if (raw.path.startsWith(prefix)) {
        resolvedUrl = server.baseUrl + raw.path;
        break;
      }
    }
  }

  return {
    id: `${raw.group.replace(/API$/, '')}.${raw.name}`,
    name: raw.name,
    description: raw.description,
    method: raw.method as ApiEndpoint['method'],
    url: resolvedUrl,
    originalPath: raw.path,
    request: raw.params.length > 0 ? { fields: raw.params } : undefined,
    contentType: raw.contentType,
    timeout: raw.timeout,
    group: raw.group,
  };
}
