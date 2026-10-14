import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import api, { HttpError, create } from '../src/index.ts';

let base = '';
let hits: Record<string, number> = {};

const server = http.createServer((req, res) => {
  const { pathname, search } = new URL(req.url ?? '/', 'http://localhost');
  hits[pathname] = (hits[pathname] ?? 0) + 1;
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (pathname === '/echo') {
      return json(200, {
        method: req.method,
        search,
        body: Buffer.concat(chunks).toString(),
        headers: req.headers,
      });
    }
    if (pathname === '/404') return json(404, { message: 'nope' });
    if (pathname === '/500') return json(500, { message: 'boom' });
    if (pathname === '/flaky') {
      return hits[pathname] < 3 ? json(503, {}) : json(200, { ok: true });
    }
    if (pathname === '/204') {
      res.writeHead(204, { 'content-type': 'application/json' });
      return res.end();
    }
    if (pathname === '/text') return res.end('hello');
    if (pathname === '/slow') return setTimeout(() => res.end('ok'), 300);
    if (pathname === '/slow-once') {
      return setTimeout(() => res.end('ok'), hits[pathname] === 1 ? 300 : 0);
    }
    res.writeHead(404).end();
  });
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  hits = {};
});

test('object bodies are sent as JSON with a JSON content type', async () => {
  const { data } = await api.post(`${base}/echo`, { body: { a: 1 } });
  assert.equal(data.body, '{"a":1}');
  assert.equal(data.headers['content-type'], 'application/json');
});

test('a custom content type is not overwritten', async () => {
  const { data } = await api.post(`${base}/echo`, {
    body: { a: 1 },
    headers: { 'Content-Type': 'application/vnd.api+json' },
  });
  assert.equal(data.headers['content-type'], 'application/vnd.api+json');
});

test('non-JSON bodies are passed through untouched', async () => {
  const text = await api.post(`${base}/echo`, { body: 'plain' });
  assert.equal(text.data.body, 'plain');
  assert.match(text.data.headers['content-type'], /^text\/plain/);

  const form = await api.post(`${base}/echo`, {
    body: new URLSearchParams({ a: '1' }),
  });
  assert.equal(form.data.body, 'a=1');
  assert.match(
    form.data.headers['content-type'],
    /^application\/x-www-form-urlencoded/,
  );

  const formData = new FormData();
  formData.append('a', '1');
  const multipart = await api.post(`${base}/echo`, { body: formData });
  assert.match(multipart.data.headers['content-type'], /^multipart\/form-data/);
});

test('delete can carry a body', async () => {
  const { data } = await api.delete(`${base}/echo`, { body: { id: 1 } });
  assert.equal(data.method, 'DELETE');
  assert.equal(data.body, '{"id":1}');
});

test('4xx fails fast with an HttpError', async () => {
  await assert.rejects(
    api.get(`${base}/404`, { retryDelay: 10 }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 404);
      assert.equal(error.message, 'Error 404: Not Found');
      assert.deepEqual(error.data, { message: 'nope' });
      assert.equal(error.response.status, 404);
      return true;
    },
  );
  assert.equal(hits['/404'], 1);
});

test('5xx is retried up to the limit, then throws an HttpError', async () => {
  await assert.rejects(
    api.get(`${base}/500`, { retry: 2, retryDelay: 10 }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 500);
      assert.deepEqual(error.data, { message: 'boom' });
      return true;
    },
  );
  assert.equal(hits['/500'], 3);
});

test('a request that recovers after retries succeeds', async () => {
  const { data } = await api.get(`${base}/flaky`, { retryDelay: 10 });
  assert.deepEqual(data, { ok: true });
  assert.equal(hits['/flaky'], 3);
});

test('retry: 0 makes a single attempt', async () => {
  const ok = await api.get(`${base}/text`, { retry: 0 });
  assert.equal(ok.data, 'hello');
  await assert.rejects(api.get(`${base}/500`, { retry: 0 }), HttpError);
  assert.equal(hits['/500'], 1);
});

test('empty JSON responses resolve to null', async () => {
  const { data, response } = await api.get(`${base}/204`);
  assert.equal(data, null);
  assert.equal(response.status, 204);
});

test('each attempt gets its own timeout', async () => {
  await assert.rejects(
    api.get(`${base}/slow`, { timeout: 100, retry: 2, retryDelay: 10 }),
    { name: 'TimeoutError' },
  );
  assert.equal(hits['/slow'], 3);

  const { data } = await api.get(`${base}/slow-once`, {
    timeout: 100,
    retryDelay: 10,
  });
  assert.equal(data, 'ok');
  assert.equal(hits['/slow-once'], 2);
});

