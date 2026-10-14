export type Params = Record<string, unknown> | URLSearchParams;

export interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  body?: unknown;
  params?: Params;
  baseURL?: string;
  retry?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface FetchroidsResponse<T> {
  data: T;
  response: Response;
}

type Method = <T = any>(
  url: string,
  options?: RequestOptions,
) => Promise<FetchroidsResponse<T>>;

export interface Fetchroids {
  get: Method;
  post: Method;
  put: Method;
  patch: Method;
  delete: Method;
  create: (defaults?: RequestOptions) => Fetchroids;
}

export class HttpError<T = any> extends Error {
  status: number;
  statusText: string;
  response: Response;
  data: T;

  constructor(response: Response, data: T) {
    const { status, statusText } = response;
    super(`Error ${status}${statusText ? `: ${statusText}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.response = response;
    this.data = data;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isJSONBody(body: unknown) {
  if (Array.isArray(body)) return true;
  if (body === null || typeof body !== 'object') return false;
  const proto = Object.getPrototypeOf(body);
  return proto === Object.prototype || proto === null;
}

function toSearchParams(params?: Params) {
  if (params instanceof URLSearchParams) return new URLSearchParams(params);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null) search.append(key, String(item));
    }
  }
  return search;
}

function mergeParams(base?: Params, overrides?: Params) {
  const merged = toSearchParams(base);
  const extra = toSearchParams(overrides);
  for (const key of new Set(extra.keys())) merged.delete(key);
  for (const [key, value] of extra) merged.append(key, value);
  return merged;
}

function mergeOptions(base: RequestOptions, overrides: RequestOptions) {
  const headers = new Headers(base.headers);
  new Headers(overrides.headers).forEach((value, key) =>
    headers.set(key, value),
  );
  return {
    ...base,
    ...overrides,
    headers,
    params: mergeParams(base.params, overrides.params),
  };
}

function buildURL(url: string, baseURL?: string, params?: Params) {
  let full = url;
  if (baseURL && !/^[a-z][a-z\d+.-]*:/i.test(url)) {
    const base = baseURL.replace(/\/+$/, '');
    const path = url.replace(/^\/+/, '');
    full = path ? `${base}/${path}` : base;
  }
  const search = toSearchParams(params).toString();
  if (!search) return full;
  return `${full}${full.includes('?') ? '&' : '?'}${search}`;
}

function parse(response: Response, text: string) {
  const isJSON = response.headers.get('content-type')?.includes('json');
  if (!isJSON) return text;
  return text ? JSON.parse(text) : null;
}

async function request<T>(
  method: string,
  url: string,
  options: RequestOptions,
): Promise<FetchroidsResponse<T>> {
  const {
    body,
    params,
    baseURL,
    retry = 3,
    retryDelay = 3000,
    timeout = 10000,
    signal,
    headers: userHeaders,
    ...init
  } = options;

  const headers = new Headers(userHeaders);
  let payload = body as BodyInit | null | undefined;
  if (isJSONBody(body)) {
    payload = JSON.stringify(body);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  const target = buildURL(url, baseURL, params);

  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt >= retry;
    const timeoutSignal = AbortSignal.timeout(timeout);
    let response: Response;
    let text = '';
    let shouldRetry = false;
    try {
      response = await fetch(target, {
        ...init,
        method,
        headers,
        body: payload,
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
      });
      shouldRetry = response.status >= 500 && !isLastAttempt;
      if (shouldRetry) await response.body?.cancel();
      else text = await response.text();
    } catch (error) {
      if (isLastAttempt || signal?.aborted) throw error;
      await sleep(retryDelay);
      continue;
    }
    if (shouldRetry) {
      await sleep(retryDelay);
      continue;
    }
    const data = parse(response, text);
    if (!response.ok) throw new HttpError(response, data);
    return { data, response };
  }
}

export function create(defaults: RequestOptions = {}): Fetchroids {
  const method =
    (name: string): Method =>
    (url, options = {}) =>
      request(name, url, mergeOptions(defaults, options));

  return {
    get: method('GET'),
    post: method('POST'),
    put: method('PUT'),
    patch: method('PATCH'),
    delete: method('DELETE'),
    create: (overrides = {}) => create(mergeOptions(defaults, overrides)),
  };
}

const api = create();

export default api;
