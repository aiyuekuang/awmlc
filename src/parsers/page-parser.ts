/**
 * Page Parser
 *
 * Analyzes React page components to extract semantic modules:
 * - Table (ProTable / Table with columns)
 * - Form (Form with Form.Item)
 * - Dialog (Modal wrapping forms)
 * - Statistic (Card with Statistic)
 * - Actions (Buttons with handlers)
 */

import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import type {
  PageModule,
  TableModule,
  FormModule,
  DialogModule,
  StatisticModule,
  TableColumn,
  FormField,
  ActionItem,
  StatisticItem,
  FieldType,
} from '../schema.js';

/**
 * Parse a page component file and extract all semantic modules
 */
export function parsePageModules(source: string, apiEndpointIds: string[]): PageModule[] {
  const ast = parse(source, {
    loc: true,
    range: true,
    jsx: true,
    comment: true,
  });

  const modules: PageModule[] = [];
  const context = new ParseContext(source, apiEndpointIds);

  // First pass: find column definitions (const columns: ProColumns[] = [...])
  walkAst(ast, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === 'columns' &&
      node.init?.type === 'ArrayExpression'
    ) {
      context.columnsArray = node.init;
    }
  });

  // Second pass: find JSX elements
  walkAst(ast, (node) => {
    if (node.type !== 'JSXElement') return;

    const tagName = getJsxTagName(node);

    if (tagName === 'GatewayProTable' || tagName === 'ProTable' || tagName === 'Table') {
      const table = extractTable(node, context);
      if (table) modules.push(table);
    }

    if (tagName === 'Modal') {
      const dialog = extractDialog(node as TSESTree.JSXElement, context);
      if (dialog) modules.push(dialog);
    }

    if (tagName === 'Statistic') {
      const stat = extractStatisticItem(node, context);
      if (stat) context.statisticItems.push(stat);
    }
  });

  // Collect statistics into a module if any were found
  if (context.statisticItems.length > 0) {
    modules.unshift({
      type: 'statistic',
      id: 'stats',
      items: context.statisticItems,
    } as StatisticModule);
  }

  // Find standalone forms (not inside modals)
  walkAst(ast, (node) => {
    if (node.type !== 'JSXElement') return;
    const tagName = getJsxTagName(node);
    if (tagName !== 'Form') return;

    // Check if this Form is inside a Modal (already captured as dialog)
    if (!context.formNodesInDialogs.has(node)) {
      const form = extractForm(node, context);
      if (form) modules.push(form);
    }
  });

  return modules;
}

class ParseContext {
  source: string;
  apiEndpointIds: string[];
  columnsArray: TSESTree.ArrayExpression | null = null;
  statisticItems: StatisticItem[] = [];
  formNodesInDialogs = new Set<TSESTree.Node>();
  moduleCounter = 0;

  constructor(source: string, apiEndpointIds: string[]) {
    this.source = source;
    this.apiEndpointIds = apiEndpointIds;
  }

  nextId(prefix: string): string {
    return `${prefix}-${this.moduleCounter++}`;
  }
}

// ============================================================================
// Table extraction
// ============================================================================

function extractTable(node: TSESTree.Node, ctx: ParseContext): TableModule | null {
  const attrs = getJsxAttributes(node);
  const columns = ctx.columnsArray ? extractColumns(ctx.columnsArray) : [];

  if (columns.length === 0) return null;

  // Find data API from request prop
  const dataApi = findApiReference(attrs.request, ctx) || '';

  // Extract toolbar actions from toolBarRender
  const toolbarActions = extractToolbarActions(attrs.toolBarRender, ctx);

  // Extract row actions from the last column if it's an action column
  const rowActions = extractRowActions(columns, ctx);

  return {
    type: 'table',
    id: ctx.nextId('table'),
    title: getLiteralValue(attrs.headerTitle) as string | undefined,
    rowKey: (getLiteralValue(attrs.rowKey) as string) || 'id',
    columns: columns.filter((c) => c.key !== 'action'),
    dataApi,
    pagination: attrs.pagination !== 'false',
    toolbarActions: toolbarActions.length > 0 ? toolbarActions : undefined,
    rowActions: rowActions.length > 0 ? rowActions : undefined,
  };
}

