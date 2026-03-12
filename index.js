async function request(url, userOptions = {}) {
  const retry = userOptions.retry ?? 3;
  const retryDelay = userOptions.retryDelay ?? 3000;
  let res;
  let attempts = 0;
  const options = {
    method: userOptions.method || 'GET',
    headers: userOptions.headers,
    credentials: userOptions.credentials,
    body: ['POST', 'PUT', 'PATCH'].includes(userOptions.method)
      ? JSON.stringify(userOptions.body)
      : undefined,
    signal: AbortSignal.timeout(userOptions.timeout ?? 10000),
    ...userOptions,
  };
  while (attempts < retry) {
    try {
      res = await fetch(url, options);
      if (res.ok) break;
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Error ${res.status}: ${res.statusText}`);
      }
    } catch (error) {
      attempts++;
      if (attempts >= retry) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  if (!res.ok) {
    throw new Error(`Error ${res.status}, ${res.statusText}`);
  }
  let data;
  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { data, response: res };
}
const api = {
  get: (url, options) => request(url, { ...options, method: 'GET' }),
  post: (url, options) => request(url, { ...options, method: 'POST' }),
  put: (url, options) => request(url, { ...options, method: 'PUT' }),
  patch: (url, options) => request(url, { ...options, method: 'PATCH' }),
  delete: (url, options) => request(url, { ...options, method: 'DELETE' }),
};
export default api;
