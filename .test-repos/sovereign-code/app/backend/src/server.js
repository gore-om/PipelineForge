const cors = require("cors");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const pino = require("pino");
const pinoHttp = require("pino-http");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: ["req.headers.authorization"],
});
const port = Number(process.env.PORT || 8080);
const tokenSecret = process.env.TOKEN_SECRET || "local-dev-token-secret-change-me";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use((request, _response, next) => {
  if (request.url === "/api") {
    request.url = "/";
  } else if (request.url.startsWith("/api/")) {
    request.url = request.url.slice(4);
  }
  next();
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      monthly_budget NUMERIC(12, 2) NOT NULL DEFAULT 2500,
      currency TEXT NOT NULL DEFAULT 'USD',
      savings_goal NUMERIC(12, 2) NOT NULL DEFAULT 10000,
      preferred_category TEXT NOT NULL DEFAULT 'Food',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      weekly_digest BOOLEAN NOT NULL DEFAULT TRUE,
      spend_alerts BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      category TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  const candidate = hashPassword(password, salt).split(":")[1];
  return hash?.length === candidate.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

function signToken(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 1000 * 60 * 60 * 12 })).toString("base64url");
  const signature = crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;

    const expected = crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url");
    if (signature.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data.sub : null;
  } catch (_error) {
    return null;
  }
}

async function requireUser(request, response, next) {
  const token = request.headers.authorization?.replace("Bearer ", "");
  const userId = verifyToken(token);

  if (!userId) {
    return response.status(401).json({ message: "Please log in again." });
  }

  const result = await pool.query(
    `SELECT id, name, email, monthly_budget, currency, savings_goal, preferred_category, timezone, weekly_digest, spend_alerts, created_at
     FROM users
     WHERE id = $1`,
    [userId],
  );

  if (!result.rowCount) {
    return response.status(401).json({ message: "User account not found." });
  }

  request.user = result.rows[0];
  next();
}

function validateTransaction(body) {
  const errors = [];
  const amount = Number(body.amount);

  if (!body.description || String(body.description).trim().length < 2) {
    errors.push("Description must be at least 2 characters.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push("Amount must be greater than zero.");
  }

  if (!["income", "expense"].includes(body.type)) {
    errors.push("Type must be income or expense.");
  }

  if (!body.category || String(body.category).trim().length < 2) {
    errors.push("Category is required.");
  }

  return errors;
}

function validatePassword(password) {
  return password.length >= 8 && new Set(password).size >= 8;
}

app.get("/health", async (_request, response) => {
  await pool.query("SELECT 1");
  response.json({
    status: "ok",
    service: "ledgerly-api",
    environment: process.env.APP_ENV || "local",
    version: process.env.APP_VERSION || "dev",
  });
});

app.get("/ready", async (_request, response) => {
  await pool.query("SELECT 1");
  response.status(204).send();
});

app.post("/auth/register", async (request, response) => {
  const name = String(request.body.name || "").trim();
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");

  if (name.length < 2 || !email.includes("@") || !validatePassword(password)) {
    return response.status(400).json({ message: "Use a name, valid email, and password with at least 8 unique characters." });
  }

  const result = await pool.query(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, monthly_budget, currency, savings_goal, preferred_category, timezone, weekly_digest, spend_alerts, created_at`,
    [crypto.randomUUID(), name, email, hashPassword(password)],
  ).catch((error) => {
    if (error.code === "23505") {
      return null;
    }
    throw error;
  });

  if (!result) {
    return response.status(409).json({ message: "An account already exists for this email." });
  }

  response.status(201).json({ token: signToken(result.rows[0].id), user: result.rows[0] });
});

app.post("/auth/login", async (request, response) => {
  const email = String(request.body.email || "").trim().toLowerCase();
  const password = String(request.body.password || "");
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);

  if (!result.rowCount || !verifyPassword(password, result.rows[0].password_hash)) {
    return response.status(401).json({ message: "Invalid email or password." });
  }

  const { password_hash, ...user } = result.rows[0];
  response.json({ token: signToken(user.id), user });
});

app.get("/profile", requireUser, (request, response) => {
  response.json(request.user);
});

app.put("/profile", requireUser, async (request, response) => {
  const result = await pool.query(
    `UPDATE users
     SET name = $1,
         monthly_budget = $2,
         currency = $3,
         savings_goal = $4,
         preferred_category = $5,
         timezone = $6,
         weekly_digest = $7,
         spend_alerts = $8
     WHERE id = $9
     RETURNING id, name, email, monthly_budget, currency, savings_goal, preferred_category, timezone, weekly_digest, spend_alerts, created_at`,
    [
      String(request.body.name || request.user.name).trim(),
      Number(request.body.monthly_budget || request.user.monthly_budget),
      String(request.body.currency || request.user.currency).trim().toUpperCase(),
      Number(request.body.savings_goal || request.user.savings_goal),
      String(request.body.preferred_category || request.user.preferred_category).trim(),
      String(request.body.timezone || request.user.timezone).trim(),
      Boolean(request.body.weekly_digest),
      Boolean(request.body.spend_alerts),
      request.user.id,
    ],
  );

  response.json(result.rows[0]);
});

app.get("/transactions", requireUser, async (request, response) => {
  const result = await pool.query(`
    SELECT id, description, amount, type, category, created_at
    FROM transactions
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 50;
  `, [request.user.id]);

  response.json(result.rows);
});

app.post("/transactions", requireUser, async (request, response) => {
  const errors = validateTransaction(request.body);

  if (errors.length) {
    return response.status(400).json({ message: errors.join(" ") });
  }

  const result = await pool.query(
    `
      INSERT INTO transactions (id, user_id, description, amount, type, category)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, description, amount, type, category, created_at;
    `,
    [
      crypto.randomUUID(),
      request.user.id,
      String(request.body.description).trim(),
      Number(request.body.amount),
      request.body.type,
      String(request.body.category).trim(),
    ],
  );

  response.status(201).json(result.rows[0]);
});

app.delete("/transactions/:id", requireUser, async (request, response) => {
  const result = await pool.query("DELETE FROM transactions WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);

  if (result.rowCount === 0) {
    return response.status(404).json({ message: "Transaction not found." });
  }

  response.status(204).send();
});

app.get("/summary", requireUser, async (request, response) => {
  const totals = await pool.query(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)::float AS "totalIncome",
      COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0)::float AS "totalExpense",
      COUNT(*)::int AS "transactionCount"
    FROM transactions
    WHERE user_id = $1;
  `, [request.user.id]);

  const categories = await pool.query(`
    SELECT category, SUM(amount)::float AS total
    FROM transactions
    WHERE type = 'expense' AND user_id = $1
    GROUP BY category
    ORDER BY total DESC
    LIMIT 6;
  `, [request.user.id]);

  const row = totals.rows[0];
  response.json({
    ...row,
    netBalance: row.totalIncome - row.totalExpense,
    categories: categories.rows,
  });
});

app.use((error, _request, response, _next) => {
  logger.error(error);
  response.status(500).json({ message: "Unexpected server error." });
});

migrate()
  .then(() => {
    app.listen(port, () => logger.info({ port }, "ledgerly-api started"));
  })
  .catch((error) => {
    logger.error(error, "database migration failed");
    process.exit(1);
  });
