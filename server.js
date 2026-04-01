// ====================== ENV & IMPORTS ======================
require('dotenv').config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = 3000;

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("❌ MONGO_URI ist nicht gesetzt!");
  process.exit(1);
}

const client = new MongoClient(uri);
let usersCollection;

// ================= ITEMS =================
const ITEMS = [
  { name: "Normal Scrap", rarity: "common", value: 18, type: "sellable", dmgBonus: 0, hpBonus: 0, defenseBonus: 0 },
  { name: "Slime Scrap", rarity: "common", value: 28, type: "sellable", dmgBonus: 0, hpBonus: 0, defenseBonus: 0 },
  { name: "Green Shard", rarity: "uncommon", value: 55, type: "sellable", dmgBonus: 0, hpBonus: 0, defenseBonus: 0 },
  { name: "Blue Shard", rarity: "rare", value: 95, type: "sellable", dmgBonus: 0, hpBonus: 0, defenseBonus: 0 },
  { name: "Gray NOXA Cap", rarity: "gray", value: 220, slot: "cap", dmgBonus: 4, hpBonus: 20, defenseBonus: 6, upgradeLevel: 0 },
  { name: "Gray NOXA Shirt", rarity: "gray", value: 310, slot: "shirt", dmgBonus: 7, hpBonus: 35, defenseBonus: 9, upgradeLevel: 0 },
  { name: "Gray NOXA Pants", rarity: "gray", value: 420, slot: "pants", dmgBonus: 6, hpBonus: 30, defenseBonus: 8, upgradeLevel: 0 },
  { name: "Gray NOXA Shoes", rarity: "gray", value: 280, slot: "shoes", dmgBonus: 5, hpBonus: 25, defenseBonus: 7, upgradeLevel: 0 }
];

// ================= DB CONNECT =================
async function connectDB() {
  await client.connect();
  const db = client.db("noxa");
  usersCollection = db.collection("users");
  console.log("MongoDB connected 🔥");
}

// ================= HELPERS =================
function getDefaultUserData(overrides = {}) {
  return {
    coins: 0,
    dmg: 1,
    maxHp: 100,
    currentHp: 100,
    defense: 0,
    xp: 0,
    level: 1,
    idleLevel: 1,
    lootboxes: 0,
    totalKills: 0,
    role: "user",
    inventory: [],
    equipped: { cap: null, shirt: null, pants: null, shoes: null },
    lastUpdated: new Date(),
    ...overrides
  };
}

function getSafeUser(user) {
  const totalDefense = 
    (user.equipped?.cap?.defenseBonus || 0) +
    (user.equipped?.shirt?.defenseBonus || 0) +
    (user.equipped?.pants?.defenseBonus || 0) +
    (user.equipped?.shoes?.defenseBonus || 0);

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    coins: user.coins,
    dmg: user.dmg,
    maxHp: user.maxHp,
    currentHp: user.currentHp,
    defense: totalDefense,
    xp: user.xp,
    level: user.level,
    lootboxes: user.lootboxes,
    totalKills: user.totalKills,
    inventory: user.inventory || [],
    equipped: user.equipped || { cap: null, shirt: null, pants: null, shoes: null }
  };
}

// ================= SHARD COUNT HELPER =================
function countItemInInventory(inventory, name) {
  return inventory.reduce((total, item) => {
    if (item.name === name) return total + (item.quantity || 1);
    return total;
  }, 0);
}

// ================= ITEM STACKING =================
async function addItemToInventory(userId, baseItem) {
  let user = await usersCollection.findOne({ id: userId });
  if (!user) return;

  const itemKey = `${baseItem.name}|${baseItem.rarity}|${baseItem.upgradeLevel || 0}`;
  const existingIndex = user.inventory.findIndex(i => 
    `${i.name}|${i.rarity}|${i.upgradeLevel || 0}` === itemKey
  );

  if (existingIndex !== -1) {
    user.inventory[existingIndex].quantity = (user.inventory[existingIndex].quantity || 1) + 1;
    await usersCollection.updateOne({ id: userId }, { $set: { inventory: user.inventory } });
  } else {
    const newItem = { ...baseItem, id: Date.now() + Math.floor(Math.random() * 100000), quantity: 1 };
    await usersCollection.updateOne({ id: userId }, { $push: { inventory: newItem } });
  }
}

