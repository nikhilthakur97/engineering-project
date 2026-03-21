import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

async function main() {
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
  }
  console.log(`Seeded ${categories.length} categories`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
