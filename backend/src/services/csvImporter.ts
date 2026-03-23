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
  deposits?: string;
  withdrawals?: string;
  balance?: string;
}

const BATCH_SIZE = 500;

export interface ImportProgress {
  phase: string;
  totalRows: number;
  processedRows: number;
  imported: number;
  skipped: number;
  failed: number;
}

let currentProgress: ImportProgress | null = null;

export function getImportProgress(): ImportProgress | null {
  return currentProgress;
}

export async function importCsv(
  prisma: PrismaClient,
  buffer: Buffer
): Promise<ImportResult> {
  const { rows, resolvedHeaders, originalHeaders } = await parseCsv(buffer);

  const hasDate = resolvedHeaders.includes("date");
  const hasAmount = resolvedHeaders.includes("amount");
  const hasDepositsOrWithdrawals =
    resolvedHeaders.includes("deposits") || resolvedHeaders.includes("withdrawals");

  if (!hasDate || (!hasAmount && !hasDepositsOrWithdrawals)) {
    const missing: string[] = [];
    if (!hasDate) missing.push("date");
    if (!hasAmount && !hasDepositsOrWithdrawals) missing.push("amount (or deposits/withdrawals)");
    return {
      imported: 0,
      skipped: 0,
      failed: rows.length,
      errors: [
        {
          row: 1,
          message: `Missing required columns: ${missing.join(", ")}. `
            + `Your file has: [${originalHeaders.join(", ")}]. `
            + `Expected at least: date, amount (or deposits/withdrawals). `
            + `Optional: description, category.`,
        },
      ],
    };
  }

  currentProgress = {
    phase: "validating",
    totalRows: rows.length,
    processedRows: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
  };
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

    currentProgress!.processedRows = i + 1;

    const validation = validateRow(raw, rowNum);
    if (validation.error) {
      result.failed++;
      currentProgress!.failed++;
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
    const dedupeKey = `${dateKey(date)}|${amountCents}|${normalize(description)}`;
    if (seenInFile.has(dedupeKey)) {
      result.skipped++;
      result.errors.push({ row: rowNum, message: "Duplicate within file" });
      continue;
    }
    seenInFile.add(dedupeKey);
    currentProgress!.skipped = result.skipped;

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
  currentProgress!.phase = "deduplicating";
  const deduped = await deduplicateAgainstDb(prisma, validRows);
  result.skipped += validRows.length - deduped.length;
  currentProgress!.skipped = result.skipped;

  // Batch insert and collect IDs for anomaly detection
  currentProgress!.phase = "inserting";
  const insertedIds: number[] = [];
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const created = await prisma.transaction.createMany({ data: batch });
    result.imported += created.count;
    currentProgress!.imported = result.imported;
  }

  // Fetch IDs of newly inserted transactions for anomaly detection
  if (result.imported > 0) {
    currentProgress!.phase = "detecting_anomalies";
    const recent = await prisma.transaction.findMany({
      orderBy: { id: "desc" },
      take: result.imported,
      select: { id: true },
    });
    insertedIds.push(...recent.map((r) => r.id));

    // Run anomaly detection on the imported batch
    await detectAnomaliesBatch(prisma, insertedIds);
  }

  currentProgress!.phase = "complete";
  const finalProgress = currentProgress;
  currentProgress = null;
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

  const existingSet = new Set<string>();
  const CHUNK_SIZE = 500;

  // Query in batches to avoid exceeding PostgreSQL parameter limits
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const dates = [...new Set(chunk.map((r) => r.date.toISOString()))].map(
      (d) => new Date(d)
    );
    const amounts = [...new Set(chunk.map((r) => r.amountCents))];

    const existing = await prisma.transaction.findMany({
      where: {
        date: { in: dates },
        amountCents: { in: amounts },
      },
      select: { date: true, amountCents: true, description: true },
    });

    for (const e of existing) {
      existingSet.add(
        `${dateKey(new Date(e.date))}|${e.amountCents}|${normalize(e.description)}`
      );
    }
  }

  return rows.filter((r) => {
    const key = `${dateKey(r.date)}|${r.amountCents}|${normalize(r.description)}`;
    return !existingSet.has(key);
  });
}

const COLUMN_ALIASES: Record<string, string> = {
  date: "date",
  transaction_date: "date",
  trans_date: "date",
  timestamp: "date",
  posted_date: "date",

  description: "description",
  desc: "description",
  payee: "description",
  memo: "description",
  narration: "description",
  details: "description",
  transaction_description: "description",

  amount: "amount",
  transaction_amount: "amount",
  transactionamount: "amount",
  value: "amount",
  sum: "amount",

  deposits: "deposits",
  deposit: "deposits",
  credit: "deposits",
  credits: "deposits",

  withdrawals: "withdrawals",
  withdrawls: "withdrawals",
  withdrawal: "withdrawals",
  debit: "withdrawals",
  debits: "withdrawals",

  balance: "balance",

  category: "category",
  category_name: "category",
  type: "category",
  transaction_type: "category",
  transactiontype: "category",
};

interface ParseResult {
  rows: RawRow[];
  resolvedHeaders: string[];
  originalHeaders: string[];
}

function parseCsv(buffer: Buffer): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const rows: RawRow[] = [];
    let resolvedHeaders: string[] = [];
    let originalHeaders: string[] = [];
    const stream = Readable.from(buffer);
    stream
      .pipe(
        parse({
          columns: (headers: string[]) => {
            originalHeaders = headers.map((h) => h.replace(/^\uFEFF/, "").trim());
            resolvedHeaders = originalHeaders.map((h) => {
              const key = h.toLowerCase().replace(/[\s-]+/g, "_");
              return COLUMN_ALIASES[key] || key;
            });
            return resolvedHeaders;
          },
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        })
      )
      .on("data", (row: RawRow) => rows.push(row))
      .on("end", () => resolve({ rows, resolvedHeaders, originalHeaders }))
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

  // Derive amount from deposits/withdrawals columns if no amount column
  if ((!raw.amount || !raw.amount.trim()) && (raw.deposits || raw.withdrawals)) {
    const depStr = (raw.deposits || "0").trim().replace(/[$,]/g, "");
    const wthStr = (raw.withdrawals || "0").trim().replace(/[$,]/g, "");
    const dep = Number(depStr);
    const wth = Number(wthStr);
    if (isNaN(dep) || isNaN(wth)) {
      return { error: `Invalid deposit/withdrawal value` };
    }
    raw.amount = String(dep - wth);
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

/** Calendar date in the environment's local timezone (avoids UTC day shifts from toISOString). */
function dateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
