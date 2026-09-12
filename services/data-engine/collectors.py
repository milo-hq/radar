"""Bounded public App Store and WordPress reviews; never fetch arbitrary URLs."""
import asyncio
import json
import re
import time
import html
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()
MAX_BYTES = 4 * 1024 * 1024
HOST_SPACING = 0.25
_next_request = 0.0
_request_lock = asyncio.Lock()


class CollectRequest(BaseModel):
    source: Literal['appstore', 'wordpress']
    query: str = Field(min_length=2, max_length=60)
    country: str = Field(default='us', pattern=r'^[a-z]{2}$')


class UpstreamError(Exception):
    def __init__(self, message, cooldown=0):
        super().__init__(message)
        self.cooldown = cooldown


def retry_after(value):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        try:
            seconds = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return 60
    return max(0, min(3600, int(seconds))) if seconds == seconds and abs(seconds) != float('inf') else 60


def apple_url(value):
    if not isinstance(value, str):
        return None
    try:
        p = urlsplit(value)
        if p.scheme not in ('http', 'https') or p.hostname not in ('itunes.apple.com', 'apps.apple.com') or p.username or p.password or p.port not in (None, 80, 443):
            return None
        return urlunsplit(('https', p.hostname, p.path, p.query, ''))
    except ValueError:
        return None


def identifier(value):
    value = str(value)
    return value if re.fullmatch(r'[1-9][0-9]{0,19}', value) else None


def label(entry, key):
    value = entry.get(key, {})
    return value.get('label') if isinstance(value, dict) else None


async def fetch_bytes(client, url, params=None):
    global _next_request
    parsed = urlsplit(url)
    allowed = (
        parsed.netloc == 'itunes.apple.com' and (parsed.path == '/search' or re.fullmatch(r'/[a-z]{2}/rss/customerreviews/id=[1-9][0-9]{0,19}/sortBy=mostRecent/json', parsed.path))
        or parsed.netloc == 'api.wordpress.org' and parsed.path == '/plugins/info/1.2/'
        or parsed.netloc == 'wordpress.org' and re.fullmatch(r'/support/plugin/[a-z0-9]+(?:-[a-z0-9]+)*/reviews/feed/', parsed.path)
    )
    if parsed.scheme != 'https' or not allowed:
        raise UpstreamError('Disallowed public endpoint')
    async with _request_lock:
        await asyncio.sleep(max(0, _next_request - time.monotonic()))
        _next_request = time.monotonic() + HOST_SPACING
    try:
        async with client.stream('GET', url, params=params, follow_redirects=False) as response:
            if response.status_code != 200:
                raise UpstreamError(f'{parsed.hostname} HTTP {response.status_code}', retry_after(response.headers.get('retry-after')) if response.status_code in (429, 503) else 0)
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise UpstreamError('Public response exceeds 4 MB limit')
                chunks.append(chunk)
            return b''.join(chunks)
    except httpx.HTTPError as exc:
        raise UpstreamError(f'Public request failed ({type(exc).__name__})') from exc


async def fetch_json(client, url, params=None):
    try:
        result = json.loads(await fetch_bytes(client, url, params))
        if not isinstance(result, dict):
            raise UpstreamError('Public response is not a JSON object')
        return result
    except ValueError as exc:
        raise UpstreamError('Invalid public JSON response') from exc


async def search_with_fallback(client, url, params, query_key, result_key):
    query = params[query_key]
    result = await fetch_json(client, url, params)
    if not isinstance(result.get(result_key), list):
        raise UpstreamError(f'Public search has no {result_key} array')
    actual = query
    words = query.split()
    if not result[result_key] and len(words) > 1 and len(words[0]) >= 2:
        actual = words[0]
        result = await fetch_json(client, url, {**params, query_key: actual})
        if not isinstance(result.get(result_key), list):
            raise UpstreamError(f'Public search has no {result_key} array')
    return result, actual