// ================= IDLE SYSTEM =================
async function refreshUser(userId) {
  let user = await usersCollection.findOne({ id: userId });
  if (!user) return null;

  const now = new Date();
  const lastUpdated = user.lastUpdated ? new Date(user.lastUpdated) : now;
  const secondsPassed = (now - lastUpdated) / 1000;

  if (secondsPassed > 0) {
    const idlePerSecond = (user.idleLevel || 1) * 0.25;
    const earnings = secondsPassed * idlePerSecond;
    if (earnings > 0) {
      await usersCollection.updateOne({ id: userId }, { $inc: { coins: earnings }, $set: { lastUpdated: now } });
    }
  }
  return await usersCollection.findOne({ id: userId });
}

// ================= ADMIN =================
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
    console.log("✅ Admin erstellt: admin / admin123");
  }
}

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Nicht eingeloggt" });
  next();
}

// ================= AUTH =================
app.post("/api/register", async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || username.trim().length < 3) return res.status(400).json({ error: "Username muss mindestens 3 Zeichen lang sein!" });
    if (!password || password.length < 6) return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen lang sein!" });

    const exists = await usersCollection.findOne({ username: username.toLowerCase() });
    if (exists) return res.status(400).json({ error: "Username existiert schon" });

    const passwordHash = await bcrypt.hash(password, 10);
    const lastUser = await usersCollection.find().sort({ id: -1 }).limit(1).toArray();
    const nextId = lastUser.length ? lastUser[0].id + 1 : 1;

    const newUser = { id: nextId, username: username.toLowerCase(), passwordHash, displayName: displayName || username, ...getDefaultUserData() };
    await usersCollection.insertOne(newUser);
    req.session.userId = newUser.id;
    res.json({ success: true, user: getSafeUser(newUser) });
  } catch (err) {
    res.status(500).json({ error: "Serverfehler" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await usersCollection.findOne({ username: username.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(400).json({ error: "Falsche Login-Daten" });
    req.session.userId = user.id;
    const freshUser = await refreshUser(user.id);
    res.json({ success: true, user: getSafeUser(freshUser) });
  } catch {
    res.status(500).json({ error: "Serverfehler" });
  }
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ success: true })));

app.get("/api/me", requireAuth, async (req, res) => {
  const user = await refreshUser(req.session.userId);
  res.json({ user: getSafeUser(user) });
});

// ================= COMBAT & LEVEL SYSTEM =================
app.post("/api/kill-mob", requireAuth, async (req, res) => {
  let user = await refreshUser(req.session.userId);
  const gold = Math.floor(12 + Math.random() * 18);
  const xpGain = 15;

  let newXp = (user.xp || 0) + xpGain;
  let newLevel = user.level || 1;
  let levelsGained = 0;

  while (newXp >= newLevel * 60) {
    newXp -= newLevel * 60;
    newLevel++;
    levelsGained++;
  }

  const scrap = ITEMS.find(i => i.name === "Slime Scrap");
  await addItemToInventory(req.session.userId, scrap);

  await usersCollection.updateOne({ id: req.session.userId }, {
    $inc: { coins: gold, totalKills: 1 },
    $set: { level: newLevel, xp: newXp }
  });

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user), leveledUp: levelsGained > 0, levelsGained, xpGain });
});

app.post("/api/apply-level-bonus", requireAuth, async (req, res) => {
  const { choice } = req.body;
  let user = await refreshUser(req.session.userId);

  if (choice === "dmg") {
    await usersCollection.updateOne({ id: req.session.userId }, { $inc: { dmg: 1 } });
  } else if (choice === "hp") {
    await usersCollection.updateOne({ id: req.session.userId }, { $inc: { maxHp: 15, currentHp: 15 } });
  }

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user) });
});

app.post("/api/take-damage", requireAuth, async (req, res) => {
  const { damage } = req.body;
  let user = await refreshUser(req.session.userId);
  let newHp = Math.max(0, (user.currentHp || 100) - damage);

  await usersCollection.updateOne({ id: req.session.userId }, { $set: { currentHp: newHp, lastUpdated: new Date() } });

  user = await usersCollection.findOne({ id: req.session.userId });
  res.json({ success: true, user: getSafeUser(user), isDead: newHp <= 0 });
});

app.post("/api/respawn", requireAuth, async (req, res) => {
  let user = await refreshUser(req.session.userId);
  const lostCoins = Math.floor((user.coins || 0) * 0.25);

  await usersCollection.updateOne({ id: req.session.userId }, {
    $inc: { coins: -lostCoins },
    $set: { currentHp: user.maxHp || 100, lastUpdated: new Date() }
  });

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user), lostCoins });
});

