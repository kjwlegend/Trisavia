#!/usr/bin/env python3
"""Build this standalone presentation. No network or application build required."""
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parent
LOCALES = ('zh-CN', 'en')
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

class Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text, self.nodes, self.stack = text, [], []
        self.offsets = [0] + [m.end() for m in re.finditer('\n', text)]
        self.feed(text)
    def position(self):
        line, column = self.getpos()
        return self.offsets[line - 1] + column
    def handle_starttag(self, tag, attrs):
        start = self.position()
        node = {'tag': tag, 'attrs': dict(attrs), 'start': start, 'openEnd': start + len(self.get_starttag_text())}
        self.nodes.append(node)
        if tag not in VOID:
            self.stack.append(node)
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.stack and self.stack[-1]['start'] == self.position():
            self.stack.pop()
    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]['tag'] == tag:
                self.stack[index]['closeStart'] = self.position()
                self.stack = self.stack[:index]
                return

class InlineMessage(HTMLParser):
    """Compile approved static inline markup; the browser never parses message HTML."""
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root, self.stack = [], []
        self.stack = [self.root]
        self.feed(text)
        if len(self.stack) != 1:
            raise ValueError('Unclosed message tag')
    def handle_starttag(self, tag, attrs):
        if tag not in {'span', 'em', 'strong', 'br', 'code', 'small'}:
            raise ValueError('Unapproved message tag: ' + tag)
        if any(name != 'class' or not re.fullmatch(r'[a-zA-Z0-9 -]+', value or '') for name, value in attrs):
            raise ValueError('Unapproved message attribute')
        node = {'tag': tag, 'children': []}
        if attrs:
            node['className'] = dict(attrs)['class']
        self.stack[-1].append(node)
        if tag != 'br':
            self.stack.append(node['children'])
    def handle_endtag(self, tag):
        if len(self.stack) <= 1:
            raise ValueError('Unexpected message end tag')
        self.stack.pop()
    def handle_data(self, data):
        self.stack[-1].append(data)
    def handle_comment(self, data):
        raise ValueError('Message comments are not allowed')


def replace_attribute(tag, name, value):
    pattern = r'(?<![\w-])' + re.escape(name) + r'="[^"]*"'
    replacement = f'{name}="{escape(value, quote=True)}"'
    if re.search(pattern, tag):
        return re.sub(pattern, lambda _: replacement, tag, count=1)
    return tag[:-1] + ' ' + replacement + '>'


def build_entry(template, messages, locale, resource_prefix, published=False):
    edits = []
    for node in Document(template).nodes:
        attrs = node['attrs']
        opening = template[node['start']:node['openEnd']]
        if node['tag'] == 'html':
            opening = replace_attribute(opening, 'lang', locale)
        if 'data-intro-i18n' in attrs:
            value = messages[attrs['data-intro-i18n']]
            edits.append((node['openEnd'], node['closeStart'], value))
        for attribute in ('alt', 'title', 'aria-label', 'content', 'data-title'):
            key = attrs.get('data-intro-' + attribute)
            if key:
                value = messages[key].replace('{count}', '10')
                opening = replace_attribute(opening, attribute, value)
        for attribute in ('href', 'src', 'data-fallback'):
            value = attrs.get(attribute)
            if value and (value.startswith('assets/') or value in ('style.css', 'deck.js', 'content.js')):
                opening = replace_attribute(opening, attribute, resource_prefix + value)
        if 'data-intro-locale' in attrs:
            target = attrs['data-intro-locale']
            target_href = f'/{target}/intro/' if published else ('' if resource_prefix == '' else '../') + f'{target}/index.html'
            opening = replace_attribute(opening, 'href', target_href)
            opening = replace_attribute(opening, 'aria-current', 'true' if target == locale else 'false')
        if 'data-intro-source-link' in attrs:
            opening = replace_attribute(opening, 'href', f'/{locale}/intro/sources.html' if published else f'{resource_prefix}{locale}/sources.html')
        if opening != template[node['start']:node['openEnd']]:
            edits.append((node['start'], node['openEnd'], opening))
    for start, end, value in sorted(edits, reverse=True):
        template = template[:start] + value + template[end:]
    return template


def inline_markdown(text):
    # Only this repository's approved source prose is rendered, never user input.
    text = escape(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    def link(match):
        href = match[2]
        if not href.startswith('https://'):
            raise ValueError('Unapproved source URL')
        return f'<a href="{href}" target="_blank" rel="noopener noreferrer">{match[1]}</a>'
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, text)


