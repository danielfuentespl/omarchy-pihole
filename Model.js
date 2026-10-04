function parseJson(text) {
    try {
        return { ok: true, value: JSON.parse(String(text || "")) }
    } catch (error) {
        return { ok: false, error: "Invalid JSON response" }
    }
}

// QML's JavaScript runtime does not provide the browser URL constructor.
function validIPv4(host) {
    var parts = host.split(".")
    return parts.length === 4 && parts.every(function(part) {
        return /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255
    })
}

function validIPv6(host) {
    if (host.indexOf(".") !== -1) {
        var colon = host.lastIndexOf(":")
        if (!validIPv4(host.slice(colon + 1))) return false
        host = host.slice(0, colon + 1) + "0:0"
    }
    if (!/^[0-9a-f:]+$/i.test(host)) return false
    var halves = host.split("::")
    if (halves.length > 2) return false
    var parts = []
    for (var i = 0; i < halves.length; ++i) {
        if (halves[i]) parts = parts.concat(halves[i].split(":"))
    }
    if (!parts.every(function(part) { return /^[0-9a-f]{1,4}$/i.test(part) })) return false
    return halves.length === 2 ? parts.length < 8 : parts.length === 8
}

function normalizeBaseUrl(value) {
    var text = String(value || "").trim()
    if (!text) return { ok: false, error: "Pi-hole base URL is not configured" }
    var match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]+))?\/?$/i.exec(text)
    var error = { ok: false, error: "Use an HTTP(S) origin only, without credentials, /admin, /api, query or fragment" }
    if (!match) return error
    var host = match[2].toLowerCase()
    if (host.charAt(0) === "[") {
        if (!validIPv6(host.slice(1, -1))) return error
    } else {
        var dnsHost = host.replace(/\.$/, "")
        if (/^[0-9.]+$/.test(dnsHost)) {
            if (!validIPv4(dnsHost)) return error
        } else if (dnsHost.length > 253 || !dnsHost.split(".").every(function(label) {
            return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
        })) return error
    }
    if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535)) return error
    return { ok: true, value: match[1].toLowerCase() + "://" + host + (match[3] ? ":" + Number(match[3]) : "") }
}

function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

function count(value) {
    return typeof value === "number" && isFinite(value) && value >= 0
        && Math.floor(value) === value && value <= 9007199254740991
}

function finiteNumber(value, fallback) {
    var number = Number(value)
    return isFinite(number) ? number : fallback
}

function nonNegativeInteger(value) {
    return Math.max(0, Math.round(finiteNumber(value, 0)))
}

function parseSummaryObject(value) {
    if (!object(value) || !object(value.queries) || !object(value.clients) || !object(value.gravity)) {
        return { ok: false, error: "Pi-hole summary is missing required objects" }
    }
    var clients = value.clients
    var gravity = value.gravity
    var queries = value.queries
    if (!count(queries.total) || !count(queries.blocked) || !count(clients.active)
            || !count(clients.total) || !count(gravity.domains_being_blocked)
            || typeof queries.percent_blocked !== "number" || !isFinite(queries.percent_blocked)
            || queries.percent_blocked < 0 || queries.percent_blocked > 100) {
        return { ok: false, error: "Pi-hole summary contains missing or invalid metrics" }
    }

    return {
        ok: true,
        data: {
            queriesTotal: nonNegativeInteger(value.queries.total),
            queriesBlocked: nonNegativeInteger(value.queries.blocked),
            percentBlocked: Math.max(0, finiteNumber(value.queries.percent_blocked, 0)),
            clientsActive: nonNegativeInteger(clients.active),
            clientsTotal: nonNegativeInteger(clients.total),
            domainsBlocked: nonNegativeInteger(gravity.domains_being_blocked)
        }
    }
}

function parseSummary(text) {
    var parsed = parseJson(text)
    if (!parsed.ok) return parsed
    return parseSummaryObject(parsed.value)
}

function parseBlockingObject(value) {
    if (!object(value)) {
        return { ok: false, error: "Pi-hole blocking response is invalid" }
    }

    if (value.blocking === "enabled") {
        return { ok: true, blocking: true }
    }

    if (value.blocking === "disabled") {
        return { ok: true, blocking: false }
    }

    return { ok: false, error: "Pi-hole blocking response contains an unknown blocking state" }
}

function parseBlocking(text) {
    var parsed = parseJson(text)
    if (!parsed.ok) return parsed
    return parseBlockingObject(parsed.value)
}

function parseAuth(text) {
    var parsed = parseJson(text)
    if (!parsed.ok) return parsed
    var session = parsed.value && parsed.value.session
    if (!object(session) || session.valid !== true || typeof session.sid !== "string"
            || !/^[A-Za-z0-9+/_=-]+$/.test(session.sid) || session.sid.length > 256
            || !count(session.validity) || session.validity === 0) {
        return { ok: false, error: "Pi-hole did not return a valid session" }
    }
    return {
        ok: true,
        sid: String(session.sid),
        validity: Math.max(0, nonNegativeInteger(session.validity))
    }
}

function healthFor(blockingEnabled, stale, errorKind) {
    if (errorKind === "config") return "config"
    if (errorKind === "auth") return "auth"
    if (errorKind === "network" || errorKind === "timeout" || errorKind === "tls") return "offline"
    if (errorKind) return "critical"
    if (stale) return "stale"
    return blockingEnabled ? "ok" : "warning"
}

function stateSymbol(health) {
    if (health === "ok") return "●"
    if (health === "warning") return "▲"
    if (health === "offline") return "○"
    if (health === "stale") return "?"
    if (health === "auth" || health === "config" || health === "critical") return "●"
    return "?"
}

function stateLabel(health, blockingEnabled) {
    if (health === "ok") return "ONLINE"
    if (health === "warning" && !blockingEnabled) return "BLOCKING DISABLED"
    if (health === "offline") return "OFFLINE"
    if (health === "stale") return "STALE"
    if (health === "auth") return "AUTH REQUIRED"
    if (health === "config") return "NOT CONFIGURED"
    if (health === "critical") return "ERROR"
    return "UNKNOWN"
}

function formatNumber(value) {
    var text = String(nonNegativeInteger(value))
    var result = ""
    while (text.length > 3) {
        result = "." + text.slice(-3) + result
        text = text.slice(0, -3)
    }
    return text + result
}

function formatPercent(value) {
    var number = Math.max(0, finiteNumber(value, 0))
    return number.toFixed(1) + " %"
}

function ageLabel(dateValue, nowMs) {
    var timestamp = dateValue instanceof Date ? dateValue.getTime() : Number(dateValue || 0)
    if (!timestamp || timestamp <= 0) return "never"
    var seconds = Math.max(0, Math.round((Number(nowMs || Date.now()) - timestamp) / 1000))
    if (seconds < 60) return seconds + " s ago"
    var minutes = Math.round(seconds / 60)
    if (minutes < 60) return minutes + " min ago"
    var hours = Math.round(minutes / 60)
    return hours + " h ago"
}

if (typeof module !== "undefined") {
    module.exports = {
        parseJson: parseJson,
        normalizeBaseUrl: normalizeBaseUrl,
        parseSummaryObject: parseSummaryObject,
        parseSummary: parseSummary,
        parseBlockingObject: parseBlockingObject,
        parseBlocking: parseBlocking,
        parseAuth: parseAuth,
        healthFor: healthFor,
        stateSymbol: stateSymbol,
        stateLabel: stateLabel,
        formatNumber: formatNumber,
        formatPercent: formatPercent,
        ageLabel: ageLabel
    }
}
