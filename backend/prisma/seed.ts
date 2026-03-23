import "dotenv/config";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const categories = [
  { name: "Shopping", slug: "shopping" },
  { name: "Food & Dining", slug: "food-dining" },
  { name: "Transportation", slug: "transportation" },
  { name: "Utilities", slug: "utilities" },
  { name: "Entertainment", slug: "entertainment" },
  { name: "Healthcare", slug: "healthcare" },
  { name: "Income", slug: "income" },
  { name: "Rent & Housing", slug: "rent-housing" },
  { name: "Subscriptions", slug: "subscriptions" },
  { name: "Other", slug: "other" },
];

const rules = [
  {
    name: "Amazon → Shopping",
    conditionType: "description_contains",
    conditionValue: "Amazon",
    actionType: "set_category",
    actionValue: "shopping",
    priority: 1,
  },
  {
    name: "Walmart → Shopping",
    conditionType: "description_contains",
    conditionValue: "Walmart",
    actionType: "set_category",
    actionValue: "shopping",
    priority: 2,
  },
  {
    name: "Uber → Transportation",
    conditionType: "description_contains",
    conditionValue: "Uber",
    actionType: "set_category",
    actionValue: "transportation",
    priority: 3,
  },
  {
    name: "Netflix → Subscriptions",
    conditionType: "description_contains",
    conditionValue: "Netflix",
    actionType: "set_category",
    actionValue: "subscriptions",
    priority: 4,
  },
  {
    name: "Starbucks → Food & Dining",
    conditionType: "description_contains",
    conditionValue: "Starbucks",
    actionType: "set_category",
    actionValue: "food-dining",
    priority: 5,
  },
  {
    name: "High Value Transaction",
    conditionType: "amount_gt",
    conditionValue: "1000",
    actionType: "add_flag",
    actionValue: "high_value",
    priority: 10,
  },
  {
    name: "ATM → Other",
    conditionType: "description_contains",
    conditionValue: "ATM",
    actionType: "set_category",
    actionValue: "other",
    priority: 6,
  },
  {
    name: "Interest → Income",
    conditionType: "description_contains",
    conditionValue: "Interest",
    actionType: "set_category",
    actionValue: "income",
    priority: 7,
  },
  {
    name: "Tax → Utilities",
    conditionType: "description_contains",
    conditionValue: "Tax",
    actionType: "set_category",
    actionValue: "utilities",
    priority: 8,
  },
  {
    name: "Bill → Utilities",
    conditionType: "description_contains",
    conditionValue: "Bill",
    actionType: "set_category",
    actionValue: "utilities",
    priority: 9,
  },
  {
    name: "Rent → Rent & Housing",
    conditionType: "description_contains",
    conditionValue: "Rent",
    actionType: "set_category",
    actionValue: "rent-housing",
    priority: 11,
  },
  {
    name: "Salary → Income",
    conditionType: "description_contains",
    conditionValue: "Salary",
    actionType: "set_category",
    actionValue: "income",
    priority: 12,
  },
  {
    name: "Gym → Healthcare",
    conditionType: "description_contains",
    conditionValue: "Gym",
    actionType: "set_category",
    actionValue: "healthcare",
    priority: 13,
  },
  {
    name: "Gas Station → Transportation",
    conditionType: "description_contains",
    conditionValue: "Gas Station",
    actionType: "set_category",
    actionValue: "transportation",
    priority: 14,
  },
  {
    name: "Lyft → Transportation",
    conditionType: "description_contains",
    conditionValue: "Lyft",
    actionType: "set_category",
    actionValue: "transportation",
    priority: 15,
  },
  {
    name: "Spotify → Subscriptions",
    conditionType: "description_contains",
    conditionValue: "Spotify",
    actionType: "set_category",
    actionValue: "subscriptions",
    priority: 16,
  },
  {
    name: "Very High Value",
    conditionType: "amount_gt",
    conditionValue: "10000",
    actionType: "add_flag",
    actionValue: "very_high_value",
    priority: 17,
  },
  {
    name: "Micro Transaction",
    conditionType: "amount_lt",
    conditionValue: "1",
    actionType: "add_flag",
    actionValue: "micro_transaction",
    priority: 18,
  },
];

async function main() {
  for (const category of categories) {
    await pool.query(
      `
        INSERT INTO categories (name, slug)
        VALUES ($1, $2)
        ON CONFLICT (slug) DO NOTHING
      `,
      [category.name, category.slug]
    );
  }
  console.log(`Seeded ${categories.length} categories`);

  let rulesInserted = 0;
  for (const rule of rules) {
    const exists = await pool.query(
      `SELECT 1 FROM rules WHERE name = $1 LIMIT 1`,
      [rule.name]
    );
    if (exists.rows.length === 0) {
      await pool.query(
        `INSERT INTO rules (name, condition_type, condition_value, action_type, action_value, priority, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [rule.name, rule.conditionType, rule.conditionValue, rule.actionType, rule.actionValue, rule.priority]
      );
      rulesInserted++;
    }
  }
  console.log(`Seeded ${rulesInserted} rules (${rules.length - rulesInserted} already existed)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
