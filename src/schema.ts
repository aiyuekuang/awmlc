/**
 * AWML (AI Web Markup Language) Specification v0.1
 *
 * AWML is to AI browsers what HTML is to traditional browsers.
 * It packages ALL information of a web application into a single structured
 * document that AI agents can read, understand, and operate on.
 *
 * Traditional web: Source Code → Build → HTML/JS/CSS → Browser renders for humans
 * AI web:          Source Code → awmlc → AWML document → AI Browser reads for agents
 */

// ============================================================================
// Top-level Document
// ============================================================================

export interface AWMLDocument {
  /** AWML specification version */
  version: '0.1';

  /** Application metadata */
  app: AppMeta;

  /** API server configuration - complete base URLs (no relative paths) */
  servers: ServerConfig[];

  /** Authentication configuration */
  auth?: AuthConfig;

  /** All routes/pages in the application */
  pages: Page[];

  /** All API endpoints with complete URLs */
  apis: ApiEndpoint[];

  /** Global navigation structure */
  nav: NavItem[];

  /** Shared data models / TypeScript interfaces */
  models?: DataModel[];
}

// ============================================================================
// Application Metadata
// ============================================================================

export interface AppMeta {
  /** Application name */
  name: string;
  /** Application title (shown in browser tab) */
  title: string;
  /** Framework used (umi, next, vite-react, vue, etc.) */
  framework: string;
  /** Framework version */
  frameworkVersion?: string;
  /** Source directory path (for reference) */
  sourceDir: string;
}

// ============================================================================
// Server Configuration
// ============================================================================

export interface ServerConfig {
  /** Identifier for this server config */
  id: string;
  /** Complete base URL (resolved from proxy config) e.g. "http://localhost:4000" */
  baseUrl: string;
  /** Path prefixes that map to this server e.g. ["/gateway", "/api"] */
  prefixes: string[];
  /** Description */
  description?: string;
}

// ============================================================================
// Authentication
// ============================================================================

export interface AuthConfig {
  /** Auth type */
  type: 'token' | 'session' | 'oauth2' | 'custom';
  /** Login API endpoint id (references ApiEndpoint.id) */
  loginApi?: string;
  /** Where the token is stored */
  tokenStorage?: 'localStorage' | 'sessionStorage' | 'cookie';
  /** Token key name in storage */
  tokenKey?: string;
  /** How token is sent in requests */
  tokenTransport?: {
    type: 'header' | 'query' | 'cookie';
    name: string; // e.g. "Authorization"
    prefix?: string; // e.g. "Bearer "
  };
}

// ============================================================================
// Pages
// ============================================================================

export interface Page {
  /** Unique page identifier (usually the route path) */
  id: string;
  /** Route path e.g. "/tenants" */
  path: string;
  /** Page display name */
  name: string;
  /** Page title/description */
  title?: string;
  /** Icon identifier */
  icon?: string;
  /** Source file path (relative to project root) */
  sourceFile: string;
  /** Layout configuration */
  layout?: boolean;
  /** Whether this is a redirect */
  redirect?: string;
  /** Page content modules */
  modules: PageModule[];
}

// ============================================================================
// Page Modules - the semantic building blocks
// ============================================================================

export type PageModule =
  | TableModule
  | FormModule
  | DetailModule
  | StatisticModule
  | ChartModule
  | ActionGroupModule
  | DialogModule
  | FilterModule;

export interface TableModule {
  type: 'table';
  /** Module id within the page */
  id: string;
  /** Table title */
  title?: string;
  /** Row key field */
  rowKey: string;
  /** Column definitions */
  columns: TableColumn[];
  /** API used to fetch data */
  dataApi: string; // references ApiEndpoint.id
  /** Whether table supports pagination */
  pagination?: boolean;
  /** Toolbar actions (buttons above the table) */
  toolbarActions?: ActionItem[];
  /** Row-level actions (buttons in action column) */
  rowActions?: ActionItem[];
}

export interface TableColumn {
  /** Column key / dataIndex */
  key: string;
  /** Display title */
  title: string;
  /** Data type hint */
  valueType?: 'text' | 'number' | 'date' | 'dateTime' | 'status' | 'enum' | 'custom';
  /** Width */
  width?: number;
  /** Whether text is truncated */
  ellipsis?: boolean;
  /** Fixed position */
  fixed?: 'left' | 'right';
  /** For enum/status type: mapping of values to labels */
  valueEnum?: Record<string, { text: string; color?: string }>;
}

export interface FormModule {
  type: 'form';
  id: string;
  /** Form title */
  title?: string;
  /** Form layout direction */
  layout?: 'vertical' | 'horizontal' | 'inline';
  /** Form fields */
  fields: FormField[];
  /** API called on submit */
  submitApi?: string; // references ApiEndpoint.id
  /** Submit button label */
  submitLabel?: string;
}