def parse_review(entry, app, country, query, now):
    if not isinstance(entry, dict):
        return None
    review_id, app_id = identifier(label(entry, 'id')), identifier(app.get('trackId'))
    body, title = label(entry, 'content'), label(entry, 'title')
    if not review_id or not app_id or not isinstance(body, str) or len(body) > 2_000_000 or not body.strip() or body.strip() in ('[removed]', '[deleted]'):
        return None
    try:
        rating = int(label(entry, 'im:rating'))
        date = datetime.fromisoformat(label(entry, 'updated').replace('Z', '+00:00'))
        if date.tzinfo is None or not 1 <= rating <= 5 or not now - timedelta(days=730) <= date <= now:
            return None
    except (ValueError, TypeError, AttributeError):
        return None
    product_url = apple_url(app.get('trackViewUrl')) or f'https://apps.apple.com/{country}/app/id{app_id}'
    review_url = f'https://itunes.apple.com/{country}/review?id={app_id}&type=Purple%20Software&reviewId={review_id}'
    document = {
        'sourceKey': 'appstore', 'externalId': f'{country}:{app_id}:{review_id}',
        'canonicalUrl': review_url, 'type': 'review', 'body': body,
        'publishedAt': date.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'threadExternalId': f'{country}:{app_id}',
        'metadata': {'rating': rating, 'country': country, 'productId': app_id,
                     'productName': app.get('trackName'), 'productUrl': product_url,
                     'userRatingCount': app.get('userRatingCount'), 'appPrice': app.get('price'),
                     'currency': app.get('currency'), 'contextComplete': False,
                     'contextNote': 'Public recent reviews only; review volume and ratings do not establish commercial success.',
                     'discoveryQuery': query, 'reviewUrl': review_url},
    }
    if isinstance(title, str):
        document['title'] = title
    author = entry.get('author', {})
    if isinstance(author, dict):
        author_id = apple_url(label(author, 'uri'))
        if author_id:
            document['authorExternalId'] = author_id
        if isinstance(label(author, 'name'), str):
            document['authorName'] = label(author, 'name')
    return document


async def collect_appstore(request, client, now=None):
    now = now or datetime.now(timezone.utc)
    result = {'documents': [], 'cooldownSeconds': 60, 'quotaRemaining': None, 'errors': [], 'applications': 0}
    search, actual_query = await search_with_fallback(client, 'https://itunes.apple.com/search', {'term': request.query, 'entity': 'software', 'country': request.country, 'limit': 2}, 'term', 'results')
    if not isinstance(search.get('results'), list):
        raise UpstreamError('Apple search has no results array')
    apps, seen_apps, seen_reviews = [], set(), set()
    for app in search['results']:
        app_id = identifier(app.get('trackId')) if isinstance(app, dict) else None
        if not app_id:
            result['errors'].append('Skipped application with invalid ID')
        elif app_id not in seen_apps and len(apps) < 2:
            seen_apps.add(app_id)
            apps.append(app)
    successful_feeds = 0
    for app in apps:
        app_id = identifier(app['trackId'])
        try:
            payload = await fetch_json(client, f'https://itunes.apple.com/{request.country}/rss/customerreviews/id={app_id}/sortBy=mostRecent/json')
            feed = payload.get('feed')
            if not isinstance(feed, dict):
                raise UpstreamError('Apple review response has no feed')
            entries = feed.get('entry', [])
            if isinstance(entries, dict):
                entries = [entries]
            if not isinstance(entries, list):
                raise UpstreamError('Apple review feed has invalid entries')
            successful_feeds += 1
            result['applications'] += 1
            accepted = 0
            for entry in entries:
                doc = parse_review(entry, app, request.country, actual_query, now)
                if doc:
                    doc['metadata']['requestedQuery'] = request.query
                if doc and doc['externalId'] not in seen_reviews:
                    seen_reviews.add(doc['externalId'])
                    result['documents'].append(doc)
                    accepted += 1
                    if accepted >= 20:
                        break
        except UpstreamError as exc:
            result['errors'].append(f'App {app_id}: {exc}')
            result['cooldownSeconds'] = max(result['cooldownSeconds'], exc.cooldown)
    if apps and not successful_feeds:
        raise UpstreamError('; '.join(result['errors']), result['cooldownSeconds'])
    return result


@router.post('/collect')
async def collect(request: CollectRequest):
    if len(request.query.strip()) < 2:
        raise HTTPException(422, 'Query must contain at least two non-padding characters')
    try:
        async with asyncio.timeout(40):
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0), trust_env=False) as client:
                return await (collect_appstore(request, client) if request.source == 'appstore' else collect_wordpress(request, client))
    except TimeoutError as exc:
        raise HTTPException(504, 'Collection exceeded 40 seconds') from exc
    except UpstreamError as exc:
        raise HTTPException(502, detail={'message': str(exc), 'cooldownSeconds': exc.cooldown}, headers={'Retry-After': str(exc.cooldown)} if exc.cooldown else None) from exc


