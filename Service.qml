pragma ComponentBehavior: Bound

import QtQuick
import QtQml
import Quickshell
import Quickshell.Io
import "Model.js" as Model

Item {
    id: root

    property var settings: ({})

    property bool refreshing: false
    property bool configured: false
    property bool authenticated: false
    property bool blockingEnabled: false
    property bool stale: false
    property bool hasData: false

    property string health: "unknown"
    property string lastError: ""
    property string errorKind: ""
    property date lastUpdated: new Date(0)

    property double queriesTotal: 0
    property double queriesBlocked: 0
    property real percentBlocked: 0
    property double clientsActive: 0
    property double clientsTotal: 0
    property double domainsBlocked: 0

    property string sid: ""

    property var _pendingSummary: null
    property var _activeRequest: null
    property var _requestCallback: null
    property int _requestToken: 0
    property bool _authRetried: false
    property string _secretOutput: ""
    property int _generation: 0
    property string _configKey: ""
    property var _cycle: null
    property var _lookup: null
    property string _secret: ""

    function setting(name, fallback) {
        var value = settings ? settings[name] : undefined
        return value === undefined || value === null ? fallback : value
    }

    function intSetting(name, fallback, minimum, maximum) {
        var value = parseInt(String(setting(name, fallback)), 10)
        if (!isFinite(value)) value = fallback
        return Math.max(minimum, Math.min(maximum, value))
    }

    readonly property var baseUrlResult: Model.normalizeBaseUrl(setting("baseUrl", ""))
    readonly property string baseUrl: baseUrlResult.ok ? baseUrlResult.value : ""
    readonly property string secretId: String(setting("secretId", "default") || "default").trim() || "default"
    readonly property int refreshIntervalSec: intSetting("refreshIntervalSec", 60, 30, 3600)
    readonly property int staleAfterSec: intSetting("staleAfterSec", 180, 60, 7200)
    readonly property int requestTimeoutMs: intSetting("requestTimeoutMs", 5000, 1000, 30000)
    readonly property string webUrl: baseUrl !== "" ? baseUrl + "/admin/" : ""

    readonly property string stateSymbol: Model.stateSymbol(health)
    readonly property string stateLabel: Model.stateLabel(health, blockingEnabled)

    onSettingsChanged: configurationChanged()
    Component.onDestruction: cancelOperations()

    function configurationKey() {
        // Read settings directly: derived QML bindings may still be reevaluating.
        return JSON.stringify([String(setting("baseUrl", "")), String(setting("secretId", "default") || "default").trim() || "default"])
    }

    function current(cycle) {
        return cycle !== null && cycle.generation === _generation && cycle.key === configurationKey()
    }

    function cancelOperations() {
        _generation += 1
        _requestToken += 1
        requestTimeout.stop()
        lookupTimeout.stop()
        var xhr = _activeRequest
        _activeRequest = null
        _requestCallback = null
        if (xhr) { try { xhr.abort() } catch (error) {} }
        var lookup = _lookup
        _lookup = null
        if (lookup) {
            lookup.running = false
            lookup.destroy()
        }
        _secret = ""
        _secretOutput = ""
        _cycle = null
        _pendingSummary = null
        refreshing = false
    }

    function configurationChanged() {
        var key = configurationKey()
        if (key === _configKey) return
        _configKey = key
        cancelOperations()
        sid = ""
        authenticated = false
        configured = false
        hasData = false
        stale = false
        lastUpdated = new Date(0)
        queriesTotal = queriesBlocked = clientsActive = clientsTotal = domainsBlocked = 0
        percentBlocked = 0
        blockingEnabled = false
        health = "unknown"
        errorKind = lastError = ""
        Qt.callLater(refresh)
    }

    function refreshIfStale() {
        var updatedAt = lastUpdated instanceof Date ? lastUpdated.getTime() : 0
        if (updatedAt <= 0 || Date.now() - updatedAt >= refreshIntervalSec * 1000) refresh()
    }

    function refresh() {
        if (_configKey !== configurationKey()) configurationChanged()
        if (refreshing || _lookup !== null || _activeRequest !== null) return
        var origin = Model.normalizeBaseUrl(setting("baseUrl", ""))

        if (!origin.ok) {
            configured = false
            fail("config", origin.error)
            return
        }

        _cycle = { generation: _generation, key: _configKey, baseUrl: origin.value,
            secretId: String(setting("secretId", "default") || "default").trim() || "default" }
        configured = true
        refreshing = true
        lastError = ""
        errorKind = ""
        _authRetried = false
        _pendingSummary = null
        requestSummary()
    }

    function requestSummary() {
        request("GET", "/api/stats/summary", null, function(status, body) {
            if (status === 200) {
                var parsed = Model.parseSummary(body)
                if (!parsed.ok) {
                    fail("protocol", parsed.error)
                    return
                }
                _pendingSummary = parsed.data
                requestBlocking()
                return
            }

            if (status === 401) {
                handleUnauthorized()
                return
            }

            failHttp(status, "Could not read Pi-hole summary")
        })
    }

    function requestBlocking() {
        request("GET", "/api/dns/blocking", null, function(status, body) {
            if (status === 200) {
                var parsed = Model.parseBlocking(body)
                if (!parsed.ok) {
                    fail("protocol", parsed.error)
                    return
                }
                finishSuccess(_pendingSummary, parsed.blocking)
                return
            }

            if (status === 401) {
                handleUnauthorized()
                return
            }

            failHttp(status, "Could not read Pi-hole blocking state")
        })
    }

    function handleUnauthorized() {
        sid = ""
        authenticated = false

        if (_authRetried) {
            fail("auth", "Pi-hole authentication failed")
            return
        }

        _authRetried = true
        loadSecret()
    }

    function loadSecret() {
        if (!current(_cycle) || _lookup !== null) return
        _secretOutput = ""
        _lookup = lookupComponent.createObject(root, { cycle: _cycle })
        if (!_lookup) { fail("auth", "Could not start Secret Service lookup"); return }
        lookupTimeout.restart()
        _lookup.running = true
    }

    function finishSecretLookup(lookup, exitCode, stdout) {
        if (lookup !== _lookup || !current(lookup.cycle)) return
        lookupTimeout.stop()
        _lookup = null
        lookup.destroy() // Release the collector together with the process.
        _secretOutput = ""
        if (exitCode === 127) {
            fail("config", "secret-tool is required for password-protected Pi-hole instances")
            return
        }
        if (exitCode !== 0) {
            fail("auth", "No application password available: check Secret Service and Secret ID")
            return
        }
        _secret = String(stdout || "").replace(/[\r\n]+$/, "")
        if (!_secret) {
            fail("auth", "No Pi-hole application password is stored for this Secret ID")
            return
        }
        authenticate()
        _secret = ""
        _secretOutput = ""
    }

    function lookupTimedOut() {
        if (_lookup === null) return
        var lookup = _lookup
        var valid = current(lookup.cycle)
        _lookup = null
        lookup.running = false
        lookup.destroy()
        _secret = _secretOutput = ""
        if (valid) fail("timeout", "Secret Service lookup timed out")
    }

    function authenticate() {
        var payload = { password: _secret }
        request("POST", "/api/auth", payload, function(status, body) {
            _secret = ""

            if (status === 200) {
                var parsed = Model.parseAuth(body)
                if (!parsed.ok) {
                    fail("protocol", parsed.error)
                    return
                }
                sid = parsed.sid
                authenticated = true
                requestSummary()
                return
            }

            if (status === 401) {
                fail("auth", "Pi-hole rejected the stored application password")
                return
            }

            failHttp(status, "Could not authenticate to Pi-hole")
        })
    }

    function request(method, path, payload, callback) {
        if (!current(_cycle) || _activeRequest !== null) return false
        var cycle = _cycle

        var xhr = new XMLHttpRequest()
        var token = ++_requestToken
        _activeRequest = xhr
        _requestCallback = callback

        xhr.onreadystatechange = function() {
            if (xhr.readyState !== XMLHttpRequest.DONE || token !== root._requestToken || !root.current(cycle)) return
            root.completeRequest(token, Number(xhr.status || 0), String(xhr.responseText || ""))
        }

        try {
            xhr.open(method, cycle.baseUrl + path)
            xhr.setRequestHeader("Accept", "application/json")
            if (sid) xhr.setRequestHeader("X-FTL-SID", sid)
            if (payload !== null && payload !== undefined) xhr.setRequestHeader("Content-Type", "application/json")
            requestTimeout.restart()
            xhr.send(payload !== null && payload !== undefined ? JSON.stringify(payload) : null)
        } catch (error) {
            completeRequest(token, 0, "")
        }
        return true
    }

    function completeRequest(token, status, body) {
        if (token !== _requestToken || !current(_cycle)) return
        requestTimeout.stop()
        _activeRequest = null
        var callback = _requestCallback
        _requestCallback = null
        if (typeof callback === "function") callback(status, body)
    }

    function failHttp(status, fallback) {
        if (status === 0) {
            fail("network", fallback + ": network or TLS error")
        } else if (status === 401 || status === 403) {
            fail("auth", fallback + " (HTTP " + status + ")")
        } else if (status >= 500) {
            fail("network", fallback + " (HTTP " + status + ")")
        } else {
            fail("http", fallback + " (HTTP " + status + ")")
        }
    }

    function fail(kind, message) {
        _secret = _secretOutput = ""
        refreshing = false
        errorKind = String(kind || "error")
        lastError = concise(message, "Pi-hole request failed")
        if (kind === "auth") authenticated = false
        stale = lastUpdated instanceof Date && lastUpdated.getTime() > 0
        health = Model.healthFor(blockingEnabled, stale, errorKind)
    }

    function finishSuccess(summary, blocking) {
        if (!summary) {
            fail("protocol", "Pi-hole summary data was lost during refresh")
            return
        }

        hasData = true
        queriesTotal = summary.queriesTotal
        queriesBlocked = summary.queriesBlocked
        percentBlocked = summary.percentBlocked
        clientsActive = summary.clientsActive
        clientsTotal = summary.clientsTotal
        domainsBlocked = summary.domainsBlocked
        blockingEnabled = blocking === true

        refreshing = false
        configured = true
        authenticated = true
        stale = false
        errorKind = ""
        lastError = blockingEnabled ? "" : "DNS blocking is disabled"
        lastUpdated = new Date()
        health = Model.healthFor(blockingEnabled, false, "")
    }

    function concise(value, fallback) {
        var text = String(value || fallback || "Pi-hole request failed").replace(/\s+/g, " ").trim()
        return text.length > 180 ? text.substring(0, 177) + "…" : text
    }

    Timer {
        id: refreshTimer
        interval: root.refreshIntervalSec * 1000
        repeat: true
        running: true
        triggeredOnStart: true
        onTriggered: root.refresh()
    }

    Timer {
        id: staleTimer
        interval: 10000
        repeat: true
        running: true
        onTriggered: {
            var updatedAt = root.lastUpdated instanceof Date ? root.lastUpdated.getTime() : 0
            if (updatedAt <= 0 || root.refreshing) return
            if (Date.now() - updatedAt > root.staleAfterSec * 1000 && !root.errorKind) {
                root.stale = true
                root.health = Model.healthFor(root.blockingEnabled, true, "")
            }
        }
    }

    Timer {
        id: requestTimeout
        interval: root.requestTimeoutMs
        repeat: false
        onTriggered: root.requestTimedOut()
    }

    function requestTimedOut() {
        if (_activeRequest === null) return
        var valid = current(_cycle)
        var xhr = _activeRequest
        _requestToken += 1
        _activeRequest = null
        _requestCallback = null
        _secret = _secretOutput = ""
        try { xhr.abort() } catch (error) {}
        if (valid) fail("timeout", "Pi-hole API request timed out after " + requestTimeoutMs + " ms")
    }

    Timer {
        id: lookupTimeout
        interval: root.requestTimeoutMs
        repeat: false
        onTriggered: root.lookupTimedOut()
    }

    Component {
        id: lookupComponent
        Process {
            id: lookupProcess
            property var cycle
            command: ["bash", "-c",
                "command -v secret-tool >/dev/null 2>&1 || exit 127; exec secret-tool lookup application omaops-pihole instance \"$1\"",
                "oma-pihole-secret", cycle.secretId]
            stdout: StdioCollector { id: output; waitForEnd: true }
            // Never forward stdout/stderr to the UI or logs.
            stderr: StdioCollector { waitForEnd: true }
            onExited: function(exitCode) {
                root.finishSecretLookup(lookupProcess, exitCode, output.text)
            }
        }
    }
}
