function quoteConfigValue(value) {
    var text = String(value)
    if (text.indexOf("\u0000") !== -1) throw new Error("NUL is not valid in curl config values")
    return '"' + text.replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\t/g, "\\t")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\v/g, "\\v") + '"'
}

function configLine(name, value) {
    if (!/^[a-z][a-z-]*$/.test(name)) throw new Error("Invalid curl option")
    return name + " = " + quoteConfigValue(value)
}

function buildRequest(spec, frameMarker) {
    if (!spec || (spec.method !== "GET" && spec.method !== "POST")) {
        return { ok: false, error: "Unsupported HTTP method" }
    }
    var route = typeof spec.url === "string"
        ? /^(https?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::[0-9]+)?)(\/api\/(?:stats\/summary|dns\/blocking|auth))$/i.exec(spec.url)
        : null
    if (!route || /[\r\n\u0000]/.test(spec.url) || route[1].indexOf("@") !== -1) {
        return { ok: false, error: "Invalid request URL" }
    }
    if (spec.sensitive && !/^https:\/\//i.test(route[1])) {
        return { ok: false, error: "Pi-hole credentials require HTTPS" }
    }
    if (spec.sid && !/^[A-Za-z0-9+/_=-]{1,256}$/.test(String(spec.sid))) {
        return { ok: false, error: "Invalid Pi-hole session identifier" }
    }
    if (spec.caCertPath && (typeof spec.caCertPath !== "string" || spec.caCertPath.charAt(0) !== "/" || /\u0000/.test(spec.caCertPath))) {
        return { ok: false, error: "CA certificate path must be an absolute path" }
    }
    if (typeof frameMarker !== "string" || !/^[A-Za-z0-9_.=-]{1,128}$/.test(frameMarker)) {
        return { ok: false, error: "Invalid response frame marker" }
    }

    try {
        var lines = ["silent", "show-error", configLine("url", spec.url),
            configLine("request", spec.method),
            configLine("connect-timeout", String(spec.connectTimeoutSec || 5)),
            configLine("max-time", String(spec.maxTimeSec || 10)),
            configLine("header", "Accept: application/json")]
        if (spec.method === "POST") {
            lines.push(configLine("header", "Content-Type: application/json"))
            lines.push(configLine("data-binary", String(spec.body || "")))
        }
        if (spec.sid) lines.push(configLine("header", "X-FTL-SID: " + spec.sid))
        if (spec.caCertPath) lines.push(configLine("cacert", spec.caCertPath))
        lines.push(configLine("write-out", "\n" + frameMarker + "%{http_code}\n"))
        return { ok: true, text: lines.join("\n") + "\n" }
    } catch (error) {
        return { ok: false, error: String(error.message || "Could not serialize curl request") }
    }
}

function parseOutput(stdout, frameMarker) {
    var text = String(stdout || "")
    var frameAt = text.lastIndexOf(frameMarker)
    if (frameAt < 1 || text.charAt(frameAt - 1) !== "\n") return { ok: false, error: "curl response status framing was missing" }
    var suffix = text.slice(frameAt + frameMarker.length)
    var match = /^(\d{3})\n?$/.exec(suffix)
    if (!match) return { ok: false, error: "curl response status framing was invalid" }
    return { ok: true, status: Number(match[1]), body: text.slice(0, frameAt - 1) }
}

function errorForExitCode(code) {
    if (code === 6) return { kind: "network", message: "DNS lookup failed" }
    if (code === 7) return { kind: "network", message: "Could not connect to Pi-hole" }
    if (code === 28) return { kind: "timeout", message: "Pi-hole request timed out" }
    if (code === 60) return { kind: "tls", message: "TLS certificate verification failed" }
    if (code === 77) return { kind: "config", message: "Could not load the configured CA certificate" }
    if ([35, 51, 58, 59, 64, 66, 80, 82, 83, 90, 91].indexOf(code) !== -1) {
        return { kind: "tls", message: "TLS connection failed (curl error " + code + ")" }
    }
    if (code === 127 || code === -2) return { kind: "config", message: "curl is required by OmaPiHole" }
    return { kind: "network", message: "Network request failed (curl error " + code + ")" }
}

if (typeof module !== "undefined") {
    module.exports = { quoteConfigValue: quoteConfigValue, configLine: configLine,
        buildRequest: buildRequest, parseOutput: parseOutput, errorForExitCode: errorForExitCode }
}
