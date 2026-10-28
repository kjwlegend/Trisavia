#!/usr/bin/env python3
"""Check the static source/publish boundary without a browser or product API."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('intro_build', ROOT / 'build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

# Regeneration must be deterministic, and must leave the artwork byte-for-byte intact.
assets = {str(path.relative_to(ROOT)): digest(path) for path in (ROOT / 'assets').iterdir()}
build.build()
before = {str(path.relative_to(ROOT)): digest(path) for path in ROOT.rglob('*') if path.is_file() and path.suffix in ('.html', '.js', '.css', '.json')}
build.build()
assert before == {name: digest(ROOT / name) for name in before}, 'Build was not deterministic'
for name, value in assets.items():
    assert value == digest(ROOT / name) == digest(ROOT / 'publish' / name)
assert not list((ROOT / 'publish' / 'en').rglob('*.png'))
assert not list((ROOT / 'publish' / 'zh-CN').rglob('*.png'))

messages = {locale: json.loads((ROOT / 'locales' / f'{locale}.json').read_text()) for locale in build.LOCALES}
assert messages['en'].keys() == messages['zh-CN'].keys()
protocol = ['GET /v1/capabilities', '/v1/gateway/discovery', 'POST …/gateway/query', 'POST …/gateway/commands', 'POST …/gateway/receipts/query', 'protocolVersion: 1', 'outcome / result']
for boundary in (ROOT, ROOT / 'publish'):
    for locale in build.LOCALES:
        path = boundary / locale / 'index.html'
        html = path.read_text()
        nodes = build.Document(html).nodes
        assert f'<html lang="{locale}">' in html
        assert len([n for n in nodes if n['tag'] == 'section']) == 10
        assert len([n for n in nodes if 'data-intro-locale' in n['attrs']]) == 2
        for literal in protocol:
            assert literal in html, literal
        for node in nodes:
            attrs = node['attrs']
            for attr, key in attrs.items():
                if attr.startswith('data-intro-') and attr not in ('data-intro-locale', 'data-intro-source-link', 'data-intro-source-locale', 'data-intro-return'):
                    assert key in messages[locale], key
            if node['tag'] == 'img' and attrs.get('alt'):
                assert 'data-intro-alt' in attrs
            for attr in ('aria-label', 'title', 'data-title'):
                if attrs.get(attr):
                    assert 'data-intro-' + attr in attrs, attrs
        if locale == 'en':
            # Chinese is retained only in the visible language choice, never as untranslated deck copy.
            assert re.findall('[\u4e00-\u9fff]+', html) == ['简体中文']
            assert 'Capabilities reviewed Oct 28, 2026' in html
            assert 'Original Chinese UI' in html
            assert 'Work and town life' in html
            assert 'The authoritative Agent guide remains in Chinese.' in html
            assert 'Town Hall selection' in html
            assert 'A development direction' in html
            assert not any(value in html for value in ['Agenta life', 'tools.Become'])
        for node in nodes:
            for attr in ('src', 'data-fallback', 'href'):
                value = node['attrs'].get(attr, '')
                if not value or value.startswith(('https://', '#')):
                    continue
                if boundary == ROOT / 'publish':
                    if value.startswith('/intro/'):
                        target = boundary / value[len('/intro/'):]
                    else:
                        match = re.fullmatch(r'/(en|zh-CN)/intro/(sources.html)?', value)
                        assert match, value
                        target = boundary / match[1] / (match[2] or 'index.html')
                else:
                    target = path.parent / value
                assert target.is_file(), (path, attr, value)
        sources = (boundary / locale / 'sources.html').read_text()
        assert f'<html lang="{locale}">' in sources
        assert f'<article data-intro-source-locale="{locale}" lang="{locale}">' in sources
        assert 'README.md#adding-a-business-module' in sources
        assert 'October 24, 2026' in sources
        assert '<table>' in sources
        assert 'https://trisavia.kjwlabs.com/agent/entry.md' in sources

# Print CSS still reveals all slides; the language toolbar is not printed.
css = (ROOT / 'style.css').read_text()
assert '@page{size:320mm 180mm;margin:0}' in css
assert '.slide,html:not(.js) .slide,body.reading .slide' in css
assert '.language-controls{display:none!important}' in css
# Paper orientation / the PDF default viewport must never activate continuous mobile layouts.
assert css.count('@media screen and (max-width:800px),screen and (orientation:portrait)') == 2
assert not re.search(r'@media\s*\(max-width:', css)
assert '@media print,screen and (min-width:801px) and (orientation:landscape)' in css
print(f'Static checks passed: 10 slides × 2 languages × 2 boundaries; {len(messages["en"])} paired messages; all local references and 9 original assets.')
