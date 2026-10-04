# OmaPiHole development

## Architecture

`Panel.qml` uses the public `bar.shell.serviceFor()` facade through `ServiceHost.js`. One `Service.qml` polls for all bar instances. `Model.js` contains pure parsing/formatting functions.

The service uses `GET /api/stats/summary`, `GET /api/dns/blocking`, and `POST /api/auth` when the first request returns 401. All are sent through CurlTransport, which supplies the request as stdin config and does not follow redirects. No Pi-hole configuration or blocking mutations are implemented.

Each API cycle captures a configuration generation, origin, Secret ID and optional CA path. Callbacks verify that identity before accepting results. Configuration changes terminate curl/keyring processes, invalidate callbacks, clear SID and secret references and schedule a fresh poll.

## Validation status

### Manually tested before release hardening

The maintainer reports these manual checks on **Omarchy 4.0.4**, **Quickshell 0.3.1**, against a **real Pi-hole v6**:

- installation from GitHub, enable, panel, Refresh and Open Pi-hole;
- disable, enable, remove, then fresh reinstall;
- HTTP API access;
- an untrusted TLS certificate was rejected and the plugin recovered to ONLINE after returning to HTTP.

The maintainer has not reported testing a real Pi-hole Application Password, reverse proxy Basic Auth, or a CA installed in the operating system trust store. Application Password behavior is covered using a synthetic keyring process in service tests, not a real Pi-hole credential.

### Automated

`./tests/run` checks strict URL validation, summary/auth/blocking parsing, number formatting, curl-config serialization, manifest consistency and service regression scenarios. The service test executes production QML JavaScript functions with a fake CurlTransport/keyring process; the separate Python integration test runs real curl against local servers.

Coverage includes unauthenticated reads, HTTPS-only credential retrieval, Application Password login/SID reuse and bounded retries, configuration changes during GET/lookup/auth POST, lookup/request timeout and failure, wrong password, stale callbacks and retained data. Curl integration covers 301/302/303/307/308, a hostile `.curlrc`, process argv secrecy, config escaping and custom-CA TLS verification.

`omarchy plugin validate .` checks the manifest contract; it does not prove QML loading or runtime correctness.

### Isolated runtime smoke test

Quickshell 0.3.1 loaded the production `CurlTransport.qml`; `Process.write()` delivered curl config, setting `stdinEnabled = false` closed the pipe, and curl returned HTTP status plus the exact JSON body. A synthetic end-to-end service test exercised HTTPS 401 → fake Secret Service lookup → `/api/auth` → SID-bearing summary and blocking GETs. No real credential or Pi-hole server was used. A local HTTPS self-signed certificate was rejected by default (curl exit 60) and accepted when its PEM certificate was supplied as the custom CA file. The redirect integration test confirmed zero requests reached the sink for all five tested redirect codes, even with `~/.curlrc` set to `location`.

### Pending runtime validation after hardening

- Load the changed plugin in the desktop shell and check QML diagnostics.
- Test the Application Password path against a real Pi-hole v6 and real Secret Service keyring (the synthetic end-to-end flow is covered, not a real credential).
- Test HTTPS with a public CA and a CA installed in the OS trust store on the target system.
- Change URL, Secret ID and CA path during real asynchronous requests/lookups.
- Verify missing `curl` and `secret-tool` diagnostics in the target desktop session.
- Verify disable/enable, shell restart and two-monitor widget creation/removal; confirm one polling stream.
- Confirm UNKNOWN/previous-data display, Refresh and Open Pi-hole.
- Test installation/update/removal from GitHub when publishing is authorized.
- Reverse-proxy Basic Auth remains intentionally deferred.

Do not mark these items as manually passed based on unit tests. Consult the target Pi-hole's `/api/docs` when changing API contracts.