test('a user signal aborts without retrying and keeps the timeout', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(
    api.get(`${base}/slow`, { signal: controller.signal, retryDelay: 10 }),
    { name: 'AbortError' },
  );
  assert.equal(hits['/slow'], 1);

  await assert.rejects(
    api.get(`${base}/slow`, {
      signal: new AbortController().signal,
      timeout: 100,
      retry: 0,
    }),
    { name: 'TimeoutError' },
  );
});

test('params are serialised onto the URL', async () => {
  const { data } = await api.get(`${base}/echo?x=1`, {
    params: { q: 'a b', tags: ['one', 'two'], skip: undefined, none: null },
  });
  assert.equal(data.search, '?x=1&q=a+b&tags=one&tags=two');

  const fromSearchParams = await api.get(`${base}/echo`, {
    params: new URLSearchParams({ page: '2' }),
  });
  assert.equal(fromSearchParams.data.search, '?page=2');
});

test('instances apply and merge defaults', async () => {
  const client = create({
    baseURL: `${base}/`,
    headers: { Authorization: 'Bearer token', 'X-App': 'one' },
    params: { key: 'abc', page: 1 },
    retryDelay: 10,
  });
  const { data } = await client.get('/echo', {
    headers: { 'x-app': 'two' },
    params: { page: 2 },
  });
  assert.equal(data.headers.authorization, 'Bearer token');
  assert.equal(data.headers['x-app'], 'two');
  assert.equal(data.search, '?key=abc&page=2');

  const absolute = await client.get(`${base}/text`);
  assert.equal(absolute.data, 'hello');

  const child = client.create({ headers: { 'X-Child': 'yes' } });
  const fromChild = await child.post('echo', { body: [1, 2] });
  assert.equal(fromChild.data.headers.authorization, 'Bearer token');
  assert.equal(fromChild.data.headers['x-child'], 'yes');
  assert.equal(fromChild.data.body, '[1,2]');
});

test('request sends any method through a config object', async () => {
  const { data } = await api.request({
    url: `${base}/echo`,
    method: 'put',
    body: { a: 1 },
  });
  assert.equal(data.method, 'PUT');
  assert.equal(data.body, '{"a":1}');
});

test('request interceptors can change the request and be ejected', async () => {
  const client = create({ baseURL: base });
  const eject = client.interceptors.request.use((config) => {
    config.headers.set('Authorization', 'Bearer token');
    config.params.set('via', config.method);
  });
  client.interceptors.request.use(async (config) => ({
    ...config,
    url: '/echo',
  }));

  const first = await client.get('/missing');
  assert.equal(first.data.headers.authorization, 'Bearer token');
  assert.equal(first.data.search, '?via=GET');

  eject();
  const second = await client.get('/missing');
  assert.equal(second.data.headers.authorization, undefined);
});

test('response interceptors can transform results', async () => {
  const client = create({ baseURL: base });
  const seen: string[] = [];
  client.interceptors.response.use((result, config) => {
    seen.push(config.url);
  });
  client.interceptors.response.use((result) => ({
    ...result,
    data: result.data.toUpperCase(),
  }));
  const { data } = await client.get('/text');
  assert.equal(data, 'HELLO');
  assert.deepEqual(seen, ['/text']);
});

test('error interceptors can observe, recover and resend', async () => {
  const client = create({ baseURL: base, retryDelay: 10 });
  const statuses: number[] = [];
  client.interceptors.response.use(null, (error) => {
    if (error instanceof HttpError) statuses.push(error.status);
  });
  await assert.rejects(client.get('/404'), HttpError);
  assert.deepEqual(statuses, [404]);

  let token = 'stale';
  client.interceptors.request.use((config) => {
    config.headers.set('X-Token', token);
  });
  client.interceptors.response.use(null, (error, config) => {
    if (error instanceof HttpError && token === 'stale') {
      token = 'fresh';
      return client.request({ ...config, url: '/echo' });
    }
  });
  const { data } = await client.get('/404');
  assert.equal(data.headers['x-token'], 'fresh');
  assert.equal(data.method, 'GET');
});

test('child instances inherit interceptors without sharing new ones', async () => {
  const parent = create({ baseURL: base });
  parent.interceptors.request.use((config) => {
    config.headers.set('X-Parent', 'yes');
  });
  const child = parent.create();
  child.interceptors.request.use((config) => {
    config.headers.set('X-Child', 'yes');
  });

  const fromChild = await child.get('/echo');
  assert.equal(fromChild.data.headers['x-parent'], 'yes');
  assert.equal(fromChild.data.headers['x-child'], 'yes');

  const fromParent = await parent.get('/echo');
  assert.equal(fromParent.data.headers['x-child'], undefined);
});
