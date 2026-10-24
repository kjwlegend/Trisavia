#!/usr/bin/env python3
"""Loopback-only design preview; exposes this package and frozen public art only."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT.parents[2] / 'apps/web/public'


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = unquote(urlsplit(path).path)
        base, relative = (PUBLIC, path[8:]) if path.startswith('/frozen/') else (ROOT, path.lstrip('/'))
        target = (base / relative).resolve()
        if not target.is_relative_to(base):
            return str(ROOT / '_denied_')
        return str(target)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Design preview http://127.0.0.1:{server.server_port}/', flush=True)
    server.serve_forever()
