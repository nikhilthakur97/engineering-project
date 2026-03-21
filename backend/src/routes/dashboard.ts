import { Router } from "express";
import { prisma } from "../index";

const router = Router();

// GET /api/dashboard/summary — counts for the review dashboard
router.get("/summary", async (_req, res, next) => {
  try {
    const [total, uncategorized, flagged, needsReview] = await Promise.all([
      prisma.transaction.count(),
      prisma.transaction.count({ where: { categoryId: null } }),
      prisma.transaction.count({
        where: { anomalyFlags: { isEmpty: false } },
      }),
      prisma.transaction.count({ where: { needsReview: true } }),
    ]);

    res.json({ total, uncategorized, flagged, needsReview });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/spending — monthly spending by category
// Uses raw SQL aggregation to avoid loading all transactions into memory.
router.get("/spending", async (req, res, next) => {
  try {
    const months = Math.max(1, Math.min(Number(req.query.months) || 12, 24));
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    const rows = await prisma.$queryRaw<
      { month: string; category: string; total_cents: bigint | number }[]
    >`
      SELECT
        TO_CHAR(t.date, 'YYYY-MM') AS month,
        COALESCE(c.name, 'Uncategorized') AS category,
        SUM(t.amount_cents) AS total_cents
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.date >= ${cutoff}
      GROUP BY TO_CHAR(t.date, 'YYYY-MM'), COALESCE(c.name, 'Uncategorized')
      ORDER BY month
    `;

    const allCategories = new Set<string>();
    const monthMap = new Map<string, Map<string, number>>();

    for (const row of rows) {
      allCategories.add(row.category);
      if (!monthMap.has(row.month)) monthMap.set(row.month, new Map());
      monthMap.get(row.month)!.set(row.category, Number(row.total_cents) / 100);
    }

    const data = [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, catMap]) => {
        const entry: Record<string, any> = { month };
        for (const cat of allCategories) {
          entry[cat] = catMap.get(cat) || 0;
        }
        return entry;
      });

    res.json({ data, categories: [...allCategories].sort() });
  } catch (err) {
    next(err);
  }
});

export default router;
