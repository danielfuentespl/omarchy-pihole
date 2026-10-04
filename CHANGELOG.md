# Changelog

## [0.1.0] - 2026-10-04

### Security and robustness

- Bind requests and secret lookups to a captured origin and configuration generation; discard late results after URL/Secret ID changes.
- Bound Secret Service lookup time, release lookup collectors, and never use secret output as an error message.
- Validate origin-only URLs and required Pi-hole response fields strictly.
- Show unknown metrics before a successful refresh and label retained data after failures.
- Add service regression coverage and pin CI actions with minimal permissions.
- Document public installation, lifecycle, transport security, asset provenance and validation limits.

### Added

- Pi-hole status icon with health indicator.
- Native Omarchy panel with live Pi-hole statistics.
- Open Pi-hole dashboard action.

- Initial OmaPiHole plugin scaffold.
- Omarchy service + bar-widget architecture.
- Pi-hole v6 summary and blocking-state polling.
- Session authentication with application-password lookup from Secret Service.
- Timeout, offline, auth, configuration and stale states.
- Pure-JS model and fixtures.