function extractColumns(arr: TSESTree.ArrayExpression): TableColumn[] {
  const columns: TableColumn[] = [];

  for (const elem of arr.elements) {
    if (elem?.type !== 'ObjectExpression') continue;

    const col: TableColumn = { key: '', title: '' };

    for (const prop of elem.properties) {
      if (prop.type !== 'Property' || prop.key.type !== 'Identifier') continue;

      const key = prop.key.name;
      const val = prop.value;

      if (key === 'dataIndex' && val.type === 'Literal') col.key = String(val.value);
      if (key === 'key' && val.type === 'Literal' && !col.key) col.key = String(val.value);
      if (key === 'title' && val.type === 'Literal') col.title = String(val.value);
      if (key === 'width' && val.type === 'Literal') col.width = Number(val.value);
      if (key === 'ellipsis' && val.type === 'Literal') col.ellipsis = val.value === true;
      if (key === 'fixed' && val.type === 'Literal') col.fixed = val.value as 'left' | 'right';
      if (key === 'valueType' && val.type === 'Literal') {
        col.valueType = val.value as TableColumn['valueType'];
      }
    }

    if (col.title || col.key) {
      columns.push(col);
    }
  }

  return columns;
}

// ============================================================================
// Form extraction
// ============================================================================

function extractForm(node: TSESTree.JSXElement, ctx: ParseContext): FormModule | null {
  const attrs = getJsxAttributes(node);
  const fields = extractFormFields(node);

  if (fields.length === 0) return null;

  const layout = getLiteralValue(attrs.layout) as string | undefined;
  const submitApi = findApiReference(attrs.onFinish, ctx);

  return {
    type: 'form',
    id: ctx.nextId('form'),
    layout: layout as FormModule['layout'],
    fields,
    submitApi: submitApi || undefined,
  };
}

function extractFormFields(formNode: TSESTree.JSXElement): FormField[] {
  const fields: FormField[] = [];
  let currentGroup: string | undefined;

  walkJsx(formNode, (node) => {
    const tagName = getJsxTagName(node);

    // Track Collapse panels as groups
    if (tagName === 'Collapse') {
      currentGroup = undefined; // Will be set by inner label
    }

    if (tagName !== 'Form.Item' && tagName !== 'FormItem') return;

    const attrs = getJsxAttributes(node);
    const name = getLiteralValue(attrs.name) as string;
    if (!name) return;

    const label = getLiteralValue(attrs.label) as string || name;
    const required = extractRequired(attrs.rules);

    // Determine field type from the child input component
    const fieldType = detectFieldType(node as TSESTree.JSXElement);

    // Extract options for Select components
    const options = extractSelectOptions(node as TSESTree.JSXElement);

    // Extract placeholder
    const placeholder = extractPlaceholder(node as TSESTree.JSXElement);

    // Extract initial/default value
    const defaultValue = getLiteralValue(attrs.initialValue);

    const field: FormField = {
      name,
      label,
      fieldType,
      required,
      placeholder: placeholder || undefined,
      defaultValue: defaultValue ?? undefined,
      options: options.length > 0 ? options : undefined,
      group: currentGroup,
    };

    fields.push(field);
  });

  return fields;
}

function detectFieldType(formItem: TSESTree.JSXElement): FieldType {
  let fieldType: FieldType = 'text';

  walkJsx(formItem, (node) => {
    const tag = getJsxTagName(node);

    if (tag === 'Input.Password') fieldType = 'password';
    else if (tag === 'Input.TextArea' || tag === 'TextArea') fieldType = 'textarea';
    else if (tag === 'InputNumber') fieldType = 'number';
    else if (tag === 'Select') fieldType = 'select';
    else if (tag === 'DatePicker') fieldType = 'date';
    else if (tag === 'RangePicker' || tag === 'DatePicker.RangePicker') fieldType = 'dateRange';
    else if (tag === 'Checkbox') fieldType = 'checkbox';
    else if (tag === 'Radio' || tag === 'Radio.Group') fieldType = 'radio';
    else if (tag === 'Switch') fieldType = 'switch';
    else if (tag === 'Upload') fieldType = 'upload';
    // Input is default (text)
  });

  return fieldType;
}

function extractSelectOptions(formItem: TSESTree.JSXElement): { label: string; value: string | number | boolean }[] {
  const options: { label: string; value: string | number | boolean }[] = [];

  walkJsx(formItem, (node) => {
    const tag = getJsxTagName(node);
    if (tag !== 'Select.Option' && tag !== 'Option') return;

    const attrs = getJsxAttributes(node);
    const value = getLiteralValue(attrs.value);
    if (value === null) return;

    // Get the label from children text
    let label = String(value);
    if (node.type === 'JSXElement') {
      const textChild = node.children?.find(
        (c: any) => c.type === 'JSXText' && c.value.trim(),
      );
      if (textChild && 'value' in textChild) {
        label = (textChild.value as string).trim();
      }
    }

    options.push({ label, value });
  });

  return options;
}