def markdown(text):
    lines, result, index = text.splitlines(), [], 0
    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue
        if line.startswith('| '):
            rows = []
            while index < len(lines) and lines[index].startswith('| '):
                cells = lines[index].strip('| ').split(' | ')
                if not all(re.fullmatch(r'[-: ]+', cell) for cell in cells):
                    rows.append(cells)
                index += 1
            result.append('<table><thead><tr>' + ''.join('<th scope="col">' + inline_markdown(cell) + '</th>' for cell in rows[0]) + '</tr></thead><tbody>')
            for row in rows[1:]:
                result.append('<tr>' + ''.join('<td>' + inline_markdown(cell) + '</td>' for cell in row) + '</tr>')
            result.append('</tbody></table>')
            continue
        if line.startswith('#'):
            level = len(line) - len(line.lstrip('#'))
            result.append(f'<h{level}>' + inline_markdown(line[level:].strip()) + f'</h{level}>')
        elif line.startswith('- '):
            items = []
            while index < len(lines) and lines[index].startswith('- '):
                items.append('<li>' + inline_markdown(lines[index][2:]) + '</li>')
                index += 1
            result.append('<ul>' + ''.join(items) + '</ul>')
            continue
        else:
            paragraph = [line]
            while index + 1 < len(lines) and lines[index + 1].strip() and not lines[index + 1].startswith(('#', '- ', '| ')):
                index += 1
                paragraph.append(lines[index])
            result.append('<p>' + inline_markdown(' '.join(paragraph)) + '</p>')
        index += 1
    return '\n'.join(result)


def sources_page(contents, locale, resource_prefix, published):
    messages = contents[locale]
    def route(target, source=False):
        if published:
            return f'/{target}/intro/' + ('sources.html' if source else '')
        return resource_prefix + f'{target}/' + ('sources.html' if source else 'index.html')
    links = ''.join(f'<a class="language-link" data-intro-locale="{target}" href="{route(target, True)}" lang="{target}" hreflang="{target}" aria-current="{str(target == locale).lower()}">{"English" if target == "en" else "简体中文"}</a>' for target in LOCALES)
    articles = '\n'.join(f'<article data-intro-source-locale="{target}" lang="{target}"' + (' hidden inert' if target != locale else '') + '>' + markdown((ROOT / f'sources.{target}.md').read_text()) + '</article>' for target in LOCALES)
    return f'''<!doctype html>
<html lang="{locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title data-intro-i18n="sources.title">{escape(messages['sources.title'])}</title>
<link rel="icon" href="{resource_prefix}assets/trisavia-small-mark-framed.svg" type="image/svg+xml">
<link rel="stylesheet" href="{resource_prefix}style.css">
<script src="{resource_prefix}content.js" defer></script><script src="{resource_prefix}deck.js" defer></script></head>
<body class="sources-page"><main class="sources-main">
<nav class="sources-nav"><a data-intro-return href="{route(locale)}" data-intro-i18n="sources.return">{messages['sources.return']}</a><div class="language-controls" aria-label="{messages['controls.language']}" data-intro-aria-label="controls.language">{links}</div></nav>
{articles}
</main></body></html>\n'''


def build():
    contents = {locale: json.loads((ROOT / 'locales' / f'{locale}.json').read_text()) for locale in LOCALES}
    if contents['zh-CN'].keys() != contents['en'].keys():
        raise ValueError('Language key mismatch')
    for key in contents['en']:
        a = set(re.findall(r'\{\w+\}', contents['zh-CN'][key]))
        b = set(re.findall(r'\{\w+\}', contents['en'][key]))
        if a != b:
            raise ValueError('Message parameter mismatch: ' + key)
    compiled = {}
    for locale, messages in contents.items():
        compiled[locale] = {key: InlineMessage(value).root if '<' in value else value for key, value in messages.items()}
    (ROOT / 'content.js').write_text('// Generated by build.py from the two approved local dictionaries.\nwindow.TRISAVIA_INTRO_CONTENT = ' + json.dumps(compiled, ensure_ascii=False, separators=(',', ':')) + ';\n')
    template = (ROOT / 'template.html').read_text()
    published_root = ROOT / 'publish'
    published_root.mkdir(exist_ok=True)
    shutil.copytree(ROOT / 'assets', published_root / 'assets', dirs_exist_ok=True)
    for locale in LOCALES:
        for target_root, prefix, published in ((ROOT, '../', False), (published_root, '/intro/', True)):
            target = target_root / locale
            target.mkdir(exist_ok=True)
            (target / 'index.html').write_text(build_entry(template, contents[locale], locale, prefix, published))
            (target / 'sources.html').write_text(sources_page(contents, locale, prefix, published))
    (ROOT / 'index.html').write_text(build_entry(template, contents['zh-CN'], 'zh-CN', ''))
    (ROOT / 'sources.html').write_text(sources_page(contents, 'zh-CN', '', False))
    (published_root / 'index.html').write_text(build_entry(template, contents['zh-CN'], 'zh-CN', '/intro/', True))
    (published_root / 'sources.html').write_text(sources_page(contents, 'zh-CN', '/intro/', True))
    for filename in ('style.css', 'deck.js', 'content.js', 'sources.en.md', 'sources.zh-CN.md'):
        shutil.copyfile(ROOT / filename, published_root / filename)
    (published_root / 'sources.md').write_text('# Trisavia — Sources / 来源\n\n[English](sources.en.md) · [简体中文](sources.zh-CN.md)\n\n[Readable sources / 可读来源页](sources.html)\n')
    print(f'Built 10 slides, {len(contents["en"])} paired messages, 3 entries and sources in each boundary.')

if __name__ == '__main__':
    build()
