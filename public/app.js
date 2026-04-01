const app = document.getElementById("app");
let currentUser = null;
let currentTab = "game";
let gameStarted = false;
let mobs = [];
let playerHpInterval = null;
let currentLeaderboardType = "gold";
let forgeSlot = null;

// ====================== REQUEST HELPER ======================
async function request(url, options = {}) {
  const res = await fetch(url, { 
    headers: { "Content-Type": "application/json" }, 
    credentials: "include", 
    ...options 
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Fehler");
  return data;
}

// ====================== VISUELLE DROPS ======================
function createFlyingDrop(type, value) {
  const drop = document.createElement("div");
  drop.style.position = "fixed";
  drop.style.zIndex = "99999";
  drop.style.fontSize = "1.8rem";
  drop.style.pointerEvents = "none";
  drop.style.transition = "all 1.2s cubic-bezier(0.25,0.1,0.25,1)";

  if (type === "coin") { drop.textContent = "💰"; drop.style.color = "#ffcc00"; }
  else if (type === "scrap") { drop.textContent = "🟢"; drop.style.color = "#2ecc71"; }
  else if (type === "xp") { drop.textContent = `+${value} XP`; drop.style.color = "#00d4ff"; drop.style.fontSize = "1.4rem"; }

  document.body.appendChild(drop);
  const startX = window.innerWidth / 2;
  const startY = window.innerHeight / 2;
  drop.style.left = `${startX}px`;
  drop.style.top = `${startY}px`;

  const targetX = 120;
  const targetY = 20;

  setTimeout(() => {
    drop.style.transform = `translate(${targetX - startX}px, ${targetY - startY}px) scale(0.3)`;
    drop.style.opacity = "0";
  }, 50);

  setTimeout(() => drop.remove(), 1300);
}

// ====================== LOOTBOX REEL ANIMATION ======================
function showLootboxReel(wonItem) {
  const modal = document.createElement("div");
  modal.className = "custom-modal";
  modal.innerHTML = `
    <div class="modal-content success" style="max-width:920px;padding:20px">
      <h2 style="text-align:center;margin-bottom:15px">🎟️ LOOTBOX ÖFFNEN...</h2>
      <div class="reel-wrapper">
        <div class="reel-container" id="reelContainer">
          <div class="reel" id="reelStrip"></div>
          <div class="reel-marker">
            <div class="reel-marker-arrow"></div>
            <div class="reel-marker-line"></div>
          </div>
          <div class="reel-marker-bottom">
            <div class="reel-marker-arrow-up"></div>
          </div>
        </div>
      </div>
      <div id="spinStatus" class="spin-status">SPINNING...</div>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add("show"), 10);

  const reelStrip = document.getElementById("reelStrip");
  const status = document.getElementById("spinStatus");

  const dummyItems = Array(30).fill(0).map(() => LOOT_SHOWCASE[Math.floor(Math.random() * LOOT_SHOWCASE.length)]);
  const reelItems = [...dummyItems, wonItem];

  reelStrip.innerHTML = reelItems.map(i => `
    <div class="reel-item ${i.rarity || 'common'}">
      <div class="item-icon">${i.icon}</div>
      <div class="item-name">${i.name}</div>
      <div class="item-rarity">${i.rarity || ''}</div>
    </div>
  `).join("");

  const itemWidth = 140;
  const finalOffset = (reelItems.length - 2) * itemWidth;

  reelStrip.offsetHeight;
  requestAnimationFrame(() => {
    reelStrip.style.transition = `transform 3800ms cubic-bezier(0.25, 0.1, 0.25, 1)`;
    reelStrip.style.transform = `translateX(-${finalOffset}px)`;
  });

  setTimeout(() => {
    status.textContent = "GEWONNEN!";
    status.classList.add("revealing");
    setTimeout(() => {
      modal.remove();
      const extra = `<div class="win-card ${wonItem.rarity}"><div class="win-icon">${wonItem.slot ? '🛡️' : '📦'}</div><h3>${wonItem.name}</h3></div>`;
      showModal("🎉 ITEM GEWONNEN!", `Du hast <strong>${wonItem.name}</strong> erhalten!`, "success", extra);
    }, 800);
  }, 3900);
}

// ====================== MODALS ======================
function showModal(title, message, type = "success", extraHTML = "") {
  const modal = document.createElement("div");
  modal.className = "custom-modal";
  modal.innerHTML = `
    <div class="modal-content ${type}">
      <h2>${title}</h2>
      <p>${message}</p>
      ${extraHTML}
      <button onclick="this.closest('.custom-modal').remove()" class="primary-btn">OK</button>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add("show"), 10);
}

// ====================== SELL QUANTITY MODAL ======================
function showSellModal(itemId, itemName, maxQty, valuePer) {
  const modal = document.createElement("div");
  modal.className = "custom-modal";
  modal.innerHTML = `
    <div class="modal-content success" style="max-width:420px">
      <h2>📦 ${itemName} verkaufen</h2>
      <p>Du hast <strong>${maxQty}</strong> Stück</p>
      <input id="sellQtyInput" type="number" min="1" max="${maxQty}" value="${maxQty}" style="width:100%;padding:12px;font-size:1.2rem;text-align:center;border-radius:12px;border:2px solid #00d4ff;margin:20px 0">
      <p style="color:#7a85a8">Wert pro Stück: <strong>${Math.floor(valuePer * 0.65)} Coins</strong></p>
      <div style="display:flex;gap:12px">
        <button onclick="this.closest('.custom-modal').remove()" class="sell-btn" style="flex:1">Abbrechen</button>
        <button onclick="confirmSell('${itemId}')" class="primary-btn" style="flex:1">Verkaufen</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add("show"), 10);
}

window.confirmSell = async function(itemId) {
  const input = document.getElementById("sellQtyInput");
  const qty = parseInt(input.value) || 1;
  const modal = input.closest('.custom-modal');
  modal.remove();

  try {
    const data = await request("/api/sell-item", { method: "POST", body: JSON.stringify({ itemId, quantity: qty }) });
    currentUser = data.user;
    showModal("✅ Verkauft!", `${data.soldQty}× ${data.itemName} für <strong>${data.soldFor}</strong> Coins!`, "success");
    updateUI();
    if (currentTab === "inventory") switchTab("inventory");
  } catch(e) {
    showModal("❌ Fehler", e.message, "error");
  }
};

// ====================== AUTH ======================
function renderAuth(tab = "login") {
  app.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a1f">
    <div style="width:380px;background:rgba(15,18,45,0.95);padding:40px;border-radius:20px;text-align:center">
      <h1 style="font-size:2.8rem;margin-bottom:20px;color:#00d4ff">NOXA</h1>
      <div style="display:flex;gap:10px;margin-bottom:20px">
        <button onclick="renderAuth('login')" style="flex:1;padding:14px;border-radius:12px;background:${tab==='login'?'#00d4ff':'#222'};color:white">Login</button>
        <button onclick="renderAuth('register')" style="flex:1;padding:14px;border-radius:12px;background:${tab==='register'?'#00d4ff':'#222'};color:white">Register</button>
      </div>
      <input id="user" placeholder="Username" style="width:100%;padding:14px;margin-bottom:12px;border-radius:12px;border:none">
      <input id="pass" type="password" placeholder="Password" style="width:100%;padding:14px;margin-bottom:20px;border-radius:12px;border:none">
      <button onclick="${tab==='login'?'login()':'register()'}" class="primary-btn">${tab==='login'?'Login':'Create Account'}</button>
    </div>
  </div>`;
}

async function login() {
  const username = document.getElementById("user").value.trim();
  const password = document.getElementById("pass").value;
  if (username.length < 3 || password.length < 6) return alert("Username ≥ 3 und Passwort ≥ 6 Zeichen!");
  try {
    await request("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    bootstrap();
  } catch (e) { showModal("❌ Fehler", e.message, "error"); }
}

async function register() {
  const username = document.getElementById("user").value.trim();
  const password = document.getElementById("pass").value;
  if (username.length < 3 || password.length < 6) return alert("Username ≥ 3 und Passwort ≥ 6 Zeichen!");
  try {
    await request("/api/register", { method: "POST", body: JSON.stringify({ username, password }) });
    bootstrap();
  } catch (e) { showModal("❌ Fehler", e.message, "error"); }
}

// ====================== APP ======================
function renderApp() {
  app.innerHTML = `
    <div class="topbar">
      <div>👤 ${currentUser.displayName} <span id="topLevel" style="font-size:0.9rem;color:#00d4ff">Lv.${currentUser.level}</span></div>
      <div style="display:flex;gap:24px;align-items:center">
        <div>💰 <span id="coins">${Math.floor(currentUser.coins)}</span></div>
        <div>📦 <span id="lootboxes">${currentUser.lootboxes}</span></div>
        <div>🗡️ <span id="dmg">${currentUser.dmg}</span></div>
        <div>🛡️ <span id="defense">${currentUser.defense}</span></div>
      </div>
      <div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:340px">
        <div id="xpText" style="text-align:center;font-size:0.8rem;color:#00d4ff;margin-bottom:4px">XP ${currentUser.xp} / ${currentUser.level * 60}</div>
        <div style="background:#222;border-radius:999px;height:10px;overflow:hidden">
          <div id="xpBar" style="height:100%;background:linear-gradient(90deg,#00d4ff,#00ffcc);width:0%;transition:width 0.4s"></div>
        </div>
      </div>
    </div>
    <div class="app">
      <div id="content" class="content"></div>
      <div class="sidebar">
        <button onclick="switchTab('game')" class="primary-btn">Game</button>
        <button onclick="switchTab('lootboxen')" class="primary-btn">Lootboxen</button>
        <button onclick="switchTab('inventory')" class="primary-btn">Inventory</button>
        <button onclick="switchTab('schmiede')" class="primary-btn">🔨 Schmiede</button>
        <button onclick="switchTab('profile')" class="primary-btn">Profile</button>
        <button onclick="switchTab('leaderboard')" class="primary-btn">Leaderboard</button>
        <button onclick="logout()" class="sell-btn" style="margin-top:auto;width:100%;padding:13px">Logout</button>
      </div>
    </div>
  `;
  switchTab("game");
  startGame();
}

// ====================== GAME ======================
function renderGame() {
  return `
    <div class="game-area" id="gameArea">
      <div class="hp-bar">
        <div id="hpText">HP <span id="hpValue">${currentUser.currentHp}</span>/${currentUser.maxHp}</div>
        <div class="hp-bar-outer"><div id="hpBar" class="hp-bar-inner" style="width:100%"></div></div>
      </div>
      <div class="slime" id="playerSlime" style="position:absolute;bottom:30px;left:50%;transform:translateX(-50%);"></div>
      <div id="mobsContainer" style="position:absolute;inset:0"></div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:1.1rem">Klicke die 👾 Mobs! Sie machen dir Schaden.</div>
  `;
}

function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  setInterval(spawnMob, 1100);
  playerHpInterval = setInterval(() => { if (mobs.length > 0) takeDamage(mobs.length * 2); }, 1000);
  setInterval(async () => {
    try {
      const data = await request("/api/me");
      currentUser = data.user;
      updateUI();
    } catch(e){}
  }, 8000);
}

function spawnMob() {
  const area = document.getElementById("mobsContainer");
  if (!area) return;
  const mob = document.createElement("div");
  mob.className = "mob";
  mob.style.left = Math.random() * 85 + "%";
  mob.style.top = Math.random() * 70 + "%";
  mob.innerHTML = `
    👾
    <div class="mob-hp" style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);width:50px;height:6px;background:#222;border-radius:999px;overflow:hidden">
      <div class="mob-hp-bar" style="height:100%;width:100%;background:#ff4444;transition:width 0.2s"></div>
    </div>
  `;
  mob.dataset.hp = "6";
  mob.dataset.maxHp = "6";
  mob.onclick = () => killMob(mob);
  area.appendChild(mob);
  mobs.push(mob);
  setTimeout(() => { if (mob.parentNode) { mob.remove(); mobs = mobs.filter(m => m !== mob); } }, 8500);
}

async function killMob(mobElement) {
  let hp = parseInt(mobElement.dataset.hp);
  hp -= currentUser.dmg || 1;
  mobElement.dataset.hp = hp;

  const percent = Math.max(0, (hp / parseInt(mobElement.dataset.maxHp)) * 100);
  const bar = mobElement.querySelector(".mob-hp-bar");
  if (bar) bar.style.width = percent + "%";

  if (hp <= 0) {
    mobElement.style.transform = "scale(0)";
    setTimeout(() => { mobElement.remove(); mobs = mobs.filter(m => m !== mobElement); }, 180);

    const data = await request("/api/kill-mob", { method: "POST" });
    currentUser = data.user;
    updateUI();

    createFlyingDrop("coin", data.user.coins);
    createFlyingDrop("scrap", 1);
    createFlyingDrop("xp", data.xpGain || 15);

    if (data.leveledUp) showLevelUpChoice(data.levelsGained);
  } else {
    mobElement.style.transform = "scale(1.3)";
    setTimeout(() => mobElement.style.transform = "", 120);
  }
}

function showLevelUpChoice(levelsGained) {
  const modal = document.createElement("div");
  modal.className = "custom-modal";
  modal.innerHTML = `
    <div class="modal-content success" style="max-width:480px">
      <h2>🎉 LEVEL UP! (+${levelsGained})</h2>
      <p>Wähle deinen Bonus pro Level:</p>
      <div style="display:flex;gap:16px;margin:30px 0">
        <button onclick="applyLevelBonus('dmg');this.closest('.custom-modal').remove()" style="flex:1;padding:20px;border-radius:16px;background:#ff4444;color:white;font-size:1.1rem">🗡️ +1 DAMAGE</button>
        <button onclick="applyLevelBonus('hp');this.closest('.custom-modal').remove()" style="flex:1;padding:20px;border-radius:16px;background:#00cc66;color:white;font-size:1.1rem">❤️ +15 HP</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add("show"), 10);
}

window.applyLevelBonus = async function(choice) {
  try {
    const data = await request("/api/apply-level-bonus", { method: "POST", body: JSON.stringify({ choice }) });
    currentUser = data.user;
    updateUI();
    showModal("✅ Bonus angewendet!", choice === "dmg" ? "+1 Damage erhalten!" : "+15 HP erhalten!", "success");
  } catch(e) {
    showModal("❌ Fehler", e.message, "error");
  }
};

async function takeDamage(damage) {
  const data = await request("/api/take-damage", { method: "POST", body: JSON.stringify({ damage }) });
  currentUser = data.user;
  updateUI();
  if (data.isDead) {
    const respawnData = await request("/api/respawn", { method: "POST" });
    currentUser = respawnData.user;
    updateUI();
    showModal("💀 DU BIST GESTORBEN", `Du hast <strong>${respawnData.lostCoins}</strong> Coins verloren.<br>Respawn bei voller HP!`, "error");
  }
}

// ====================== LOOTBOXEN ======================
const LOOT_SHOWCASE = [
  { name: "Normal Scrap", icon: "⚙️", chance: "50%", rarity: "common" },
  { name: "Slime Scrap", icon: "🟢", chance: "25%", rarity: "common" },
  { name: "Green Shard", icon: "💚", chance: "16%", rarity: "uncommon" },
  { name: "Blue Shard", icon: "🔷", chance: "5%", rarity: "rare" },
  { name: "Gray NOXA Cap", icon: "🧢", chance: "1%", rarity: "gray" },
  { name: "Gray NOXA Shirt", icon: "👕", chance: "1%", rarity: "gray" },
  { name: "Gray NOXA Pants", icon: "👖", chance: "1%", rarity: "gray" },
  { name: "Gray NOXA Shoes", icon: "👟", chance: "1%", rarity: "gray" }
];

function renderLootboxen() {
  return `
    <div style="text-align:center;padding:40px 0">
      <h1 style="font-size:2.6rem;margin-bottom:8px">🎟️ LOOTBOXEN</h1>
      <p style="color:#7a85a8;margin-bottom:30px">50 % Scrap • 25 % Slime Scrap • 16 % Green Shard • 5 % Blue Shard • 4 % Gray NOXA Gear</p>
      <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;max-width:720px;margin:0 auto 40px">
        ${LOOT_SHOWCASE.map(i => `
          <div style="background:rgba(255,255,255,0.05);padding:14px 20px;border-radius:14px;text-align:center;width:118px">
            <div style="font-size:2.4rem;margin-bottom:8px">${i.icon}</div>
            <div style="font-size:0.9rem">${i.name}</div>
            <div style="font-size:0.75rem;color:#00d4ff">${i.chance}</div>
          </div>
        `).join("")}
      </div>
      <button onclick="openLootboxen()" id="openLootBtn" class="open-case-btn">🔓 OPEN LOOTBOX <span style="opacity:0.75;font-weight:700">– 100 Coins</span></button>
    </div>`;
}

async function openLootboxen() {
  const btn = document.getElementById("openLootBtn");
  btn.style.transition = "all 0.4s";
  btn.style.transform = "scale(0.92) rotate(8deg)";
  setTimeout(() => btn.style.transform = "", 180);

  let data;
  try { data = await request("/api/open-starter-box", { method: "POST" }); }
  catch (e) { return showModal("❌ Fehler", e.message, "error"); }

  currentUser = data.user;
  updateUI();

  showLootboxReel(data.itemWon);
  if (currentTab === "inventory") switchTab("inventory");
}

// ====================== INVENTORY ======================
function renderInventory() {
  const e = currentUser.equipped || {};
  return `
    <h1 style="margin-bottom:20px">Inventory</h1>
    <div class="character-area" style="margin-top:60px">
      <div class="slime"></div>
      <div class="slots">
        ${["cap","shirt","pants","shoes"].map(slot => {
          const item = e[slot];
          return `<div class="slot">
            <div class="slot-label">${slot.toUpperCase()}</div>
            <div class="slot-box ${item ? 'filled' : ''}" ondblclick="unequipItem('${slot}')">
              ${item ? item.name : 'Leer'}<br>
              ${item && item.upgradeLevel !== undefined ? `Lv.${item.upgradeLevel}` : ''}
            </div>
            ${item ? `<button onclick="unequipItem('${slot}');event.stopImmediatePropagation()" class="sell-btn" style="margin-top:6px">Ausziehen</button>` : ''}
          </div>`;
        }).join("")}
      </div>
    </div>
    <h2 style="margin:30px 0 15px">Deine Items</h2>
    <div class="grid">
      ${currentUser.inventory.map(item => `
        <div class="card ${item.rarity}">
          <h3>${item.name} ${item.quantity > 1 ? `<span style="font-size:1.1rem;color:#00d4ff">×${item.quantity}</span>` : ''}</h3>
          <p>${item.rarity} ${item.upgradeLevel !== undefined ? `(Lv.${item.upgradeLevel})` : ''}</p>
          ${item.dmgBonus ? `<p>🗡️ +${item.dmgBonus} DMG</p>` : ''}
          ${item.hpBonus ? `<p>❤️ +${item.hpBonus} HP</p>` : ''}
          ${item.defenseBonus ? `<p>🛡️ +${item.defenseBonus} Defense</p>` : ''}
          ${item.slot ? `<button onclick="equipItem('${item.id}');event.stopImmediatePropagation()" class="primary-btn">Anziehen</button>` : ''}
          ${item.type === "sellable" ? `<button onclick="sellItem('${item.id}', '${item.name}', ${item.quantity || 1}, ${item.value});event.stopImmediatePropagation()" class="sell-btn" style="background:#e74c3c">Verkaufen</button>` : ''}
          ${item.slot && (item.rarity === "gray" || item.rarity === "green") ? `<button onclick="upgradeItem('${item.id}');event.stopImmediatePropagation()" class="primary-btn" style="background:#00d4ff">Upgraden</button>` : ''}
        </div>
      `).join("")}
    </div>
  `;
}

async function equipItem(itemId) {
  const data = await request("/api/equip-item", { method: "POST", body: JSON.stringify({ itemId }) });
  currentUser = data.user;
  updateUI();
  if (currentTab === "inventory") switchTab("inventory");
}

async function unequipItem(slot) {
  const data = await request("/api/unequip-item", { method: "POST", body: JSON.stringify({ slot }) });
  currentUser = data.user;
  updateUI();
  if (currentTab === "inventory") switchTab("inventory");
}

async function upgradeItem(itemId) {
  const data = await request("/api/upgrade-item", { method: "POST", body: JSON.stringify({ itemId }) });
  if (data.success) {
    currentUser = data.user;
    updateUI();
    showModal("✅ UPGRADE ERFOLGREICH!", `Dein Item ist jetzt stärker!`, "success");
    if (currentTab === "inventory") switchTab("inventory");
  } else {
    showModal("❌ Nicht genug Shards", data.error || "Du brauchst mehr Shards!", "error");
  }
}

async function sellItem(itemId, itemName, maxQty, valuePer) {
  showSellModal(itemId, itemName, maxQty, valuePer);
}

// ====================== DRAG & DROP SCHMIEDE ======================
function enableForgeDragAndDrop() {
  setTimeout(() => {
    document.querySelectorAll('.forge-draggable').forEach(el => {
      el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', el.dataset.id);
        e.dataTransfer.setData('type', el.dataset.type);
      });
    });

    const anvil = document.getElementById('anvil-dropzone');
    if (anvil) {
      anvil.addEventListener('dragover', e => e.preventDefault());
      anvil.addEventListener('drop', async e => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        const type = e.dataTransfer.getData('type');
        if (type === 'armor') await selectForgeItem(id);
      });
    }

    const shardZone = document.getElementById('shard-dropzone');
    if (shardZone) {
      shardZone.addEventListener('dragover', e => e.preventDefault());
      shardZone.addEventListener('drop', async e => {
        e.preventDefault();
        if (forgeSlot) await addSingleShard();
      });
    }
  }, 150);
}

async function addSingleShard() {
  if (!forgeSlot) return showModal("❌", "Zuerst eine Rüstung in den Amboss legen!", "error");
  try {
    const data = await request("/api/forge-add-shard", {
      method: "POST",
      body: JSON.stringify({ slot: forgeSlot, amount: 1 })
    });
    currentUser = data.user;
    updateUI();
    switchTab("schmiede");
    if (data.upgraded) showModal("🎉 UPGRADE ERFOLGREICH!", "Rarität geändert!", "success");
  } catch (e) {
    showModal("❌", e.message, "error");
  }
}

function renderSchmiede() {
  const e = currentUser.equipped || {};
  const item = forgeSlot ? e[forgeSlot] : null;
  let needed = 0, shardName = "", progress = 0, shardsAvailable = 0;

  if (item) {
    needed = item.rarity === "gray" ? 30 : item.rarity === "green" ? 50 : 0;
    shardName = item.rarity === "gray" ? "Green Shard" : "Blue Shard";
    progress = item.progress || 0;
    shardsAvailable = currentUser.inventory.reduce((sum, i) => i.name === shardName ? sum + (i.quantity || 1) : sum, 0);
  }

  return `
    <h1 style="text-align:center;margin-bottom:30px">🔨 <strong>SCHMIEDE</strong></h1>
    <div style="display:flex;gap:40px;justify-content:center;flex-wrap:wrap">
      <div style="text-align:center">
        <h3 style="color:#ffcc00;margin-bottom:15px">AMBOSS</h3>
        <div style="display:flex;gap:30px;align-items:flex-start;justify-content:center">
          <div id="anvil-dropzone" style="width:190px;height:190px;border:4px dashed #00d4ff;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,212,255,0.08);cursor:pointer">
            ${item ? `
              <div style="font-size:3.8rem;margin-bottom:10px">🛡️</div>
              <div style="font-weight:700">${item.name}</div>
              <div style="color:#00d4ff">${item.rarity.toUpperCase()} Lv.${item.upgradeLevel || 0}</div>
              <div style="margin-top:20px;width:160px">
                <div style="font-size:0.9rem">${shardName}: <strong>${progress}/${needed}</strong></div>
                <div style="height:14px;background:#222;border-radius:999px;overflow:hidden;margin-top:6px">
                  <div style="height:100%;background:linear-gradient(90deg,#00d4ff,#00ffcc);width:${Math.min(100,(progress/needed)*100)}%"></div>
                </div>
              </div>
            ` : `
              <div style="font-size:4rem;opacity:0.3">🛡️</div>
              <div style="margin-top:15px;font-weight:700;color:#aaa">Rüstung hierher ziehen</div>
            `}
          </div>

          <div id="shard-dropzone" style="width:190px;height:190px;border:4px dashed #ffcc00;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(255,204,0,0.08);cursor:pointer">
            <div style="font-size:3.8rem">💎</div>
            <div style="margin-top:15px;font-weight:700">Shards hierher ziehen</div>
            ${item ? `<div style="margin-top:20px;color:#ffcc00">Verfügbar: <strong>${shardsAvailable}</strong></div>` : ''}
          </div>
        </div>

        ${item ? `
          <div style="margin-top:30px">
            <button onclick="upgradeForgeItem()" class="primary-btn" style="width:380px">
              UPGRADE JETZT (${needed - progress} ${shardName})
            </button>
            <button onclick="clearForgeSlot()" class="sell-btn" style="margin-top:12px;width:380px">
              Amboss leeren
            </button>
          </div>
        ` : ''}
      </div>

      <div style="max-width:720px">
        <h3 style="margin-bottom:15px">Dein Inventar – ziehe Items in den Amboss</h3>
        <div class="grid">
          ${currentUser.inventory.map(i => {
            const isShard = i.name.includes("Shard");
            const type = isShard ? "shard" : "armor";
            if (!isShard && !i.slot) return '';
            return `
              <div class="card ${i.rarity || ''} forge-draggable" 
                   data-id="${i.id}" 
                   data-type="${type}">
                <h3>${i.name} ${i.quantity > 1 ? `×${i.quantity}` : ''}</h3>
                ${i.slot ? `<p>${i.rarity} • Lv.${i.upgradeLevel || 0}</p>` : ''}
                ${isShard ? `<p style="color:#ffcc00">Drag & Drop in Shards-Slot</p>` : ''}
              </div>`;
          }).join("")}
        </div>
      </div>
    </div>
  `;
}

window.selectForgeItem = async function(itemId) {
  const item = currentUser.inventory.find(i => String(i.id) === String(itemId));
  if (!item || !item.slot) return;

  if (!currentUser.equipped[item.slot] || currentUser.equipped[item.slot].id !== item.id) {
    await request("/api/equip-item", { method: "POST", body: JSON.stringify({ itemId }) });
    const fresh = await request("/api/me");
    currentUser = fresh.user;
  }

  forgeSlot = item.slot;
  switchTab("schmiede");
};

window.upgradeForgeItem = async function() {
  if (!forgeSlot) return;
  const item = currentUser.equipped[forgeSlot];
  if (!item) return;
  const needed = item.rarity === "gray" ? 30 : 50;
  const remaining = needed - (item.progress || 0);
  if (remaining <= 0) return showModal("✅", "Item ist bereits maximal!", "success");

  try {
    const data = await request("/api/forge-add-shard", {
      method: "POST",
      body: JSON.stringify({ slot: forgeSlot, amount: remaining })
    });
    currentUser = data.user;
    updateUI();
    showModal("🎉 UPGRADE ERFOLGREICH!", "Rarität geändert!", "success");
    switchTab("schmiede");
  } catch(e) {
    showModal("❌", e.message, "error");
  }
};

window.clearForgeSlot = function() {
  forgeSlot = null;
  switchTab("schmiede");
};

// ====================== LEADERBOARD ======================
async function renderLeaderboard() {
  const data = await request(`/api/leaderboard?type=${currentLeaderboardType}`);
  let html = `<h1 style="margin-bottom:20px">Leaderboard</h1>`;
  html += `
    <div style="display:flex;gap:8px;margin-bottom:20px">
      <button onclick="switchLeaderboard('gold')" style="flex:1;padding:12px;border-radius:12px;background:${currentLeaderboardType==='gold'?'#00d4ff':'#222'};color:white">💰 Gold</button>
      <button onclick="switchLeaderboard('level')" style="flex:1;padding:12px;border-radius:12px;background:${currentLeaderboardType==='level'?'#00d4ff':'#222'};color:white">🏆 Level</button>
      <button onclick="switchLeaderboard('lootboxes')" style="flex:1;padding:12px;border-radius:12px;background:${currentLeaderboardType==='lootboxes'?'#00d4ff':'#222'};color:white">📦 Lootboxen</button>
    </div>`;
  html += `<div style="display:flex;flex-direction:column;gap:8px">`;
  data.leaderboard.forEach((u, i) => {
    html += `<div onclick="viewProfile(${u.id})" style="background:rgba(255,255,255,0.05);padding:16px;border-radius:12px;display:flex;justify-content:space-between;cursor:pointer">
      <span><strong>#${i+1}</strong> ${u.displayName} <span style="color:#00d4ff">Lv.${u.level}</span></span>
      <span>${currentLeaderboardType==='lootboxes' ? u.lootboxes + ' Lootboxen' : Math.floor(u.coins) + ' Coins'}</span>
    </div>`;
  });
  html += `</div>`;
  return html;
}

window.switchLeaderboard = function(type) {
  currentLeaderboardType = type;
  switchTab("leaderboard");
};

window.viewProfile = async function(userId) {
  try {
    const data = await request(`/api/user-profile/${userId}`);
    const p = data.profile;
    const modalHTML = `
      <div class="modal-content success" style="max-width:460px">
        <h2>${p.displayName}</h2>
        <p>Level <strong>${p.level}</strong> • ${Math.floor(p.coins)} Coins</p>
        <p>🗡️ DMG: <strong>${p.dmg}</strong> • 🛡️ Defense: <strong>${p.defense}</strong></p>
        <p>❤️ HP: <strong>${p.currentHp}/${p.maxHp}</strong></p>
        <button onclick="this.closest('.custom-modal').remove()" class="primary-btn">Schließen</button>
      </div>`;
    const modal = document.createElement("div");
    modal.className = "custom-modal";
    modal.innerHTML = modalHTML;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add("show"), 10);
  } catch(e) {
    showModal("❌ Fehler", "Profil konnte nicht geladen werden", "error");
  }
};

// ====================== SWITCH TAB ======================
async function switchTab(tab) {
  currentTab = tab;
  const content = document.getElementById("content");

  if (tab === "game") content.innerHTML = renderGame();
  else if (tab === "lootboxen") content.innerHTML = renderLootboxen();
  else if (tab === "inventory") content.innerHTML = renderInventory();
  else if (tab === "schmiede") {
    content.innerHTML = renderSchmiede();
    enableForgeDragAndDrop();   // ← Drag & Drop aktivieren
  }
  else if (tab === "profile") content.innerHTML = renderProfile();
  else if (tab === "leaderboard") content.innerHTML = await renderLeaderboard();
}

function updateUI() {
  const levelEl = document.getElementById("topLevel");
  if (levelEl) levelEl.textContent = `Lv.${currentUser.level}`;

  const xpNeeded = currentUser.level * 60;
  const xpPercent = Math.min(100, Math.floor((currentUser.xp / xpNeeded) * 100));
  const xpBar = document.getElementById("xpBar");
  const xpText = document.getElementById("xpText");
  if (xpBar) xpBar.style.width = xpPercent + "%";
  if (xpText) xpText.textContent = `XP ${currentUser.xp} / ${xpNeeded}`;

  document.getElementById("coins").innerText = Math.floor(currentUser.coins);
  document.getElementById("lootboxes").innerText = currentUser.lootboxes;
  document.getElementById("dmg").innerText = currentUser.dmg;
  document.getElementById("defense").innerText = currentUser.defense || 0;

  const hpBar = document.getElementById("hpBar");
  const hpValue = document.getElementById("hpValue");
  if (hpBar && hpValue) {
    const percent = Math.max(0, Math.floor((currentUser.currentHp / currentUser.maxHp) * 100));
    hpBar.style.width = percent + "%";
    hpValue.innerText = Math.floor(currentUser.currentHp);
  }
}

function renderProfile() {
  return `<div style="background:var(--panel);padding:40px;border-radius:16px;text-align:center;max-width:520px;margin:0 auto">
    <h2>${currentUser.displayName} <span style="color:#00d4ff">Lv.${currentUser.level}</span></h2>
    <p>🗡️ DMG: <strong>${currentUser.dmg}</strong> • 🛡️ Defense: <strong>${currentUser.defense}</strong></p>
    <p>❤️ HP: <strong>${currentUser.currentHp}/${currentUser.maxHp}</strong></p>
    <div class="slime" style="margin-top:60px"></div>
  </div>`;
}

async function bootstrap() {
  try {
    const { user } = await request("/api/me");
    currentUser = user;
    renderApp();
  } catch {
    renderAuth();
  }
}

async function logout() {
  await request("/api/logout", { method: "POST" });
  location.reload();
}

bootstrap();