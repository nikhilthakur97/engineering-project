import { parse } from "csv-parse";
import { Readable } from "stream";
import { PrismaClient } from "../../generated/prisma/client";
import { evaluateRules } from "./ruleEngine";
import { detectAnomaliesBatch } from "./anomalyDetector";

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
}

interface RawRow {
  date?: string;
  description?: string;
  amount?: string;
  category?: string;
}

const BATCH_SIZE = 500;

export async function importCsv(
  prisma: PrismaClient,
  buffer: Buffer
): Promise<ImportResult> {
  const rows = await parseCsv(buffer);
  const categories = await prisma.category.findMany();
  const categoryMap = new Map(categories.map((c) => [c.slug, c.id]));
  const categoryNameMap = new Map(
    categories.map((c) => [c.name.toLowerCase(), c.id])
  );

  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, errors: [] };
  const validRows: {
    date: Date;
    description: string | null;
    amountCents: number;
    categoryId: number | null;
    anomalyFlags: string[];
    needsReview: boolean;
  }[] = [];

  // Pre-load rules once for the entire import instead of querying per row
  const preloadedRules = await prisma.rule.findMany({
    where: { active: true },
    orderBy: { priority: "asc" },
  });

  // O(1) lookup for in-file duplicate detection instead of O(n) scan per row
  const seenInFile = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // +2 because row 1 is the header
    const raw = rows[i];

    const validation = validateRow(raw, rowNum);
    if (validation.error) {
      result.failed++;
      result.errors.push({ row: rowNum, message: validation.error });
      continue;
    }

    const date = new Date(raw.date!);
    const amountCents = Math.round(Number(raw.amount) * 100);
    const description = raw.description?.trim() || null;

    // Resolve category by slug or name
    let categoryId: number | null = null;
    if (raw.category) {
      const cat = raw.category.trim().toLowerCase();
      const slug = cat.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      categoryId = categoryMap.get(slug) ?? categoryNameMap.get(cat) ?? null;
    }

    // Check for duplicates within the file itself (Set-based O(1) lookup)
    const dedupeKey = `${date.getTime()}|${amountCents}|${normalize(description)}`;
    if (seenInFile.has(dedupeKey)) {
      result.skipped++;
      result.errors.push({ row: rowNum, message: "Duplicate within file" });
      continue;
    }
    seenInFile.add(dedupeKey);

    // Run rules engine for auto-categorization and flagging
    const ruleResult = await evaluateRules(
      prisma,
      { description, amountCents },
      categoryId,
      preloadedRules
    );
    const finalCategoryId = ruleResult.categoryId;
    const flags = ruleResult.flags;

    validRows.push({
      date,
      description,
      amountCents,
      categoryId: finalCategoryId,
      anomalyFlags: flags,
      needsReview: flags.length > 0 || !finalCategoryId || !description,
    });
  }

  // Check for duplicates against existing database records
  const deduped = await deduplicateAgainstDb(prisma, validRows);
  result.skipped += validRows.length - deduped.length;

  // Batch insert and collect IDs for anomaly detection
  const insertedIds: number[] = [];
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const created = await prisma.transaction.createMany({ data: batch });
    result.imported += created.count;
  }

  // Fetch IDs of newly inserted transactions for anomaly detection
  if (result.imported > 0) {
    const recent = await prisma.transaction.findMany({
      orderBy: { id: "desc" },
      take: result.imported,
      select: { id: true },
    });
    insertedIds.push(...recent.map((r) => r.id));

    // Run anomaly detection on the imported batch
    await detectAnomaliesBatch(prisma, insertedIds);
  }

  return result;
}

async function deduplicateAgainstDb(
  prisma: PrismaClient,
  rows: {
    date: Date;
    description: string | null;
    amountCents: number;
    categoryId: number | null;
    anomalyFlags: string[];
    needsReview: boolean;
  }[]
): Promise<typeof rows> {
  if (rows.length === 0) return [];

  // Get unique date+amount pairs to query
  const dateAmountPairs = [
    ...new Set(rows.map((r) => `${r.date.toISOString()}|${r.amountCents}`)),
  ];

  const dates = dateAmountPairs.map((p) => new Date(p.split("|")[0]));
  const amounts = dateAmountPairs.map((p) => Number(p.split("|")[1]));

  const existing = await prisma.transaction.findMany({
    where: {
      date: { in: dates },
      amountCents: { in: amounts },
    },
    select: { date: true, amountCents: true, description: true },
  });

  const existingSet = new Set(
    existing.map(
      (e) =>
        `${new Date(e.date).toISOString()}|${e.amountCents}|${normalize(e.description)}`
    )
  );

  return rows.filter((r) => {
    const key = `${r.date.toISOString()}|${r.amountCents}|${normalize(r.description)}`;
    return !existingSet.has(key);
  });
}

function parseCsv(buffer: Buffer): Promise<RawRow[]> {
  return new Promise((resolve, reject) => {
    const rows: RawRow[] = [];
    const stream = Readable.from(buffer);
    stream
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        })
      )
      .on("data", (row: RawRow) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function validateRow(
  raw: RawRow,
  rowNum: number
): { error?: string } {
  if (!raw.date || !raw.date.trim()) {
    return { error: `Missing date` };
  }
  const parsed = new Date(raw.date.trim());
  if (isNaN(parsed.getTime())) {
    return { error: `Invalid date: "${raw.date}"` };
  }

  if (!raw.amount || !raw.amount.trim()) {
    return { error: `Missing amount` };
  }
  // Strip currency symbols and commas
  const cleaned = raw.amount.trim().replace(/[$,]/g, "");
  if (isNaN(Number(cleaned))) {
    return { error: `Invalid amount: "${raw.amount}"` };
  }
  // Rewrite the amount so downstream code sees the cleaned value
  raw.amount = cleaned;

  return {};
}

function normalize(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}