// ================= LOOTBOXEN =================
function getRandomLootItem() {
  const roll = Math.random() * 100;
  if (roll < 50) return ITEMS[0];
  if (roll < 75) return ITEMS[1];
  if (roll < 91) return ITEMS[2];
  if (roll < 96) return ITEMS[3];
  const gear = ITEMS.slice(4);
  return gear[Math.floor(Math.random() * gear.length)];
}

app.post("/api/open-starter-box", requireAuth, async (req, res) => {
  let user = await refreshUser(req.session.userId);
  if ((user.coins || 0) < 100) return res.status(400).json({ error: "Zu wenig Coins" });

  const base = getRandomLootItem();
  await addItemToInventory(req.session.userId, base);

  await usersCollection.updateOne({ id: req.session.userId }, { $inc: { coins: -100, lootboxes: 1 } });

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user), itemWon: base });
});

// ================= EQUIP / UNEQUIP / UPGRADE / SELL =================
app.post("/api/equip-item", requireAuth, async (req, res) => {
  const { itemId } = req.body;
  let user = await refreshUser(req.session.userId);
  const item = (user.inventory || []).find(i => String(i.id) === String(itemId));
  if (!item || !item.slot) return res.status(400).json({ error: "Item kann nicht ausgerüstet werden" });

  const oldItem = user.equipped[item.slot];
  const update = { $pull: { inventory: { id: item.id } }, $set: { [`equipped.${item.slot}`]: item } };
  if (oldItem) update.$push = { inventory: oldItem };

  await usersCollection.updateOne({ id: req.session.userId }, update);
  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user) });
});

app.post("/api/unequip-item", requireAuth, async (req, res) => {
  const { slot } = req.body;
  let user = await refreshUser(req.session.userId);
  const item = user.equipped[slot];
  if (!item) return res.status(400).json({ error: "Nichts zum Ausziehen" });

  await usersCollection.updateOne({ id: req.session.userId }, {
    $unset: { [`equipped.${slot}`]: "" },
    $push: { inventory: item }
  });

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user) });
});

app.post("/api/upgrade-item", requireAuth, async (req, res) => {
  const { itemId } = req.body;
  let user = await refreshUser(req.session.userId);
  const itemIndex = (user.inventory || []).findIndex(i => String(i.id) === String(itemId));
  if (itemIndex === -1) return res.status(400).json({ error: "Item nicht gefunden" });

  const item = user.inventory[itemIndex];
  if (!item.slot) return res.status(400).json({ error: "Item kann nicht upgegradet werden" });

  const needed = item.rarity === "gray" ? 30 : item.rarity === "green" ? 50 : 0;
  const shardName = item.rarity === "gray" ? "Green Shard" : "Blue Shard";
  const shardsAvailable = countItemInInventory(user.inventory, shardName);

  if (shardsAvailable < needed) return res.status(400).json({ error: `Du brauchst ${needed} ${shardName}!` });

  const upgradedItem = { ...item };
  upgradedItem.rarity = item.rarity === "gray" ? "green" : "blue";
  upgradedItem.upgradeLevel = (item.upgradeLevel || 0) + 1;
  upgradedItem.dmgBonus = Math.floor(item.dmgBonus * 1.4);
  upgradedItem.hpBonus = Math.floor(item.hpBonus * 1.4);
  upgradedItem.defenseBonus = Math.floor(item.defenseBonus * 1.4);
  upgradedItem.name = item.name.replace("Gray", upgradedItem.rarity.charAt(0).toUpperCase() + upgradedItem.rarity.slice(1));

  await usersCollection.updateOne({ id: req.session.userId }, { $pull: { inventory: { id: item.id } } });
  await usersCollection.updateOne({ id: req.session.userId }, { $push: { inventory: upgradedItem } });

  for (let i = 0; i < needed; i++) {
    await usersCollection.updateOne({ id: req.session.userId }, { $pull: { inventory: { name: shardName } } });
  }

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user) });
});

app.post("/api/sell-item", requireAuth, async (req, res) => {
  const { itemId, quantity = 1 } = req.body;
  let user = await refreshUser(req.session.userId);
  const itemIndex = user.inventory.findIndex(i => String(i.id) === String(itemId));
  if (itemIndex === -1) return res.status(400).json({ error: "Item nicht gefunden" });

  const item = user.inventory[itemIndex];
  if (item.type !== "sellable") return res.status(400).json({ error: "Item kann nicht verkauft werden" });

  const sellQty = Math.min(quantity, item.quantity || 1);
  const sellValue = Math.floor(item.value * 0.65 * sellQty);

  if ((item.quantity || 1) <= sellQty) {
    await usersCollection.updateOne({ id: req.session.userId }, { $pull: { inventory: { id: item.id } } });
  } else {
    user.inventory[itemIndex].quantity = (item.quantity || 1) - sellQty;
    await usersCollection.updateOne({ id: req.session.userId }, { $set: { inventory: user.inventory } });
  }

  await usersCollection.updateOne({ id: req.session.userId }, { $inc: { coins: sellValue } });

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user), soldFor: sellValue, itemName: item.name, soldQty: sellQty });
});

