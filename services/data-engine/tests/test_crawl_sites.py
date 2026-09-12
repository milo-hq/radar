"""Offline guards for curated source boundaries, not live access assertions."""

import re
import sys
import unittest
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from crawl_sites import SITES


class CrawlSitesTests(unittest.TestCase):
    def test_registry_has_public_seeds_and_all_three_evidence_types(self):
        self.assertGreaterEqual(len(SITES), 6)
        self.assertEqual({s["kind"] for s in SITES.values()}, {"community", "product_directory", "product"})
        for key, site in SITES.items():
            with self.subTest(site=key):
                self.assertEqual(key, site["id"])
                seed = urlsplit(site["seed"])
                self.assertEqual(seed.scheme, "https")
                self.assertIn(seed.hostname, site["hosts"])
                self.assertIsNone(seed.username)
                self.assertTrue(site["enabled"])
                re.compile(site["path_pattern"])

    def test_communities_only_follow_topic_pages(self):
        for site in SITES.values():
            if site["kind"] != "community":
                continue
            pattern = site["path_pattern"]
            for path in ("/t/payment-reconciliation/12345", "/t/help-with-invoices/42/3"):
                self.assertRegex(path, pattern)
            for path in ("/u/alice", "/login", "/search", "/t/new", "/t/topic/42.json", "/c/jobs/13"):
                self.assertNotRegex(path, pattern)

    def test_directory_profiles_exclude_navigation_and_submission(self):
        self.assertRegex("/postiz", SITES["openalternative"]["path_pattern"])
        self.assertRegex("/macro-docs", SITES["openalternative"]["path_pattern"])
        for path in ("/submit", "/submit/", "/blog", "/alternatives", "/alternatives/notion", "/collections/latest", "/login"):
            self.assertNotRegex(path, SITES["openalternative"]["path_pattern"])
        self.assertRegex("/s/linguator--wordpress-multilingual-plugin/150446/", SITES["launching_next"]["path_pattern"])
        for path in ("/submit/", "/blog/", "/s/invalid/", "/s/tool/123/edit"):
            self.assertNotRegex(path, SITES["launching_next"]["path_pattern"])

    def test_product_scope_excludes_account_and_general_blogs(self):
        self.assertRegex("/pricing/startup-plan/", SITES["n8n_product"]["path_pattern"])
        self.assertRegex("/for-ecommerce", SITES["plausible_product"]["path_pattern"])
        for key in ("n8n_product", "plausible_product"):
            for path in ("/login", "/register", "/blog", "/legal/privacy", "/contact"):
                self.assertNotRegex(path, SITES[key]["path_pattern"])


if __name__ == "__main__":
    unittest.main()
