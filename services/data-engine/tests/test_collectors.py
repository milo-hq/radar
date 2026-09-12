import asyncio
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import collectors

NOW = datetime(2026, 9, 12, tzinfo=timezone.utc)
APP = {'trackId': 123, 'trackName': 'Habit', 'trackViewUrl': 'https://evil.example/app', 'userRatingCount': 5, 'price': 0, 'currency': 'USD'}


def review(review_id='456', body='No', rating='1', date='2026-09-11T01:00:00-07:00'):
    return {'id': {'label': review_id}, 'content': {'label': body}, 'title': {'label': 'Feedback'}, 'im:rating': {'label': rating}, 'updated': {'label': date}, 'author': {'name': {'label': 'Person'}, 'uri': {'label': 'http://itunes.apple.com/us/reviews/id1234'}}}


class CollectorsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        collectors._next_request = 0
        collectors._request_lock = asyncio.Lock()
        self.spacing = patch.object(collectors, 'HOST_SPACING', 0)
        self.spacing.start()
        self.addCleanup(self.spacing.stop)

    async def run_collect(self, handler):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await collectors.collect_appstore(collectors.CollectRequest(source='appstore', query='habit'), client, NOW)

    async def test_preserves_short_body_deduplicates_and_normalizes(self):
        def handler(request):
            self.assertEqual(request.url.host, 'itunes.apple.com')
            if request.url.path == '/search':
                self.assertEqual(request.url.params['limit'], '2')
                return httpx.Response(200, json={'results': [APP, APP]})
            return httpx.Response(200, json={'feed': {'entry': [review(body=' No\n '), review()]}})
        result = await self.run_collect(handler)
        self.assertEqual(len(result['documents']), 1)
        doc = result['documents'][0]
        self.assertEqual(doc['body'], ' No\n ')
        self.assertEqual(doc['externalId'], 'us:123:456')
        self.assertEqual(doc['publishedAt'], '2026-09-11T08:00:00Z')
        self.assertEqual(doc['authorExternalId'], 'https://itunes.apple.com/us/reviews/id1234')
        self.assertEqual(doc['metadata']['productUrl'], 'https://apps.apple.com/us/app/id123')
        self.assertNotIn('engagementScore', doc)
        self.assertFalse(doc['metadata']['contextComplete'])

    async def test_invalid_ids_dates_ratings_and_cap(self):
        entries = [review('../evil'), review(date='2023-01-01T00:00:00Z'), review(date='2027-01-01T00:00:00Z'), review(rating='0'), review(rating='6'), review(date='invalid'), review(date='2026-09-11'), review(body=' ')]
        entries += [review(str(i)) for i in range(1, 40)]
        result = await self.run_collect(lambda r: httpx.Response(200, json={'results': [{'trackId': '../evil'}, APP]} if r.url.path == '/search' else {'feed': {'entry': entries}}))
        self.assertEqual(len(result['documents']), 20)
        self.assertEqual(result['errors'], ['Skipped application with invalid ID'])

    async def test_partial_failure_returns_good_documents_and_retry_after(self):
        def handler(request):
            if request.url.path == '/search':
                return httpx.Response(200, json={'results': [APP, {'trackId': 124}]})
            if 'id=123/' in request.url.path:
                return httpx.Response(200, json={'feed': {'entry': [review()]}})
            return httpx.Response(429, headers={'Retry-After': '9000'})
        result = await self.run_collect(handler)
        self.assertEqual(len(result['documents']), 1)
        self.assertEqual(result['applications'], 1)
        self.assertEqual(result['cooldownSeconds'], 3600)
        self.assertIn('429', result['errors'][0])

    async def test_empty_search_and_empty_feed(self):
        result = await self.run_collect(lambda r: httpx.Response(200, json={'results': []}))
        self.assertEqual(result['documents'], [])
        result = await self.run_collect(lambda r: httpx.Response(200, json={'results': [APP]} if r.url.path == '/search' else {'feed': {}}))
        self.assertEqual(result['documents'], [])
        self.assertEqual(result['applications'], 1)

    async def test_all_feeds_fail_is_error(self):
        with self.assertRaises(collectors.UpstreamError):
            await self.run_collect(lambda r: httpx.Response(200, json={'results': [APP]}) if r.url.path == '/search' else httpx.Response(503))

    async def test_redirect_not_followed(self):
        visited = []
        def handler(request):
            visited.append(str(request.url))
            return httpx.Response(302, headers={'Location': 'http://127.0.0.1/private'})
        with self.assertRaises(collectors.UpstreamError):
            await self.run_collect(handler)
        self.assertEqual(len(visited), 1)

    async def test_foreign_fetch_endpoint_rejected_before_network(self):
        def handler(request):
            self.fail('Disallowed URL reached transport')
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            for url in ('http://itunes.apple.com/search', 'https://evil.example/search', 'https://itunes.apple.com/private'):
                with self.assertRaisesRegex(collectors.UpstreamError, 'Disallowed'):
                    await collectors.fetch_json(client, url)

    async def test_oversized_response(self):
        with self.assertRaisesRegex(collectors.UpstreamError, '4 MB'):
            await self.run_collect(lambda r: httpx.Response(200, content=b'x' * (collectors.MAX_BYTES + 1)))

    async def test_bad_json_network_failure_and_malformed_feed(self):
        with self.assertRaises(collectors.UpstreamError):
            await self.run_collect(lambda r: httpx.Response(200, content=b'bad JSON'))
        def failed(request):
            raise httpx.ConnectError('offline', request=request)
        with self.assertRaises(collectors.UpstreamError):
            await self.run_collect(failed)
        with self.assertRaises(collectors.UpstreamError):
            await self.run_collect(lambda r: httpx.Response(200, json={'results': [APP]} if r.url.path == '/search' else {'wrong': {}}))

    def test_no_foreign_author_and_invalid_country(self):
        entry = review()
        entry['author']['uri']['label'] = 'https://evil.example/user'
        doc = collectors.parse_review(entry, APP, 'us', 'habit', NOW)
        self.assertNotIn('authorExternalId', doc)
        for url in ('https://itunes.apple.com.evil.example/a', 'https://a@itunes.apple.com/a', 'https://itunes.apple.com:123/a'):
            self.assertIsNone(collectors.apple_url(url))
        with self.assertRaises(ValueError):
            collectors.CollectRequest(source='appstore', query='habit', country='../x')


class WordpressTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = CollectorsTests.asyncSetUp

    async def run_wordpress(self, handler, query='booking'):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await collectors.collect_wordpress(collectors.CollectRequest(source='wordpress', query=query), client, NOW)

    def rss(self, items=1):
        return ('<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>' + ''.join(f'<item><guid>https://wordpress.org/support/topic/review-{i}/</guid><title>Hard to use (2 stars)</title><description><![CDATA[<p>Replies: 0</p><p>Rating: 2 stars</p><p>Too &amp; hard</p>]]></description><pubDate>Fri, 11 Sep 2026 12:00:00 +0000</pubDate><dc:creator>alice</dc:creator></item>' for i in range(items)) + '</channel></rss>').encode()

    async def test_wordpress_real_shape_and_cap(self):
        result = await self.run_wordpress(lambda r: httpx.Response(200, json={'plugins': [{'slug': 'booking', 'name': 'Booking'}]}) if r.url.host == 'api.wordpress.org' else httpx.Response(200, content=self.rss(30)))
        self.assertEqual(len(result['documents']), 20)
        doc = result['documents'][0]
        self.assertEqual(doc['body'], 'Too & hard')
        self.assertEqual(doc['metadata']['rating'], 2)
        self.assertNotIn('authorExternalId', doc)
        self.assertTrue(doc['metadata']['authorIdentityUnverified'])
        self.assertEqual(doc['sourceKey'], 'wordpress')

    async def test_wordpress_fallback_once_and_partial_failure(self):
        searches = []
        def handler(r):
            if r.url.host == 'api.wordpress.org':
                query = r.url.params['request[search]']
                searches.append(query)
                return httpx.Response(200, json={'plugins': [] if query == 'booking rooms' else [{'slug': 'booking'}, {'slug': 'broken'}]})
            return httpx.Response(503, headers={'Retry-After': '120'}) if 'broken' in r.url.path else httpx.Response(200, content=self.rss())
        result = await self.run_wordpress(handler, 'booking rooms')
        self.assertEqual(searches, ['booking rooms', 'booking'])
        self.assertEqual(result['documents'][0]['metadata']['discoveryQuery'], 'booking')
        self.assertEqual(result['documents'][0]['metadata']['requestedQuery'], 'booking rooms')
        self.assertEqual(result['cooldownSeconds'], 120)
        self.assertEqual(len(result['errors']), 1)

    async def test_wordpress_reject_dtd_invalid_xml_and_oversize(self):
        for payload in (b'<!DOCTYPE rss [<!ENTITY x "bad">]><rss><channel/></rss>', b'not xml', b'x' * (collectors.MAX_BYTES + 1)):
            with self.assertRaises(collectors.UpstreamError):
                await self.run_wordpress(lambda r: httpx.Response(200, json={'plugins': [{'slug': 'booking'}]}) if r.url.host == 'api.wordpress.org' else httpx.Response(200, content=payload))

    async def test_wordpress_invalid_slug_and_foreign_review(self):
        result = await self.run_wordpress(lambda r: httpx.Response(200, json={'plugins': [{'slug': '../x'}, {'slug': 'booking'}]}) if r.url.host == 'api.wordpress.org' else httpx.Response(200, content=self.rss().replace(b'https://wordpress.org/support/topic/', b'https://evil.example/support/topic/')))
        self.assertEqual(result['documents'], [])
        self.assertEqual(result['errors'], ['Skipped plugin with invalid slug'])

    async def test_apple_fallback_once(self):
        searches = []
        def handler(r):
            query = r.url.params['term']
            searches.append(query)
            return httpx.Response(200, json={'results': []})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await collectors.collect_appstore(collectors.CollectRequest(source='appstore', query='unusual habit'), client, NOW)
        self.assertEqual(searches, ['unusual habit', 'unusual'])
        self.assertEqual(result['documents'], [])


if __name__ == '__main__':
    unittest.main()
