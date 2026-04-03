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

function getEquipmentTotals(equipped = {}) {
  return {
    dmg:
      (equipped.cap?.dmgBonus || 0) +
      (equipped.shirt?.dmgBonus || 0) +
      (equipped.pants?.dmgBonus || 0) +
      (equipped.shoes?.dmgBonus || 0),
    hp:
      (equipped.cap?.hpBonus || 0) +
      (equipped.shirt?.hpBonus || 0) +
      (equipped.pants?.hpBonus || 0) +
      (equipped.shoes?.hpBonus || 0),
    defense:
      (equipped.cap?.defenseBonus || 0) +
      (equipped.shirt?.defenseBonus || 0) +
      (equipped.pants?.defenseBonus || 0) +
      (equipped.shoes?.defenseBonus || 0)
  };
}

function getSafeUser(user) {
  const equipped = user.equipped || { cap: null, shirt: null, pants: null, shoes: null };
  const bonuses = getEquipmentTotals(equipped);
  const baseMaxHp = user.maxHp || 100;
  const effectiveMaxHp = baseMaxHp + bonuses.hp;
  const storedCurrentHp = user.currentHp ?? baseMaxHp;
  const effectiveCurrentHp = Math.max(0, Math.min(storedCurrentHp + bonuses.hp, effectiveMaxHp));

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    coins: user.coins,
    dmg: (user.dmg || 1) + bonuses.dmg,
    maxHp: effectiveMaxHp,
    currentHp: effectiveCurrentHp,
    defense: (user.defense || 0) + bonuses.defense,
    xp: user.xp,
    level: user.level,
    lootboxes: user.lootboxes,
    totalKills: user.totalKills,
    inventory: user.inventory || [],
    equipped
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

  if (baseItem.slot) {
    const newItem = { ...baseItem, id: Date.now() + Math.floor(Math.random() * 100000), quantity: 1 };
    await usersCollection.updateOne({ id: userId }, { $push: { inventory: newItem } });
    return;
  }

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

function removeItemQuantity(inventory, itemName, amount) {
  let remaining = amount;

  for (let i = inventory.length - 1; i >= 0 && remaining > 0; i--) {
    if (inventory[i].name !== itemName) continue;

    const quantity = inventory[i].quantity || 1;
    if (quantity > remaining) {
      inventory[i].quantity = quantity - remaining;
      remaining = 0;
    } else {
      remaining -= quantity;
      inventory.splice(i, 1);
    }
  }

  return remaining === 0;
}

function sanitizeBetAmount(value) {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return amount;
}

function drawBlackjackCard() {
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  return ranks[Math.floor(Math.random() * ranks.length)];
}

function calculateBlackjackTotal(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    if (card === "A") {
      total += 11;
      aces++;
    } else if (["J", "Q", "K"].includes(card)) {
      total += 10;
    } else {
      total += Number(card);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

function getBlackjackState(game, revealDealer = false) {
  return {
    betAmount: game.betAmount,
    playerHand: game.playerHand,
    dealerHand: revealDealer ? game.dealerHand : [game.dealerHand[0], "?"],
    playerTotal: calculateBlackjackTotal(game.playerHand),
    dealerTotal: revealDealer ? calculateBlackjackTotal(game.dealerHand) : null,
    finished: Boolean(game.finished),
    resultText: game.resultText || ""
  };
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
  const requestedTier = Math.max(1, Math.min(40, parseInt(req.body?.tier, 10) || 1));
  const tierCap = Math.max(1, Math.ceil((user.level || 1) / 2) + 3);
  const tier = Math.min(requestedTier, tierCap);
  const isBoss = (req.body?.boss === true || req.body?.boss === "true") && tier >= 4;
  const gold = Math.floor(12 + Math.random() * 18 + (tier - 1) * 4 + (isBoss ? 30 + tier * 2 : 0));
  const xpGain = 15 + (tier - 1) * 4 + (isBoss ? 28 + tier * 3 : 0);
  const lootboxesGained = isBoss ? 1 : 0;

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
    $inc: { coins: gold, totalKills: 1, lootboxes: lootboxesGained },
    $set: { level: newLevel, xp: newXp, lastUpdated: new Date() }
  });

  user = await refreshUser(req.session.userId);
  res.json({
    success: true,
    user: getSafeUser(user),
    leveledUp: levelsGained > 0,
    levelsGained,
    xpGain,
    goldGain: gold,
    lootboxesGained
  });
});

