#!/usr/bin/env python3
import http.server
import json
import os
import pathlib
import shutil
import ssl
import subprocess
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
BRIDGE = (
    "const fs=require('fs'); const c=require('./CurlConfig.js'); "
    "const x=JSON.parse(fs.readFileSync(0,'utf8')); "
    "const r=c.buildRequest(x.spec,x.marker); "
    "if(!r.ok){process.stderr.write(r.error);process.exit(2)} "
    "process.stdout.write(r.text)"
)

sink_requests = []
source_requests = []
SYNTHETIC_PASSWORD = 'quote" slash\\ tab\t line\n return\r unicode-雪'
slow_arrived = threading.Event()
slow_release = threading.Event()


class Sink(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        sink_requests.append(("GET", self.path, dict(self.headers)))
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        sink_requests.append(("POST", self.path, dict(self.headers), body))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_args):
        pass


class Source(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        source_requests.append((self.path, dict(self.headers), body))
        if self.headers.get("X-FTL-SID") == "synthetic-delayed-sid":
            slow_arrived.set()
            slow_release.wait(5)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        status = (301, 302, 303, 307, 308)[len(source_requests) - 1]
        self.send_response(status)
        self.send_header("Location", f"http://127.0.0.1:{sink.server_port}/sink")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *_args):
        pass


sink = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Sink)
source = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Source)
threading.Thread(target=sink.serve_forever, daemon=True).start()
threading.Thread(target=source.serve_forever, daemon=True).start()


def config_for(path, marker):
    spec = {
        "url": f"http://127.0.0.1:{source.server_port}/api/stats/summary",
        "method": "POST",
        "body": json.dumps({"password": SYNTHETIC_PASSWORD}, separators=(",", ":"), ensure_ascii=False),
        "sid": "synthetic-delayed-sid" if path == "/slow" else "synthetic-session-sid",
        "sensitive": False,  # loopback HTTP is solely to test redirect behavior
        "maxTimeSec": 4,
        "connectTimeoutSec": 2,
    }
    result = subprocess.run(
        ["node", "-e", BRIDGE], input=json.dumps({"spec": spec, "marker": marker}),
        text=True, capture_output=True, cwd=ROOT, check=True,
    )
    # Include a proxy Authorization header as an independent redirect-safety probe.
    return result.stdout + 'header = "Authorization: Basic synthetic-proxy-secret"\n'


try:
    with tempfile.TemporaryDirectory(prefix="omapi-curl-home-") as home:
        pathlib.Path(home, ".curlrc").write_text("location\n", encoding="utf-8")
        env = os.environ.copy()
        env["HOME"] = home
        env["CURL_HOME"] = home

        for status in (301, 302, 303, 307, 308):
            marker = f"__TEST_HTTP_{status}__="
            config = config_for(f"/redirect/{status}", marker)
            command = ["curl", "-q", "--config", "-"]
            assert command[:2] == ["curl", "-q"], command
            result = subprocess.run(command, input=config, text=True, capture_output=True, env=env, timeout=6)
            assert result.returncode == 0, result.stderr
            assert result.stdout.endswith("\n" + marker + str(status) + "\n"), repr(result.stdout)

        # Confirm the sensitive-looking values reached server A in the request, while B was never contacted.
        assert len(source_requests) == 5, len(source_requests)
        for path, headers, body in source_requests:
            assert headers.get("X-FTL-SID") == "synthetic-session-sid", headers
            assert headers.get("Authorization") == "Basic synthetic-proxy-secret", headers
            expected_body = json.dumps({"password": SYNTHETIC_PASSWORD}, separators=(",", ":"), ensure_ascii=False).encode()
            assert body == expected_body, body
        time.sleep(0.15)
        assert len(sink_requests) == 0, sink_requests

        # Check the live process table while a credential-bearing config is in use.
        marker = "__TEST_HTTP_SLOW__="
        process = subprocess.Popen(
            ["curl", "-q", "--config", "-"], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
        )
        process.stdin.write(config_for("/slow", marker))
        process.stdin.close()
        process.stdin = None
        assert slow_arrived.wait(3), "delayed server did not receive the request"
        argv = pathlib.Path(f"/proc/{process.pid}/cmdline").read_bytes().replace(b"\0", b" ")
        for secret in (SYNTHETIC_PASSWORD.encode(), b"synthetic-session-sid", b"synthetic-proxy-secret", b"Authorization"):
            assert secret not in argv, argv
        slow_release.set()
        stdout, stderr = process.communicate(timeout=6)
        assert process.returncode == 0, stderr
        assert stdout.endswith("\n" + marker + "200\n"), repr(stdout)

        if shutil.which("openssl"):
            cert = pathlib.Path(home, "server.pem")
            key = pathlib.Path(home, "server-key.pem")
            subprocess.run([
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
                "-keyout", str(key), "-out", str(cert),
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            ca_path = pathlib.Path(home, 'ca "quoted" \\ unicode-ü.pem')
            shutil.copyfile(cert, ca_path)

            class TlsHandler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    body = b'{"tls":"verified"}'
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

                def log_message(self, *_args):
                    pass

            tls_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), TlsHandler)
            tls_server.handle_error = lambda *_args: None
            tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls_context.load_cert_chain(certfile=cert, keyfile=key)
            tls_server.socket = tls_context.wrap_socket(tls_server.socket, server_side=True)
            threading.Thread(target=tls_server.serve_forever, daemon=True).start()
            tls_url = f"https://127.0.0.1:{tls_server.server_port}/api/stats/summary"
            tls_marker = "__TEST_TLS__="

            def tls_config(ca=None):
                tls_spec = {"url": tls_url, "method": "GET", "sensitive": True,
                            "sid": "", "caCertPath": str(ca or ""),
                            "maxTimeSec": 4, "connectTimeoutSec": 2}
                response = subprocess.run(
                    ["node", "-e", BRIDGE],
                    input=json.dumps({"spec": tls_spec, "marker": tls_marker}),
                    text=True, capture_output=True, cwd=ROOT, check=True,
                )
                return response.stdout

            rejected = subprocess.run(["curl", "-q", "--config", "-"], input=tls_config(),
                                      text=True, capture_output=True, env=env, timeout=6)
            assert rejected.returncode == 60, (rejected.returncode, rejected.stderr)
            trusted = subprocess.run(["curl", "-q", "--config", "-"], input=tls_config(ca_path),
                                     text=True, capture_output=True, env=env, timeout=6)
            assert trusted.returncode == 0, trusted.stderr
            assert trusted.stdout == '{"tls":"verified"}\n' + tls_marker + "200\n", repr(trusted.stdout)
            tls_server.shutdown()
            tls_server.server_close()
            print("TLS verification: self-signed cert rejected by default (curl 60); custom CA file accepted: PASS")

        print("Redirect integration: 301/302/303/307/308 refused by default; sink requests: 0")
        print("curlrc location ignored with argv curl -q --config -: PASS")
        print("argv contains no password, SID, proxy password, or Authorization: PASS")
finally:
    slow_release.set()
    source.shutdown()
    sink.shutdown()
    source.server_close()
    sink.server_close()
