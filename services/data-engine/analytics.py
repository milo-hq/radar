"""Deterministic lexical evidence grouping; no embeddings or market inference."""
import hashlib
import json
import re
import time
import unicodedata
from datetime import datetime, timezone

import polars as pl
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from models import AnalyzeRequest

MAX_TEXT = 6000
SIMILARITY_THRESHOLD = 0.58
ANALYSIS_SECONDS = 20
KEYWORDS = {
    'pain': r'\b(broken|painful\w*|frustrat\w*|slow|problem\w*|fail\w*|hate|expensive)\b|麻烦|痛苦|太慢|失败',
    'commercial': r'\b(pay|paid|paying|budget|buy|purchase|price|pricing|subscription|revenue)\b|付费|购买|预算',
    'friction': r'\b(manual\w*|workaround\w*|spreadsheet\w*|repetitive|copy.paste|reconcil\w*)\b|手动|重复|表格',
}


def normalized(text):
    return ' '.join(unicodedata.normalize('NFKC', text).casefold().split())


def parse_date(value):
    if not value:
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


def analyze(request: AnalyzeRequest):
    deadline = time.monotonic() + ANALYSIS_SECONDS
    as_of = request.asOf or datetime.now(timezone.utc)
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=timezone.utc)
    docs = sorted(request.documents, key=lambda d: d.id)
    sources = (pl.DataFrame({'source': [d.source for d in docs]}).group_by('source').len().sort('source').to_dicts() if docs else [])
    grouped = {}
    content_text = {}
    for d in docs:
        # A changed headline cannot create independent evidence for a copied body.
        # Full normalized body defines identity; title is used only for blank bodies.
        # Truncation never declares distinct long texts identical.
        full = normalized(d.body) or normalized(d.title)
        identity = ('sha256:' + d.metadata['fullContentHash'].lower() if d.metadata.get('bodyTruncated') is True else 'text:' + full)
        grouped.setdefault(identity, []).append(d)
        content_text.setdefault(identity, full)
    texts = sorted(grouped)
    parent = list(range(len(texts)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    if len(texts) > 1:
        vectorizer = TfidfVectorizer(analyzer='char', ngram_range=(2, 4), max_features=24000, sublinear_tf=True)
        try:
            vectors = vectorizer.fit_transform([content_text[s][:MAX_TEXT] for s in texts])
            for start in range(0, len(texts), 64):
                if time.monotonic() > deadline:
                    raise TimeoutError('analysis exceeded 20 second compute budget')
                similarities = cosine_similarity(vectors[start:start + 64], vectors)
                for offset, row in enumerate(similarities):
                    i = start + offset
                    for j in range(i):
                        if row[j] >= SIMILARITY_THRESHOLD:
                            parent[root(i)] = root(j)
        except ValueError as exc:
            if 'empty vocabulary' not in str(exc):
                raise
    components = {}
    for i, content in enumerate(texts):
        components.setdefault(root(i), []).append(content)
    clusters = []
    for contents in components.values():
        if time.monotonic() > deadline:
            raise TimeoutError('analysis exceeded 20 second compute budget')
        observations = [d for content in contents for d in grouped[content]]
        # Conflicting copy metadata earns no source/date/identity evidence.
        # Representatives are used only for stable labels and bounded text.
        representatives = [grouped[content][0] for content in contents]
        account_parent = {}
        eligible_accounts = set()
        def account_root(a):
            account_parent.setdefault(a, a)
            while account_parent[a] != a:
                a = account_parent[a]
            return a
        for content in contents:
            accounts = sorted({(d.source, d.authorId.strip()) for d in grouped[content] if d.authorId and d.authorId.strip()})
            if all(d.authorId and d.authorId.strip() for d in grouped[content]):
                eligible_accounts.update(accounts)
            for a in accounts:
                account_root(a)
            for a in accounts[1:]:
                account_parent[account_root(a)] = account_root(accounts[0])
        accounts_count = min(len(contents), len({account_root(a) for a in eligible_accounts}))
        unanimous_sources = [{d.source for d in grouped[content]} for content in contents]
        source_names = sorted({next(iter(names)) for names in unanimous_sources if len(names) == 1})
        dates = []
        for content in contents:
            copy_dates = [parse_date(d.publishedAt) for d in grouped[content]]
            dates.append(min(copy_dates) if all(d is not None and d <= as_of for d in copy_dates) else None)
        valid = [d for d in dates if d is not None]
        recent = sum(0 <= (as_of - d).total_seconds() <= 30 * 86400 for d in valid)
        rows = [{name: (not any(d.metadata.get('pageKind') in ('product', 'product_directory') for d in grouped[content]) and bool(re.search(pattern, content_text[content][:MAX_TEXT]))) for name, pattern in KEYWORDS.items()} for content in contents]
        sums = pl.DataFrame(rows).select(pl.all().sum()).to_dicts()[0]
        size = len(contents)
        dimensions = {
            'recurrence': round(min(1, max(0, accounts_count - 1) / 4) * 100, 1),
            'crossSource': round(min(1, max(0, len(source_names) - 1) / 2) * 100, 1),
            'recency': round(100 * recent / size, 1) if valid else None,
            **{name: round(100 * sums[name] / size, 1) for name in KEYWORDS},
        }
        # Fixed denominator: missing evidence earns no points, never a boosted score.
        score = round(sum((dimensions[name] or 0) * weight for name, weight in [('recurrence', .30), ('crossSource', .20), ('recency', .15), ('pain', .15), ('commercial', .10), ('friction', .10)]), 1)
        unknowns = ['sampling_representativeness', 'market_size', 'verified_willingness_to_pay', 'cross_platform_identity']
        if any(len(names) > 1 for names in unanimous_sources):
            unknowns.append('original_source')
        if len(valid) < size:
            unknowns.append('publication_time')
        if any(not d.authorId or not d.authorId.strip() for d in observations):
            unknowns.append('author_identity')
        representative = representatives[0]
        label = (representative.title.strip() or representative.body.strip())[:100]
        clusters.append({
            'id': 'cluster_' + hashlib.sha256(json.dumps(contents, ensure_ascii=False).encode()).hexdigest()[:16],
            'label': label, 'documentIds': sorted(d.id for d in observations),
            'independentAccounts': accounts_count, 'sourceCount': len(source_names), 'sourceNames': source_names,
            'recentCount': recent, 'painMentions': sums['pain'], 'commercialMentions': sums['commercial'], 'frictionMentions': sums['friction'],
            'evidenceScore': score, 'dimensions': dimensions, 'unknowns': unknowns,
        })
    return {'version': '1', 'documentCount': len(docs), 'uniqueContentCount': len(texts), 'clusterCount': len(clusters),
            'sourceCounts': {r['source']: r['len'] for r in sources},
            'clusters': sorted(clusters, key=lambda c: (-c['evidenceScore'], c['id'])),
            'limitations': [
                'Lexical character TF-IDF and cosine connected-component grouping (threshold 0.58); not semantic embeddings. Similarity is not identity and transitive groups may contain weakly related endpoints.',
                'Exact NFKC/case/whitespace-normalized full-body copies count once regardless of title; blank bodies fall back to title. Truncated bodies use a validated supplied full-body SHA256 for identity. Source votes require unanimous copies; dates use earliest date only when every copy has a valid nonfuture date. Content with any missing author earns no account vote; copied-account links are conservatively merged. Account independence is unverified.',
                'Source counts describe raw supplied documents; cluster evidence counts use unique content with conservative copy metadata. This convenience sample cannot establish market demand or prevalence.',
                'Pain, commercial and friction features are English/Chinese keyword heuristics, not verified intent. Scores rank observed evidence and do not predict business success.',
                'Limits: 1000 documents, 40000 body characters, first 6000 normalized body characters analyzed (title only when body is blank), 24000 TF-IDF features, 20 second compute budget. Fully blank documents rejected with 422; every accepted document belongs to a cluster.',
                'Recent means the preceding 30 days; missing, invalid and future dates are unknown; recency divides recent content by all unique content and is null only when no date is known. No observed keyword match is zero, not proof of absence.',
            ]}