// 🔥 FIX: Bei jedem Level-Up wird jetzt IMMER auf volle maxHp geheilt (egal ob DMG oder HP gewählt)
app.post("/api/apply-level-bonus", requireAuth, async (req, res) => {
  const { choice } = req.body;
  let user = await refreshUser(req.session.userId);

  if (choice === "dmg") {
    await usersCollection.updateOne({ id: req.session.userId }, { $inc: { dmg: 1 } });
  } else if (choice === "hp") {
    await usersCollection.updateOne({ id: req.session.userId }, { $inc: { maxHp: 15 } });
  }

  // Immer volle Heilung nach Level-Up
  const updatedUser = await usersCollection.findOne({ id: req.session.userId });
  const newMaxHp = updatedUser.maxHp || 100;
  
  await usersCollection.updateOne({ id: req.session.userId }, { 
    $set: { currentHp: newMaxHp, lastUpdated: new Date() }
  });

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user) });
});

app.post("/api/take-damage", requireAuth, async (req, res) => {
  const { damage } = req.body;
  let user = await usersCollection.findOne({ id: req.session.userId });
  const equipped = user.equipped || { cap: null, shirt: null, pants: null, shoes: null };
  const bonuses = getEquipmentTotals(equipped);
  const rawMaxHp = user.maxHp || 100;
  const effectiveMaxHp = rawMaxHp + bonuses.hp;
  const effectiveCurrentHp = Math.min((user.currentHp ?? rawMaxHp) + bonuses.hp, effectiveMaxHp);
  const nextEffectiveHp = Math.max(0, effectiveCurrentHp - Math.max(0, Number(damage) || 0));
  const nextRawHp = Math.min(rawMaxHp, nextEffectiveHp - bonuses.hp);

  await usersCollection.updateOne(
    { id: req.session.userId },
    { $set: { currentHp: nextRawHp, lastUpdated: new Date() } }
  );

  user = await usersCollection.findOne({ id: req.session.userId });
  res.json({ success: true, user: getSafeUser(user), isDead: nextEffectiveHp <= 0 });
});

// 🔥 FIX: Respawn heilt jetzt immer auf die aktuelle maxHp (nicht hart auf 100)
app.post("/api/respawn", requireAuth, async (req, res) => {
  let user = await usersCollection.findOne({ id: req.session.userId });
  const lostCoins = Math.floor((user.coins || 0) * 0.25);

  await usersCollection.updateOne({ id: req.session.userId }, {
    $inc: { coins: -lostCoins },
    $set: { 
      currentHp: user.maxHp || 100, 
      lastUpdated: new Date() 
    }
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
  await usersCollection.updateOne({ id: req.session.userId }, { $inc: { coins: -100, lootboxes: 1 } });
  await addItemToInventory(req.session.userId, base);

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user), itemWon: base });
});

