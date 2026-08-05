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
import socketserver
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(REPO_ROOT, 'assets', 'og-cover.jpg')
OUT_PATH = DEFAULT_OUT
MAX_BYTES = 5 * 1024 * 1024  # generous ceiling; the real card is ~85KB


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=REPO_ROOT, **kwargs)

    def do_POST(self):
        if self.path != '/save-og':
            self.send_error(404)
            return

        length = int(self.headers.get('Content-Length', 0))
        if length <= 0 or length > MAX_BYTES:
            self.send_error(413, 'bad length')
            return

        body = self.rfile.read(length)
        # JPEG magic, so a mis-wired fetch can't silently write garbage here.
        if not body.startswith(b'\xff\xd8\xff'):
            self.send_error(400, 'not a JPEG')
            return

        os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
        with open(OUT_PATH, 'wb') as fh:
            fh.write(body)

        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(f'wrote {len(body)} bytes to {OUT_PATH}'.encode())
        print(f'[og] wrote {len(body)} bytes -> {OUT_PATH}', flush=True)

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