export interface FormField {
  /** Field name (form data key) */
  name: string;
  /** Display label */
  label: string;
  /** Field input type */
  fieldType: FieldType;
  /** Whether field is required */
  required?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Default value */
  defaultValue?: any;
  /** Validation rules description */
  rules?: string[];
  /** For select/radio: available options */
  options?: FieldOption[];
  /** Whether field is disabled */
  disabled?: boolean;
  /** For number inputs: min/max constraints */
  min?: number;
  max?: number;
  /** Nested fields (for grouped/collapsible sections) */
  group?: string;
}

export type FieldType =
  | 'text'
  | 'password'
  | 'number'
  | 'email'
  | 'phone'
  | 'textarea'
  | 'select'
  | 'multiSelect'
  | 'date'
  | 'dateTime'
  | 'dateRange'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'file'
  | 'upload'
  | 'hidden'
  | 'custom';

export interface FieldOption {
  label: string;
  value: string | number | boolean;
}

export interface DetailModule {
  type: 'detail';
  id: string;
  title?: string;
  /** Description list items */
  items: { label: string; key: string; span?: number }[];
  /** API to fetch detail data */
  dataApi?: string;
}

export interface StatisticModule {
  type: 'statistic';
  id: string;
  /** Statistic items */
  items: StatisticItem[];
  /** API to fetch statistic data */
  dataApi?: string;
}

export interface StatisticItem {
  title: string;
  /** Data key in API response */
  key: string;
  /** Display format */
  format?: 'number' | 'percent' | 'currency' | 'progress';
  icon?: string;
  color?: string;
}

export interface ChartModule {
  type: 'chart';
  id: string;
  title?: string;
  chartType: 'line' | 'bar' | 'pie' | 'area' | 'gauge' | 'dashboard';
  dataApi?: string;
}

export interface ActionGroupModule {
  type: 'actionGroup';
  id: string;
  actions: ActionItem[];
}

export interface DialogModule {
  type: 'dialog';
  id: string;
  title: string;
  /** Trigger action id */
  trigger?: string;
  /** Dialog content modules */
  content: PageModule[];
  /** Dialog footer actions */
  actions?: ActionItem[];
}

export interface FilterModule {
  type: 'filter';
  id: string;
  fields: FormField[];
  /** The table module this filter targets */
  targetTable?: string;
}

// ============================================================================
// Actions
// ============================================================================

export interface ActionItem {
  /** Action identifier */
  id: string;
  /** Display label */
  label: string;
  /** Action type */
  actionType: 'api' | 'navigate' | 'dialog' | 'confirm' | 'link' | 'custom';
  /** For api type: the API endpoint id */
  api?: string;
  /** For navigate type: the target path */
  path?: string;
  /** For dialog type: the dialog module id */
  dialogId?: string;
  /** For confirm type: confirmation message */
  confirmMessage?: string;
  /** Button style */
  style?: 'primary' | 'default' | 'danger' | 'link' | 'text';
  /** Icon identifier */
  icon?: string;
  /** Whether action is dangerous (shows warning) */
  danger?: boolean;
  /** Position context */
  position?: 'toolbar' | 'row' | 'footer' | 'inline';
}

// ============================================================================
// API Endpoints
// ============================================================================

export interface ApiEndpoint {
  /** Unique endpoint identifier e.g. "tenant.list" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description (from JSDoc comments) */
  description?: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Complete URL (resolved from proxy) e.g. "http://localhost:4000/gateway/tenant/list" */
  url: string;
  /** Original path in source code e.g. "/gateway/tenant/list" */
  originalPath: string;
  /** Request parameters schema */
  request?: ApiParams;
  /** Response schema description */
  response?: ApiResponse;
  /** Request content type */
  contentType?: 'json' | 'form' | 'multipart';
  /** Timeout in ms */
  timeout?: number;
  /** Which API group this belongs to e.g. "tenantAPI" */
  group?: string;
}

export interface ApiParams {
  /** Parameter fields */
  fields: ApiParamField[];
}

export interface ApiParamField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file';
  required?: boolean;
  description?: string;
  /** For nested objects */
  children?: ApiParamField[];
}

export interface ApiResponse {
  /** Standard response wrapper */
  wrapper?: {
    codeField: string;
    messageField: string;
    dataField: string;
    successCode: number | string;
  };
  /** Data type description */
  dataType?: string;
}

// ============================================================================
// Navigation
// ============================================================================

export interface NavItem {
  /** Display name */
  name: string;
  /** Route path */
  path: string;
  /** Icon identifier */
  icon?: string;
  /** Child navigation items */
  children?: NavItem[];
  /** Whether this is the active/default route */
  isDefault?: boolean;
}

// ============================================================================
// Data Models
// ============================================================================

export interface DataModel {
  /** Model name e.g. "Tenant" */
  name: string;
  /** Source (interface name in code) */
  source?: string;
  /** Model fields */
  fields: DataModelField[];
}

export interface DataModelField {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}
