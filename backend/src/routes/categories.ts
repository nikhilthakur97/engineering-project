import { Router } from "express";
import { prisma } from "../index";

const router = Router();

// GET /api/categories — list all
router.get("/", async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
    });
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// POST /api/categories — create
router.post("/", async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    if (!slug) {
      res.status(400).json({ error: "Name must contain at least one alphanumeric character" });
      return;
    }

    const category = await prisma.category.create({
      data: { name: name.trim(), slug },
    });
    res.status(201).json(category);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "Category already exists" });
      return;
    }
    next(err);
  }
});

export default router;
