# awmlc

**AWML Compiler** — Compiles web application source code into AWML (AI Web Markup Language), the standard document format for [Zenith](https://github.com/aiyuekuang/zenith).

## What is AWML?

**AWML (AI Web Markup Language)** is a new document format designed for AI agents to interact with web applications. It is to AI browsers what HTML is to traditional browsers.

```
Traditional web:  Source Code → webpack/vite → HTML/JS/CSS → Chrome renders for humans
AI web:           Source Code → awmlc        → AWML        → Zenith reads for agents
```

### The Problem

Today's AI agents interact with web applications by simulating human behavior — clicking buttons, reading pixels, parsing DOM trees. This is fragile, slow, and fundamentally wrong. AI doesn't need pixels and layouts. It needs **structured semantics**: what pages exist, what data is shown, what actions are available, what APIs to call.

### The Solution

AWML captures the **complete semantic structure** of a web application in a single file:

- **Pages** — all routes with their semantic modules (tables, forms, dialogs, statistics)
- **APIs** — every endpoint with full URLs, parameters, and descriptions
- **Navigation** — the complete menu structure
- **Authentication** — how to log in and authorize requests
- **Data Models** — the shape of data flowing through the app

An AI agent reading an AWML document instantly understands the entire application — no rendering, no DOM parsing, no pixel interpretation needed.

## Install

```bash
npm install -g awmlc
```

## Usage

```bash
# Compile a web app into AWML
awmlc ./my-web-app --pretty

# Specify API server URL (resolves proxy config)
awmlc ./my-web-app --server http://api.example.com

# Custom output path
awmlc ./my-web-app --output my-app.awml.json
```

## Supported Frameworks

| Framework | Status |
|-----------|--------|
| Umi / Umi Max | Supported |
| Next.js | Planned |
| Vite + React | Planned |
| Vue | Planned |

## AWML Document Structure

```json
{
  "version": "0.1",
  "app": {
    "name": "My App",
    "title": "My Application",
    "framework": "umi"
  },
  "servers": [
    {
      "id": "server-0",
      "baseUrl": "http://localhost:4000",
      "prefixes": ["/api"]
    }
  ],
  "auth": {
    "type": "token",
    "loginApi": "auth.login",
    "tokenStorage": "localStorage",
    "tokenKey": "access_token"
  },
  "pages": [
    {
      "path": "/users",
      "name": "User Management",
      "modules": [
        {
          "type": "table",
          "columns": [
            { "key": "name", "title": "Name" },
            { "key": "email", "title": "Email" }
          ],
          "dataApi": "user.list"
        },
        {
          "type": "dialog",
          "title": "Add User",
          "content": [
            {
              "type": "form",
              "fields": [
                { "name": "name", "label": "Name", "fieldType": "text", "required": true },
                { "name": "email", "label": "Email", "fieldType": "email", "required": true }
              ],
              "submitApi": "user.create"
            }
          ]
        }
      ]
    }
  ],
  "apis": [
    {
      "id": "user.list",
      "name": "list",
      "description": "Get user list",
      "method": "POST",
      "url": "http://localhost:4000/api/user/list"
    }
  ],
  "nav": [
    { "name": "User Management", "path": "/users", "icon": "UserOutlined" }
  ]
}
```

## How It Works

awmlc performs **static analysis** at build time — it never executes your code or starts a browser:

1. **Framework Detection** — identifies Umi, Next.js, or Vite from config files
2. **Config Parsing** — extracts routes and proxy config (resolves API base URLs)
3. **API Extraction** — parses `request()` calls via AST to find all endpoints, parameters, and JSDoc descriptions
4. **Page Analysis** — scans React components for Table columns, Form fields, Modal dialogs, Statistic items
5. **Assembly** — combines everything into a single AWML document

## Related Projects

- **[Zenith](https://github.com/aiyuekuang/zenith)** — The next-generation AI browser that reads AWML documents via MCP protocol

## License

MIT
