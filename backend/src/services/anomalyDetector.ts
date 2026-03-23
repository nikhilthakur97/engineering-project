import { PrismaClient } from "../../generated/prisma/client";

export interface AnomalyResult {
  flags: string[];
}

interface TransactionInput {
  id?: number;
  date: Date;
  description: string | null;
  amountCents: number;
  categoryId: number | null;
}

/**
 * Run all anomaly checks on a single transaction.
 * Returns flags to merge with any existing flags (e.g. from rules engine).
 */
export async function detectAnomalies(
  prisma: PrismaClient,
  tx: TransactionInput
): Promise<AnomalyResult> {
  const flags: string[] = [];

  if (checkMissingMetadata(tx)) flags.push("incomplete");
  if (await checkDuplicate(prisma, tx)) flags.push("possible_duplicate");
  if (await checkUnusualAmount(prisma, tx)) flags.push("unusual_amount");

  return { flags };
}

/**
 * Run anomaly detection on a batch of transaction IDs (already in DB).
 * Processes in chunks, uses Map-based O(1) duplicate lookup, and
 * groups UPDATEs by flag combination for bulk execution.
 */
export async function detectAnomaliesBatch(
  prisma: PrismaClient,
  transactionIds?: number[]
): Promise<{ flagged: number }> {
  const CHUNK = 5000;
  let totalFlagged = 0;

  const allIds = transactionIds ?? (
    await prisma.transaction.findMany({ select: { id: true }, orderBy: { id: "asc" } })
  ).map((t) => t.id);

  const categoryIds = new Set<number>();
  const allCatRows = await prisma.transaction.findMany({
    where: transactionIds ? { id: { in: transactionIds } } : {},
    select: { categoryId: true },
    distinct: ["categoryId"],
  });
  for (const r of allCatRows) {
    if (r.categoryId !== null) categoryIds.add(r.categoryId);
  }
  const statsMap = await precomputeAmountStats(prisma, [...categoryIds]);

  for (let offset = 0; offset < allIds.length; offset += CHUNK) {
    const chunkIds = allIds.slice(offset, offset + CHUNK);
    const transactions = await prisma.transaction.findMany({
      where: { id: { in: chunkIds } },
      select: {
        id: true,
        date: true,
        description: true,
        amountCents: true,
        categoryId: true,
        anomalyFlags: true,
      },
    });

    if (transactions.length === 0) continue;

    // Pre-load duplicate candidates and index by date|amount for O(1) lookup
    const uniqueDates = [
      ...new Set(transactions.map((t) => new Date(t.date).toISOString())),
    ].map((d) => new Date(d));
    const uniqueAmounts = [...new Set(transactions.map((t) => t.amountCents))];

    const duplicateCandidates = await prisma.transaction.findMany({
      where: {
        date: { in: uniqueDates },
        amountCents: { in: uniqueAmounts },
      },
      select: { id: true, date: true, amountCents: true, description: true },
    });

    const dupeMap = new Map<string, { id: number; description: string | null }[]>();
    for (const c of duplicateCandidates) {
      const key = `${new Date(c.date).toISOString()}|${c.amountCents}`;
      let bucket = dupeMap.get(key);
      if (!bucket) { bucket = []; dupeMap.set(key, bucket); }
      bucket.push({ id: c.id, description: c.description });
    }

    // Group updates by (sorted flags + needsReview) for bulk SQL UPDATEs
    const grouped = new Map<string, number[]>();

    for (const tx of transactions) {
      const flags: string[] = [];

      if (!tx.description || tx.description.trim().length === 0) {
        flags.push("incomplete");
      }

      const txDateISO = new Date(tx.date).toISOString();
      const normalizedDesc = normalize(tx.description);
      const key = `${txDateISO}|${tx.amountCents}`;
      const bucket = dupeMap.get(key);
      if (bucket) {
        const isDupe = bucket.some((m) => {
          if (m.id === tx.id) return false;
          const matchDesc = normalize(m.description);
          if (matchDesc === normalizedDesc) return true;
          if (matchDesc.length > 3 && normalizedDesc.length > 3) {
            return matchDesc.includes(normalizedDesc) || normalizedDesc.includes(matchDesc);
          }
          return false;
        });
        if (isDupe) flags.push("possible_duplicate");
      }

      const stats = statsMap.get(tx.categoryId ?? -1) ?? statsMap.get(-1);
      if (stats && stats.count >= 10 && stats.stddev > 0) {
        const zScore = Math.abs(tx.amountCents - stats.mean) / stats.stddev;
        if (zScore > 3) flags.push("unusual_amount");
      }

      const existingNonAnomaly = (tx.anomalyFlags || []).filter(
        (f) => !["incomplete", "possible_duplicate", "unusual_amount"].includes(f)
      );
      const mergedFlags = [...new Set([...existingNonAnomaly, ...flags])];
      const needsReview = mergedFlags.length > 0 || tx.categoryId === null;

      const changed =
        mergedFlags.length !== (tx.anomalyFlags || []).length ||
        mergedFlags.some((f) => !(tx.anomalyFlags || []).includes(f));

      if (changed) {
        const sortedFlags = [...mergedFlags].sort();
        const groupKey = JSON.stringify({ flags: sortedFlags, needsReview });
        let ids = grouped.get(groupKey);
        if (!ids) { ids = []; grouped.set(groupKey, ids); }
        ids.push(tx.id);
        if (flags.length > 0) totalFlagged++;
      }
    }

    // Execute one UPDATE per unique flag combination (typically just a few)
    for (const [groupKey, ids] of grouped) {
      const { flags: flagsArr, needsReview } = JSON.parse(groupKey) as { flags: string[]; needsReview: boolean };

      for (let i = 0; i < ids.length; i += 1000) {
        const chunk = ids.slice(i, i + 1000);
        await prisma.$executeRaw`
          UPDATE transactions
          SET anomaly_flags = ${flagsArr}::text[],
              needs_review = ${needsReview}
          WHERE id = ANY(${chunk}::int[])
        `;
      }
    }
  }

  return { flagged: totalFlagged };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AmountStats {
  count: number;
  mean: number;
  stddev: number;
}

/**
 * Pre-compute mean/stddev for each category (and global, keyed as -1).
 * One query per category — O(categories) instead of O(transactions).
 */
async function precomputeAmountStats(
  prisma: PrismaClient,
  categoryIds: number[]
): Promise<Map<number, AmountStats>> {
  const statsMap = new Map<number, AmountStats>();

  const globalAmounts = await prisma.transaction.findMany({
    select: { amountCents: true },
    orderBy: { id: "desc" },
    take: 1000,
  });
  if (globalAmounts.length >= 10) {
    statsMap.set(-1, computeStats(globalAmounts.map((t) => t.amountCents)));
  }

  for (const catId of categoryIds) {
    const amounts = await prisma.transaction.findMany({
      where: { categoryId: catId },
      select: { amountCents: true },
      orderBy: { id: "desc" },
      take: 1000,
    });
    if (amounts.length >= 10) {
      statsMap.set(catId, computeStats(amounts.map((t) => t.amountCents)));
    }
  }

  return statsMap;
}

function computeStats(amounts: number[]): AmountStats {
  const count = amounts.length;
  const mean = amounts.reduce((sum, a) => sum + a, 0) / count;
  const variance =
    amounts.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / count;
  return { count, mean, stddev: Math.sqrt(variance) };
}

// ---------------------------------------------------------------------------
// Single-transaction checks (used by detectAnomalies for individual creates)
// ---------------------------------------------------------------------------

function checkMissingMetadata(tx: TransactionInput): boolean {
  return !tx.description || tx.description.trim().length === 0;
}

async function checkDuplicate(
  prisma: PrismaClient,
  tx: TransactionInput
): Promise<boolean> {
  const matches = await prisma.transaction.findMany({
    where: {
      date: tx.date,
      amountCents: tx.amountCents,
      ...(tx.id ? { id: { not: tx.id } } : {}),
    },
    select: { id: true, description: true },
  });

  if (matches.length === 0) return false;

  const normalizedDesc = normalize(tx.description);
  return matches.some((m) => {
    const matchDesc = normalize(m.description);
    if (matchDesc === normalizedDesc) return true;
    if (matchDesc.length > 3 && normalizedDesc.length > 3) {
      if (
        matchDesc.includes(normalizedDesc) ||
        normalizedDesc.includes(matchDesc)
      )
        return true;
    }
    return false;
  });
}

async function checkUnusualAmount(
  prisma: PrismaClient,
  tx: TransactionInput
): Promise<boolean> {
  const where = tx.categoryId ? { categoryId: tx.categoryId } : {};

  const amounts = await prisma.transaction.findMany({
    where,
    select: { amountCents: true },
    orderBy: { id: "desc" },
    take: 1000,
  });

  if (amounts.length < 10) return false;

  const { mean, stddev } = computeStats(amounts.map((t) => t.amountCents));
  if (stddev === 0) return false;

  return Math.abs(tx.amountCents - mean) / stddev > 3;
}

function normalize(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}
