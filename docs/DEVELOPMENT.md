# OmaPiHole Monitor development

## Architecture

`Panel.qml` uses the public `bar.shell.serviceFor()` facade through `ServiceHost.js`. One `Service.qml` polls for all bar instances. `Model.js` contains pure parsing/formatting functions.

The service uses `GET /api/stats/summary`, `GET /api/dns/blocking`, and `POST /api/auth` when the first request returns 401. All are sent through CurlTransport, which supplies the request as stdin config and does not follow redirects. No Pi-hole configuration or blocking mutations are implemented.

Each API cycle captures a configuration generation, origin, Secret ID and optional CA path. Callbacks verify that identity before accepting results. Configuration changes terminate curl/keyring processes, invalidate callbacks, clear SID and secret references and schedule a fresh poll.

## Validation status

### Manually tested for v0.1.0

The maintainer validated the release on **Omarchy 4.0.4**, **Quickshell 0.3.1**, against a **real Pi-hole v6**:

- installation from GitHub, enable, panel, Refresh and Open Pi-hole;
- disable, enable, remove and fresh reinstall;
- omarchy-shell restart;
- unauthenticated HTTP API access;
- an untrusted TLS certificate being rejected;
- HTTPS using Pi-hole's self-signed CA through `caCertPath`;
- password-protected Pi-hole returning HTTP 401 without credentials;
- missing Secret Service credential producing `AUTH REQUIRED`;
- rejected/incorrect Application Password producing an authentication error;
- a real Pi-hole v6 Application Password stored in Secret Service;
- successful `POST /api/auth`, SID session authentication and authenticated summary/blocking reads over HTTPS;
- recovery to `ONLINE` with current metrics after authentication.

Not manually validated for v0.1.0: reverse-proxy Basic Auth (not supported), mTLS (not supported), a public CA certificate, a private CA installed globally in the OS trust store, configuration changes during a real in-flight request, and final multi-monitor lifecycle with the curl transport.

### Automated

`./tests/run` checks strict URL validation, summary/auth/blocking parsing, number formatting, curl-config serialization, manifest consistency and service regression scenarios. The service test executes production QML JavaScript functions with a fake CurlTransport/keyring process; the separate Python integration test runs real curl against local servers.

Coverage includes unauthenticated reads, HTTPS-only credential retrieval, Application Password login/SID reuse and bounded retries, configuration changes during GET/lookup/auth POST, lookup/request timeout and failure, wrong password, stale callbacks and retained data. Curl integration covers 301/302/303/307/308, a hostile `.curlrc`, process argv secrecy, config escaping and custom-CA TLS verification.

`omarchy plugin validate .` checks the manifest contract; it does not prove QML loading or runtime correctness.

### Isolated runtime smoke test

Quickshell 0.3.1 loaded the production `CurlTransport.qml`; `Process.write()` delivered curl config, setting `stdinEnabled = false` closed the pipe, and curl returned HTTP status plus the exact JSON body. A synthetic end-to-end service test exercised HTTPS 401 → fake Secret Service lookup → `/api/auth` → SID-bearing summary and blocking GETs. No real credential or Pi-hole server was used. A local HTTPS self-signed certificate was rejected by default (curl exit 60) and accepted when its PEM certificate was supplied as the custom CA file. The redirect integration test confirmed zero requests reached the sink for all five tested redirect codes, even with `~/.curlrc` set to `location`.

### Remaining runtime validation

- Test HTTPS with a public CA and a CA installed globally in the OS trust store.
- Change URL, Secret ID and CA path during real asynchronous requests/lookups.
- Verify missing `curl` and `secret-tool` diagnostics in the target desktop session.
- Verify two-monitor widget creation/removal with the final curl transport and confirm one polling stream.
- Reverse-proxy Basic Auth and mTLS remain intentionally unsupported in v0.1.0.

Do not mark these items as manually passed based on unit tests. Consult the target Pi-hole's `/api/docs` when changing API contracts.
