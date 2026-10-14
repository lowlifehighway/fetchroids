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

export interface RequestConfig extends RequestOptions {
  url: string;
  method: string;
  headers: Headers;
  params: URLSearchParams;
}

type MaybePromise<T> = T | Promise<T>;

export type RequestInterceptor = (
  config: RequestConfig,
) => MaybePromise<RequestConfig | void>;

export type ResponseInterceptor = (
  result: FetchroidsResponse<any>,
  config: RequestConfig,
) => MaybePromise<FetchroidsResponse<any> | void>;

export type ErrorInterceptor = (
  error: unknown,
  config: RequestConfig,
) => MaybePromise<FetchroidsResponse<any> | void>;

export interface Interceptors {
  request: { use: (interceptor: RequestInterceptor) => () => void };
  response: {
    use: (
      onResponse?: ResponseInterceptor | null,
      onError?: ErrorInterceptor | null,
    ) => () => void;
  };
}

type ResponseHandlers = [
  onResponse?: ResponseInterceptor | null,
  onError?: ErrorInterceptor | null,
];

type Method = <T = any>(
  url: string,
  options?: RequestOptions,
) => Promise<FetchroidsResponse<T>>;

export interface Fetchroids {
  request: <T = any>(
    config: RequestOptions & { url: string; method?: string },
  ) => Promise<FetchroidsResponse<T>>;
  get: Method;
  post: Method;
  put: Method;
  patch: Method;
  delete: Method;
  create: (defaults?: RequestOptions) => Fetchroids;
  interceptors: Interceptors;
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

async function send<T>(config: RequestConfig): Promise<FetchroidsResponse<T>> {
  const {
    url,
    method,
    body,
    params,
    baseURL,
    retry = 3,
    retryDelay = 3000,
    timeout = 10000,
    signal,
    headers: userHeaders,
    ...init
  } = config;

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

function register<T>(list: T[], item: T) {
  list.push(item);
  return () => {
    const index = list.indexOf(item);
    if (index !== -1) list.splice(index, 1);
  };
}

function build(
  defaults: RequestOptions,
  inheritedRequest: RequestInterceptor[],
  inheritedResponse: ResponseHandlers[],
): Fetchroids {
  const requestInterceptors = [...inheritedRequest];
  const responseInterceptors = [...inheritedResponse];

  const request: Fetchroids['request'] = async ({ url, method, ...options }) => {
    let config: RequestConfig = {
      ...mergeOptions(defaults, options),
      url,
      method: (method ?? 'GET').toUpperCase(),
    };
    for (const interceptor of [...requestInterceptors]) {
      config = (await interceptor(config)) ?? config;
    }
    let result = send<any>(config);
    for (const [onResponse, onError] of [...responseInterceptors]) {
      result = result.then(
        onResponse &&
          (async (value) => (await onResponse(value, config)) ?? value),
        onError &&
          (async (error) => {
            const recovered = await onError(error, config);
            if (recovered === undefined) throw error;
            return recovered;
          }),
      );
    }
    return result;
  };

  const method =
    (name: string): Method =>
    (url, options) =>
      request({ ...options, url, method: name });

  return {
    request,
    get: method('GET'),
    post: method('POST'),
    put: method('PUT'),
    patch: method('PATCH'),
    delete: method('DELETE'),
    create: (overrides = {}) =>
      build(
        mergeOptions(defaults, overrides),
        requestInterceptors,
        responseInterceptors,
      ),
    interceptors: {
      request: {
        use: (interceptor) => register(requestInterceptors, interceptor),
      },
      response: {
        use: (onResponse, onError) =>
          register(responseInterceptors, [onResponse, onError]),
      },
    },
  };
}

export function create(defaults: RequestOptions = {}): Fetchroids {
  return build(defaults, [], []);
}

const api = create();

export default api;