// ================= KASINO =================
app.post("/api/casino/roulette", requireAuth, async (req, res) => {
  const betAmount = sanitizeBetAmount(req.body.betAmount);
  const color = String(req.body.color || "").toLowerCase();
  if (!["rot", "schwarz", "gruen"].includes(color)) {
    return res.status(400).json({ error: "Ungültige Farbe" });
  }
  if (betAmount < 10) {
    return res.status(400).json({ error: "Mindesteinsatz ist 10 Coins" });
  }

  let user = await refreshUser(req.session.userId);
  if ((user.coins || 0) < betAmount) {
    return res.status(400).json({ error: "Zu wenig Coins" });
  }

  const roll = Math.floor(Math.random() * 37);
  const landedColor = roll === 0 ? "gruen" : roll % 2 === 0 ? "schwarz" : "rot";
  const multiplier = color === "gruen" ? 14 : 2;
  const win = landedColor === color;
  const payout = win ? betAmount * multiplier : 0;
  const delta = payout - betAmount;

  await usersCollection.updateOne(
    { id: req.session.userId },
    { $inc: { coins: delta }, $set: { lastUpdated: new Date() } }
  );

  user = await refreshUser(req.session.userId);
  res.json({
    success: true,
    win,
    rolledNumber: roll,
    landedColor,
    payout,
    delta,
    user: getSafeUser(user)
  });
});

app.post("/api/casino/slots", requireAuth, async (req, res) => {
  const betAmount = sanitizeBetAmount(req.body.betAmount);
  if (betAmount < 10) {
    return res.status(400).json({ error: "Mindesteinsatz ist 10 Coins" });
  }

  let user = await refreshUser(req.session.userId);
  if ((user.coins || 0) < betAmount) {
    return res.status(400).json({ error: "Zu wenig Coins" });
  }

  const symbols = ["KIRSCHE", "7", "SCHWERT", "SCHILD", "KRONE", "SLIME"];
  const reels = Array.from({ length: 3 }, () => symbols[Math.floor(Math.random() * symbols.length)]);

  let multiplier = 0;
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    multiplier = reels[0] === "7" ? 8 : reels[0] === "KRONE" ? 6 : 5;
  } else if (new Set(reels).size === 2) {
    multiplier = 2;
  }

  const payout = multiplier > 0 ? betAmount * multiplier : 0;
  const delta = payout - betAmount;

  await usersCollection.updateOne(
    { id: req.session.userId },
    { $inc: { coins: delta }, $set: { lastUpdated: new Date() } }
  );

  user = await refreshUser(req.session.userId);
  res.json({
    success: true,
    reels,
    multiplier,
    payout,
    win: payout > 0,
    delta,
    user: getSafeUser(user)
  });
});

app.post("/api/casino/blackjack/start", requireAuth, async (req, res) => {
  const betAmount = sanitizeBetAmount(req.body.betAmount);
  if (betAmount < 10) {
    return res.status(400).json({ error: "Mindesteinsatz ist 10 Coins" });
  }

  let user = await refreshUser(req.session.userId);
  if ((user.coins || 0) < betAmount) {
    return res.status(400).json({ error: "Zu wenig Coins" });
  }

  const game = {
    betAmount,
    playerHand: [drawBlackjackCard(), drawBlackjackCard()],
    dealerHand: [drawBlackjackCard(), drawBlackjackCard()],
    finished: false,
    resultText: ""
  };

  await usersCollection.updateOne(
    { id: req.session.userId },
    { $inc: { coins: -betAmount }, $set: { lastUpdated: new Date() } }
  );

  const playerTotal = calculateBlackjackTotal(game.playerHand);
  const dealerTotal = calculateBlackjackTotal(game.dealerHand);

  if (playerTotal === 21 || dealerTotal === 21) {
    game.finished = true;
    let payout = 0;

    if (playerTotal === 21 && dealerTotal === 21) {
      payout = betAmount;
      game.resultText = "Beide haben Blackjack. Einsatz zurück.";
    } else if (playerTotal === 21) {
      payout = Math.floor(betAmount * 2.5);
      game.resultText = "Blackjack. Du gewinnst.";
    } else {
      game.resultText = "Dealer hat Blackjack.";
    }

    if (payout > 0) {
      await usersCollection.updateOne(
        { id: req.session.userId },
        { $inc: { coins: payout }, $set: { lastUpdated: new Date() } }
      );
    }
  }

  req.session.blackjackGame = game.finished ? null : game;
  user = await refreshUser(req.session.userId);

  res.json({
    success: true,
    game: getBlackjackState(game, game.finished),
    user: getSafeUser(user)
  });
});

