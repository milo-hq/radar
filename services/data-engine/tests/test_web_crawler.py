import asyncio
from contextlib import closing
import httpx
import unittest
import tempfile
from pathlib import Path
import web_crawler as w

SITE = dict(id='fixture', name='Fixture', seed='https://fixture.example/latest', hosts=['fixture.example'], path_pattern=r'^/t/[^/]+/\d+$', kind='community', enabled=True)
TEXT = 'I lose hours copying customer requests between several tools every week. ' * 12
HTML = '<html><title>Manual work</title><article><p>' + TEXT + '</p></article></html>'

async def no_wait(seconds): pass

async def public(host): return ['93.184.216.34']

def run(tmp_path, handler, **kwargs):
    return asyncio.run(w.Crawler(SITE, state_dir=tmp_path, transport=httpx.MockTransport(handler), resolver=public, sleeper=no_wait, **kwargs).crawl())

def handler(request):
    if request.url.path == '/robots.txt': return httpx.Response(200, text='User-agent: *\nAllow: /')
    if request.url.path == '/latest': return httpx.Response(200, text='<a href="/t/manual/12?utm_source=test">topic</a><a href="https://evil.test/t/a/1">evil</a>')
    return httpx.Response(200, text=HTML, headers={'etag':'"one"'})

class TestWebCrawler(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.state_dir = Path(temp.name)

    def test_interrupted_job_retry_preserves_committed_documents(self):
        def interrupted(req):
            if req.url.path == '/latest':
                return httpx.Response(200, text='<a href="/t/a/1">a</a><a href="/t/b/2">b</a>')
            if req.url.path == '/t/b/2':
                raise asyncio.CancelledError()
            return handler(req)
        with self.assertRaises(asyncio.CancelledError):
            run(self.state_dir, interrupted, replay_key='interrupted-job')
        def resumed(req):
            self.assertNotEqual(req.url.path, '/t/a/1', 'Committed first page must resume from the job journal')
            return handler(req)
        result = run(self.state_dir, resumed, replay_key='interrupted-job')
        self.assertEqual([doc['externalId'] for doc in result['documents']], ['https://fixture.example/t/a/1', 'https://fixture.example/t/b/2'])
        self.assertEqual(result['stats']['visited'], 3)
        self.assertEqual(run(self.state_dir, lambda _: self.fail('completed replay accessed network'), replay_key='interrupted-job'), result)

    def test_interrupted_resume_keeps_whole_job_page_limit(self):
        def interrupted(req):
            if req.url.path == '/latest':
                return httpx.Response(200, text=''.join(f'<a href="/t/topic/{i}">topic</a>' for i in range(30)))
            if req.url.path == '/t/topic/5': raise asyncio.CancelledError()
            return handler(req)
        with self.assertRaises(asyncio.CancelledError):
            run(self.state_dir, interrupted, replay_key='bounded-interrupted-job')
        result = run(self.state_dir, handler, replay_key='bounded-interrupted-job')
        self.assertEqual(result['stats']['visited'], 12)
        self.assertEqual(len(result['documents']), 11)
        self.assertEqual(len({doc['externalId'] for doc in result['documents']}), 11)
        self.assertGreater(result['stats']['remaining'], 0)

    def test_product_seed_is_document_with_marketing_context(self):
        site = dict(SITE, kind='product', seed='https://fixture.example/', path_pattern=r'^/pricing$')
        result = asyncio.run(w.Crawler(site, state_dir=self.state_dir, transport=httpx.MockTransport(handler), resolver=public, sleeper=no_wait).crawl())
        self.assertEqual(len(result['documents']), 1)
        self.assertEqual(result['documents'][0]['canonicalUrl'], site['seed'])
        self.assertIn('not user demand', result['documents'][0]['metadata']['contextNote'])

    def test_minimum_delay_and_robots_delay_are_respected(self):
        delays = []
        async def record_delay(seconds): delays.append(seconds)
        asyncio.run(w.Crawler(SITE, state_dir=self.state_dir, transport=httpx.MockTransport(handler), resolver=public, sleeper=record_delay).crawl())
        self.assertTrue(delays)
        self.assertTrue(all(delay >= 1 for delay in delays))
        with tempfile.TemporaryDirectory() as state:
            def delayed(req):
                if req.url.path == '/robots.txt': return httpx.Response(200, text='User-agent: *\nAllow: /\nCrawl-delay: 3')
                return handler(req)
            delays.clear()
            asyncio.run(w.Crawler(SITE, state_dir=state, transport=httpx.MockTransport(delayed), resolver=public, sleeper=record_delay).crawl())
            self.assertTrue(all(delay >= 3 for delay in delays))

    def test_crawl_discover_extract_and_replay(self):
        tmp_path = self.state_dir
        result = run(tmp_path, handler, replay_key='job-1')
        assert len(result['documents']) == 1
        doc = result['documents'][0]
        assert doc['canonicalUrl'] == 'https://fixture.example/t/manual/12'
        assert TEXT.strip() in doc['body']
        assert doc['metadata']['contextComplete'] is False
        assert doc['sourceKey'] == 'web'
        assert 'author' not in doc and 'publishedAt' not in doc
        assert result['stats']['visited'] == 2
        assert run(tmp_path, lambda _: self.fail('replay accessed network'), replay_key='job-1') == result
        assert run(tmp_path, handler)['documents'] == result['documents']

    def test_robots_denies_and_failures_are_visible(self):
        tmp_path = self.state_dir
        def denied(req):
            assert req.url.path == '/robots.txt'
            return httpx.Response(200, text='User-agent: *\nDisallow: /')
        result = run(tmp_path, denied)
        assert not result['documents'] and result['stats']['blocked'] and result['errors']

    def test_rate_limit_keeps_frontier_for_retry(self):
        tmp_path = self.state_dir
        def limited(req):
            if req.url.path.startswith('/t/'): return httpx.Response(429, headers={'retry-after':'120'})
            return handler(req)
        result = run(tmp_path, limited)
        assert result['cooldownSeconds'] == 120
        assert result['stats']['remaining'] >= 1
        assert result['errors']

    def test_thin_page_uses_renderer(self):
        tmp_path = self.state_dir
        async def render(url, site, resolver, robots): return HTML
        def thin(req):
            if req.url.path.startswith('/t/'): return httpx.Response(200, text='<div id="app"></div><script>render()</script>')
            return handler(req)
        result = run(tmp_path, thin, renderer=render)
        assert result['documents'][0]['metadata']['fetchMethod'] == 'browser'
        assert result['stats']['rendered'] >= 1

    def test_canonical_blocks_unsafe_urls(self):
        for value in ['http://fixture.example/t/a/1','https://user:pass@fixture.example/t/a/1','https://evil.test/t/a/1','https://fixture.example:444/t/a/1']:
            assert w.canonical(value, SITE) is None
        assert w.canonical('https://fixture.example/t/a/1?utm_source=x#fragment', SITE) == 'https://fixture.example/t/a/1'

    def test_private_dns_and_foreign_redirect_fail_closed(self):
        tmp_path = self.state_dir
        async def private(host): return ['127.0.0.1']
        result = asyncio.run(w.Crawler(SITE, state_dir=tmp_path, transport=httpx.MockTransport(lambda _: self.fail('private network request')), resolver=private).crawl())
        assert result['errors'] and not result['documents']

    def test_real_chromium_executes_javascript_without_foreign_requests(self):
        from urllib.robotparser import RobotFileParser
        rules = RobotFileParser(); rules.parse(['User-agent: *','Allow: /'])
        fixture = '<html><title>JS rendered</title><body><article id="article"></article><script>document.getElementById("article").textContent = ' + __import__('json').dumps(TEXT) + ';</script><img src="https://private.test/pixel"></body></html>'
        def serve(req):
            assert req.url.host == 'fixture.example'
            return httpx.Response(200, text=fixture,headers={'content-type':'text/html'})
        html = asyncio.run(w.render_browser('https://fixture.example/t/js/1', SITE, public, rules, transport=httpx.MockTransport(serve)))
        assert TEXT.strip() in html and '<article id="article">I lose hours' in html

    def test_frontier_continues_new_pages_before_cached(self):
        tmp_path = self.state_dir
        def many(req):
            if req.url.path == '/latest': return httpx.Response(200,text=''.join(f'<a href="/t/topic/{i}">topic</a>' for i in range(30)))
            return handler(req)
        first = run(tmp_path,many)
        second = run(tmp_path,many)
        assert len(first['documents']) == 11
        assert len(second['documents']) == 12
        assert not ({d['externalId'] for d in first['documents']} & {d['externalId'] for d in second['documents']})

    def test_challenge_never_invokes_browser(self):
        tmp_path = self.state_dir
        async def render(*args): self.fail('challenge bypass attempted')
        def challenge(req):
            if req.url.path.startswith('/t/'): return httpx.Response(200,text='<script>challenge()</script><title>Verify you are human</title><div>CAPTCHA</div>')
            return handler(req)
        result = run(tmp_path,challenge,renderer=render)
        assert result['stats']['blocked'] == 1 and not result['documents']

    def test_foreign_redirect_is_not_followed(self):
        tmp_path = self.state_dir
        def redirect(req):
            if req.url.path.startswith('/t/'): return httpx.Response(302,headers={'location':'https://evil.test/secret'})
            return handler(req)
        result = run(tmp_path,redirect)
        assert result['stats']['blocked'] == 1
        assert any('Redirect outside' in e for e in result['errors'])

    def test_oversized_response_retains_partial_documents(self):
        tmp_path = self.state_dir
        def response(req):
            if req.url.path == '/latest': return httpx.Response(200,text='<a href="/t/a/1">a</a><a href="/t/z/2">b</a>')
            if req.url.path == '/t/z/2': return httpx.Response(200,content=b'x' * (w.MAX_BYTES+1))
            return handler(req)
        result = run(tmp_path,response)
        assert len(result['documents']) == 1
        assert any('4 MiB' in e for e in result['errors'])

    def test_conditional_revalidation_reuses_original_document(self):
        tmp_path = self.state_dir
        result = run(tmp_path,handler)
        import sqlite3
        with closing(sqlite3.connect(tmp_path/'crawler.sqlite3')) as db:
            db.execute("UPDATE pages SET due=0 WHERE document IS NOT NULL")
            db.commit()
        def unchanged(req):
            if req.url.path.startswith('/t/'):
                assert req.headers['If-None-Match'] == '"one"'
                return httpx.Response(304)
            return handler(req)
        second = run(tmp_path,unchanged)
        assert second['documents'] == result['documents']
        assert second['stats']['cached'] == 1

    def test_robots_html_challenge_fails_closed(self):
        tmp_path = self.state_dir
        result = run(tmp_path,lambda req:httpx.Response(200,text='<html><title>Checking browser</title></html>'))
        assert result['stats']['blocked'] and result['errors'] and result['stats']['visited'] == 0

    def test_original_title_and_topic_identity(self):
        tmp_path = self.state_dir
        result = run(tmp_path,handler)
        assert result['documents'][0]['title'] == 'Manual work'
        assert w.canonical('https://fixture.example/t/manual/12/4',SITE) == 'https://fixture.example/t/manual/12'

    def test_listing_with_links_does_not_need_rendering(self):
        tmp_path = self.state_dir
        async def render(*args): self.fail('server-rendered listing unnecessarily opened browser')
        def listing(req):
            if req.url.path == '/latest': return httpx.Response(200,text='<script src="app.js"></script><a href="/t/manual/12">topic</a>')
            return handler(req)
        assert len(run(tmp_path,listing,renderer=render)['documents']) == 1


if __name__ == "__main__":
    unittest.main()