function extractPlaceholder(node: TSESTree.JSXElement): string | null {
  let placeholder: string | null = null;

  walkJsx(node, (child) => {
    if (placeholder) return; // already found
    const tag = getJsxTagName(child);
    if (tag?.startsWith('Form')) return; // don't look at nested form items

    const attrs = getJsxAttributes(child);
    if (attrs.placeholder) {
      placeholder = getLiteralValue(attrs.placeholder) as string;
    }
  });

  return placeholder;
}

function extractRequired(rulesAttr: any): boolean {
  // rules={[{ required: true, message: '...' }]}
  if (!rulesAttr) return false;
  // Quick heuristic: check if source contains "required: true" or "required:true"
  // This is simpler than deep AST analysis of the rules array
  if (typeof rulesAttr === 'string') return false;
  // For JSXExpressionContainer with array
  return true; // If rules exist, assume required (conservative)
}

// ============================================================================
// Dialog extraction
// ============================================================================

function extractDialog(node: TSESTree.JSXElement, ctx: ParseContext): DialogModule | null {
  const attrs = getJsxAttributes(node);
  const title = getLiteralValue(attrs.title) as string;

  // Find Form inside Modal
  const content: PageModule[] = [];
  walkJsx(node, (child) => {
    const tag = getJsxTagName(child);
    if (tag === 'Form' && child.type === 'JSXElement') {
      ctx.formNodesInDialogs.add(child);
      const form = extractForm(child, ctx);
      if (form) content.push(form);
    }
  });

  if (!title && content.length === 0) return null;

  return {
    type: 'dialog',
    id: ctx.nextId('dialog'),
    title: title || 'Dialog',
    content,
  };
}

// ============================================================================
// Statistic extraction
// ============================================================================

function extractStatisticItem(node: TSESTree.Node, _ctx: ParseContext): StatisticItem | null {
  const attrs = getJsxAttributes(node);
  const title = getLiteralValue(attrs.title) as string;
  if (!title) return null;

  return {
    title,
    key: title, // Use title as key for now
  };
}

// ============================================================================
// Action extraction
// ============================================================================

function extractToolbarActions(
  _toolBarRenderAttr: any,
  ctx: ParseContext,
): ActionItem[] {
  // toolBarRender is typically a function returning JSX array
  // For now, we do a simpler approach: scan all top-level Button JSX in the source
  // A full implementation would trace the toolBarRender function body
  return [];
}

function extractRowActions(columns: TableColumn[], _ctx: ParseContext): ActionItem[] {
  // Row actions are typically in the last column with key='action'
  // The actual actions are in the render function which requires deeper analysis
  // For now, return empty - will be enhanced with pattern matching
  return [];
}

// ============================================================================
// Utility: JSX helpers
// ============================================================================

function getJsxTagName(node: TSESTree.Node): string | null {
  if (node.type === 'JSXElement' && node.openingElement) {
    return jsxNameToString(node.openingElement.name);
  }
  return null;
}

function jsxNameToString(name: TSESTree.JSXTagNameExpression): string {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') {
    return `${jsxNameToString(name.object)}.${name.property.name}`;
  }
  return '';
}

function getJsxAttributes(node: TSESTree.Node): Record<string, any> {
  const attrs: Record<string, any> = {};

  let attributes: TSESTree.JSXAttribute[] | TSESTree.JSXSpreadAttribute[] = [];
  if (node.type === 'JSXElement') {
    attributes = node.openingElement.attributes as any;
  }

  for (const attr of attributes) {
    if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier') continue;

    const name = attr.name.name;
    const val = attr.value;

    if (!val) {
      attrs[name] = true;
      continue;
    }

    if (val.type === 'Literal') {
      attrs[name] = val.value;
    } else if (val.type === 'JSXExpressionContainer') {
      attrs[name] = val.expression;
    } else {
      attrs[name] = val;
    }
  }

  return attrs;
}

function getLiteralValue(val: any): string | number | boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
  if (val?.type === 'Literal') return val.value;
  if (val?.type === 'TemplateLiteral' && val.quasis?.length === 1) {
    return val.quasis[0].value.raw;
  }
  return null;
}

function findApiReference(_expr: any, _ctx: ParseContext): string | null {
  // TODO: trace function calls to map them to API endpoint IDs
  return null;
}

// ============================================================================
// AST Walker
// ============================================================================

function walkAst(node: any, visitor: (node: TSESTree.Node) => void) {
  if (!node || typeof node !== 'object') return;

  visitor(node);

  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && item.type) {
          walkAst(item, visitor);
        }
      }
    } else if (child && typeof child === 'object' && child.type) {
      walkAst(child, visitor);
    }
  }
}

function walkJsx(node: any, visitor: (node: TSESTree.Node) => void) {
  walkAst(node, visitor);
}