class ReviewText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in ('p', 'br', 'li', 'div'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('p', 'li', 'div'):
            self.parts.append('\n')


def wordpress_topic(value):
    try:
        p = urlsplit(value)
        if p.scheme == 'https' and p.netloc == 'wordpress.org' and re.fullmatch(r'/support/topic/[a-zA-Z0-9%_-]+/', p.path):
            return urlunsplit(('https', 'wordpress.org', p.path, '', ''))
    except (ValueError, TypeError):
        pass
    return None


def parse_wordpress_item(item, plugin, query, requested_query, now):
    url = wordpress_topic(item.findtext('guid')) or wordpress_topic(item.findtext('link'))
    raw_body = item.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or item.findtext('description', '')
    parser = ReviewText()
    parser.feed(raw_body)
    body = ''.join(parser.parts).strip()
    # bbPress adds these feed headers, separate from the user's original review.
    body = re.sub(r'^Replies:\s*\d+\s*', '', body)
    body = re.sub(r'^Rating:\s*[1-5]\s*stars?\s*', '', body)
    if not url or not body.strip() or len(body) > 2_000_000:
        return None
    try:
        date = parsedate_to_datetime(item.findtext('pubDate'))
        if date.tzinfo is None or not now - timedelta(days=730) <= date <= now:
            return None
    except (ValueError, TypeError, AttributeError):
        return None
    title = html.unescape(item.findtext('title', ''))
    rating = re.search(r'\(([1-5]) stars?\)\s*$', title)
    slug = plugin['slug']
    author = item.findtext('{http://purl.org/dc/elements/1.1/}creator', '')
    doc = {'sourceKey': 'wordpress', 'externalId': f'{slug}:{url}', 'canonicalUrl': url,
           'type': 'review', 'title': title, 'body': body, 'threadExternalId': url,
           'publishedAt': date.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
           'metadata': {'productId': slug, 'productName': html.unescape(plugin.get('name', slug)),
                        'productUrl': f'https://wordpress.org/plugins/{slug}/', 'country': None,
                        'contextComplete': False, 'contextNote': 'Public plugin user reviews only; ratings and installation counts do not establish commercial success.',
                        'discoveryQuery': query, 'requestedQuery': requested_query,
                        'reviewUrl': url, 'originalBodyHtml': raw_body}}
    if rating:
        doc['metadata']['rating'] = int(rating.group(1))
    if author:
        doc['authorName'] = author
        # RSS creator is a display name, not a verified account/profile identifier.
        doc['metadata']['authorIdentityUnverified'] = True
    return doc


async def collect_wordpress(request, client, now=None):
    now = now or datetime.now(timezone.utc)
    result = {'documents': [], 'cooldownSeconds': 60, 'quotaRemaining': None, 'errors': [], 'applications': 0}
    search, actual_query = await search_with_fallback(client, 'https://api.wordpress.org/plugins/info/1.2/', {'action': 'query_plugins', 'request[search]': request.query, 'request[per_page]': 2}, 'request[search]', 'plugins')
    plugins, seen_slugs, seen_reviews = [], set(), set()
    for plugin in search['plugins']:
        slug = plugin.get('slug') if isinstance(plugin, dict) else None
        if not isinstance(slug, str) or len(slug) > 200 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug):
            result['errors'].append('Skipped plugin with invalid slug')
        elif slug not in seen_slugs and len(plugins) < 2:
            seen_slugs.add(slug)
            plugins.append(plugin)
    for plugin in plugins:
        slug = plugin['slug']
        try:
            data = await fetch_bytes(client, f'https://wordpress.org/support/plugin/{slug}/reviews/feed/')
            # Reject DTD/entity declarations including UTF-16/32 encodings before parsing.
            guarded = data.replace(b'\x00', b'').upper()
            if b'<!DOCTYPE' in guarded or b'<!ENTITY' in guarded:
                raise UpstreamError('Disallowed XML declaration')
            try:
                root = ET.fromstring(data)
            except ET.ParseError as exc:
                raise UpstreamError('Invalid review RSS XML') from exc
            channel = root.find('channel')
            if root.tag != 'rss' or channel is None:
                raise UpstreamError('Review response has no RSS channel')
            result['applications'] += 1
            accepted = 0
            for item in channel.findall('item'):
                doc = parse_wordpress_item(item, plugin, actual_query, request.query, now)
                if doc and doc['externalId'] not in seen_reviews:
                    seen_reviews.add(doc['externalId'])
                    result['documents'].append(doc)
                    accepted += 1
                    if accepted >= 20:
                        break
        except UpstreamError as exc:
            result['errors'].append(f'Plugin {slug}: {exc}')
            result['cooldownSeconds'] = max(result['cooldownSeconds'], exc.cooldown)
    if plugins and not result['applications']:
        raise UpstreamError('; '.join(result['errors']), result['cooldownSeconds'])
    return result
