"""Curated public crawl scopes, live checked with VentureRadarBot on 2026-09-12.

These sources provide user reports or vendor/directory descriptions, not proof of
market demand. Access and robots rules must still be checked on every crawl.
The seed is an index entry point; path_pattern scopes discovered content pages.
"""

_TOPIC_PATH = r"^/t/[^/]+/\d+(?:/\d+)?/?$"

SITES = {
    "n8n_community": {
        "id": "n8n_community", "name": "n8n Community",
        "seed": "https://community.n8n.io/latest",
        "hosts": ["community.n8n.io"], "path_pattern": _TOPIC_PATH,
        "kind": "community", "enabled": True,
    },
    "obsidian_forum": {
        "id": "obsidian_forum", "name": "Obsidian Forum",
        "seed": "https://forum.obsidian.md/latest",
        "hosts": ["forum.obsidian.md"], "path_pattern": _TOPIC_PATH,
        "kind": "community", "enabled": True,
    },
    "discourse_meta": {
        "id": "discourse_meta", "name": "Discourse Meta",
        "seed": "https://meta.discourse.org/latest",
        "hosts": ["meta.discourse.org"], "path_pattern": _TOPIC_PATH,
        "kind": "community", "enabled": True,
    },
    "frappe_forum": {
        "id": "frappe_forum", "name": "Frappe / ERPNext Forum",
        "seed": "https://discuss.frappe.io/latest",
        "hosts": ["discuss.frappe.io"], "path_pattern": _TOPIC_PATH,
        "kind": "community", "enabled": True,
    },
    "openalternative": {
        "id": "openalternative", "name": "OpenAlternative",
        "seed": "https://openalternative.co/",
        "hosts": ["openalternative.co"],
        # Actual product profiles are /slug. Exclude all observed navigation
        # routes, including collections, account and submission pages.
        "path_pattern": (
            r"^/(?!(?:alternatives|categories|collections|discounts|stacks|tags|"
            r"licenses|about|blog|advertise|submit|login|sign-in|signup|dashboard|"
            r"api|search|privacy|terms|robots\.txt|sitemap\.xml)/?$)"
            r"[a-z0-9]+(?:-[a-z0-9]+)*/?$"
        ),
        "kind": "product_directory", "enabled": True,
    },
    "launching_next": {
        "id": "launching_next", "name": "Launching Next",
        "seed": "https://www.launchingnext.com/",
        "hosts": ["www.launchingnext.com"],
        "path_pattern": r"^/s/[a-z0-9-]+/\d+/?$",
        "kind": "product_directory", "enabled": True,
    },
    "n8n_product": {
        "id": "n8n_product", "name": "n8n Product & Pricing",
        "seed": "https://n8n.io/pricing/", "hosts": ["n8n.io"],
        "path_pattern": r"^/(?:pricing(?:/startup-plan)?|features|enterprise|itops|secops|automate-lead-management|supercharge-your-crm|saas)/?$",
        "kind": "product", "enabled": True,
    },
    "plausible_product": {
        "id": "plausible_product", "name": "Plausible Product & Pricing",
        # Pricing is a section of the homepage, not a separate /pricing URL.
        "seed": "https://plausible.io/", "hosts": ["plausible.io"],
        "path_pattern": r"^/(?:features|for-ecommerce|for-saas|for-freelancers-agencies|simple-web-analytics|white-label-web-analytics|enterprise-web-analytics)/?$",
        "kind": "product", "enabled": True,
    },
}
