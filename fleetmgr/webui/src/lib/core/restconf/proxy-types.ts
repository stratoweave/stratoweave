export interface ProxyRouteConfig {
  origin: string;
  path: string;
  search: string;
}

export interface RestconfRequestOptions {
  accept?: string;
  contentType?: string;
  readBody?: boolean;
}
