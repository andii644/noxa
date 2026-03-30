const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb"); // 🔥 NEU

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data.json");

// 🔥 DEIN MONGO STRING
const uri = "mongodb+srv://ananassosse:Einstellung1%21@cluster0.8qjy2xi.mongodb.net/noxa?retryWrites=true&w=majority";

const client = new MongoClient(uri);
let usersCollection;

// 🔥 CONNECT
async function connectDB() {
  await client.connect();
  const db = client.db("noxa");
  usersCollection = db.collection("users");
  console.log("MongoDB connected 🔥");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "noxa-super-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

function getDefaultUserData(overrides = {}) {
  return {
    coins: 0,
    money: 0,
    coinMultiplier: 1,
    idleLevel: 1,
    lootboxes: 0,
    totalClicks: 0,
    role: "user",
    ...overrides
  };
}

// 🔥 HIER KOMMT DER MAGIC REPLACE

async function readData() {
  const users = await usersCollection.find().toArray();
  return { users };
}

async function writeData(data) {
  // Mongo handled das automatisch → nichts nötig
}

function getSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    coins: user.coins,
    money: user.money,
    coinMultiplier: user.coinMultiplier,
    idleLevel: user.idleLevel,
    lootboxes: user.lootboxes,
    totalClicks: user.totalClicks,
    role: user.role
  };
}

async function ensureAdminExists() {
  let admin = await usersCollection.findOne({ username: "admin" });

  if (!admin) {
    const passwordHash = await bcrypt.hash("admin123", 10);

    await usersCollection.insertOne({
      id: 1,
      username: "admin",
      passwordHash,
      displayName: "Admin",
      ...getDefaultUserData({ role: "admin" })
    });

    console.log("Admin erstellt: admin / admin123");
  }
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Nicht eingeloggt" });
  }
  next();
}

async function requireAdmin(req, res, next) {
  const user = await usersCollection.findOne({ id: req.session.userId });

  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Keine Admin-Rechte" });
  }

  next();
}

// ================= REGISTER =================
app.post("/api/register", async (req, res) => {
  try {
    const { username, password, displayName } = req.body;

    const exists = await usersCollection.findOne({
      username: username.toLowerCase()
    });

    if (exists) {
      return res.status(400).json({ error: "Username existiert schon" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const lastUser = await usersCollection.find().sort({ id: -1 }).limit(1).toArray();
    const nextId = lastUser.length ? lastUser[0].id + 1 : 1;

    const newUser = {
      id: nextId,
      username,
      passwordHash,
      displayName: displayName || username,
      ...getDefaultUserData()
    };

    await usersCollection.insertOne(newUser);

    req.session.userId = newUser.id;

    res.json({ success: true, user: getSafeUser(newUser) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

// ================= LOGIN =================
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await usersCollection.findOne({
      username: username.toLowerCase()
    });

    if (!user) {
      return res.status(400).json({ error: "Falsche Login-Daten" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);

    if (!ok) {
      return res.status(400).json({ error: "Falsche Login-Daten" });
    }

    req.session.userId = user.id;

    res.json({
      success: true,
      user: getSafeUser(user)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

// ================= LOGOUT =================
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ================= ME =================
app.get("/api/me", requireAuth, async (req, res) => {
  const user = await usersCollection.findOne({ id: req.session.userId });

  if (!user) {
    return res.status(404).json({ error: "User nicht gefunden" });
  }

  res.json({ user: getSafeUser(user) });
});

// ================= SAVE =================
app.post("/api/save-progress", requireAuth, async (req, res) => {
  const updates = req.body;

  await usersCollection.updateOne(
    { id: req.session.userId },
    { $set: updates }
  );

  const user = await usersCollection.findOne({ id: req.session.userId });

  res.json({
    success: true,
    user: getSafeUser(user)
  });
});

// ================= LEADERBOARD =================
app.get("/api/leaderboard", requireAuth, async (req, res) => {
  const users = await usersCollection.find().sort({ coins: -1 }).toArray();

  res.json({ leaderboard: users.map(getSafeUser) });
});

// ================= START =================
app.listen(PORT, async () => {
  await connectDB();
  await ensureAdminExists();
  console.log(`Server läuft auf http://localhost:${PORT}`);
});