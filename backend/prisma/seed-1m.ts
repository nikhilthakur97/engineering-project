import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const TOTAL = 1_000_000;
const BATCH = 1_000;

const descriptions = [
  "Amazon - Office Supplies",
  "Walmart Grocery",
  "Uber Trip",
  "Netflix Subscription",
  "Starbucks Coffee",
  "Rent Payment",
  "Salary Deposit",
  "ATM Withdrawal",
  "Gas Station Fill-up",
  "Lyft Ride",
  "Spotify Premium",
  "Gym Membership",
  "Electric Bill Payment",
  "Water Bill Payment",
  "Tax Payment",
  "Interest Earned",
  "Freelance Invoice",
  "Restaurant Dinner",
  "Target Household Items",
  "Apple Store Purchase",
  "Home Depot Tools",
  "Insurance Premium",
  "Phone Bill",
  "Internet Bill",
  "Pet Store Supplies",
  "Pharmacy CVS",
  "Doctor Visit Copay",
  "Parking Garage",
  "Toll Road Fee",
  "Airline Ticket",
];

const categorySlugMap: Record<string, string> = {
  "Amazon - Office Supplies": "shopping",
  "Walmart Grocery": "shopping",
  "Uber Trip": "transportation",
  "Netflix Subscription": "subscriptions",
  "Starbucks Coffee": "food-dining",
  "Rent Payment": "rent-housing",
  "Salary Deposit": "income",
  "ATM Withdrawal": "other",
  "Gas Station Fill-up": "transportation",
  "Lyft Ride": "transportation",
  "Spotify Premium": "subscriptions",
  "Gym Membership": "healthcare",
  "Electric Bill Payment": "utilities",
  "Water Bill Payment": "utilities",
  "Tax Payment": "utilities",
  "Interest Earned": "income",
  "Freelance Invoice": "income",
  "Restaurant Dinner": "food-dining",
  "Target Household Items": "shopping",
  "Apple Store Purchase": "shopping",
  "Home Depot Tools": "shopping",
  "Insurance Premium": "utilities",
  "Phone Bill": "utilities",
  "Internet Bill": "utilities",
  "Pet Store Supplies": "shopping",
  "Pharmacy CVS": "healthcare",
  "Doctor Visit Copay": "healthcare",
  "Parking Garage": "transportation",
  "Toll Road Fee": "transportation",
  "Airline Ticket": "transportation",
};

function randomDate(): string {
  const start = new Date("2021-01-01");
  const end = new Date("2026-03-22");
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return d.toISOString().split("T")[0];
}

function randomAmount(): number {
  const r = Math.random();
  if (r < 0.6) return Math.round((Math.random() * 200 + 1) * 100);
  if (r < 0.9) return Math.round((Math.random() * 2000 + 200) * 100);
  if (r < 0.98) return Math.round((Math.random() * 10000 + 2000) * 100);
  return Math.round((Math.random() * 50000 + 10000) * 100);
}

async function main() {
  const start = Date.now();
  console.log(`Seeding ${TOTAL.toLocaleString()} transactions...`);

  // Load category IDs
  const catRows = await pool.query("SELECT id, slug FROM categories");
  const catMap = new Map<string, number>();
  for (const r of catRows.rows) catMap.set(r.slug, r.id);

  if (catMap.size === 0) {
    console.error("No categories found. Run `npm run db:seed` first.");
    process.exit(1);
  }

  let inserted = 0;

  for (let batch = 0; batch < TOTAL; batch += BATCH) {
    const size = Math.min(BATCH, TOTAL - batch);
    const values: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    for (let i = 0; i < size; i++) {
      const desc = descriptions[Math.floor(Math.random() * descriptions.length)];
      const date = randomDate();
      const amountCents = randomAmount();
      const slug = categorySlugMap[desc];
      const catId = slug ? catMap.get(slug) ?? null : null;
      const isHighValue = amountCents > 100000;
      const isVeryHigh = amountCents > 1000000;

      const flags: string[] = [];
      const reasons: string[] = [];
      if (isVeryHigh) { flags.push("very_high_value"); reasons.push("Rule match: Very High Value — add flag very_high_value"); }
      if (isHighValue) { flags.push("high_value"); reasons.push("Rule match: High Value Transaction — add flag high_value"); }

      const needsReview = flags.length > 0 || catId === null;

      values.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}::text[], $${paramIdx + 6}::text[], $${paramIdx + 7}, NOW(), NOW())`
      );
      params.push(date, desc, amountCents, catId, "rule", flags, reasons, needsReview);
      paramIdx += 8;
    }

    await pool.query(
      `INSERT INTO transactions (date, description, amount_cents, category_id, category_source, anomaly_flags, review_reasons, needs_review, created_at, updated_at)
       VALUES ${values.join(", ")}`,
      params
    );

    inserted += size;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const rate = Math.round(inserted / ((Date.now() - start) / 1000));
    console.log(`  ${inserted.toLocaleString()} / ${TOTAL.toLocaleString()} (${elapsed}s, ${rate.toLocaleString()} rows/s)`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone! Inserted ${inserted.toLocaleString()} transactions in ${elapsed}s`);

  // Verify count
  const countResult = await pool.query("SELECT COUNT(*) FROM transactions");
  console.log(`Total transactions in DB: ${Number(countResult.rows[0].count).toLocaleString()}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => pool.end());
