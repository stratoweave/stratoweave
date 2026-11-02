// Reads a transform layer from the top's /layer/<idx> inspection endpoint,
// which sits next to RESTCONF. The output format follows the Accept header,
// and the content parameter picks config, operational state or both.

type Fetch = typeof fetch;

export type LayerContent = 'config' | 'nonconfig' | 'all';
export type LayerFormat = 'xml' | 'json' | 'adata';

export const CONTENT_OPTIONS: { value: LayerContent; label: string }[] = [
  { value: 'config', label: 'Config' },
  { value: 'nonconfig', label: 'Oper' },
  { value: 'all', label: 'All' }
];

export const FORMAT_OPTIONS: { value: LayerFormat; label: string }[] = [
  { value: 'xml', label: 'XML' },
  { value: 'json', label: 'JSON' },
  { value: 'adata', label: 'AData' }
];

const ACCEPT: Record<LayerFormat, string> = {
  xml: 'application/yang-data+xml',
  json: 'application/yang-data+json',
  adata: 'application/yang-data+acton-adata'
};

export function parseContent(value: string | null): LayerContent {
  return CONTENT_OPTIONS.find((option) => option.value === value)?.value ?? 'config';
}

export function parseFormat(value: string | null): LayerFormat {
  return FORMAT_OPTIONS.find((option) => option.value === value)?.value ?? 'xml';
}

export async function fetchLayer(
  index: number,
  content: LayerContent,
  format: LayerFormat,
  fetchFn: Fetch = fetch
): Promise<string> {
  const response = await fetchFn(`/layer/${index}?content=${content}`, {
    headers: { accept: ACCEPT[format] }
  });
  if (!response.ok) {
    const message = (await response.text()) || response.statusText;
    throw new Error(`Layer ${index} ${response.status}: ${message}`);
  }
  return response.text();
}
