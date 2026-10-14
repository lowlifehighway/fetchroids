# fetchroids 🚀

A lightweight, modern fetch wrapper with automatic retries, timeout support, and smart response parsing.

## Features

- ✅ Automatic retries with configurable delay
- ✅ Per-attempt request timeout via `AbortSignal`
- ✅ Auto-serialises JSON bodies and auto-parses JSON responses
- ✅ Clean API: `get`, `post`, `put`, `patch`, `delete`
- ✅ Reusable instances with `baseURL` and default options
- ✅ Request and response interceptors
- ✅ Query params
- ✅ `HttpError` with status, response and parsed error body
- ✅ 4xx errors fail fast (no retry)
- ✅ Written in TypeScript, zero dependencies

## Installation

```bash
npm install fetchroids
```

or

```bash
yarn add fetchroids
```

## Usage

```js
import api from 'fetchroids';

// GET request
const { data } = await api.get('https://api.example.com/users');

// POST request
const { data } = await api.post('https://api.example.com/posts', {
  body: { title: 'Hello', content: 'World' },
});

// PUT request
const { data } = await api.put('https://api.example.com/posts/1', {
  body: { title: 'Updated' },
});

// PATCH request
const { data } = await api.patch('https://api.example.com/posts/1', {
  body: { title: 'Patched Title' },
});

// DELETE request
const { data } = await api.delete('https://api.example.com/posts/1');
```

## Options

All methods accept an optional `options` object. Any other standard `fetch` option (`credentials`, `signal`, `cache`, `mode`, …) is passed straight through.

| Option       | Type                        | Default     | Description                                               |
| ------------ | --------------------------- | ----------- | --------------------------------------------------------- |
| `headers`    | `HeadersInit`               | `undefined` | Custom request headers                                    |
| `body`       | `unknown`                   | `undefined` | Request body, see [Request bodies](#request-bodies)       |
| `params`     | `object \| URLSearchParams` | `undefined` | Query params appended to the URL                          |
| `baseURL`    | `string`                    | `undefined` | Prefix for relative URLs                                  |
| `retry`      | `number`                    | `3`         | Number of retries after the first attempt (`0` disables)  |
| `retryDelay` | `number`                    | `3000`      | Delay in ms between retries                               |
| `timeout`    | `number`                    | `10000`     | Timeout in ms for each attempt                            |
| `signal`     | `AbortSignal`               | `undefined` | Cancels the request; combined with the timeout            |

### Example with options

```js
const { data, response } = await api.get('https://api.example.com/data', {
  headers: { Authorization: 'Bearer my-token' },
  params: { page: 2, tags: ['a', 'b'] }, // ?page=2&tags=a&tags=b
  timeout: 5000,
  retry: 2,
  retryDelay: 1000,
});
```

`null` and `undefined` params are skipped, and arrays become repeated keys.

## Request bodies

Plain objects and arrays are JSON-stringified and sent with `Content-Type: application/json` (unless you set your own). Everything else — strings, `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer` — is passed to `fetch` untouched, so the browser or Node sets the right content type.

```js
const form = new FormData();
form.append('avatar', file);
await api.post('https://api.example.com/upload', { body: form });
```

## Instances

Use `create` to share defaults across requests. Per-request options override the defaults; headers and params are merged.

```js
import { create } from 'fetchroids';

const github = create({
  baseURL: 'https://api.github.com',
  headers: { Authorization: 'Bearer my-token' },
  timeout: 5000,
});

const { data } = await github.get('/user/repos', { params: { per_page: 50 } });

// Instances can be extended
const uploads = github.create({ timeout: 60000 });
```

Absolute URLs ignore `baseURL`.

## Interceptors

Interceptors run before a request is sent and after it settles. Each `use` call returns a function that removes the interceptor.

```js
import { create, HttpError } from 'fetchroids';

const client = create({ baseURL: 'https://api.example.com' });

// Request: change the config in place, or return a new one
const eject = client.interceptors.request.use((config) => {
  config.headers.set('Authorization', `Bearer ${getToken()}`);
});

// Response: return a new result to replace it, or nothing to keep it
client.interceptors.response.use((result, config) => {
  console.log(config.method, config.url, result.response.status);
});

// Errors: return a result to recover, or nothing to let the error through
client.interceptors.response.use(null, async (error, config) => {
  if (error instanceof HttpError && error.status === 401 && !config.retried) {
    await refreshToken();
    return client.request({ ...config, retried: true });
  }
});

eject();
```

- `config` is the merged request: `url`, `method`, `headers` (a `Headers` object), `params` (a `URLSearchParams`) and every other option.
- Request interceptors run once per call, not once per retry attempt.
- Error interceptors run after retries are exhausted.
- `client.request(config)` sends a request from a config object and runs the interceptors again, so guard against loops as above.
- Instances made with `client.create()` start with a copy of the parent's interceptors.

## Return Value

Each method returns an object with:

- `data` — Parsed JSON (if the content type is JSON), `null` for an empty JSON response, or raw text otherwise
- `response` — The original `Response` object for status codes, headers, etc.

## Error Handling

- **4xx errors** throw an `HttpError` immediately without retrying
- **5xx errors** are retried up to the `retry` limit, then throw an `HttpError`
- **Timeouts and network errors** are retried up to the `retry` limit, then throw the underlying error
- **Aborting** via your own `signal` stops immediately without retrying

```js
import api, { HttpError } from 'fetchroids';

try {
  const { data } = await api.get('https://api.example.com/protected');
} catch (err) {
  if (err instanceof HttpError) {
    console.error(err.status); // 401
    console.error(err.message); // "Error 401: Unauthorized"
    console.error(err.data); // parsed error body from the server
    console.error(err.response); // original Response
  }
}
```

## TypeScript

Types are included. Pass a type argument to type `data`:

```ts
interface User {
  id: number;
  name: string;
}

const { data } = await api.get<User[]>('https://api.example.com/users');
```

## Development

```bash
npm install
npm test          # runs the TypeScript tests directly (Node 22.18+)
npm run typecheck
npm run build     # emits dist/
```

## Requirements

- Node.js 20.3+ or any modern browser (uses native `fetch`, `AbortSignal.timeout` and `AbortSignal.any`)
- ES Modules (`"type": "module"` in your `package.json`)

## License

MIT © Victor Ayoola
