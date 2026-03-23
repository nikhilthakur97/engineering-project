import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { importCsv, getImportProgress } from "../services/csvImporter";
import { evaluateRules, applyRulesToExisting } from "../services/ruleEngine";
import { detectAnomalies } from "../services/anomalyDetector";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function stripRuleCategoryReasons(reasons: string[] | undefined): string[] {
  return (reasons || []).filter(
    (reason) => !(reason.startsWith("Rule match:") && reason.includes("set category"))
  );
}

// ---------------------------------------------------------------------------
// GET /api/transactions — list with cursor pagination and filters
// ---------------------------------------------------------------------------
router.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    if (cursor !== undefined && isNaN(cursor)) {
      res.status(400).json({ error: "Invalid cursor" });
      return;
    }
    const categoryId = req.query.categoryId === "null"
      ? undefined
      : req.query.categoryId
        ? Number(req.query.categoryId)
        : undefined;
    if (categoryId !== undefined && isNaN(categoryId)) {
      res.status(400).json({ error: "Invalid categoryId" });
      return;
    }
    const needsReview =
      req.query.needsReview === "true"
        ? true
        : req.query.needsReview === "false"
          ? false
          : undefined;
    const dateFrom = req.query.dateFrom
      ? new Date(req.query.dateFrom as string)
      : undefined;
    const dateTo = req.query.dateTo
      ? new Date(req.query.dateTo as string)
      : undefined;
    const search = req.query.search as string | undefined;
    const anomalyFlag = req.query.anomalyFlag as string | undefined;
    const flagged = req.query.flagged === "true";

    const where: any = {};
    if (req.query.categoryId === "null") {
      where.categoryId = null;
    } else if (categoryId !== undefined) {
      where.categoryId = categoryId;
    }
    if (needsReview !== undefined) where.needsReview = needsReview;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = dateFrom;
      if (dateTo) where.date.lte = dateTo;
    }
    if (search) {
      where.description = { contains: search, mode: "insensitive" };
    }
    if (anomalyFlag) {
      where.anomalyFlags = { has: anomalyFlag };
    }
    if (flagged) {
      where.anomalyFlags = { isEmpty: false };
    }

    const transactions = await prisma.transaction.findMany({
      take: limit + 1, // fetch one extra to determine if there's a next page
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where,
      orderBy: { id: "desc" },
      include: { category: true },
    });

    const hasMore = transactions.length > limit;
    if (hasMore) transactions.pop();

    const nextCursor = hasMore
      ? transactions[transactions.length - 1]?.id
      : null;

    res.json({
      data: transactions.map(formatTransaction),
      nextCursor,
      hasMore,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/transactions/import/progress — poll import progress
// ---------------------------------------------------------------------------
router.get("/import/progress", (_req, res) => {
  const progress = getImportProgress();
  res.json(progress || { phase: "idle", totalRows: 0, processedRows: 0, imported: 0, skipped: 0, failed: 0 });
});

// ---------------------------------------------------------------------------
// POST /api/transactions/import — CSV upload
// ---------------------------------------------------------------------------
router.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    if (!req.file.originalname.endsWith(".csv")) {
      res.status(400).json({ error: "File must be a CSV" });
      return;
    }

    const result = await importCsv(prisma, req.file.buffer);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/transactions/:id — get one
// ---------------------------------------------------------------------------
router.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: { category: true },
    });

    if (!transaction) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    res.json(formatTransaction(transaction));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/transactions — create one
