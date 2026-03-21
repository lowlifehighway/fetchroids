# fetchroids 🚀

A lightweight, modern fetch wrapper with automatic retries, timeout support, and smart response parsing.

## Features

- ✅ Automatic retries with configurable delay
- ✅ Request timeout via `AbortSignal`
- ✅ Auto-parses JSON responses
- ✅ Clean API: `get`, `post`, `put`, `patch`, `delete`
- ✅ 4xx errors fail fast (no retry)
- ✅ Zero dependencies

## Installation

```bash
npm install fetchroids
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

All methods accept an optional `options` object:

| Option        | Type     | Default     | Description                                               |
| ------------- | -------- | ----------- | --------------------------------------------------------- |
| `headers`     | `object` | `undefined` | Custom request headers                                    |
| `body`        | `object` | `undefined` | Request body (POST, PUT, PATCH) — auto JSON-stringified   |
| `retry`       | `number` | `3`         | Number of retry attempts on failure                       |
| `retryDelay`  | `number` | `3000`      | Delay in ms between retries                               |
| `timeout`     | `number` | `10000`     | Request timeout in ms                                     |
| `credentials` | `string` | `undefined` | Fetch credentials option (`include`, `same-origin`, etc.) |

### Example with options

```js
const { data, response } = await api.get('https://api.example.com/data', {
  headers: { Authorization: 'Bearer my-token' },
  timeout: 5000,
  retry: 2,
  retryDelay: 1000,
});
```

## Return Value

Each method returns an object with:

- `data` — Parsed JSON (if `Content-Type: application/json`) or raw text
- `response` — The original `Response` object for status codes, headers, etc.

## Error Handling

- **4xx errors** throw immediately without retrying (client errors)
- **5xx errors** are retried up to the `retry` limit
- **Timeouts** are retried up to the `retry` limit

```js
try {
  const { data } = await api.get('https://api.example.com/protected');
} catch (err) {
  console.error(err.message); // e.g. "Error 401: Unauthorized"
}
```

## Requirements

- Node.js 18+ (uses native `fetch` and `AbortSignal.timeout`)
- ES Modules (`"type": "module"` in your `package.json`)

## License

MIT © Victor Ayoola
