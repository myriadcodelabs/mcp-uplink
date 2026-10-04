# MCP Uplink

General-purpose local MCP manager with a loopback aggregate MCP endpoint and optional WebSocket uplink.

## Install and run

Requires Node.js 22 or newer.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:8787`. Add a STDIO command or a Streamable HTTP MCP endpoint, then start it. MCP clients connect to `http://127.0.0.1:8787/mcp`. The UI and endpoint bind only to `127.0.0.1`; the local endpoint has no authentication. `/mcp` accepts loopback and Chrome/Firefox extension origins. Ordinary website origins remain blocked because they could otherwise invoke local tools.

To install as a local CLI package, run `npm pack` here, then `npm install -g ./myriadcode-mcp-uplink-1.0.0.tgz` and `mcp-uplink`.

Configuration, including MCP environment variables and the uplink credential, is stored in `~/.config/mcp-uplink/config.json` with owner-only permissions. Set `MCP_UPLINK_CONFIG` to use another path and `MCP_UPLINK_PORT` to change the loopback port. Legacy `MYRIAD_ADAPTER_CONFIG` and `MYRIAD_ADAPTER_PORT` values remain supported for compatibility. Keep your user account and config file protected.

Remote uplink is optional. On the Remote page, enter a WebSocket URL and credential. The current registry backend accepts an `Authorization: Bearer` header, sends `call` frames, and receives `register`, `result`, and `error` frames. Other remotes must support this protocol. Tool names are preserved when unique; duplicate names are prefixed with the source ID.

MCP Uplink manages processes and transport only. It has no local permissions, filtering, or quotas.