app.post("/api/casino/blackjack/hit", requireAuth, async (req, res) => {
  const game = req.session.blackjackGame;
  if (!game || game.finished) {
    return res.status(400).json({ error: "Kein aktives Blackjack-Spiel" });
  }

  game.playerHand.push(drawBlackjackCard());
  const total = calculateBlackjackTotal(game.playerHand);

  if (total > 21) {
    game.finished = true;
    game.resultText = "Überkauft. Du verlierst.";
    req.session.blackjackGame = null;
    const user = await refreshUser(req.session.userId);
    return res.json({ success: true, game: getBlackjackState(game, true), user: getSafeUser(user) });
  }

  req.session.blackjackGame = game;
  const user = await refreshUser(req.session.userId);
  res.json({ success: true, game: getBlackjackState(game, false), user: getSafeUser(user) });
});

app.post("/api/casino/blackjack/stand", requireAuth, async (req, res) => {
  const game = req.session.blackjackGame;
  if (!game || game.finished) {
    return res.status(400).json({ error: "Kein aktives Blackjack-Spiel" });
  }

  while (calculateBlackjackTotal(game.dealerHand) < 17) {
    game.dealerHand.push(drawBlackjackCard());
  }

  const playerTotal = calculateBlackjackTotal(game.playerHand);
  const dealerTotal = calculateBlackjackTotal(game.dealerHand);
  let payout = 0;

  if (dealerTotal > 21 || playerTotal > dealerTotal) {
    payout = game.betAmount * 2;
    game.resultText = "Du gewinnst.";
  } else if (playerTotal === dealerTotal) {
    payout = game.betAmount;
    game.resultText = "Unentschieden. Einsatz zurück.";
  } else {
    game.resultText = "Dealer gewinnt.";
  }

  if (payout > 0) {
    await usersCollection.updateOne(
      { id: req.session.userId },
      { $inc: { coins: payout }, $set: { lastUpdated: new Date() } }
    );
  }

  game.finished = true;
  req.session.blackjackGame = null;
  const user = await refreshUser(req.session.userId);
  res.json({ success: true, game: getBlackjackState(game, true), user: getSafeUser(user) });
});

// ================= EQUIP / UNEQUIP / UPGRADE / SELL =================
app.post("/api/equip-item", requireAuth, async (req, res) => {
  const { itemId } = req.body;
  let user = await refreshUser(req.session.userId);
  const item = (user.inventory || []).find(i => String(i.id) === String(itemId));
  if (!item || !item.slot) return res.status(400).json({ error: "Item kann nicht ausgerüstet werden" });

  user.equipped = user.equipped || { cap: null, shirt: null, pants: null, shoes: null };
  const oldItem = user.equipped[item.slot];
  const equippedItem = { ...item, id: Date.now() + Math.floor(Math.random() * 100000), quantity: 1 };

  if ((item.quantity || 1) > 1) {
    user.inventory = (user.inventory || []).map((entry) =>
      String(entry.id) === String(itemId)
        ? { ...entry, quantity: (entry.quantity || 1) - 1 }
        : entry
    );
  } else {
    user.inventory = (user.inventory || []).filter((entry) => String(entry.id) !== String(itemId));
  }

  if (oldItem) user.inventory.push({ ...oldItem, quantity: 1 });
  user.equipped[item.slot] = equippedItem;

  await usersCollection.updateOne(
    { id: req.session.userId },
    { $set: { inventory: user.inventory, equipped: user.equipped } }
  );
  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user) });
});

