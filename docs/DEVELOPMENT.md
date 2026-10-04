# OmaPiHole development

## Architecture

`Panel.qml` uses the public `bar.shell.serviceFor()` facade through `ServiceHost.js`. One `Service.qml` polls for all bar instances. `Model.js` contains pure parsing/formatting functions.

Only `GET /api/stats/summary`, `GET /api/dns/blocking` and `POST /api/auth` are used. No configuration or blocking mutations are implemented.

Each cycle captures a configuration generation, origin and Secret ID. Callbacks verify that identity before accepting results. URL/Secret ID changes invalidate work, cancel the XHR/lookup, release sensitive references, clear cached data and schedule a new refresh. Other setting changes do not discard the SID.

The lookup uses a short-lived Process and StdioCollector, destroyed after completion/cancellation. Shell arguments are positional and quoted. A watchdog bounds lookup time. HTTP requests have a separate watchdog.

## Validation status

### Manually tested before release hardening

The maintainer reports the original plugin working on **Omarchy 4.0.4**, **Quickshell 0.3.1**, against a **real Pi-hole v6**, including the panel shown in `preview.png`. This is a baseline test, not evidence that every authentication/TLS/error scenario or the subsequent hardening changes has been exercised on the real instance.

### Automated

`./tests/run` checks strict URL validation, summary/auth/blocking parsing, number formatting, manifest consistency and service regression scenarios. The service test loads the production QML JavaScript functions and substitutes XHR, timers and process creation with deterministic fakes. It does not copy the production state machine.

Coverage includes configuration changes during GET, lookup and authentication, old callbacks, cross-origin SID isolation, lookup timeout/failures, wrong password, session renewal, bounded 401 retries, HTTP timeout, network failure and cached-data handling.

`omarchy plugin validate .` checks the manifest contract; it does not prove QML loading or runtime correctness.

### Isolated runtime smoke test after hardening

The changed Service.qml was loaded successfully in Quickshell 0.3.1 using the offscreen platform and an isolated temporary runtime directory. A synthetic `secret-tool` executable and simulated API callbacks exercised the real Process/StdioCollector completion and lookup timeout. Both passed; no real credentials or Pi-hole server were used. This does not validate desktop rendering, real keyring behavior, XHR/TLS or shell lifecycle.

### Pending runtime validation after hardening

- Load the changed plugin in the desktop shell and check QML diagnostics.
- Confirm Secret Service completion, cancellation, timeout and collector destruction on Quickshell 0.3.1.
- Exercise valid HTTPS, untrusted certificate, hostname mismatch and redirects; no insecure TLS workaround is acceptable.
- Test wrong password, SID expiration, Pi-hole shutdown and recovery against a real Pi-hole v6.
- Change URL/Secret ID during real asynchronous operations using test instances/credentials.
- Verify disable/enable, shell restart and two-monitor widget creation/removal; confirm one polling stream.
- Confirm UNKNOWN/previous-data display, Refresh and Open Pi-hole.
- Test installation/update/removal from GitHub when publishing is authorized. Removal must leave only the explicitly user-stored keyring entry.

Do not mark these items as manually passed based on unit tests. Consult the target Pi-hole's `/api/docs` when changing API contracts.
