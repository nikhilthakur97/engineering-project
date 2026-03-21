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
 * Pre-loads duplicate candidates and amount stats in bulk to avoid
 * 3×N individual DB queries.
 */
export async function detectAnomaliesBatch(
  prisma: PrismaClient,
  transactionIds?: number[]
): Promise<{ flagged: number }> {
  const where = transactionIds ? { id: { in: transactionIds } } : {};
  const transactions = await prisma.transaction.findMany({
    where,
    select: {
      id: true,
      date: true,
      description: true,
      amountCents: true,
      categoryId: true,
      anomalyFlags: true,
    },
  });

  if (transactions.length === 0) return { flagged: 0 };

  // Pre-load duplicate candidates in a single query
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

  // Pre-compute amount stats per category (+ global for uncategorized)
  const categoryIds = [
    ...new Set(
      transactions
        .map((t) => t.categoryId)
        .filter((id): id is number => id !== null)
    ),
  ];
  const statsMap = await precomputeAmountStats(prisma, categoryIds);

  let flagged = 0;

  for (const tx of transactions) {
    const flags: string[] = [];

    // Check 1: Missing metadata
    if (!tx.description || tx.description.trim().length === 0) {
      flags.push("incomplete");
    }

    // Check 2: Duplicate (using preloaded candidates)
    const txDateISO = new Date(tx.date).toISOString();
    const normalizedDesc = normalize(tx.description);
    const matches = duplicateCandidates.filter(
      (c) =>
        c.id !== tx.id &&
        new Date(c.date).toISOString() === txDateISO &&
        c.amountCents === tx.amountCents
    );
    if (
      matches.some((m) => {
        const matchDesc = normalize(m.description);
        if (matchDesc === normalizedDesc) return true;
        if (matchDesc.length > 3 && normalizedDesc.length > 3) {
          return (
            matchDesc.includes(normalizedDesc) ||
            normalizedDesc.includes(matchDesc)
          );
        }
        return false;
      })
    ) {
      flags.push("possible_duplicate");
    }

    // Check 3: Unusual amount (using precomputed stats)
    const stats = statsMap.get(tx.categoryId ?? -1) ?? statsMap.get(-1);
    if (stats && stats.count >= 10 && stats.stddev > 0) {
      const zScore = Math.abs(tx.amountCents - stats.mean) / stats.stddev;
      if (zScore > 3) flags.push("unusual_amount");
    }

    // Merge new anomaly flags with existing rule-based flags
    const existingNonAnomaly = (tx.anomalyFlags || []).filter(
      (f) => !["incomplete", "possible_duplicate", "unusual_amount"].includes(f)
    );
    const mergedFlags = [...new Set([...existingNonAnomaly, ...flags])];
    const needsReview = mergedFlags.length > 0 || tx.categoryId === null;

    if (
      mergedFlags.length !== (tx.anomalyFlags || []).length ||
      mergedFlags.some((f) => !(tx.anomalyFlags || []).includes(f))
    ) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { anomalyFlags: mergedFlags, needsReview },
      });
      if (flags.length > 0) flagged++;
    }
  }

  return { flagged };
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