app.post("/api/unequip-item", requireAuth, async (req, res) => {
  const { slot } = req.body;
  let user = await refreshUser(req.session.userId);
  user.equipped = user.equipped || { cap: null, shirt: null, pants: null, shoes: null };
  const item = user.equipped[slot];
  if (!item) return res.status(400).json({ error: "Nichts zum Ausziehen" });

  await usersCollection.updateOne({ id: req.session.userId }, {
    $set: { [`equipped.${slot}`]: null },
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

  const upgradedItem = { ...item, id: Date.now() + Math.floor(Math.random() * 100000), quantity: 1 };
  upgradedItem.rarity = item.rarity === "gray" ? "green" : "blue";
  upgradedItem.upgradeLevel = (item.upgradeLevel || 0) + 1;
  upgradedItem.dmgBonus = Math.floor(item.dmgBonus * 1.4);
  upgradedItem.hpBonus = Math.floor(item.hpBonus * 1.4);
  upgradedItem.defenseBonus = Math.floor(item.defenseBonus * 1.4);
  upgradedItem.name = item.rarity === "gray"
    ? item.name.replace("Gray", "Green")
    : item.name.replace("Green", "Blue");
  if ((item.quantity || 1) > 1) {
    user.inventory[itemIndex].quantity = (item.quantity || 1) - 1;
  } else {
    user.inventory.splice(itemIndex, 1);
  }
  removeItemQuantity(user.inventory, shardName, needed);
  user.inventory.push(upgradedItem);

  await usersCollection.updateOne(
    { id: req.session.userId },
    { $set: { inventory: user.inventory } }
  );

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user) });
});

app.post("/api/upgrade-item-progress", requireAuth, async (req, res) => {
  const { itemId, amount = 1 } = req.body;
  const shardAmount = Math.max(1, Math.floor(Number(amount) || 1));
  let user = await refreshUser(req.session.userId);
  const itemIndex = (user.inventory || []).findIndex(i => String(i.id) === String(itemId));
  if (itemIndex === -1) return res.status(400).json({ error: "Item nicht gefunden" });

  const item = user.inventory[itemIndex];
  if (!item.slot) return res.status(400).json({ error: "Item kann nicht verbessert werden" });

  const isGray = item.rarity === "gray";
  const isGreen = item.rarity === "green";
  if (!isGray && !isGreen) return res.status(400).json({ error: "Dieses Item kann nicht weiter verbessert werden" });

  const shardName = isGray ? "Green Shard" : "Blue Shard";
  const needed = isGray ? 30 : 50;
  const available = countItemInInventory(user.inventory, shardName);
  if (available <= 0) return res.status(400).json({ error: `Keine ${shardName} verfügbar` });

  const currentProgress = item.progress || 0;
  const missing = needed - currentProgress;
  const toUse = Math.min(shardAmount, available, missing);
  if (toUse <= 0) return res.status(400).json({ error: "Dieses Item ist bereits upgradebereit" });

  const updatedItem = { ...item, progress: currentProgress + toUse };
  let upgraded = false;

  if (updatedItem.progress >= needed) {
    const oldRarity = updatedItem.rarity;
    updatedItem.rarity = oldRarity === "gray" ? "green" : "blue";
    updatedItem.upgradeLevel = (updatedItem.upgradeLevel || 0) + 1;
    updatedItem.dmgBonus = Math.floor(updatedItem.dmgBonus * 1.4);
    updatedItem.hpBonus = Math.floor(updatedItem.hpBonus * 1.4);
    updatedItem.defenseBonus = Math.floor(updatedItem.defenseBonus * 1.4);
    updatedItem.name = oldRarity === "gray"
      ? updatedItem.name.replace("Gray", "Green")
      : updatedItem.name.replace("Green", "Blue");
    updatedItem.progress = 0;
    upgraded = true;
  }

  user.inventory[itemIndex] = updatedItem;
  removeItemQuantity(user.inventory, shardName, toUse);

  await usersCollection.updateOne(
    { id: req.session.userId },
    { $set: { inventory: user.inventory } }
  );

  user = await refreshUser(req.session.userId);
  res.json({ success: true, user: getSafeUser(user), upgraded, used: toUse, shardName, needed, progress: updatedItem.progress || 0 });
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
  const isGreen = item.rarity === "green";
  if (!isGray && !isGreen) {
    return res.status(400).json({ error: "Dieses Item kann nicht weiter verbessert werden" });
  }
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
