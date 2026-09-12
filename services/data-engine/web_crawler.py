"""Bounded, robots-aware crawler for the server-owned public site catalog."""
import asyncio
import hashlib
import ipaddress
import json
import os
import re
import socket
import sqlite3
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx
import trafilatura
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from crawl_sites import SITES

router = APIRouter()
USER_AGENT = 'RadarPublicResearchBot/1.0'
MAX_BYTES = 4 * 1024 * 1024
MAX_PAGES = 12
DUE_SECONDS = 6 * 3600
_global = asyncio.Semaphore(2)
_site_locks = {}


class CrawlRequest(BaseModel):
    siteId: str = Field(min_length=1, max_length=80)
    replayKey: str | None = Field(default=None, max_length=160)


class CrawlFailure(Exception):
    def __init__(self, message, cooldown=0, blocked=False):
        super().__init__(message)
        self.cooldown, self.blocked = cooldown, blocked


def canonical(url, site):
    try:
        p = urlsplit(url)
        if p.scheme != 'https' or p.hostname not in site['hosts'] or p.username or p.password or p.port not in (None, 443):
            return None
        if any(c in url for c in ('\\', '\n', '\r', '\x00')):
            return None
        # Catalog content is path-addressed. Drop queries so tracking/filter links cannot explode the frontier.
        path = p.path or '/'
        if site['kind'] == 'community':
            match = re.fullmatch(r'(/t/[^/]+/\d+)(?:/\d+)?/?', path)
            if match: path = match.group(1)
        return urlunsplit(('https', p.hostname, path, '', ''))
    except ValueError:
        return None


async def resolve_public(host):
    infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return list({item[4][0] for item in infos})


async def check_public(host, resolver):
    addresses = await resolver(host)
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise CrawlFailure('Host does not resolve exclusively to public addresses', blocked=True)


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.extend(v for k, v in attrs if k == 'href' and v)


async def render_browser(url, site, resolver, robots, transport=None):
    """Run genuine JS while intercepting every outbound browser resource."""
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=USER_AGENT, service_workers='block')
        client = httpx.AsyncClient(transport=transport, timeout=10, trust_env=False, headers={'User-Agent': USER_AGENT})
        try:
            async def intercept(route):
                req = route.request
                target = canonical(req.url, site)
                if not target or req.method != 'GET' or urlsplit(target).hostname != urlsplit(url).hostname or req.resource_type in ('image', 'media', 'font', 'websocket') or not robots.can_fetch(USER_AGENT, req.url):
                    return await route.abort()
                try:
                    await check_public(urlsplit(target).hostname, resolver)
                    # Proxy bounded responses through HTTPX: Chromium never makes an unchecked network connection.
                    async with client.stream('GET', req.url, follow_redirects=False) as resource:
                        if resource.status_code >= 400:
                            return await route.abort()
                        if resource.status_code in (301, 302, 303, 307, 308):
                            redirect = canonical(urljoin(req.url, resource.headers.get('location', '')), site)
                            if not redirect or urlsplit(redirect).hostname != urlsplit(url).hostname or not robots.can_fetch(USER_AGENT, redirect):
                                return await route.abort()
                        chunks, size = [], 0
                        async for chunk in resource.aiter_bytes():
                            size += len(chunk)
                            if size > MAX_BYTES: return await route.abort()
                            chunks.append(chunk)
                        headers = {k:v for k,v in resource.headers.items() if k.lower() not in ('content-encoding','content-length','set-cookie')}
                        await route.fulfill(status=resource.status_code, headers=headers, body=b''.join(chunks))
                except Exception:
                    await route.abort()
            await context.route('**/*', intercept)
            await context.route_web_socket('**/*', lambda ws: ws.close())
            page = await context.new_page()
            response = await page.goto(url, wait_until='domcontentloaded', timeout=12000)
            if response and response.status >= 400:
                raise CrawlFailure(f'Browser HTTP {response.status}', 120 if response.status in (403, 429) else 0, response.status in (403, 429))
            await page.wait_for_timeout(900)
            if not canonical(page.url, site):
                raise CrawlFailure('Browser redirected outside approved hosts', blocked=True)
            content = await page.content()
            if len(content.encode()) > MAX_BYTES:
                raise CrawlFailure('Rendered page exceeds 4 MiB')
            return content
        finally:
            await client.aclose()
            await context.close()
            await browser.close()


