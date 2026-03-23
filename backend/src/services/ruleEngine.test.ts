import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRules, matchesCondition } from "./ruleEngine";

test("matchesCondition handles description and amount operators", () => {
  assert.equal(
    matchesCondition(
      { conditionType: "description_contains", conditionValue: "amazon" },
      { description: "Amazon Marketplace", amountCents: 2500 }
    ),
    true
  );
  assert.equal(
    matchesCondition(
      { conditionType: "amount_gt", conditionValue: "10" },
      { description: "Coffee", amountCents: 1200 }
    ),
    true
  );
});

test("evaluateRules preserves manual category overrides while still adding flags", async () => {
  const prisma = {
    category: {
      findUnique: async ({ where }: { where: { id?: number; slug?: string } }) => {
        if (where.id === 1 || where.slug === "shopping") {
          return { id: 1, slug: "shopping", name: "Shopping" };
        }
        return null;
      },
      findMany: async () => [{ id: 1, slug: "shopping", name: "Shopping" }],
    },
  } as any;

  const result = await evaluateRules(
    prisma,
    { description: "Amazon order", amountCents: 250000 },
    {
      existingCategoryId: 99,
      existingCategorySource: "manual",
      preloadedRules: [
        {
          name: "Amazon -> Shopping",
          conditionType: "description_contains",
          conditionValue: "Amazon",
          actionType: "set_category",
          actionValue: "shopping",
        },
        {
          name: "Large purchase",
          conditionType: "amount_gt",
          conditionValue: "1000",
          actionType: "add_flag",
          actionValue: "high_value",
        },
      ],
    }
  );

  assert.equal(result.categoryId, 99);
  assert.equal(result.categorySource, "manual");
  assert.deepEqual(result.flags, ["high_value"]);
  assert.deepEqual(result.reasons, [
    'Rule match: "Large purchase" added flag "high_value".',
  ]);
});

test("evaluateRules can auto-categorize imported transactions once", async () => {
  const prisma = {
    category: {
      findUnique: async ({ where }: { where: { id?: number; slug?: string } }) => {
        if (where.slug === "shopping") return { id: 1, slug: "shopping", name: "Shopping" };
        if (where.slug === "other") return { id: 2, slug: "other", name: "Other" };
        return null;
      },
      findMany: async () => [
        { id: 1, slug: "shopping", name: "Shopping" },
        { id: 2, slug: "other", name: "Other" },
      ],
    },
  } as any;

  const result = await evaluateRules(
    prisma,
    { description: "Amazon order", amountCents: 2500 },
    {
      existingCategoryId: 2,
      existingCategorySource: "import",
      preloadedRules: [
        {
          name: "Amazon -> Shopping",
          conditionType: "description_contains",
          conditionValue: "Amazon",
          actionType: "set_category",
          actionValue: "shopping",
        },
        {
          name: "Fallback -> Other",
          conditionType: "description_contains",
          conditionValue: "Amazon",
          actionType: "set_category",
          actionValue: "other",
        },
      ],
    }
  );

  assert.equal(result.categoryId, 1);
  assert.equal(result.categorySource, "rule");
  assert.deepEqual(result.reasons, [
    'Rule match: "Amazon -> Shopping" set category to "shopping".',
  ]);
});
