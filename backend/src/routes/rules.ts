import { Router } from "express";
import { prisma } from "../index";
import { applyRulesToExisting } from "../services/ruleEngine";

const router = Router();

const VALID_CONDITION_TYPES = [
  "description_contains",
  "description_equals",
  "amount_gt",
  "amount_lt",
  "amount_eq",
];

const VALID_ACTION_TYPES = ["set_category", "add_flag"];

// GET /api/rules — list all
router.get("/", async (_req, res, next) => {
  try {
    const rules = await prisma.rule.findMany({
      orderBy: { priority: "asc" },
    });
    res.json(rules);
  } catch (err) {
    next(err);
  }
});

// POST /api/rules — create
router.post("/", async (req, res, next) => {
  try {
    const { name, conditionType, conditionValue, actionType, actionValue, priority } =
      req.body;

    const error = validateRule(req.body);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const parsedPriority =
      priority !== undefined && priority !== null ? Number(priority) : 0;

    const rule = await prisma.rule.create({
      data: {
        name: name.trim(),
        conditionType,
        conditionValue: String(conditionValue).trim(),
        actionType,
        actionValue: String(actionValue).trim(),
        priority: parsedPriority,
      },
    });
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});

// PUT /api/rules/:id — update
router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const existing = await prisma.rule.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    const updateData: any = {};
    const { name, conditionType, conditionValue, actionType, actionValue, priority, active } =
      req.body;

    if (name !== undefined) updateData.name = name.trim();
    if (conditionType !== undefined) {
      if (!VALID_CONDITION_TYPES.includes(conditionType)) {
        res.status(400).json({ error: `Invalid conditionType. Must be one of: ${VALID_CONDITION_TYPES.join(", ")}` });
        return;
      }
      updateData.conditionType = conditionType;
    }
    if (conditionValue !== undefined)
      updateData.conditionValue = String(conditionValue).trim();
    if (actionType !== undefined) {
      if (!VALID_ACTION_TYPES.includes(actionType)) {
        res.status(400).json({ error: `Invalid actionType. Must be one of: ${VALID_ACTION_TYPES.join(", ")}` });
        return;
      }
      updateData.actionType = actionType;
    }
    if (actionValue !== undefined)
      updateData.actionValue = String(actionValue).trim();
    if (priority !== undefined) {
      const p = Number(priority);
      if (isNaN(p)) { res.status(400).json({ error: "priority must be a number" }); return; }
      updateData.priority = p;
    }
    if (active !== undefined) updateData.active = Boolean(active);

    const rule = await prisma.rule.update({ where: { id }, data: updateData });
    res.json(rule);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/rules/:id — delete
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const existing = await prisma.rule.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    await prisma.rule.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/rules/apply — re-run all rules on existing transactions
router.post("/apply", async (_req, res, next) => {
  try {
    const result = await applyRulesToExisting(prisma);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

function validateRule(body: any): string | undefined {
  if (!body.name?.trim()) return "Name is required";
  if (!VALID_CONDITION_TYPES.includes(body.conditionType))
    return `Invalid conditionType. Must be one of: ${VALID_CONDITION_TYPES.join(", ")}`;
  if (!body.conditionValue && body.conditionValue !== 0)
    return "conditionValue is required";
  if (!VALID_ACTION_TYPES.includes(body.actionType))
    return `Invalid actionType. Must be one of: ${VALID_ACTION_TYPES.join(", ")}`;
  if (!body.actionValue && body.actionValue !== 0)
    return "actionValue is required";
  if (body.priority !== undefined && body.priority !== null) {
    const p = Number(body.priority);
    if (isNaN(p)) return "priority must be a number";
  }
  return undefined;
}

export default router;
