import unittest
from analytics import analyze
from models import AnalyzeRequest


def doc(i, body, **kw):
    return dict(id=str(i), source='reddit', externalId=str(i), title='', body=body, authorId=f'user{i}', publishedAt='2026-09-10T00:00:00Z', metadata={}, **kw)


def run(rows):
    return analyze(AnalyzeRequest(documents=rows, asOf='2026-09-12T00:00:00Z'))


class AnalyticsTests(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(run([])['clusterCount'], 0)
        with self.assertRaises(ValueError):
            run([doc(1, '')])

    def test_groups_similar_and_separates_unrelated_deterministically(self):
        rows = [doc(1, 'invoice export broken painfully slow manual spreadsheet reconciliation'), doc(2, 'invoice export broken painfully slow manual spreadsheet reconciliation today'), doc(3, 'beautiful tropical birds flying over ocean islands')]
        a, b = run(rows), run(list(reversed(rows)))
        self.assertEqual(a, b)
        self.assertEqual(a['clusterCount'], 2)
        self.assertEqual(a['uniqueContentCount'], 3)
        self.assertTrue(any(set(c['documentIds']) == {'1', '2'} for c in a['clusters']))

    def test_duplicate_authors_sources_do_not_inflate_evidence(self):
        original = doc(1, 'invoice export broken painfully slow manual work')
        duplicate = dict(original, id='2', source='hackernews', authorId='other')
        a, b = run([original])['clusters'][0], run([original, duplicate])['clusters'][0]
        for field in ['independentAccounts', 'sourceCount', 'recentCount', 'painMentions', 'evidenceScore']:
            self.assertGreaterEqual(a[field], b[field], field)
        self.assertEqual(run([original, duplicate])['uniqueContentCount'], 1)

    def test_changed_headline_cannot_amplify_copied_body(self):
        original = dict(doc(1, 'invoice export broken slow manual work'), title='Invoice question')
        copied = dict(original, id='2', title='Buy subscription pricing painful spreadsheet', source='hackernews', authorId='other')
        baseline = run([original])
        result = run([original, copied])
        self.assertEqual(result['uniqueContentCount'], 1)
        self.assertEqual(result['clusterCount'], 1)
        self.assertEqual(result['clusters'][0]['documentIds'], ['1', '2'])
        for field in ['id', 'independentAccounts', 'painMentions', 'commercialMentions', 'frictionMentions', 'evidenceScore']:
            self.assertEqual(result['clusters'][0][field], baseline['clusters'][0][field], field)

    def test_title_only_documents_are_partitioned(self):
        rows = [dict(doc(1, ''), title='Title only'), doc(2, 'Something else')]
        result = run(rows)
        self.assertEqual(sorted(i for c in result['clusters'] for i in c['documentIds']), ['1', '2'])
        with self.assertRaises(ValueError):
            run([dict(doc(1, '  '), title=' \n\t')])

    def test_lower_id_copy_cannot_add_evidence(self):
        first = dict(doc('b', 'invoice export broken slow manual reconciliation'), publishedAt='2020-01-01', authorId=None)
        second = doc('c', 'invoice export broken slow manual reconciliation today')
        original = run([first, second])['clusters'][0]
        copied = dict(first, id='a', source='github', publishedAt='2026-09-11', authorId='new')
        changed = run([first, second, copied])['clusters'][0]
        self.assertLessEqual(changed['sourceCount'], original['sourceCount'])
        self.assertLessEqual(changed['recentCount'], original['recentCount'])
        self.assertLessEqual(changed['independentAccounts'], original['independentAccounts'])
        self.assertLessEqual(changed['evidenceScore'], original['evidenceScore'])
        invalid = dict(copied, publishedAt=None)
        changed = run([first, second, invalid])['clusters'][0]
        self.assertIn('publication_time', changed['unknowns'])
        self.assertEqual(changed['dimensions']['recency'], 50)

    def test_partial_dates_keep_full_denominator(self):
        rows = [doc(1, 'invoice export broken slow manual reconciliation'), dict(doc(2, 'invoice export broken slow manual reconciliation today'), publishedAt=None)]
        self.assertEqual(run(rows)['clusters'][0]['dimensions']['recency'], 50)

    def test_full_hash_retains_truncated_tail_identity(self):
        import hashlib
        prefix = 'invoice export broken slow manual reconciliation'
        h1 = hashlib.sha256((prefix + 'tail one').encode()).hexdigest()
        h2 = hashlib.sha256((prefix + 'tail two').encode()).hexdigest()
        one = dict(doc(1, prefix), metadata={'bodyTruncated': True, 'fullContentHash': h1})
        two = dict(doc(2, prefix), metadata={'bodyTruncated': True, 'fullContentHash': h2})
        self.assertEqual(run([one, two])['uniqueContentCount'], 2)
        self.assertEqual(run([one, dict(two, metadata=one['metadata'])])['uniqueContentCount'], 1)
        with self.assertRaises(ValueError):
            run([dict(one, metadata={'bodyTruncated': True, 'fullContentHash': 'bad'})])
        self.assertEqual(run([doc(1, prefix), dict(two, metadata={'fullContentHash': h2})])['uniqueContentCount'], 1)

    def test_unknown_dates_and_authors_are_explicit(self):
        a = run([dict(doc(1, 'text for analysis'), publishedAt='invalid', authorId=None)])['clusters'][0]
        self.assertIsNone(a['dimensions']['recency'])
        self.assertEqual(a['independentAccounts'], 0)
        self.assertIn('publication_time', a['unknowns'])
        self.assertIn('author_identity', a['unknowns'])
        old = run([dict(doc(1, 'text for analysis'), publishedAt='2020-01-01')])['clusters'][0]
        self.assertEqual(old['dimensions']['recency'], 0)

    def test_extreme_provider_date_is_unknown(self):
        c = run([dict(doc(1, 'date edge case'), publishedAt='9999-12-31T23:59:59-23:59')])['clusters'][0]
        self.assertIsNone(c['dimensions']['recency'])
        self.assertIn('publication_time', c['unknowns'])

    def test_future_dates_are_not_recent(self):
        c = run([dict(doc(1, 'future text'), publishedAt='2099-01-01')])['clusters'][0]
        self.assertEqual(c['recentCount'], 0)
        self.assertIsNone(c['dimensions']['recency'])

    def test_non_latin_and_single_character(self):
        for body in ['导出发票太慢手动操作很麻烦', 'a', '!!!']:
            self.assertEqual(run([doc(1, body)])['clusterCount'], 1)

    def test_one_source_cannot_earn_cross_source_points(self):
        c = run([doc(i, f'invoice export broken painfully slow manual reconciliation {i}') for i in range(4)])['clusters'][0]
        self.assertEqual(c['dimensions']['crossSource'], 0)
        self.assertIn('sampling_representativeness', c['unknowns'])

    def test_bound_and_duplicate_ids(self):
        with self.assertRaises(ValueError):
            AnalyzeRequest(documents=[doc(1, 'x' * 40001)])
        with self.assertRaises(ValueError):
            AnalyzeRequest(documents=[doc(1, 'a'), doc(1, 'b')])

class HttpTests(unittest.TestCase):
    def test_health_analysis_and_validation(self):
        from fastapi.testclient import TestClient
        from app import app
        with TestClient(app) as client:
            self.assertEqual(client.get('/health').json(), {'status': 'ok', 'version': '1'})
            response = client.post('/analyze', json={'documents': [doc(1, 'manual invoice export is broken')]})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['documentCount'], 1)
            self.assertEqual(client.post('/analyze', json={'documents': [doc(1, 'x' * 40001)]}).status_code, 422)
            self.assertEqual(client.post('/analyze', content=b'{').status_code, 422)
            self.assertEqual(client.post('/analyze', json={'documents': [doc(1, '')]}).status_code, 422)

    def test_body_bound(self):
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        from app import app
        with patch('app.MAX_REQUEST_BYTES', 10), TestClient(app) as client:
            self.assertEqual(client.post('/analyze', content=b'x' * 11).status_code, 413)

if __name__ == '__main__':
    unittest.main()
