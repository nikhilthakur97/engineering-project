# Soraban — Scalable Bookkeeping System

A full-stack bookkeeping application with automated categorization, anomaly detection, and performance optimized to handle 1 million+ transactions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js, Express 5, TypeScript |
| **ORM** | Prisma 7 with PostgreSQL adapter |
| **Database** | PostgreSQL |
| **Frontend** | React 19, TypeScript, Vite 8 |
| **Styling** | Tailwind CSS 4 |
| **State/Data** | TanStack React Query, Axios |
| **Charts** | Recharts |
| **Routing** | React Router 7 |

## Prerequisites

- **Node.js** v18 or higher
- **PostgreSQL** running locally (v14+ recommended)
- **npm** (comes with Node.js)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/nikhilthakur97/engineering-project.git
cd engineering-project
```

### 2. Set up the backend

```bash
cd backend
npm install
```

Create a `.env` file (or copy the example):

```bash
cp .env.example .env
```

Edit `.env` and set your PostgreSQL connection string:

```
DATABASE_URL="postgresql://YOUR_USER@localhost:5432/soraban_bookkeeping"
PORT=3001
```

Create the database if it doesn't exist:

```bash
createdb soraban_bookkeeping
```

Run migrations and seed data:

```bash
npx prisma migrate deploy
npm run db:seed
```

This creates the tables, indexes, and seeds 10 categories + 18 categorization rules.

Start the backend:

```bash
npm run dev
```

The API runs at **http://localhost:3001**.

### 3. Set up the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The app runs at **http://localhost:5173**.

### 4. Open the application

Go to **http://localhost:5173** in your browser.

## Available Scripts

### Backend (`cd backend`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled production build |
| `npm test` | Run unit tests |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:seed` | Seed categories and rules |
| `npm run db:seed:1m` | Generate 1,000,000 test transactions for scalability testing |
| `npm run db:reset` | Reset database (drops all data, re-runs migrations) |

### Frontend (`cd frontend`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview production build |

## Project Structure

```
engineering-project/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma            # Database schema (models, indexes)
│   │   ├── seed.ts                  # Seeds categories + rules
│   │   ├── seed-1m.ts              # Generates 1m test transactions
│   │   └── migrations/             # SQL migrations
│   └── src/
│       ├── index.ts                 # Express app entry point
│       ├── db.ts                    # Prisma client + pg pool setup
│       ├── routes/
│       │   ├── transactions.ts      # CRUD, CSV import, bulk actions
│       │   ├── categories.ts        # Category listing
│       │   ├── rules.ts             # Rule CRUD + apply all rules
│       │   └── dashboard.ts         # Summary counts + spending chart
│       ├── services/
│       │   ├── csvImporter.ts       # CSV parsing, validation, batch import
│       │   ├── ruleEngine.ts        # Rule evaluation + auto-categorization
│       │   ├── anomalyDetector.ts   # Anomaly detection (single + batch)
│       │   ├── csvImporter.test.ts  # CSV importer tests
│       │   ├── ruleEngine.test.ts   # Rule engine tests
│       │   └── anomalyDetector.test.ts # Anomaly detector tests
│       └── middleware/
│           └── errorHandler.ts      # Global error handling
├── frontend/
│   └── src/
│       ├── App.tsx                  # Layout with sidebar navigation
│       ├── main.tsx                 # React entry + QueryClient setup
│       ├── lib/
│       │   └── api.ts              # Axios client + API functions
│       ├── pages/
│       │   ├── Dashboard.tsx        # Review dashboard with tabs + chart
│       │   ├── Transactions.tsx     # Transaction list with filters
│       │   └── Rules.tsx            # Rule management
│       └── components/
│           ├── TransactionForm.tsx   # Add/edit transaction form
│           ├── CsvUpload.tsx        # CSV drag-and-drop uploader
│           ├── AnomalyBadge.tsx     # Colored anomaly flag badges
│           ├── ReviewReasons.tsx    # Expandable review reason list
│           └── SpendingChart.tsx    # Monthly spending bar chart
└── sample/
    ├── valid.csv                    # 20 clean sample transactions
    └── edge-cases.csv              # CSV with intentional errors for testing
```

## Features

### 1. Record & Import Transactions

**Manual entry:** Users add transactions via a form with date, description, amount, and optional category fields.