// ================= SCHMIEDE – DRAG & DROP =================
app.post("/api/forge-add-shard", requireAuth, async (req, res) => {
  const { slot, amount = 1 } = req.body;
  if (!slot || amount < 1) return res.status(400).json({ error: "Ungültige Anfrage" });

  let user = await usersCollection.findOne({ id: req.session.userId });
  const item = user.equipped?.[slot];
  if (!item || !item.slot) return res.status(400).json({ error: "Kein Item im Amboss" });

  const isGray = item.rarity === "gray";
  const shardName = isGray ? "Green Shard" : "Blue Shard";
  const needed = isGray ? 30 : 50;

  const available = countItemInInventory(user.inventory, shardName);
  if (available < amount) {
    return res.status(400).json({ error: `Du hast nur ${available} von ${amount} benötigten ${shardName}!` });
  }

  item.progress = (item.progress || 0) + amount;

  let upgraded = false;
  if (item.progress >= needed) {
    const oldRarity = item.rarity;
    item.rarity = oldRarity === "gray" ? "green" : "blue";
    item.upgradeLevel = (item.upgradeLevel || 0) + 1;
    item.dmgBonus = Math.floor(item.dmgBonus * 1.4);
    item.hpBonus = Math.floor(item.hpBonus * 1.4);
    item.defenseBonus = Math.floor(item.defenseBonus * 1.4);
    if (oldRarity === "gray") item.name = item.name.replace("Gray", "Green");
    else if (oldRarity === "green") item.name = item.name.replace("Green", "Blue");
    item.progress = 0;
    upgraded = true;
  }

  let toRemove = amount;
  for (let i = user.inventory.length - 1; i >= 0 && toRemove > 0; i--) {
    if (user.inventory[i].name === shardName) {
      const qty = user.inventory[i].quantity || 1;
      if (qty >= toRemove) {
        user.inventory[i].quantity = qty - toRemove;
        if (user.inventory[i].quantity <= 0) user.inventory.splice(i, 1);
        toRemove = 0;
      } else {
        toRemove -= qty;
        user.inventory.splice(i, 1);
      }
    }
  }

  await usersCollection.updateOne({ id: req.session.userId }, { 
    $set: { [`equipped.${slot}`]: item, inventory: user.inventory } 
  });

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user), upgraded });
});

// ================= LEADERBOARD + PROFIL =================
app.get("/api/leaderboard", requireAuth, async (req, res) => {
  const type = req.query.type || "gold";
  let sort = { coins: -1 };
  if (type === "level") sort = { level: -1, coins: -1 };
  if (type === "lootboxes") sort = { lootboxes: -1, coins: -1 };

  const users = await usersCollection.find({ role: { $ne: "admin" } }).sort(sort).limit(50).toArray();
  res.json({ leaderboard: users.map(getSafeUser), type });
});

app.get("/api/user-profile/:id", requireAuth, async (req, res) => {
  const user = await usersCollection.findOne({ id: parseInt(req.params.id) });
  if (!user) return res.status(404).json({ error: "Spieler nicht gefunden" });
  res.json({ profile: getSafeUser(user) });
});

// ================= RESET =================
app.get("/api/reset-all-players", async (req, res) => {
  const secret = req.query.secret;
  const confirm = req.query.confirm;
  if (secret !== process.env.RESET_SECRET) return res.status(403).send("❌ Falsches Secret!");
  if (confirm !== "YES") return res.send("⚠️ Füge &confirm=YES hinzu um wirklich zu löschen.");
  const result = await usersCollection.deleteMany({ role: { $ne: "admin" } });
  console.log(`🗑️ RESET: ${result.deletedCount} Spieler gelöscht`);
  res.send(`<h1>✅ RESET ERFOLGREICH</h1><p>${result.deletedCount} Spieler gelöscht</p>`);
});

// ================= START =================
app.listen(PORT, async () => {
  await connectDB();
  await ensureAdminExists();
  console.log(`🚀 NOXA v2 läuft auf http://localhost:${PORT}`);
});