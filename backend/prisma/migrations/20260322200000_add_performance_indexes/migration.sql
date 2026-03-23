-- GIN index on anomaly_flags for fast isEmpty / has queries
CREATE INDEX "transactions_anomaly_flags_idx" ON "transactions" USING GIN ("anomaly_flags");

-- GIN index on review_reasons for fast array filtering
CREATE INDEX "transactions_review_reasons_idx" ON "transactions" USING GIN ("review_reasons");

-- Enable trigram extension for fast ILIKE searches on description
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on description for fast ILIKE / contains searches
CREATE INDEX "transactions_description_trgm_idx" ON "transactions" USING GIN ("description" gin_trgm_ops);

-- Partial index for uncategorized transactions (speeds up dashboard count)
CREATE INDEX "transactions_uncategorized_idx" ON "transactions" ("id") WHERE "category_id" IS NULL;

-- B-tree index on amount_cents for range queries in anomaly detection
CREATE INDEX "transactions_amount_cents_idx" ON "transactions" ("amount_cents");