**CSV import:** Drag and drop or browse to upload a CSV file. The importer:
- Recognizes multiple column name formats (e.g., `payee` → `description`, `credit`/`debit` → amount)
- Validates each row (date format, amount parsing, required fields)
- Handles edge cases: missing fields, malformed data, currency symbols, commas in numbers
- Detects duplicates within the file (Set-based O(1) lookup)
- Detects duplicates against existing database records (chunked queries)
- Shows real-time progress with a progress bar (phases: validating, deduplicating, inserting, detecting anomalies)
- Reports results: imported count, skipped count, failed count with per-row error messages

### 2. Bulk Actions & Rule-Based Categorization

**Bulk actions:** Select multiple transactions using checkboxes and:
- Bulk categorize — assign a category to all selected transactions at once
- Bulk approve — clear flags and mark as reviewed
- Bulk delete — remove selected transactions

**Rules engine:** Users create rules on the Rules page with:
- **Conditions:** description contains, description equals, amount greater than, amount less than, amount equals
- **Actions:** set category, add flag
- **Priority:** rules execute in priority order; first matching category rule wins
- **Auto-apply:** rules run automatically when transactions are created or imported
- **Re-run:** "Re-run All Rules" button applies all rules to existing transactions
- **Toggle:** enable/disable individual rules without deleting them

18 rules come pre-seeded covering common merchants (Amazon, Walmart, Uber, Netflix, Starbucks, etc.) and value-based flags (high_value for >$1,000, very_high_value for >$10,000, micro_transaction for <$1).

### 3. Anomaly Detection & Fraud Prevention

Three types of anomalies are detected automatically:

**Unusual amount:** Calculates the mean and standard deviation of recent transactions (last 1,000). If a transaction's amount is more than 3 standard deviations from the average, it is flagged. Stats are computed both globally and per-category for better accuracy.

**Potential duplicates:** Transactions with the same date, same amount, and similar descriptions (exact match or substring match) are flagged as possible duplicates.

**Incomplete metadata:** Transactions missing a description are flagged as incomplete.

**Batch processing:** During CSV import, anomaly detection runs in batch mode — processes 5,000 transactions per chunk, pre-computes statistics once, uses Map-based O(1) duplicate lookups, and groups database updates by flag combination for bulk SQL execution.

Each flagged transaction includes human-readable review reasons explaining why it was flagged.

### 4. Scalability & Performance Optimization

The system is optimized to handle **1,000,000+ transactions** efficiently.

**To test with 1 million transactions:**

```bash
cd backend
npm run db:seed:1m
```

This generates 1,000,000 realistic transactions in ~27 seconds (~37,000 rows/sec).

**Benchmark results with 1,037,446 transactions:**

| Operation | Response Time |
|-----------|--------------|
| Dashboard summary (first load) | ~450ms |
| Dashboard summary (cached) | ~11ms |
| Transaction list (50 rows, paginated) | ~24ms |
| Text search ("Amazon" across 1m rows) | ~19ms |
| Filter by flagged | ~13ms |
| Filter by uncategorized | ~13ms |
| Spending chart (24 months, aggregation) | ~780ms |

#### Indexing

**B-tree indexes** on frequently queried columns:
- `date` — date range filters
- `category_id` — category filter
- `needs_review` — review status filter
- `(date, amount_cents)` — composite for deduplication queries
- `amount_cents` — anomaly detection range queries

**GIN indexes** for array column operations:
- `anomaly_flags` — fast `isEmpty` / `has` filtering for flagged transactions
- `review_reasons` — fast array filtering

**Trigram index** for text search:
- `description` with `gin_trgm_ops` — enables fast `ILIKE` (case-insensitive substring) searches without full table scans

**Partial index** for common filtered counts:
- `id WHERE category_id IS NULL` — speeds up uncategorized transaction counts

#### Caching

- **Dashboard summary:** in-memory cache with 5-second TTL prevents running 4 COUNT queries on every frontend poll (polls every 10 seconds)
- **Category resolution:** in-memory cache with 60-second TTL in the rule engine reduces repeated database lookups during rule evaluation

#### Batch Processing

- **CSV inserts:** batches of 500 rows via `createManyAndReturn`
- **Database deduplication:** chunked queries of 500 to avoid exceeding PostgreSQL parameter limits
- **Anomaly detection:** processes 5,000 transactions per chunk with pre-computed statistics
- **Bulk updates:** groups anomaly flag updates by flag combination, executes one UPDATE per unique combination using raw SQL with `ANY()` arrays

#### Cursor-Based Pagination

