import test from "node:test";
import assert from "node:assert/strict";
import { detectAnomalies } from "./anomalyDetector";

test("detectAnomalies returns explainable duplicate and incomplete reasons", async () => {
  const prisma = {
    transaction: {
      findMany: async ({ select }: { select?: { id?: boolean } }) => {
        if (select?.id) {
          return [{ id: 10, description: "" }];
        }
        return Array.from({ length: 10 }, () => ({ amountCents: 1000 }));
      },
    },
  } as any;

  const result = await detectAnomalies(prisma, {
    id: 11,
    date: new Date("2026-03-22"),
    description: "",
    amountCents: 1000,
    categoryId: null,
  });

  assert.deepEqual(result.flags.sort(), ["incomplete", "possible_duplicate"]);
  assert.equal(
    result.reasons.includes("Anomaly: missing description metadata."),
    true
  );
  assert.equal(
    result.reasons.includes(
      "Anomaly: possible duplicate with the same date, amount, and similar description."
    ),
    true
  );
});

test("detectAnomalies includes z-score context for unusual amounts", async () => {
  const prisma = {
    transaction: {
      findMany: async ({ select }: { select?: { id?: boolean } }) => {
        if (select?.id) return [];
        return [
          { amountCents: 1000 },
          { amountCents: 1020 },
          { amountCents: 980 },
          { amountCents: 1010 },
          { amountCents: 995 },
          { amountCents: 1005 },
          { amountCents: 990 },
          { amountCents: 1015 },
          { amountCents: 985 },
          { amountCents: 1000 },
        ];
      },
    },
  } as any;

  const result = await detectAnomalies(prisma, {
    date: new Date("2026-03-22"),
    description: "Laptop",
    amountCents: 100000,
    categoryId: 5,
  });

  assert.equal(result.flags.includes("unusual_amount"), true);
  assert.equal(
    result.reasons.some((reason) =>
      reason.startsWith("Anomaly: amount is ") && reason.includes("category average")
    ),
    true
  );
});
