// ================= INIT =================
const app = document.getElementById("app");
let currentUser = null;

let state = {
  coins: 0,
  multiplier: 1,
  idle: 0.5,
  inventory: [],
  collection: [],
  equipped: []
};

let gameStarted = false;

// ================= ITEMS =================
const ITEMS = [
  { name: "Broken Coin", rarity: "common", value: 20 },
  { name: "Old Scrap", rarity: "common", value: 30 },
  { name: "Green Core", rarity: "uncommon", value: 60 },
  { name: "Blue Crystal", rarity: "rare", value: 150 },
  { name: "Epic Relic", rarity: "epic", value: 600 },
  { name: "Golden Core", rarity: "legendary", value: 2500 }
];

// ================= REQUEST =================
async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

// ================= AUTH UI =================
function renderAuth(tab = "login") {
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-panel">

        <div class="auth-title">NOXA</div>

        <div class="auth-tabs">
          <button onclick="renderAuth('login')" class="${tab==="login"?"active":""}">Login</button>
          <button onclick="renderAuth('register')" class="${tab==="register"?"active":""}">Register</button>
        </div>

        <div class="auth-form">
          <input id="user" placeholder="Username">
          <input id="pass" type="password" placeholder="Password">
        </div>

        <button class="primary-btn" onclick="${tab==='login'?'login()':'register()'}">
          ${tab === "login" ? "Login" : "Create Account"}
        </button>

      </div>
    </div>
  `;
}

// ================= AUTH =================
async function login() {
  const username = user.value;
  const password = pass.value;

  await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });

  bootstrap();
}

async function register() {
  const username = user.value;
  const password = pass.value;

  await request("/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });

  bootstrap();
}

// ================= APP =================
function renderApp() {
  app.innerHTML = `

    <div class="topbar">
      <div>👤 ${currentUser.displayName}</div>

      <div>
        💰 <span id="coins">${Math.floor(state.coins)}</span>
        ⚡ x<span id="multi">${state.multiplier.toFixed(1)}</span>
      </div>
    </div>

    <div class="app">

      <div id="content" class="content"></div>

      <div class="sidebar">
        <button onclick="switchTab('game')">Game</button>
        <button onclick="switchTab('lootbox')">Lootbox</button>
        <button onclick="switchTab('inventory')">Inventory</button>
        <button onclick="switchTab('profile')">Profile</button>
        <button onclick="switchTab('leaderboard')">Leaderboard</button>
        <button onclick="logout()">Logout</button>
      </div>

    </div>
  `;

  switchTab("game");
  startGame();
}

// ================= GAME =================
function renderGame() {
  return `
    <div class="game-view">
      <div id="gameArea" class="game-area">
        <div class="slime"></div>
      </div>
    </div>
  `;
}

function startGame() {
  if (gameStarted) return;
  gameStarted = true;

  setInterval(spawnCoin, 1200);

  setInterval(() => {
    state.coins += state.idle * state.multiplier;
    saveProgress();
    updateUI();
  }, 2000);
}

function spawnCoin() {
  const area = document.getElementById("gameArea");
  if (!area) return;

  const coin = document.createElement("div");
  coin.className = "coin";

  coin.style.left = Math.random() * 90 + "%";

  coin.onclick = () => {
    state.coins += 1 * state.multiplier;
    coin.remove();
    updateUI();
  };

  area.appendChild(coin);
  setTimeout(() => coin.remove(), 6000);
}

// ================= LOOTBOX =================
function renderLootbox() {
  return `
    <div class="panel-section">
      <h2>🎁 Lootbox</h2>
      <button class="primary-btn" onclick="openLootbox()">Open (100 Coins)</button>
    </div>
  `;
}

function openLootbox() {
  if (state.coins < 100) return alert("Zu wenig Coins");

  state.coins -= 100;

  const rarities = [
    ...Array(6).fill("common"),
    ...Array(4).fill("uncommon"),
    ...Array(3).fill("rare"),
    ...Array(2).fill("epic"),
    "legendary"
  ];

  const rarity = rarities[Math.floor(Math.random() * rarities.length)];

  const poolItems = ITEMS.filter(i => i.rarity === rarity);
  const item = poolItems[Math.floor(Math.random() * poolItems.length)];

  state.inventory.push(item);

  if (!state.collection.find(i => i.name === item.name)) {
    state.collection.push(item);
  }

  alert(`🔥 ${item.name} (${item.rarity})`);

  saveProgress();
  updateUI();
}

// ================= INVENTORY =================
function renderInventory() {
  return `
    <div class="grid">
      ${state.inventory.map((item,i)=>`
        <div class="card ${item.rarity}">
          <h3>${item.name}</h3>
          <p>${item.rarity}</p>
          <p>+${Math.floor(item.value/50)} Multi</p>
          <button onclick="equipItem(${i})">Equip</button>
        </div>
      `).join("")}
    </div>
  `;
}

function equipItem(i) {
  const item = state.inventory[i];

  if (state.equipped.includes(item)) return;

  state.equipped.push(item);
  state.multiplier += item.value / 50;

  saveProgress();
  updateUI();
}

// ================= PROFILE =================
function renderProfile() {
  return `
    <div class="panel-section">
      <h2>${currentUser.displayName}</h2>
      <p>Coins: ${Math.floor(state.coins)}</p>
      <p>Multiplier: x${state.multiplier.toFixed(1)}</p>

      <div class="slime"></div>
    </div>
  `;
}

// ================= LEADERBOARD =================
async function renderLeaderboard() {
  const data = await request("/api/leaderboard");

  return `
    <div class="leaderboard-list">
      ${data.leaderboard.map(u=>`
        <div class="leader-row">
          ${u.displayName} - ${u.coins}
        </div>
      `).join("")}
    </div>
  `;
}

// ================= NAV =================
async function switchTab(tab) {
  const content = document.getElementById("content");

  if (tab === "game") content.innerHTML = renderGame();
  if (tab === "lootbox") content.innerHTML = renderLootbox();
  if (tab === "inventory") content.innerHTML = renderInventory();
  if (tab === "profile") content.innerHTML = renderProfile();
  if (tab === "leaderboard") content.innerHTML = await renderLeaderboard();
}

// ================= UI UPDATE =================
function updateUI() {
  const coinsEl = document.getElementById("coins");
  const multiEl = document.getElementById("multi");

  if (coinsEl) coinsEl.innerText = Math.floor(state.coins);
  if (multiEl) multiEl.innerText = state.multiplier.toFixed(1);
}

// ================= SAVE =================
async function saveProgress() {
  await request("/api/save-progress", {
    method: "POST",
    body: JSON.stringify({
      coins: state.coins,
      coinMultiplier: state.multiplier
    })
  });
}

// ================= START =================
async function bootstrap() {
  try {
    const { user } = await request("/api/me");

    currentUser = user;
    state.coins = user.coins;
    state.multiplier = user.coinMultiplier;

    renderApp();
  } catch {
    renderAuth();
  }
}

async function logout() {
  await request("/api/logout",{method:"POST"});
  location.reload();
}

bootstrap();