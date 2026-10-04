# Security notes

OmaPiHole runs inside the Omarchy/Quickshell process with the desktop user's privileges. Plugins are trusted desktop code, not sandboxed applications.

## Configuration and origin isolation

Each operation captures its configuration generation, normalized origin, Secret ID and CA path. Changing any of these cancels the curl process/keyring lookup, discards its callback, clears the SID and releases secret references.

## Secrets

- The Pi-hole Application Password is retrieved from Secret Service only after an HTTPS API request returns 401. The keyring may persist it; removing the plugin does not delete the keyring entry.
- Passwords and SIDs are passed to curl through its stdin configuration, never argv, environment variables or temporary files. The helper stores the value in Secret Service via stdin and contains no password itself.
- The plugin does not write credentials or SIDs to its own files or logs. Process arguments contain only `curl -q --config -` and `secret-tool` lookup metadata. QML strings and stdio buffers are released after use; cryptographic memory erasure is not promised.
- Reverse-proxy Basic Auth is not implemented in v0.1.0.

## Network

HTTP does not encrypt API traffic. Unauthenticated instances may use HTTP. If the API requires credentials, the plugin refuses to retrieve or send them over HTTP. HTTPS requires a trusted chain and matching hostname under curl's normal certificate verification. An optional public PEM CA bundle can be selected per plugin; otherwise curl uses its normal CA store. There is no TLS bypass, `-k`, `--insecure`, or disabled verification option.

API requests run `curl -q --config -`; the `-q` option is the first curl argument and suppresses `.curlrc`. The plugin never enables curl's location/redirect option, so 301, 302, 303, 307 and 308 responses are rejected before another request is made. A two-server loopback test verified the destination received zero requests even with a malicious `.curlrc` containing `location` and synthetic password, SID and Authorization headers on the original request.

Curl connect and total timeouts are set per request and also bounded by a QML watchdog; configuration changes terminate the old process. DNS (curl 6), connection failure (7), timeout (28), peer certificate verification (60) and unreadable custom CA (77) have controlled messages. API response framing separates status from JSON body before strict model validation. Error text is controlled and dynamic panel messages use plain text.

v0.1 reads statistics and blocking status and creates an API session only when required. It requests no root privileges and does not mutate Pi-hole settings.

## Release checks

Run tests and manifest validation, inspect source/assets for private data, verify the real-instance checklist in DEVELOPMENT.md, and review current Pi-hole security advisories before release. Review Git author metadata separately before making the repository public.