All transaction lists use cursor-based pagination (not offset-based). This ensures consistent performance regardless of how deep into the dataset the user navigates. Page size is 50 with a maximum of 200 per request.

### 5. Review System & Dashboard

**Summary cards:** Total transactions, Uncategorized, Flagged, and Needs Review — clickable to filter the table below.

**Tabs:**
- **Uncategorized** — transactions without a category, needing manual classification
- **Flagged Anomalies** — transactions with anomaly flags (unusual amount, duplicate, incomplete)
- **Needs Review** — all transactions requiring attention (uncategorized + flagged)

**Per-transaction actions:**
- **Approve** — clears all flags and marks as reviewed
- **Edit** — inline editing of date, description, amount, category
- **Delete** — remove with confirmation

**Bulk actions bar:** appears when transactions are selected, with categorize, approve, and delete options.

**Spending chart:** monthly spending by category using Recharts, aggregated via raw SQL.

## API Endpoints

### Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/transactions` | List transactions (cursor pagination, filters) |
| `GET` | `/api/transactions/:id` | Get single transaction |
| `POST` | `/api/transactions` | Create transaction (auto-applies rules + anomaly detection) |
| `PUT` | `/api/transactions/:id` | Update transaction |
| `DELETE` | `/api/transactions/:id` | Delete transaction |
| `PATCH` | `/api/transactions/bulk` | Bulk categorize, approve, re-run rules, or delete |
| `POST` | `/api/transactions/import` | Import CSV file (multipart form) |
| `GET` | `/api/transactions/import/progress` | Poll import progress |

**Query parameters for `GET /api/transactions`:**
- `limit` — page size (default 50, max 200)
- `cursor` — transaction ID for cursor pagination
- `search` — ILIKE search on description
- `categoryId` — filter by category (use `null` for uncategorized)
- `needsReview` — `true` or `false`
- `flagged` — `true` to show only flagged transactions
- `anomalyFlag` — filter by specific flag (e.g., `high_value`)
- `dateFrom` / `dateTo` — date range filter

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/categories` | List all categories |

### Rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rules` | List all rules |
| `POST` | `/api/rules` | Create a rule |
| `PUT` | `/api/rules/:id` | Update a rule |
| `DELETE` | `/api/rules/:id` | Delete a rule |
| `POST` | `/api/rules/apply` | Re-apply all rules to existing transactions |

### Dashboard

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dashboard/summary` | Summary counts (cached) |
| `GET` | `/api/dashboard/spending?months=N` | Monthly spending by category |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |

## Database Schema

### Categories
| Column | Type | Notes |
|--------|------|-------|
| id | serial | Primary key |
| name | varchar(100) | Unique |
| slug | varchar(100) | Unique, URL-friendly |
| created_at | timestamp | Auto-set |

### Transactions
| Column | Type | Notes |
|--------|------|-------|
| id | serial | Primary key |
| date | date | Transaction date |
| description | text | Nullable |
| amount_cents | integer | Amount in cents (avoids floating-point issues) |
| category_id | integer | FK to categories, nullable |
| category_source | varchar(20) | `manual`, `import`, or `rule` |
| anomaly_flags | text[] | Array of flag strings |
| review_reasons | text[] | Human-readable reasons |
| needs_review | boolean | Whether transaction needs attention |
| created_at | timestamp | Auto-set |
| updated_at | timestamp | Auto-updated |

### Rules
| Column | Type | Notes |
|--------|------|-------|
| id | serial | Primary key |
| name | varchar(255) | Display name |
| condition_type | varchar(50) | `description_contains`, `amount_gt`, etc. |
| condition_value | text | Value to match against |
| action_type | varchar(50) | `set_category` or `add_flag` |
| action_value | text | Category slug or flag name |
| priority | integer | Lower = higher priority |
| active | boolean | Enable/disable without deleting |
| created_at | timestamp | Auto-set |

## Sample CSV Files

Two sample CSV files are included in the `sample/` directory:

**`valid.csv`** — 20 clean transactions with proper dates, amounts, descriptions, and categories.

**`edge-cases.csv`** — Intentionally problematic data to test edge case handling:
- Invalid dates
- Missing descriptions
- Missing amounts
- Non-numeric amounts
- Dollar signs and commas in amounts
- Duplicate rows
- Unknown category names
- Empty category fields
- Negative amounts
- Extra whitespace

## Running Tests

```bash
cd backend
npm test
```

Tests cover the CSV importer, rule engine, and anomaly detector services.
