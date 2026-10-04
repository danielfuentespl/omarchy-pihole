# Security notes

OmaPiHole runs inside the Omarchy/Quickshell process with the desktop user's privileges. Plugins are trusted desktop code, not sandboxed applications.

## Configuration and origin isolation

Every API cycle captures its origin, Secret ID and generation. Changing URL or Secret ID invalidates callbacks, aborts the old XHR, stops/destroys the lookup process and clears SID, sensitive references and cached data. Each callback also compares against current settings, even before QML configuration-change handling completes. Ordinary polling-setting changes preserve the current session.

A Secret ID selects a user-managed keyring entry. If the user deliberately configures another server with the same ID, a fresh authentication attempt uses that selected entry. Use separate Secret IDs for different servers. The isolation guarantee concerns stale/in-flight operations, not a misconfigured credential choice.

## Secrets

- The plugin does not write passwords or SIDs to its own files, settings or logs.
- Secret Service may persist the password in its own keyring. Uninstalling the plugin does not erase that entry.
- Password input is hidden and passed to `secret-tool store` on stdin. Lookup arguments contain only namespace and Secret ID.
- Lookup stdout is a secret channel, never an error-message fallback. Neither stdout nor stderr is displayed or logged by the plugin.
- Short-lived lookup collectors are destroyed after use. Password references are cleared; this is not a guarantee of secure/cryptographic erasure of JavaScript or Qt strings.
- The SID is kept in process memory and sent in the `X-FTL-SID` header, not in URLs.
- Session expiry is handled by one reauthentication attempt per refresh cycle. Unused server sessions expire normally; v0.1 does not implement explicit logout.

## Network

HTTP does not encrypt the application password, SID or statistics. Prefer HTTPS. HTTPS requires a trusted certificate chain and matching hostname under normal Qt/system certificate validation. There is no TLS bypass, `verifyTls=false` or insecure curl option.

Use the final origin directly. Redirect behavior and TLS rejection must be tested in the installed Qt/Quickshell build; the JavaScript test transport cannot validate those properties.

Both API requests and Secret Service lookup have timeouts. API response types and required fields are validated before publishing metrics. Error text is controlled and dynamic panel messages use plain text.

v0.1 reads statistics and blocking status; the only POST creates an authentication session. It requests no root privileges and does not mutate Pi-hole settings.

## Release checks

Run tests and manifest validation, inspect source/assets for private data, verify the real-instance checklist in DEVELOPMENT.md, and review current Pi-hole security advisories before release. Review Git author metadata separately before making the repository public.
