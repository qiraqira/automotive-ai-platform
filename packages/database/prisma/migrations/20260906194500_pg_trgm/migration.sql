-- Enables trigram-based title similarity for duplicate/story-clustering
-- detection (docs/database.md "pg_trgm fallback" until pgvector is
-- available in this environment).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS source_articles_title_trgm_idx ON source_articles USING gin (title gin_trgm_ops);
