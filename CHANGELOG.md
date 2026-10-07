# Changelog

## [0.2.0] - 2026-10-07

- Add an in-panel Pi-hole address editor that saves through Omarchy's widget-settings API.
- Open the editor automatically on first use when no Pi-hole address is configured.
- Explain the expected URL format and HTTPS requirement beside the input.

## [0.1.0] - 2026-10-04

### Security and robustness

- Bind requests and keyring lookups to the captured origin, Secret ID, CA path and configuration generation; discard late results after a configuration change.
- Replace QML XMLHttpRequest with a curl Process that receives its configuration through stdin, never follows redirects, and retains normal TLS verification.
- Restore Pi-hole v6 Application Password and SID authentication over HTTPS; refuse to send credentials over HTTP.
- Support an optional PEM CA bundle and map reliable curl DNS, connection, timeout and TLS errors to concise states.
- Validate origin-only URLs and required Pi-hole response fields strictly.
- Show unknown metrics before a successful refresh and label retained data after failures.
- Add service regression coverage and pin CI actions with minimal permissions.
- Document public installation, lifecycle, transport security, asset provenance and validation limits.
- Defer reverse-proxy Basic Auth; preserve unauthenticated HTTP and authenticated HTTPS support.

### Added

- Pi-hole status icon with health indicator.
- Native Omarchy panel with live Pi-hole statistics.
- Open Pi-hole dashboard action.

- Initial OmaPiHole Monitor plugin scaffold.
- Omarchy service + bar-widget architecture.
- Pi-hole v6 summary and blocking-state polling.
- Secret Service Application Password lookup and authenticated Pi-hole v6 session polling.
- Timeout, offline, auth, configuration and stale states.
- Pure-JS model and fixtures.
