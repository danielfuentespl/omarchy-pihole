# OmaPiHole

Read-only Pi-hole v6 status for the Omarchy bar. Part of the provisional **OmaOps** plugin family.

**Version: 0.1.0** · Maintainer: [danielfuentespl](https://github.com/danielfuentespl)

OmaPiHole is an independent third-party project and is not affiliated with or endorsed by Pi-hole.

![OmaPiHole running on Omarchy](./preview.png)

## Features

- Native bar icon and panel with Pi-hole health and DNS blocking status.
- Queries, blocked queries, blocked percentage, active clients and gravity domains.
- Shared polling service for multiple bars; no enable/disable-blocking action.
- Optional application-password authentication using Secret Service and an in-memory SID.
- Configuration, authentication, network, timeout and stale-data states.

## Requirements

- Plugin-capable Omarchy Quattro. The maintainer's original manual test used Omarchy 4.0.4 and Quickshell 0.3.1 with a real Pi-hole v6.
- Pi-hole v6; Pi-hole v5 is not supported.
- For authenticated APIs: `secret-tool` (Arch package `libsecret`) and an available, unlocked Secret Service keyring in the desktop user session.
- Development tests require Node.js and Python 3; these are not plugin runtime dependencies.

The release hardening changes have automated regression coverage. The runtime scenarios still pending are listed in [development notes](docs/DEVELOPMENT.md); a previous real-instance test does not validate every new change.

## Installation

Once the repository is publicly accessible:

```bash
omarchy plugin add https://github.com/danielfuentespl/omarchy-pihole.git --enable
```

Choose the bar section when prompted. The plugin ID is `com.blogvirtualizado.omaops.pihole`.

## Configuration

Open the bar/widget configuration in Omarchy and edit the OmaPiHole settings. Set **Pi-hole base URL** to the HTTP(S) origin of your instance, for example:

```text
https://pi.hole
```

An optional port and one trailing slash are accepted. Do **not** include `/admin`, `/api`, any other path, username/password, query or fragment. IPv6 addresses must be enclosed in brackets. Credentials never belong in this setting.

| Setting | Default | Purpose |
| --- | --- | --- |
| baseUrl | empty | Pi-hole origin |
| refreshIntervalSec | 60 | Poll interval, 30–3600 seconds |
| staleAfterSec | 180 | Data age threshold, 60–7200 seconds |
| requestTimeoutMs | 5000 | Timeout for each API request and Secret Service lookup, 1000–30000 ms |
| secretId | default | Keyring entry identifier |

Keep the stale threshold above your polling interval unless you intentionally want stale indications between polls.

### HTTP and HTTPS

HTTP does not encrypt API traffic, the application password or the SID. Prefer HTTPS, especially when authentication is enabled.

HTTPS requires a certificate trusted by Qt/system trust and valid for the configured hostname. For a private CA, install its trust chain through the normal system mechanism. Certificate verification is never disabled: there is no TLS bypass or insecure option. Configure the final origin directly, without relying on redirects.

### Authentication

If the Pi-hole API allows unauthenticated access, no password or Secret Service is needed. Otherwise, create an **application password** in the Pi-hole web interface's settings, then run the helper from the installed plugin directory:

```bash
cd ~/.config/omarchy/plugins/com.blogvirtualizado.omaops.pihole
./scripts/store-secret
```

The prompt hides your input. The default **Secret ID** is `default`. To select another entry:

```bash
./scripts/store-secret secondary
```

Set **Secret ID** to the same value in the widget settings. Use a separate entry for each server. Changing the URL does not automatically choose another stored password.

The plugin first tries the read endpoint, retrieves the password only after HTTP 401, then calls `POST /api/auth`. It reuses the returned SID in `X-FTL-SID` until rejected. It never changes DNS blocking or Pi-hole configuration.

## Panel

Click the bar icon to open the panel. **Refresh** or **R** requests new data; **Open Pi-hole** opens the configured origin's `/admin/` page. Refresh is temporarily unavailable while a cycle runs.

Metrics are `—` and blocking is `UNKNOWN` until a complete valid response is available. On subsequent failure, previous metrics remain visible with **Previous data** and their last update time. Changing the server or Secret ID discards those metrics.

Queries and blocking metrics come from `/api/stats/summary` (the current statistics window, normally the last 24 hours), not the long-term database endpoint. Active clients are those seen in the last 24 hours; gravity domains are the current gravity-list count.

States: `ONLINE`, `BLOCKING DISABLED`, `OFFLINE`, `STALE`, `AUTH REQUIRED`, `NOT CONFIGURED`, `ERROR`. Blocking disabled is a warning, not proof that the server is offline.

## Update, enable, disable and remove

```bash
omarchy plugin update com.blogvirtualizado.omaops.pihole
omarchy plugin disable com.blogvirtualizado.omaops.pihole
omarchy plugin enable com.blogvirtualizado.omaops.pihole
omarchy plugin remove com.blogvirtualizado.omaops.pihole
```

Removing the plugin does **not** automatically delete the application password from Secret Service. To remove the default entry deliberately:

```bash
secret-tool clear application omaops-pihole instance default
```

Replace `default` with the Secret ID you used. Revocation of an application password is managed in Pi-hole.

## Troubleshooting

- **NOT CONFIGURED:** supply an origin in the accepted format, without `/admin` or `/api`.
- **AUTH REQUIRED:** check the application password, matching Secret ID and unlocked keyring. A second 401 ends the current cycle; the next refresh can retry.
- **secret-tool is required:** install `libsecret` and ensure a Secret Service implementation is running in your user session.
- **Secret Service lookup timed out:** unlock/check the keyring and refresh. The HTTP timeout setting also bounds the lookup.
- **OFFLINE:** check DNS, routing, Pi-hole availability, certificate trust and hostname. A network or TLS error is not necessarily a Pi-hole outage.
- **ERROR:** an HTTP failure or malformed/unexpected API response was received. Check compatibility with Pi-hole v6.
- **STALE / Previous data:** displayed metrics are old; inspect the error and last update time.
- After QML development edits, a shell restart may be needed if the installed shell does not reload the service. Disable/enable and multi-monitor lifecycle remain part of the runtime validation checklist.

## Security

Operations are tied to a configuration generation and captured origin. Changing URL/Secret ID cancels pending work and invalidates its results and SID. Secret lookups and API requests have timeouts.

The plugin does not write secrets to its own files, settings or logs. Secret Service may persist the password in its own keyring. Password references and lookup collectors are released after use; JavaScript/Qt does not provide a cryptographic string-erasure guarantee. The SID remains in process memory. See [security notes](docs/SECURITY.md).

## Development

```bash
./tests/run
omarchy plugin validate .
```

The suite covers models, manifest and service functions with simulated transport/processes. It does not replace QML, TLS or real-instance runtime tests. See [validation status](docs/DEVELOPMENT.md).

## License and icon

Project code: [MIT](LICENSE). The Pi-hole icon uses Simple Icons geometry under CC0-1.0, with the Pi-hole brand color applied. Pi-hole retains its trademark rights. See [asset provenance](assets/README.md).
