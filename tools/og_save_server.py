"""Tiny dev server for regenerating the social card.

Serves the repo like `py -m http.server`, but also accepts
`POST /save-og` and writes the raw request body to assets/og-cover.jpg.
That lets tools/make_og_image.html hand the rendered canvas straight to
disk as binary, instead of round-tripping ~116KB of base64 by hand.

Usage:
    py tools/og_save_server.py [port] [out_path]
then open  http://localhost:<port>/tools/make_og_image.html

out_path defaults to assets/og-cover.jpg. Pass an explicit path to render a
preview somewhere harmless (e.g. a scratch dir) while leaving the live card
in place until the design is approved.
"""

import http.server
import os
import re
import socketserver
import sys
import urllib.parse

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(REPO_ROOT, 'assets', 'og-cover.jpg')
OUT_PATH = DEFAULT_OUT
MAX_BYTES = 5 * 1024 * 1024  # generous ceiling; the real card is ~85KB


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/save-og':
            self.send_error(404)
            return

        # Optional ?name=foo.png writes to that file in the repo root instead
        # of the configured output. Restricted to a bare safe filename so a
        # stray request can't traverse out of the repo.
        name = urllib.parse.parse_qs(parsed.query).get('name', [None])[0]
        if name is None:
            out_path = OUT_PATH
        elif re.fullmatch(r'[A-Za-z0-9._-]+\.(png|jpg)', name) and '..' not in name:
            out_path = os.path.join(REPO_ROOT, name)
        else:
            self.send_error(400, 'unsafe name')
            return

        length = int(self.headers.get('Content-Length', 0))
        if length <= 0 or length > MAX_BYTES:
            self.send_error(413, 'bad length')
            return

        body = self.rfile.read(length)
        # Match magic bytes to the extension, so a mis-wired fetch can't
        # silently write garbage (or a JPEG named .png) into the repo.
        expected = b'\x89PNG\r\n\x1a\n' if out_path.endswith('.png') else b'\xff\xd8\xff'
        if not body.startswith(expected):
            self.send_error(400, f'body does not match {os.path.splitext(out_path)[1]}')
            return

        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'wb') as fh:
            fh.write(body)

        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(f'wrote {len(body)} bytes to {out_path}'.encode())
        print(f'[og] wrote {len(body)} bytes -> {out_path}', flush=True)

    def log_message(self, *args):
        pass  # keep the console to just the [og] lines above


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8970
    if len(sys.argv) > 2:
        OUT_PATH = os.path.abspath(sys.argv[2])
    print(f'[og] writing uploads to {OUT_PATH}', flush=True)
    with socketserver.TCPServer(('', port), Handler) as httpd:
        print(f'serving {REPO_ROOT} on http://localhost:{port}', flush=True)
        httpd.serve_forever()
