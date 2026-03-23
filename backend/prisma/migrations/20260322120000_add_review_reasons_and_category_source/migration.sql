ALTER TABLE "transactions"
ADD COLUMN "category_source" VARCHAR(20) NOT NULL DEFAULT 'manual',
ADD COLUMN "review_reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