class Crawler:
    def __init__(self, site, state_dir=None, transport=None, resolver=resolve_public, renderer=render_browser, replay_key=None, sleeper=asyncio.sleep):
        self.site, self.transport, self.resolver, self.renderer = site, transport, resolver, renderer
        self.replay_key = replay_key
        self.sleeper = sleeper
        directory = Path(state_dir or os.environ.get('CRAWLER_STATE_DIR', '.local/crawl-state'))
        directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(directory / 'crawler.sqlite3', timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS pages(site TEXT,url TEXT,due REAL DEFAULT 0,etag TEXT,modified TEXT,document TEXT,PRIMARY KEY(site,url));
        CREATE TABLE IF NOT EXISTS replays(site TEXT,key TEXT,result TEXT,created REAL,PRIMARY KEY(site,key));
        CREATE TABLE IF NOT EXISTS cooldowns(site TEXT PRIMARY KEY,until REAL);
        CREATE TABLE IF NOT EXISTS batch_journal(site TEXT,key TEXT,result TEXT,created REAL,PRIMARY KEY(site,key));
        ''')
        self.result = dict(documents=[], cooldownSeconds=0, quotaRemaining=None, errors=[], applications=0,
            stats=dict(siteId=site['id'],siteName=site['name'],visited=0,discovered=0,rendered=0,cached=0,blocked=0,remaining=0))
        self.robots = {}

    def queue(self, url):
        cur = self.db.execute('INSERT OR IGNORE INTO pages(site,url) VALUES (?,?)', (self.site['id'], url))
        self.result['stats']['discovered'] += cur.rowcount
        self.db.commit()

    def checkpoint(self):
        # Commit the current job output atomically with the page's cache/due update.
        # A killed worker can then replay every document before advancing its frontier.
        if self.replay_key:
            self.db.execute('INSERT OR REPLACE INTO batch_journal VALUES (?,?,?,?)',
                (self.site['id'], self.replay_key, json.dumps(self.result), time.time()))
        self.db.commit()

    async def fetch(self, client, url, headers=None):
        is_robots = urlsplit(url).path == '/robots.txt'
        for _ in range(4):
            if not canonical(url, self.site):
                raise CrawlFailure('Redirect outside approved HTTPS hosts', blocked=True)
            await check_public(urlsplit(url).hostname, self.resolver)
            async with client.stream('GET', url, headers=headers, follow_redirects=False) as response:
                if response.status_code in (301,302,303,307,308):
                    target = canonical(urljoin(url, response.headers.get('location','')), self.site)
                    if not target:
                        raise CrawlFailure('Redirect outside approved HTTPS hosts', blocked=True)
                    if not is_robots:
                        if target != self.site['seed'] and not re.search(self.site['path_pattern'],urlsplit(target).path):
                            raise CrawlFailure('Redirect outside approved page paths', blocked=True)
                        rules = await self.rules(client, target)
                        if not rules.can_fetch(USER_AGENT, target):
                            raise CrawlFailure('Redirect denied by robots.txt', blocked=True)
                    url = target
                    continue
                if response.status_code in (403,429):
                    try: cooldown = max(60, min(3600,int(response.headers.get('retry-after','120'))))
                    except ValueError: cooldown = 120
                    raise CrawlFailure(f'HTTP {response.status_code}; public access blocked or rate limited', cooldown, True)
                if response.status_code not in (200,304,404):
                    raise CrawlFailure(f'HTTP {response.status_code}')
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES: raise CrawlFailure('Response exceeds 4 MiB')
                    chunks.append(chunk)
                return response.status_code, b''.join(chunks).decode('utf-8',errors='replace'), response.headers
        raise CrawlFailure('Too many redirects', blocked=True)

    async def rules(self, client, url):
        host = urlsplit(url).hostname
        if host not in self.robots:
            status, body, _ = await self.fetch(client, f'https://{host}/robots.txt')
            if status != 200 or re.search(r'<(?:html|script|title|!doctype)\b', body, re.I):
                raise CrawlFailure(f'{host}: robots.txt unavailable; skipped safely', blocked=True)
            rules = RobotFileParser()
            rules.parse(body.splitlines())
            self.robots[host] = rules
        return self.robots[host]

    def document(self, url, html, method):
        if re.search(r'<title[^>]*>[^<]*(?:verify you are human|access denied|just a moment)|<input[^>]+type=[\"\']password|cf-chl-', html[:100000], re.I):
            raise CrawlFailure('Public page presents a login or access challenge', blocked=True)
        extracted = trafilatura.bare_extraction(html, include_comments=True, include_tables=False, favor_recall=True, with_metadata=True)
        extraction = extracted.as_dict() if extracted else {}
        body = (extraction or {}).get('text') or ''
        if len(body.strip()) < 100: return None
        body = body[:40000]
        title = (extraction or {}).get('title') or urlsplit(url).path
        return dict(sourceKey='web',externalId=url,canonicalUrl=url,type='post' if self.site['kind']=='community' else 'article',title=title[:500],body=body,
            metadata=dict(crawlSite=self.site['id'],sourceHost=urlsplit(url).hostname,pageKind=self.site['kind'],fetchMethod=method,contextComplete=False,
                contextNote=('Public community excerpt; full thread context and author identity are not verified.' if self.site['kind'] == 'community' else 'Public product marketing or directory description; not user demand or a verified customer pain point.'),contentHash=hashlib.sha256(body.encode()).hexdigest()))

    async def batch(self):
        site_id = self.site['id']
        self.queue(self.site['seed'])
        seen = set()
        previous_visits = self.result['stats']['visited']
        async with httpx.AsyncClient(transport=self.transport, timeout=10, headers={'User-Agent':USER_AGENT}, trust_env=False) as client:
            while previous_visits + len(seen) < MAX_PAGES:
                rows = self.db.execute('SELECT * FROM pages WHERE site=? AND due<=? ORDER BY (document IS NOT NULL),due,rowid LIMIT 100', (site_id,time.time())).fetchall()
                row = next((r for r in rows if r['url'] not in seen),None)
                if row is None: break
                url = row['url']; seen.add(url)
                try:
                    rules = await self.rules(client,url)
                    if not rules.can_fetch(USER_AGENT,url): raise CrawlFailure('Denied by robots.txt',blocked=True)
                    delay = max(1, rules.crawl_delay(USER_AGENT) or 0)
                    await self.sleeper(delay)
                    self.result['stats']['visited'] += 1
                    headers = {}
                    if row['etag']: headers['If-None-Match'] = row['etag']
                    if row['modified']: headers['If-Modified-Since'] = row['modified']
                    status, html, response_headers = await self.fetch(client,url,headers)
                    content_type = response_headers.get('content-type','').lower()
                    if content_type and not any(kind in content_type for kind in ('text/html','application/xhtml+xml','text/plain')):
                        raise CrawlFailure('Unsupported non-HTML response')
                    if status == 404: raise CrawlFailure('HTTP 404')
                    if re.search(r'<title[^>]*>[^<]*(?:verify you are human|access denied|just a moment)|<input[^>]+type=[\"\']password|cf-chl-', html[:100000], re.I):
                        raise CrawlFailure('Public page presents a login or access challenge', blocked=True)
                    if status == 304 and row['document']:
                        doc = json.loads(row['document'])
                        self.result['stats']['cached'] += 1
                    else:
                        relevant = bool(re.search(self.site['path_pattern'],urlsplit(url).path)) or (self.site['kind'] == 'product' and url == self.site['seed'])
                        doc = self.document(url,html,'http') if relevant else None
                        links = Links(); links.feed(html)
                        has_links = any((target := canonical(urljoin(url,link),self.site)) and re.search(self.site['path_pattern'],urlsplit(target).path) for link in links.links[:3000])
                        if self.site.get('render') or (not doc and (relevant or not has_links) and ('<script' in html or 'id="app"' in html)):
                            html = await self.renderer(url,self.site,self.resolver,rules)
                            self.result['stats']['rendered'] += 1
                            doc = self.document(url,html,'browser') if relevant else None
                        links = Links(); links.feed(html)
                        for link in links.links[:3000]:
                            target = canonical(urljoin(url,link),self.site)
                            if target and re.search(self.site['path_pattern'],urlsplit(target).path): self.queue(target)
                        if relevant and not doc: raise CrawlFailure('Page contains insufficient public text')
                    if doc: self.result['documents'].append(doc)
                    self.db.execute('UPDATE pages SET due=?,etag=COALESCE(?,etag),modified=COALESCE(?,modified),document=? WHERE site=? AND url=?',
                        (time.time()+DUE_SECONDS,response_headers.get('etag'),response_headers.get('last-modified'),json.dumps(doc) if doc else None,site_id,url))
                except Exception as exc:
                    cooldown = getattr(exc,'cooldown',0)
                    self.result['cooldownSeconds'] = max(self.result['cooldownSeconds'],cooldown)
                    self.result['stats']['blocked'] += int(getattr(exc,'blocked',False))
                    self.result['errors'].append(f'{url}: {str(exc)[:240]}')
                    self.db.execute('UPDATE pages SET due=? WHERE site=? AND url=?',(time.time()+max(60,cooldown),site_id,url))
                    if cooldown:
                        self.db.execute('INSERT OR REPLACE INTO cooldowns VALUES (?,?)',(site_id,time.time()+cooldown))
                        self.checkpoint()
                        break
                    if urlsplit(url).hostname not in self.robots:
                        self.checkpoint()
                        break
                self.checkpoint()

    async def crawl(self):
        try:
            if self.replay_key:
                replay = self.db.execute('SELECT result FROM replays WHERE site=? AND key=?',(self.site['id'],self.replay_key)).fetchone()
                if replay: return json.loads(replay['result'])
            lock = _site_locks.setdefault(self.site['id'],asyncio.Lock())
            try:
                async with asyncio.timeout(40):
                    async with _global, lock:
                        if self.replay_key:
                            replay = self.db.execute('SELECT result FROM replays WHERE site=? AND key=?',(self.site['id'],self.replay_key)).fetchone()
                            if replay: return json.loads(replay['result'])
                            journal = self.db.execute('SELECT result FROM batch_journal WHERE site=? AND key=?',(self.site['id'],self.replay_key)).fetchone()
                            if journal: self.result = json.loads(journal['result'])
                        cooldown = self.db.execute('SELECT until FROM cooldowns WHERE site=?',(self.site['id'],)).fetchone()
                        if cooldown and cooldown['until']>time.time():
                            self.result['cooldownSeconds'] = max(1,int(cooldown['until']-time.time()))
                            self.result['errors'].append('Site cooldown is active')
                        else: await self.batch()
            except TimeoutError:
                self.result['errors'].append('40-second crawl deadline reached; partial results retained')
            if not self.result['documents']:
                rows = self.db.execute('SELECT document FROM pages WHERE site=? AND document IS NOT NULL ORDER BY due DESC LIMIT 12',(self.site['id'],)).fetchall()
                self.result['documents'] = [json.loads(row['document']) for row in rows]
                self.result['stats']['cached'] += len(rows)
            self.result['stats']['remaining'] = self.db.execute('SELECT count(*) FROM pages WHERE site=? AND (document IS NULL OR due<=?) AND (url<>? OR due<=?)',(self.site['id'],time.time(),self.site['seed'],time.time())).fetchone()[0]
            if self.replay_key:
                self.db.execute('INSERT OR REPLACE INTO replays VALUES (?,?,?,?)',(self.site['id'],self.replay_key,json.dumps(self.result),time.time()))
                self.db.execute('DELETE FROM replays WHERE created<?',(time.time()-7*86400,))
                self.db.execute('DELETE FROM batch_journal WHERE site=? AND key=?',(self.site['id'],self.replay_key))
            self.db.commit()
            return self.result
        finally:
            self.db.close()


@router.get('/crawl/sites')
def crawl_sites():
    return {'sites':[{k:site[k] for k in ('id','name','seed','kind','enabled')} for site in SITES.values()]}


@router.post('/crawl')
async def crawl(request: CrawlRequest):
    site = SITES.get(request.siteId)
    if not site or not site.get('enabled'): raise HTTPException(400,'Unknown or disabled crawl site')
    return await Crawler(site,replay_key=request.replayKey).crawl()
