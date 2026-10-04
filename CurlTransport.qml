import QtQuick
import Quickshell.Io
import "CurlConfig.js" as CurlConfig

Item {
    id: root

    signal completed(int requestId, int curlExitCode, int httpStatus,
                     string body, string errorKind, string errorMessage)

    property var _activeProcess: null

    function start(requestId, spec) {
        if (_activeProcess !== null) return false
        var marker = "__OMAPI_HTTP_" + requestId + "_" + Math.floor(Math.random() * 0x7fffffff) + "__="
        var built = CurlConfig.buildRequest(spec, marker)
        if (!built.ok) {
            Qt.callLater(function() { root.completed(requestId, -1, 0, "", "config", built.error) })
            return true
        }

        var process = curlProcess.createObject(root, {
            requestId: requestId,
            frameMarker: marker,
            configText: built.text,
            running: true
        })
        if (!process) {
            Qt.callLater(function() { root.completed(requestId, -1, 0, "", "config", "Could not start curl") })
            return true
        }
        _activeProcess = process
        return true
    }

    function cancel(requestId) {
        var process = _activeProcess
        if (!process || (requestId !== undefined && process.requestId !== requestId)) return
        _activeProcess = null
        process.cancelled = true
        process.running = false
    }

    function processFinished(process, exitCode, stdout) {
        if (process.reported) return
        process.reported = true
        if (_activeProcess === process) _activeProcess = null
        if (process.cancelled) {
            process.destroy()
            return
        }

        var status = 0
        var body = ""
        var kind = ""
        var message = ""
        if (exitCode !== 0) {
            var failure = CurlConfig.errorForExitCode(exitCode)
            kind = failure.kind
            message = failure.message
        } else {
            var parsed = CurlConfig.parseOutput(stdout, process.frameMarker)
            if (!parsed.ok) {
                kind = "protocol"
                message = parsed.error
            } else {
                status = parsed.status
                body = parsed.body
            }
        }

        var requestId = process.requestId
        process.destroy()
        root.completed(requestId, exitCode, status, body, kind, message)
    }

    function processFailedToStart(process) {
        if (process.reported || process.cancelled) return
        process.reported = true
        if (_activeProcess === process) _activeProcess = null
        var requestId = process.requestId
        process.destroy()
        root.completed(requestId, -2, 0, "", "config", "curl is required by OmaPiHole Monitor")
    }

    Component {
        id: curlProcess

        Process {
            id: process
            property int requestId: 0
            property string frameMarker: ""
            property string configText: ""
            property bool cancelled: false
            property bool didStart: false
            property bool reported: false

            command: ["curl", "-q", "--config", "-"]
            clearEnvironment: true
            environment: ({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8" })
            stdinEnabled: true
            stdout: StdioCollector { id: output; waitForEnd: true }
            stderr: StdioCollector { waitForEnd: true }

            onStarted: {
                didStart = true
                write(configText)
                configText = ""
                stdinEnabled = false
            }
            onRunningChanged: {
                if (!running && !didStart && !cancelled) Qt.callLater(function() { root.processFailedToStart(process) })
                else if (!running && !didStart && cancelled) process.destroy()
            }
            onExited: function(exitCode) { root.processFinished(process, exitCode, output.text) }
        }
    }
}
