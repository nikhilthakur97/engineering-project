import { PrismaClient } from "../../generated/prisma/client";

export interface RuleResult {
  categoryId: number | null;
  flags: string[];
}

interface TransactionInput {
  description: string | null;
  amountCents: number;
}

interface RuleData {
  conditionType: string;
  conditionValue: string;
  actionType: string;
  actionValue: string;
}

/**
 * Evaluate all active rules against a single transaction.
 * Rules are sorted by priority (lower = first).
 * - For set_category: first match wins (doesn't overwrite if already set).
 * - For add_flag: all matching rules accumulate flags.
 *
 * Pass `preloadedRules` to skip the per-call DB query (useful for batch ops).
 */
export async function evaluateRules(
  prisma: PrismaClient,
  tx: TransactionInput,
  existingCategoryId?: number | null,
  preloadedRules?: RuleData[]
): Promise<RuleResult> {
  const rules =
    preloadedRules ??
    (await prisma.rule.findMany({
      where: { active: true },
      orderBy: { priority: "asc" },
    }));

  let categoryId: number | null = existingCategoryId ?? null;
  const flags: string[] = [];

  for (const rule of rules) {
    if (!matchesCondition(rule, tx)) continue;

    if (rule.actionType === "set_category" && categoryId === null) {
      const resolved = await resolveCategory(prisma, rule.actionValue);
      if (resolved !== null) categoryId = resolved;
    } else if (rule.actionType === "add_flag") {
      const flag = rule.actionValue.trim();
      if (flag && !flags.includes(flag)) flags.push(flag);
    }
  }

  return { categoryId, flags };
}

/**
 * Apply rules to a batch of transactions (by ID, or all if omitted).
 * Pre-loads rules once and processes in batches of 1000 for scalability.
 */
export async function applyRulesToExisting(
  prisma: PrismaClient,
  transactionIds?: number[]
): Promise<{ updated: number }> {
  const rules = await prisma.rule.findMany({
    where: { active: true },
    orderBy: { priority: "asc" },
  });

  let updated = 0;

  if (transactionIds) {
    const transactions = await prisma.transaction.findMany({
      where: { id: { in: transactionIds } },
      select: { id: true, description: true, amountCents: true },
    });

    for (const tx of transactions) {
      const result = await evaluateRules(prisma, tx, null, rules);
      const needsReview = result.flags.length > 0 || result.categoryId === null;

      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          categoryId: result.categoryId,
          anomalyFlags: result.flags,
          needsReview,
        },
      });
      updated++;
    }
  } else {
    const BATCH_SIZE = 1000;
    let lastId = 0;

    while (true) {
      const transactions = await prisma.transaction.findMany({
        where: { id: { gt: lastId } },
        select: { id: true, description: true, amountCents: true },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
      });

      if (transactions.length === 0) break;

      for (const tx of transactions) {
        const result = await evaluateRules(prisma, tx, null, rules);
        const needsReview = result.flags.length > 0 || result.categoryId === null;

        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            categoryId: result.categoryId,
            anomalyFlags: result.flags,
            needsReview,
          },
        });
        updated++;
      }

      lastId = transactions[transactions.length - 1].id;
    }
  }

  return { updated };
}

function matchesCondition(
  rule: { conditionType: string; conditionValue: string },
  tx: TransactionInput
): boolean {
  const val = rule.conditionValue;

  switch (rule.conditionType) {
    case "description_contains":
      return (tx.description || "")
        .toLowerCase()
        .includes(val.toLowerCase());

    case "description_equals":
      return (tx.description || "").toLowerCase() === val.toLowerCase();

    case "amount_gt":
      return tx.amountCents > Math.round(Number(val) * 100);

    case "amount_lt":
      return tx.amountCents < Math.round(Number(val) * 100);

    case "amount_eq":
      return tx.amountCents === Math.round(Number(val) * 100);

    default:
      return false;
  }
}

const CACHE_TTL_MS = 60_000;
const categoryCache = new Map<string, { value: number | null; expires: number }>();

async function resolveCategory(
  prisma: PrismaClient,
  value: string
): Promise<number | null> {
  const key = value.trim().toLowerCase();

  const cached = categoryCache.get(key);
  if (cached && Date.now() < cached.expires) return cached.value;

  function cache(v: number | null) {
    categoryCache.set(key, { value: v, expires: Date.now() + CACHE_TTL_MS });
    return v;
  }

  // Try as ID first
  const asNum = Number(value);
  if (!isNaN(asNum)) {
    const cat = await prisma.category.findUnique({ where: { id: asNum } });
    if (cat) return cache(cat.id);
  }

  // Try as slug
  const slug = key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (slug) {
    const bySlug = await prisma.category.findUnique({ where: { slug } });
    if (bySlug) return cache(bySlug.id);
  }

  // Try as name
  const all = await prisma.category.findMany();
  const byName = all.find((c) => c.name.toLowerCase() === key);
  if (byName) return cache(byName.id);

  return cache(null);
}
