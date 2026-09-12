"""Bounded wire contract shared with the TypeScript BFF."""
import re
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Document(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=512)
    source: str = Field(min_length=1, max_length=128)
    externalId: str = Field(default='', max_length=1024)
    title: str = Field(default='', max_length=2000)
    body: str = Field(default='', max_length=40000)
    authorId: str | None = Field(default=None, max_length=512)
    # Bad provider dates are retained as unknown evidence, not rejected.
    publishedAt: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode='after')
    def nonblank_content(self):
        if self.metadata.get('bodyTruncated') is True:
            digest = self.metadata.get('fullContentHash')
            if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', digest):
                raise ValueError('truncated body requires a 64-hex SHA256 fullContentHash')
        if not self.body.strip() and not self.title.strip():
            raise ValueError('document must contain a nonblank body or title')
        return self

class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    documents: list[Document] = Field(max_length=1000)
    asOf: datetime | None = None

    @model_validator(mode='after')
    def unique_ids(self):
        ids = [d.id for d in self.documents]
        if len(ids) != len(set(ids)):
            raise ValueError('document ids must be unique')
        return self