// ---------------------------------------------------------------------------
router.post("/", async (req, res, next) => {
  try {
    const { date, description, amount, categoryId } = req.body;

    const validation = validateTransaction({ date, description, amount });
    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const desc = description?.trim() || null;
    const amountCents = Math.round(Number(amount) * 100);
    const catId = categoryId ? Number(categoryId) : null;

    // Run rules engine to auto-categorize and flag
    const ruleResult = await evaluateRules(
      prisma,
      { description: desc, amountCents },
      {
        existingCategoryId: catId,
        existingCategorySource: "manual",
      }
    );

    const finalCategoryId = ruleResult.categoryId;

    let createdId: number | null = null;

    try {
      // Insert first so anomaly detection can compare against DB
      const transaction = await prisma.transaction.create({
        data: {
          date: new Date(date),
          description: desc,
          amountCents,
          categoryId: finalCategoryId,
          categorySource: ruleResult.categorySource,
          anomalyFlags: ruleResult.flags,
          reviewReasons: ruleResult.reasons,
          needsReview: true, // temporary; updated after anomaly check
        },
        include: { category: true },
      });
      createdId = transaction.id;

      // Run anomaly detection
      const anomalyResult = await detectAnomalies(prisma, {
        id: transaction.id,
        date: new Date(date),
        description: desc,
        amountCents,
        categoryId: finalCategoryId,
      });

      const allFlags = [...new Set([...ruleResult.flags, ...anomalyResult.flags])];
      const reviewReasons = [
        ...new Set([...ruleResult.reasons, ...anomalyResult.reasons]),
      ];
      const needsReview = allFlags.length > 0 || finalCategoryId === null || !desc;

      // Update with final flags
      const updated = await prisma.transaction.update({
        where: { id: transaction.id },
        data: { anomalyFlags: allFlags, reviewReasons, needsReview },
        include: { category: true },
      });

      res.status(201).json(formatTransaction(updated));
    } catch (err) {
      if (createdId !== null) {
        await prisma.transaction.delete({ where: { id: createdId } }).catch(() => {
          // Best-effort cleanup to avoid leaving a half-processed row behind.
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/transactions/:id — update
// ---------------------------------------------------------------------------
router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    const {
      date,
      description,
      amount,
      categoryId,
      needsReview,
      anomalyFlags,
      reviewReasons,
    } = req.body;

    const updateData: any = {};
    if (date !== undefined) updateData.date = new Date(date);
    if (description !== undefined)
      updateData.description = description?.trim() || null;
    if (amount !== undefined)
      updateData.amountCents = Math.round(Number(amount) * 100);
    if (categoryId !== undefined) {
      updateData.categoryId = categoryId ? Number(categoryId) : null;
      updateData.categorySource = "manual";
      updateData.reviewReasons = stripRuleCategoryReasons(existing.reviewReasons);
    }
    if (needsReview !== undefined) updateData.needsReview = needsReview;
    if (anomalyFlags !== undefined) updateData.anomalyFlags = anomalyFlags;
    if (reviewReasons !== undefined) {
      updateData.reviewReasons = categoryId !== undefined
        ? stripRuleCategoryReasons(reviewReasons)
        : reviewReasons;
    }

    const transaction = await prisma.transaction.update({
      where: { id },
      data: updateData,
      include: { category: true },
    });

    res.json(formatTransaction(transaction));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/transactions/:id — delete
// ---------------------------------------------------------------------------
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    await prisma.transaction.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/transactions/bulk — bulk categorize or approve
// ---------------------------------------------------------------------------
router.patch("/bulk", async (req, res, next) => {
  try {
    const { ids, action, categoryId } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array" });
      return;
    }

    const numericIds = ids.map(Number).filter((n) => !isNaN(n));

    if (action === "categorize") {
      if (!categoryId) {
        res.status(400).json({ error: "categoryId is required for categorize" });
        return;
      }
      const catIdNum = Number(categoryId);
      const transactions = await prisma.transaction.findMany({
        where: { id: { in: numericIds } },
        select: { id: true, reviewReasons: true },
      });
      for (const tx of transactions) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            categoryId: catIdNum,
            categorySource: "manual",
            reviewReasons: stripRuleCategoryReasons(tx.reviewReasons),
          },
        });
      }
      res.json({ updated: transactions.length });
    } else if (action === "approve") {
      const result = await prisma.transaction.updateMany({
        where: { id: { in: numericIds } },
        data: { needsReview: false, anomalyFlags: [], reviewReasons: [] },
      });
      res.json({ updated: result.count });
    } else if (action === "rerun_rules") {
      const result = await applyRulesToExisting(prisma, numericIds);
      res.json({ updated: result.updated });
    } else if (action === "delete") {
      const result = await prisma.transaction.deleteMany({
        where: { id: { in: numericIds } },
      });
      res.json({ deleted: result.count });
    } else {
      res.status(400).json({
        error:
          "action must be 'categorize', 'approve', 'rerun_rules', or 'delete'",
      });
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateTransaction(data: {
  date: any;
  description: any;
  amount: any;
}): { error?: string } {
  if (!data.date) return { error: "Date is required" };
  const parsed = new Date(data.date);
  if (isNaN(parsed.getTime())) return { error: "Invalid date" };

  if (data.amount === undefined || data.amount === null || data.amount === "")
    return { error: "Amount is required" };
  const num = Number(data.amount);
  if (isNaN(num)) return { error: "Amount must be a number" };

  return {};
}

function formatTransaction(t: any) {
  return {
    id: t.id,
    date: t.date,
    description: t.description,
    amount: t.amountCents / 100,
    amountCents: t.amountCents,
    categoryId: t.categoryId,
    category: t.category || null,
    categorySource: t.categorySource,
    anomalyFlags: t.anomalyFlags,
    reviewReasons: t.reviewReasons,
    needsReview: t.needsReview,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export default router;
