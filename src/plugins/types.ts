export type FieldType =
  | 'text'
  | 'textarea'
  | 'color'
  | 'number'
  | 'checkbox'
  | 'select';

export interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  default: string;
  options: { value: string; label: string }[];
  help: string;
}

export interface PluginMeta {
  name: string;
  version: string;
  author: string;
  description: string;
  settings: ConfigField[];
}

export interface PluginApi {
  listPosts: (opts?: { limit?: number }) => unknown[];
}

// A plugin module is a plain object (default export of index.mjs).
export interface PluginModule {
  name?: string;
  // Return a string to inject HTML at the hook point.
  hooks?: Record<string, (ctx: Record<string, unknown>) => string | void>;
  // Side-effect listeners for lifecycle events.
  events?: Record<string, (data: Record<string, unknown>) => void>;
  // Register extra routes (mounted at startup for enabled plugins).
  routes?: (app: unknown, ctx: { api: PluginApi }) => void;
}
