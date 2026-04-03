const app = document.getElementById("app");
let currentUser = null;
let currentTab = "game";
let combatActive = false;
let mobs = [];
let spawnInterval = null;
let playerHpInterval = null;
let syncInterval = null;
let currentLeaderboardType = "gold";
let forgeSlot = null;
let forgeDragBound = false;
let currentCasinoGame = "roulette";
let blackjackState = null;
let menuOpen = false;
let menuPausedCombat = false;
let menuSectionOpen = false;
const WAVE_BREAK_MS = 1800;
let casinoVisualState = {
  roulette: {
    betAmount: 100,
    spinning: false,
    selectedColor: null,
    rolledNumber: null,
    landedColor: null,
    payout: 0,
    win: false,
    message: "Bereit für die nächste Runde."
  },
  slots: {
    betAmount: 100,
    spinning: false,
    reels: ["KIRSCHE", "7", "KRONE"],
    multiplier: 0,
    payout: 0,
    win: false,
    message: "Noch kein Dreh gestartet."
  }
};

const LOOT_SHOWCASE = [
  { name: "Normal Scrap", icon: "SCRP", chance: "50%", rarity: "common" },
  { name: "Slime Scrap", icon: "SLSH", chance: "25%", rarity: "common" },
  { name: "Green Shard", icon: "GSHD", chance: "16%", rarity: "uncommon" },
  { name: "Blue Shard", icon: "BSHD", chance: "5%", rarity: "rare" },
  { name: "Gray NOXA Cap", icon: "CAP", chance: "1%", rarity: "gray" },
  { name: "Gray NOXA Shirt", icon: "SUIT", chance: "1%", rarity: "gray" },
  { name: "Gray NOXA Pants", icon: "LEG", chance: "1%", rarity: "gray" },
  { name: "Gray NOXA Shoes", icon: "BOOT", chance: "1%", rarity: "gray" }
];

const LOOTBOX_OFFERS = [
  {
    id: "starter",
    title: "Starter-Kiste",
    price: 100,
    label: "Immer offen",
    description: "Solider Einstieg mit Scrap, Shards und grauen NOXA-Teilen.",
    action: "open",
    accent: "common",
    loot: LOOT_SHOWCASE.slice(0, 6)
  },
  {
    id: "hunter",
    title: "Hunter-Kiste",
    price: 250,
    label: "Später",
    description: "Reservierter Slot für seltenere Ausrüstung und mehr Upgrade-Material.",
    action: "locked",
    accent: "rare",
    loot: LOOT_SHOWCASE.slice(2, 7)
  },
  {
    id: "elite",
    title: "Elite-Kiste",
    price: 500,
    label: "Später",
    description: "Platz für Premium-Drops, Events oder saisonale Kisten.",
    action: "locked",
    accent: "gray",
    loot: LOOT_SHOWCASE.slice(3)
  }
];

function createWaveState(checkpointWave = 0) {
  return {
    current: 0,
    totalSpawns: 0,
    pendingSpawns: 0,
    defeated: 0,
    bossWave: false,
    spawnDelay: 0,
    maxConcurrent: 0,
    nextSpawnAt: 0,
    nextWaveAt: 0,
    phase: "idle",
    checkpointWave,
    queuedWave: Math.max(1, checkpointWave + 1)
  };
}

let waveState = createWaveState();

function resetWaveState(checkpointWave = waveState.checkpointWave || 0) {
  waveState = createWaveState(checkpointWave);
}

function getWaveConfig(waveNumber) {
  const bossWave = waveNumber % 5 === 0;
  const speedBase = 54 + waveNumber * 2;
  if (bossWave) {
    return {
      waveNumber,
      bossWave: true,
      totalSpawns: 1,
      spawnDelay: 1600,
      maxConcurrent: 1,
      hp: 18 + waveNumber * 5,
      damage: 3 + Math.floor(waveNumber * 0.7),
      rewardTier: waveNumber + 2,
      mobClass: "boss",
      sigil: "BOSS",
      width: 132,
      height: 132,
      speed: Math.min(108, 42 + waveNumber * 2.2)
    };
  }

  const eliteWave = waveNumber >= 4;
  return {
    waveNumber,
    bossWave: false,
    totalSpawns: Math.min(12, 3 + waveNumber),
    spawnDelay: Math.max(420, 960 - waveNumber * 45),
    maxConcurrent: Math.min(6, 2 + Math.floor(waveNumber / 2)),
    hp: 5 + waveNumber * 2 + (eliteWave ? 3 : 0),
    damage: 1 + Math.floor((waveNumber - 1) / 2) + (eliteWave ? 1 : 0),
    rewardTier: Math.max(1, Math.ceil(waveNumber / 2) + (eliteWave ? 1 : 0)),
    mobClass: eliteWave ? "elite" : "normal",
    sigil: eliteWave ? "ALP" : "SLM",
    width: eliteWave ? 98 : 88,
    height: eliteWave ? 98 : 88,
    speed: Math.min(124, speedBase + (eliteWave ? 10 : 0))
  };
}

function getWaveDisplayLabel() {
  if (!waveState.current) return combatActive || menuPausedCombat ? `Welle ${waveState.queuedWave || 1}` : "Bereit";
  return waveState.bossWave ? `Boss ${waveState.current}` : `Welle ${waveState.current}`;
}

function getNextBossWave() {
  const baseWave = Math.max(1, waveState.current || waveState.queuedWave || 1);
  return baseWave % 5 === 0 ? baseWave + 5 : baseWave + (5 - baseWave % 5);
}

function getCheckpointLabel() {
  return waveState.checkpointWave ? `Welle ${waveState.checkpointWave}` : "Start";
}

function scheduleNextWave(delay = WAVE_BREAK_MS) {
  waveState.nextWaveAt = Date.now() + delay;
  waveState.phase = waveState.current ? "intermission" : "countdown";
}

function startNextWave() {
  const nextWaveNumber = Math.max(1, waveState.queuedWave || waveState.current + 1);
  const config = getWaveConfig(nextWaveNumber);
  waveState = {
    ...waveState,
    current: config.waveNumber,
    totalSpawns: config.totalSpawns,
    pendingSpawns: config.totalSpawns,
    defeated: 0,
    bossWave: config.bossWave,
    spawnDelay: config.spawnDelay,
    maxConcurrent: config.maxConcurrent,
    nextSpawnAt: Date.now() + 260,
    nextWaveAt: 0,
    phase: "spawning",
    queuedWave: config.waveNumber + 1
  };
  updateUI();
}

function unlockCheckpoint(completedWave) {
  if (completedWave <= waveState.checkpointWave) return;
  waveState = {
    ...waveState,
    checkpointWave: completedWave,
    queuedWave: completedWave + 1
  };
  showModal("Checkpoint", `Boss von Welle <strong>${completedWave}</strong> besiegt. Dein neuer Checkpoint ist jetzt freigeschaltet.`, "success");
}

function getIncomingDamage() {
  return mobs.reduce((total, mob) => total + (mob.dataset.attacking === "true" ? (parseInt(mob.dataset.damage, 10) || 0) : 0), 0);
}

function getPlayerCombatZone(area) {
  const stage = area.closest(".game-area");
  const player = stage?.querySelector("#playerSlime");
  if (!player) return null;

  const areaRect = area.getBoundingClientRect();
  const playerRect = player.getBoundingClientRect();
  const centerX = playerRect.left - areaRect.left + playerRect.width / 2;
  const centerY = playerRect.top - areaRect.top + playerRect.height / 2;
  const radius = Math.max(112, Math.min(148, playerRect.width * 0.74));

  return { x: centerX, y: centerY, radius };
}

function isCandidateInsidePlayerZone(candidateRect, area) {
  const playerZone = getPlayerCombatZone(area);
  if (!playerZone) return false;

  const candidateCenterX = candidateRect.left + (candidateRect.right - candidateRect.left) / 2;
  const candidateCenterY = candidateRect.top + (candidateRect.bottom - candidateRect.top) / 2;
  const candidateRadius = Math.max(candidateRect.right - candidateRect.left, candidateRect.bottom - candidateRect.top) / 2;
  const distance = Math.hypot(playerZone.x - candidateCenterX, playerZone.y - candidateCenterY);
  return distance <= playerZone.radius + candidateRadius + 24;
}

function applyMobPosition(mobElement, centerX, centerY) {
  const width = parseFloat(mobElement.dataset.width || mobElement.offsetWidth || 88);
  const height = parseFloat(mobElement.dataset.height || mobElement.offsetHeight || width);
  mobElement.dataset.posX = String(centerX);
  mobElement.dataset.posY = String(centerY);
  mobElement.style.left = `${centerX - width / 2}px`;
  mobElement.style.top = `${centerY - height / 2}px`;
}

function updateMobMovement(area) {
  const playerZone = getPlayerCombatZone(area);
  if (!playerZone) return;

  const moveDelta = 0.22;
  mobs.forEach((mob) => {
    if (!mob.isConnected || mob.dataset.dead === "true") return;

    const mobWidth = parseFloat(mob.dataset.width || mob.offsetWidth || 88);
    const mobHeight = parseFloat(mob.dataset.height || mob.offsetHeight || mobWidth);
    let centerX = parseFloat(mob.dataset.posX);
    let centerY = parseFloat(mob.dataset.posY);

    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      const currentRect = mob.getBoundingClientRect();
      const areaRect = area.getBoundingClientRect();
      centerX = currentRect.left - areaRect.left + currentRect.width / 2;
      centerY = currentRect.top - areaRect.top + currentRect.height / 2;
    }

    const dx = playerZone.x - centerX;
    const dy = playerZone.y - centerY;
    const distance = Math.hypot(dx, dy) || 0.0001;
    const stopDistance = playerZone.radius + Math.max(mobWidth, mobHeight) * 0.42;

    if (distance <= stopDistance) {
      mob.dataset.attacking = "true";
      mob.classList.add("attacking");
      if (distance < stopDistance - 4) {
        const snapFactor = stopDistance / distance;
        centerX = playerZone.x - dx * snapFactor;
        centerY = playerZone.y - dy * snapFactor;
        applyMobPosition(mob, centerX, centerY);
      }
      return;
    }

    const speed = parseFloat(mob.dataset.speed || 60);
    const nextDistance = Math.max(stopDistance, distance - speed * moveDelta);
    const ratio = nextDistance / distance;
    mob.dataset.attacking = "false";
    mob.classList.remove("attacking");
    centerX = playerZone.x - dx * ratio;
    centerY = playerZone.y - dy * ratio;
    applyMobPosition(mob, centerX, centerY);
  });
}

function tickCombatLoop() {
  if (!combatActive || !currentUser) return;
  const now = Date.now();
  const area = document.getElementById("mobsContainer");

  if (!waveState.current && !waveState.nextWaveAt && !waveState.pendingSpawns && mobs.length === 0) {
    scheduleNextWave(500);
    updateUI();
    return;
  }

  if (area && mobs.length > 0) updateMobMovement(area);

  if (waveState.nextWaveAt && now >= waveState.nextWaveAt) {
    startNextWave();
  }

  if (waveState.pendingSpawns > 0 && now >= waveState.nextSpawnAt && mobs.length < waveState.maxConcurrent) {
    const config = getWaveConfig(waveState.current);
    spawnMob(config);
    waveState.pendingSpawns -= 1;
    waveState.phase = waveState.pendingSpawns > 0 ? "spawning" : "clear";
    waveState.nextSpawnAt = now + config.spawnDelay;
    updateUI();
  }

  if (!waveState.pendingSpawns && mobs.length === 0 && !waveState.nextWaveAt && waveState.current > 0) {
    scheduleNextWave();
    updateUI();
  }
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function polarPoint(cx, cy, radius, angleDeg) {
  const angle = (angleDeg - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle)
  };
}

function describeRouletteSlice(cx, cy, radius, startAngle, endAngle) {
  const start = polarPoint(cx, cy, radius, endAngle);
  const end = polarPoint(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function getSlotSymbolMeta(symbol) {
  const map = {
    KIRSCHE: { label: "Kirsche", accent: "#f6685f" },
    "7": { label: "777", accent: "#f1c75b" },
    SCHWERT: { label: "Schwert", accent: "#d6dde7" },
    SCHILD: { label: "Schild", accent: "#6fa3ff" },
    KRONE: { label: "Krone", accent: "#f0c56a" },
    SLIME: { label: "Slime", accent: "#9ccb5a" }
  };
  return map[symbol] || { label: symbol, accent: "#f7e8c5" };
}

function getBlackjackSuit(rank, index = 0) {
  const suits = ["spade", "heart", "diamond", "club"];
  const seed = String(rank || "").charCodeAt(0) + index;
  return suits[Math.abs(seed) % suits.length];
}

function getSuitShape(suit) {
  const shapes = {
    heart: '<path d="M50 84 C22 62 8 42 8 24 C8 11 18 2 30 2 C39 2 46 8 50 16 C54 8 61 2 70 2 C82 2 92 11 92 24 C92 42 78 62 50 84Z"/>',
    diamond: '<path d="M50 2 L86 42 L50 84 L14 42 Z"/>',
    club: '<path d="M50 26 C50 14 59 6 70 6 C82 6 90 16 90 27 C90 38 82 47 70 47 C67 47 64 46 61 45 C66 50 70 57 70 65 C70 76 61 86 50 86 C39 86 30 76 30 65 C30 57 34 50 39 45 C36 46 33 47 30 47 C18 47 10 38 10 27 C10 16 18 6 30 6 C41 6 50 14 50 26 Z"/><rect x="43" y="58" width="14" height="24" rx="5"/>',
    spade: '<path d="M50 2 C60 16 90 34 90 56 C90 70 80 82 66 82 C58 82 52 78 50 72 C48 78 42 82 34 82 C20 82 10 70 10 56 C10 34 40 16 50 2 Z"/><rect x="43" y="60" width="14" height="24" rx="5"/>'
  };
  return shapes[suit] || shapes.spade;
}

function renderSuitMark(suit, className = "") {
  return `<svg class="${className}" viewBox="0 0 100 90" aria-hidden="true">${getSuitShape(suit)}</svg>`;
}

function renderSuitGlyph(suit, className = "") {
  return `<g class="${className}">${getSuitShape(suit)}</g>`;
}

function renderCasinoSymbol(symbol, className = "") {
  const classes = className ? ` ${className}` : "";
  switch (symbol) {
    case "KIRSCHE":
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true">
        <path d="M60 26 C54 16 54 9 60 4 C69 11 72 20 70 30" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
        <path d="M60 30 C43 25 26 27 14 40" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
        <path d="M60 30 C76 24 94 26 106 40" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
        <circle cx="35" cy="72" r="24" fill="currentColor" opacity="0.92"/>
        <circle cx="84" cy="72" r="24" fill="currentColor" opacity="0.92"/>
        <circle cx="27" cy="63" r="7" fill="#fff" opacity="0.22"/>
        <circle cx="76" cy="63" r="7" fill="#fff" opacity="0.22"/>
        <ellipse cx="61" cy="18" rx="13" ry="8" fill="#9ccb5a"/>
      </svg>`;
    case "7":
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true">
        <path d="M22 28 H95 L62 94" fill="none" stroke="currentColor" stroke-width="14" stroke-linecap="square" stroke-linejoin="round"/>
        <path d="M24 28 H97" stroke="#fff" stroke-width="5" opacity="0.22"/>
      </svg>`;
    case "SCHWERT":
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true">
        <path d="M66 14 L94 42 L58 78 L42 62 Z" fill="currentColor"/>
        <path d="M40 64 L56 80 L27 109 C22 114 14 114 10 110 C6 106 6 98 11 93 Z" fill="currentColor" opacity="0.78"/>
        <path d="M33 74 L46 87" stroke="#fff" stroke-width="6" opacity="0.18" stroke-linecap="round"/>
        <path d="M70 18 L90 38" stroke="#fff" stroke-width="6" opacity="0.18" stroke-linecap="round"/>
      </svg>`;
    case "SCHILD":
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true">
        <path d="M60 12 L94 24 V54 C94 79 78 98 60 108 C42 98 26 79 26 54 V24 Z" fill="currentColor"/>
        <path d="M60 25 V92" stroke="#fff" stroke-width="6" opacity="0.22"/>
        <path d="M40 48 H80" stroke="#fff" stroke-width="6" opacity="0.18"/>
      </svg>`;
    case "KRONE":
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true">
        <path d="M18 88 L28 34 L52 56 L60 24 L68 56 L92 34 L102 88 Z" fill="currentColor"/>
        <rect x="18" y="88" width="84" height="14" fill="currentColor" opacity="0.78"/>
        <circle cx="28" cy="32" r="6" fill="#fff" opacity="0.28"/>
        <circle cx="60" cy="22" r="6" fill="#fff" opacity="0.28"/>
        <circle cx="92" cy="32" r="6" fill="#fff" opacity="0.28"/>
      </svg>`;
    case "SLIME":
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true">
        <path d="M22 82 C22 52 37 28 60 28 C83 28 98 52 98 82 C98 96 87 106 60 106 C33 106 22 96 22 82 Z" fill="currentColor"/>
        <circle cx="48" cy="68" r="6" fill="#15250a"/>
        <circle cx="72" cy="68" r="6" fill="#15250a"/>
        <path d="M46 86 C52 92 68 92 74 86" fill="none" stroke="#15250a" stroke-width="5" stroke-linecap="round"/>
        <circle cx="42" cy="52" r="8" fill="#fff" opacity="0.18"/>
      </svg>`;
    case "roulette-red":
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="42" fill="currentColor"/><circle cx="60" cy="60" r="16" fill="#fff" opacity="0.18"/></svg>`;
    case "roulette-black":
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true"><rect x="22" y="22" width="76" height="76" rx="16" fill="currentColor"/><rect x="38" y="38" width="44" height="44" rx="10" fill="#fff" opacity="0.12"/></svg>`;
    case "roulette-green":
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true"><polygon points="60,14 100,60 60,106 20,60" fill="currentColor"/><circle cx="60" cy="60" r="14" fill="#fff" opacity="0.16"/></svg>`;
    default:
      return `<svg class="casino-symbol-svg${classes}" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="34" fill="currentColor"/></svg>`;
  }
}

function renderRouletteWheelSvg(highlightNumber = null) {
  const pockets = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27];
  const sliceAngle = 360 / pockets.length;
  const slices = pockets.map((number, index) => {
    const startAngle = index * sliceAngle;
    const endAngle = startAngle + sliceAngle;
    const isGreen = number === 0;
    const fill = isGreen ? "#2b8f55" : index % 2 === 0 ? "#b84237" : "#19191d";
    const isActive = number === highlightNumber;
    const textPoint = polarPoint(100, 100, 71, startAngle + sliceAngle / 2);
    return `
      <path d="${describeRouletteSlice(100, 100, 88, startAngle, endAngle)}" fill="${fill}" stroke="rgba(255,240,207,0.18)" stroke-width="2"/>
      ${isActive ? `<path d="${describeRouletteSlice(100, 100, 88, startAngle, endAngle)}" fill="rgba(255,240,207,0.16)"/>` : ""}
      <text x="${textPoint.x.toFixed(2)}" y="${textPoint.y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${startAngle + sliceAngle / 2 + 90} ${textPoint.x.toFixed(2)} ${textPoint.y.toFixed(2)})" fill="#fff1d5" font-size="11" font-family="'Press Start 2P', monospace">${number}</text>`;
  }).join("");
  return `<svg class="roulette-wheel-svg" viewBox="0 0 200 200" aria-hidden="true">
    <circle cx="100" cy="100" r="98" fill="#3b2417" stroke="#f0c56a" stroke-width="4"/>
    <circle cx="100" cy="100" r="90" fill="#160f0b" stroke="rgba(255,241,213,0.22)" stroke-width="2"/>
    ${slices}
    <circle cx="100" cy="100" r="42" fill="#6f4127" stroke="#f0c56a" stroke-width="4"/>
    <circle cx="100" cy="100" r="16" fill="#f6ddb0"/>
  </svg>`;
}

function renderBlackjackCard(rank, index, hidden = false) {
  if (hidden) {
    return `<div class="bj-card is-hidden" style="--card-order:${index}">
      <svg class="bj-card-svg" viewBox="0 0 160 220" aria-hidden="true">
        <rect x="8" y="8" width="144" height="204" rx="18" fill="#2a1d14" stroke="#f0c56a" stroke-width="6"/>
        <rect x="26" y="26" width="108" height="168" rx="12" fill="none" stroke="rgba(255,241,213,0.18)" stroke-width="4"/>
        <path d="M32 64 L80 32 L128 64 L80 96 Z" fill="#f0c56a" opacity="0.76"/>
        <path d="M32 156 L80 124 L128 156 L80 188 Z" fill="#c4513d" opacity="0.76"/>
      </svg>
    </div>`;
  }
  const suit = getBlackjackSuit(rank, index);
  return `<div class="bj-card" style="--card-order:${index}">
    <svg class="bj-card-svg ${suit}" viewBox="0 0 160 220" aria-hidden="true">
      <rect x="8" y="8" width="144" height="204" rx="18" fill="#fbf5e6" stroke="#d1b07b" stroke-width="6"/>
      <rect x="22" y="22" width="116" height="176" rx="12" fill="none" stroke="rgba(70,43,22,0.14)" stroke-width="3"/>
      <text x="28" y="46" font-size="26" font-family="'Press Start 2P', monospace" fill="currentColor">${escapeHTML(rank)}</text>
      <text x="132" y="188" font-size="26" text-anchor="end" font-family="'Press Start 2P', monospace" fill="currentColor">${escapeHTML(rank)}</text>
      <g transform="translate(44 66) scale(0.72)">${renderSuitGlyph(suit)}</g>
      <g transform="translate(44 118) scale(0.72)">${renderSuitGlyph(suit)}</g>
    </svg>
  </div>`;
}

function getItemIcon(item) {
  if (!item) return "GEAR";
  if (item.icon) return item.icon;
  if (item.name.includes("Shard")) return item.name.startsWith("Blue") ? "BSHD" : "GSHD";
  if (item.name.includes("Scrap")) return "SCRP";
  if (item.slot === "cap") return "CAP";
  if (item.slot === "shirt") return "SUIT";
  if (item.slot === "pants") return "LEG";
  if (item.slot === "shoes") return "BOOT";
  return "GEAR";
}

function getMatchState() {
  const isDead = (currentUser.currentHp || 0) <= 0;
  if (menuPausedCombat) return "Pausiert";
  if (combatActive) {
    if (waveState.nextWaveAt && waveState.current > 0 && waveState.pendingSpawns === 0 && mobs.length === 0) return "Wellenpause";
    return waveState.bossWave ? "Bosskampf" : "Im Kampf";
  }
  if (isDead) return "Tot";
  return "Bereit";
}

function getTopbarTitle(tab) {
  if (tab === "game") return "Spiel";
  if (tab === "lootboxen") return "Kisten";
  if (tab === "inventory") return "Inventar";
  if (tab === "kasino") return "Kasino";
  if (tab === "profile") return "Profil";
  if (tab === "leaderboard") return "Bestenliste";
  return "NOXA";
}

function showModal(title, message, type = "success", extraHTML = "") {
  const modal = document.createElement("div");
  modal.className = "custom-modal";
  modal.innerHTML = `
    <div class="modal-content ${type}">
      <h2>${title}</h2>
      <p>${message}</p>
      ${extraHTML}
      <button onclick="this.closest('.custom-modal').remove()" class="primary-btn">Schließen</button>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add("show"), 10);
}

function createFlyingDrop(type, value) {
  const drop = document.createElement("div");
  drop.className = `floating-drop ${type}`;
  drop.style.left = `${window.innerWidth / 2}px`;
  drop.style.top = `${window.innerHeight / 2}px`;
  if (type === "coin") drop.textContent = `+ ${Math.max(1, Math.floor(value || 1))} CR`;
  if (type === "scrap") drop.textContent = "+ SCRAP";
  if (type === "xp") drop.textContent = `+ ${value} XP`;
  if (type === "lootbox") drop.textContent = `+ ${value} Kiste${value === 1 ? "" : "n"}`;
  document.body.appendChild(drop);
  setTimeout(() => {
    drop.style.transform = `translate(${130 - window.innerWidth / 2}px, ${20 - window.innerHeight / 2}px) scale(.35)`;
    drop.style.opacity = "0";
  }, 50);
  setTimeout(() => drop.remove(), 1300);
}

function showLootboxReel(wonItem) {
  const modal = document.createElement("div");
  modal.className = "custom-modal";
  modal.innerHTML = `
    <div class="modal-content modal-wide">
      <h2>Kiste wird geöffnet</h2>
      <div class="reel-wrapper">
        <div class="reel-title">Beutetafel</div>
        <div class="reel-container">
          <div class="reel" id="reelStrip"></div>
          <div class="reel-marker"><div class="reel-marker-arrow"></div><div class="reel-marker-line"></div></div>
          <div class="reel-marker-bottom"><div class="reel-marker-arrow-up"></div></div>
        </div>
      </div>
      <div id="spinStatus" class="spin-status">DREHT...</div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add("show"), 10);
  const strip = document.getElementById("reelStrip");
  const status = document.getElementById("spinStatus");
  const targetIndex = 26;
  const reelItems = Array.from({ length: 40 }, (_, index) => {
    if (index === targetIndex) return wonItem;
    return LOOT_SHOWCASE[Math.floor(Math.random() * LOOT_SHOWCASE.length)];
  });
  strip.innerHTML = reelItems.map((item) => `
    <div class="reel-item ${item.rarity || "common"}">
      <div class="item-emblem">${getItemIcon(item)}</div>
      <div class="item-name">${item.name}</div>
      <div class="item-rarity">${item.rarity || "common"}</div>
    </div>`).join("");
  requestAnimationFrame(() => {
    strip.style.transition = "transform 3800ms cubic-bezier(0.25, 0.1, 0.25, 1)";
    strip.style.transform = `translateX(-${Math.max(0, targetIndex * 150 - 390)}px)`;
  });
  setTimeout(() => {
    status.textContent = "GEWONNEN";
    status.classList.add("revealing");
    setTimeout(() => {
      modal.remove();
      showModal(
        "Loot gesichert",
        `Du hast <strong>${wonItem.name}</strong> erhalten.`,
        "success",
        `<div class="win-card ${wonItem.rarity || "common"}"><div class="win-icon">${getItemIcon(wonItem)}</div><h3>${wonItem.name}</h3></div>`
      );
    }, 800);
  }, 3900);
}

function renderAuth(tab = "login") {
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand auth-brand-card">NOXA</div>
        <div class="eyebrow auth-kicker">Login / Register</div>
        <div class="auth-tabs">
          <button onclick="renderAuth('login')" class="${tab === "login" ? "auth-tab active" : "auth-tab"}">Login</button>
          <button onclick="renderAuth('register')" class="${tab === "register" ? "auth-tab active" : "auth-tab"}">Register</button>
        </div>
        <h2>${tab === "login" ? "Login" : "Register"}</h2>
        <p class="auth-copy">${tab === "login" ? "Melde dich an und gehe direkt ins Spiel." : "Erstelle deinen Account und starte danach direkt im Hub."}</p>
        <input id="user" class="auth-input" placeholder="Username" />
        <input id="pass" class="auth-input" type="password" placeholder="Passwort" />
        <button onclick="${tab === "login" ? "login()" : "register()"}" class="primary-btn auth-submit">${tab === "login" ? "Login" : "Register"}</button>
      </div>
    </div>`;
}

async function login() {
  const username = document.getElementById("user").value.trim();
  const password = document.getElementById("pass").value;
  if (username.length < 3 || password.length < 6) return showModal("Fehler", "Username mindestens 3 Zeichen, Passwort mindestens 6 Zeichen.", "error");
  try {
    await request("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
    bootstrap();
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
}

async function register() {
  const username = document.getElementById("user").value.trim();
  const password = document.getElementById("pass").value;
  if (username.length < 3 || password.length < 6) return showModal("Fehler", "Username mindestens 3 Zeichen, Passwort mindestens 6 Zeichen.", "error");
  try {
    await request("/api/register", { method: "POST", body: JSON.stringify({ username, password }) });
    bootstrap();
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
}

function renderApp() {
  app.innerHTML = `
    <div class="game-shell">
      <section class="game-window">
        <div class="game-stage-shell">
          ${renderArenaStage()}
        </div>
      </section>
    </div>`;
  ensureLoops();
  switchTab(currentTab);
}

function ensureLoops() {
  if (!spawnInterval) spawnInterval = setInterval(() => tickCombatLoop(), 220);
  if (!playerHpInterval) {
    playerHpInterval = setInterval(() => {
      if (!combatActive) return;
      const incomingDamage = getIncomingDamage();
      if (incomingDamage > 0) takeDamage(incomingDamage);
    }, 1000);
  }
  if (!syncInterval) {
    syncInterval = setInterval(async () => {
      try {
        const data = await request("/api/me");
        currentUser = data.user;
        updateUI();
      } catch (_) {}
    }, 8000);
  }
}

function clearArena() {
  mobs.forEach((mob) => mob.remove());
  mobs = [];
  const container = document.getElementById("mobsContainer");
  if (container) container.innerHTML = "";
}

function refreshArenaStage() {
  const shell = document.querySelector(".game-stage-shell");
  if (shell) shell.innerHTML = renderArenaStage();
}

function closeGameMenu() {
  menuOpen = false;
  menuSectionOpen = false;
  if (menuPausedCombat && (currentUser.currentHp || 0) > 0) combatActive = true;
  menuPausedCombat = false;
  const panel = document.getElementById("gameMenuPanel");
  const button = document.getElementById("gameMenuToggle");
  const home = document.getElementById("gameMenuHome");
  const section = document.getElementById("gameMenuSectionShell");
  if (panel) panel.classList.remove("open");
  if (button) button.classList.remove("active");
  if (home) home.classList.add("hidden");
  if (section) section.classList.remove("open");
}

function openGameMenu() {
  menuOpen = true;
  menuSectionOpen = false;
  menuPausedCombat = combatActive;
  combatActive = false;
  const panel = document.getElementById("gameMenuPanel");
  const button = document.getElementById("gameMenuToggle");
  if (panel) panel.classList.add("open");
  if (button) button.classList.add("active");
  const home = document.getElementById("gameMenuHome");
  const section = document.getElementById("gameMenuSectionShell");
  if (home) home.classList.remove("hidden");
  if (section) section.classList.remove("open");
  if (panel) panel.classList.remove("open");
}

window.toggleGameMenu = function() {
  if (menuOpen) closeGameMenu();
  else openGameMenu();
  if (currentTab === "game") switchTab("game");
  else updateUI();
};

window.openMenuSection = async function(tab) {
  menuSectionOpen = true;
  const panel = document.getElementById("gameMenuPanel");
  const home = document.getElementById("gameMenuHome");
  const section = document.getElementById("gameMenuSectionShell");
  if (home) home.classList.add("hidden");
  if (section) section.classList.add("open");
  if (panel) panel.classList.add("open");
  await switchTab(tab);
};

window.backToGameMenu = function() {
  menuSectionOpen = false;
  const panel = document.getElementById("gameMenuPanel");
  const home = document.getElementById("gameMenuHome");
  const section = document.getElementById("gameMenuSectionShell");
  const content = document.getElementById("content");
  const heading = document.getElementById("moduleTitle");
  if (panel) panel.classList.remove("open");
  if (home) home.classList.remove("hidden");
  if (section) section.classList.remove("open");
  if (content) content.innerHTML = "";
  if (heading) heading.textContent = "Menü";
  document.querySelectorAll(".nav-btn").forEach((button) => button.classList.remove("active"));
};

async function startMatch() {
  try {
    const checkpointWave = waveState.checkpointWave || 0;
    if ((currentUser.currentHp || 0) <= 0) {
      const respawnData = await request("/api/respawn", { method: "POST" });
      currentUser = respawnData.user;
      showModal("Respawn bereit", `Du bist mit voller HP zurück und hast <strong>${respawnData.lostCoins}</strong> Coins verloren.`, "success");
    }
    combatActive = true;
    menuPausedCombat = false;
    clearArena();
    resetWaveState(checkpointWave);
    scheduleNextWave(500);
    refreshArenaStage();
    await switchTab("game");
    updateUI();
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
}

function stopMatch() {
  combatActive = false;
  menuPausedCombat = false;
  clearArena();
  resetWaveState(waveState.checkpointWave || 0);
  refreshArenaStage();
  if (currentTab === "game") switchTab("game");
}

function rectsOverlap(rectA, rectB) {
  return rectA.left < rectB.right &&
    rectA.right > rectB.left &&
    rectA.top < rectB.bottom &&
    rectA.bottom > rectB.top;
}

function getArenaHudSafeZone(area) {
  const stage = area.closest(".game-area");
  const hud = stage?.querySelector(".arena-hud");
  if (!hud) return null;

  const areaRect = area.getBoundingClientRect();
  const hudRect = hud.getBoundingClientRect();
  const rightPadding = 120;
  const bottomPadding = 72;

  return {
    left: 0,
    top: 0,
    right: Math.min(areaRect.width, hudRect.right - areaRect.left + rightPadding),
    bottom: Math.min(areaRect.height, hudRect.bottom - areaRect.top + bottomPadding)
  };
}

function renderArenaStage() {
  const isDead = (currentUser.currentHp || 0) <= 0;
  const hpPercent = Math.max(0, Math.floor(currentUser.currentHp / currentUser.maxHp * 100));
  const xpNeeded = currentUser.level * 60;
  const xpPercent = Math.min(100, Math.floor(currentUser.xp / xpNeeded * 100));
  const waveLabel = getWaveDisplayLabel();
  const menuSections = [
    { tab: "inventory", title: "Inventar", note: "Loadout, Items und Upgrades" },
    { tab: "lootboxen", title: "Kisten", note: "Cases, Drops und Beute" },
    { tab: "kasino", title: "Kasino", note: "Roulette, Slots, Blackjack" },
    { tab: "profile", title: "Profil", note: "Stats und Laufdaten" },
    { tab: "leaderboard", title: "Bestenliste", note: "Server-Ranglisten" }
  ];
  const stateClass = isDead ? "danger" : combatActive ? "live" : "idle";
  return `
    <div class="game-area ${combatActive ? "active" : "paused"}">
      <div class="arena-backdrop"></div>
      <button id="gameMenuToggle" onclick="toggleGameMenu()" class="game-menu-toggle ${menuOpen ? "active" : ""}">Menü</button>
      <div id="waveBanner" class="wave-banner ${combatActive ? "live" : ""} ${waveState.bossWave ? "boss" : waveState.current >= 4 ? "elite" : ""}">
        <span>Aktuelle Welle</span>
        <strong id="waveBannerText">${waveLabel}</strong>
      </div>
      <div class="arena-hud">
        <div class="hud-shell">
          <div class="hud-identity">
            <span class="hud-kicker">Aktiver Lauf</span>
            <div class="hud-name-row">
              <span class="player-hud-name">${currentUser.displayName}</span>
              <span id="playerMeta" class="hud-state-pill ${stateClass}">Level <span id="topLevel">${currentUser.level}</span> / ${getMatchState()}</span>
            </div>
          </div>
          <div class="hud-overview">
            <div class="hud-overview-item emphasis">
              <span class="hud-item-label">HP</span>
              <strong id="hpText"><span id="hpValue">${Math.floor(currentUser.currentHp)}</span> / ${currentUser.maxHp}</strong>
              <div class="hud-mini-track">
                <div id="hpBar" class="hud-mini-fill hp" style="width:${hpPercent}%"></div>
              </div>
            </div>
            <div class="hud-overview-item">
              <span class="hud-item-label">Coins</span>
              <strong><span id="coins">${Math.floor(currentUser.coins)}</span></strong>
            </div>
            <div class="hud-overview-item">
              <span class="hud-item-label">Kisten</span>
              <strong><span id="lootboxes">${currentUser.lootboxes}</span></strong>
            </div>
            <div class="hud-overview-item">
              <span class="hud-item-label">Welle</span>
              <strong id="waveInfoText">${waveLabel}</strong>
            </div>
          </div>
          <div class="hud-subgrid">
            <div class="hud-inline-pill">
              <span>DMG</span>
              <strong id="dmg">${currentUser.dmg}</strong>
            </div>
            <div class="hud-inline-pill">
              <span>DEF</span>
              <strong id="defense">${currentUser.defense || 0}</strong>
            </div>
            <div class="hud-inline-pill xp-pill">
              <span>XP</span>
              <strong id="xpText">${currentUser.xp} / ${xpNeeded}</strong>
              <div class="hud-mini-track">
                <div id="xpBar" class="hud-mini-fill xp" style="width:${xpPercent}%"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="target-reticle"></div>
      <div class="player-aggro-ring"></div>
      <div class="player-core" id="playerSlime"></div>
      <div class="player-core-label">SPIELER</div>
      <div id="mobsContainer" class="mobs-container"></div>
      <div class="arena-floor"></div>
      <div id="gameMenuHome" class="game-menu-home ${menuOpen && !menuSectionOpen ? "" : "hidden"}">
        <div class="game-menu-grid">
          ${menuSections.map((section) => `
            <button onclick="openMenuSection('${section.tab}')" class="menu-launch-btn">
              <span class="menu-launch-copy">
                <strong>${section.title}</strong>
                <small>${section.note}</small>
              </span>
            </button>`).join("")}
        </div>
      </div>
      <aside id="gameMenuPanel" class="game-menu-panel ${menuOpen && menuSectionOpen ? "open" : ""}">
        <div id="gameMenuSectionShell" class="game-menu-section-shell ${menuSectionOpen ? "open" : ""}">
          <div class="game-module-head">
            <div>
              <span class="eyebrow">Fenster</span>
              <h2 id="moduleTitle">${getTopbarTitle(currentTab)}</h2>
            </div>
            <div class="game-menu-actions">
              <button onclick="backToGameMenu()" class="ghost-btn">Zurück</button>
              <button onclick="toggleGameMenu()" class="ghost-btn">Schließen</button>
            </div>
          </div>
          <div id="content" class="game-module-content"></div>
        </div>
      </aside>
      ${combatActive ? "" : `<div class="game-overlay ${isDead ? "dead" : ""}"><div class="overlay-card"><div class="overlay-kicker">${isDead ? "Respawn nötig" : "Start"}</div><h3>${isDead ? "Du bist tot" : "Bereit"}</h3><p>${isDead ? "Du spawnst nicht automatisch. Starte die Runde neu, wenn du wieder kämpfen willst." : "Alles sitzt jetzt direkt im Spiel. Starte den Kampf ohne die Szene zu verlassen."}</p><button onclick="startMatch()" class="primary-btn overlay-action">Start</button></div></div>`}
    </div>`;
}

function renderGame() {
  const isDead = (currentUser.currentHp || 0) <= 0;
  const xpNeeded = currentUser.level * 60;
  const waveProgress = waveState.current ? `${waveState.defeated} / ${waveState.totalSpawns}` : "0 / 0";
  return `
    <section class="panel ingame-panel">
      <div class="panel-head">
        <div class="section-caption">
          <span>Übersicht</span>
          <h2>Spielstatus</h2>
        </div>
        <div class="state-badge ${combatActive ? "live" : "idle"}">${combatActive ? "AKTIV" : "PAUSE"}</div>
      </div>
      <div class="brief-list">
        <div class="brief-item"><span>Status</span><strong>${combatActive ? getMatchState() : isDead ? "Wiederbelebung nötig" : "Im Hub"}</strong></div>
        <div class="brief-item"><span>Welle</span><strong id="gameWaveValue">${getWaveDisplayLabel()}</strong></div>
        <div class="brief-item"><span>Fortschritt</span><strong id="waveProgressValue">${waveProgress}</strong></div>
        <div class="brief-item"><span>Attacke</span><strong>${currentUser.dmg}</strong></div>
        <div class="brief-item"><span>Rüstung</span><strong>${currentUser.defense || 0}</strong></div>
        <div class="brief-item"><span>Coins</span><strong>${Math.floor(currentUser.coins)}</strong></div>
      </div>
      <div class="threat-panel">
        <div class="brief-item"><span>Checkpoint</span><strong id="checkpointValue">${getCheckpointLabel()}</strong></div>
        <div class="brief-item"><span>Nächster Boss</span><strong id="nextBossValue">Welle ${getNextBossWave()}</strong></div>
        <div class="brief-item"><span>Kisten</span><strong>${currentUser.lootboxes}</strong></div>
        <div class="brief-item"><span>XP</span><strong>${currentUser.xp} / ${xpNeeded}</strong></div>
        <p class="panel-note">Die Gegner kommen jetzt in echten Wellen, werden härter und schicken dir alle fünf Wellen einen Boss entgegen.</p>
      </div>
      <div class="panel-actions">
        ${combatActive ? `<button onclick="stopMatch()" class="inventory-action-btn full-width">Kampf pausieren</button>` : `<button onclick="startMatch()" class="inventory-action-btn full-width">Kampf starten</button>`}
      </div>
    </section>`;
}

function spawnMob(config = getWaveConfig(Math.max(1, waveState.current || 1))) {
  const area = document.getElementById("mobsContainer");
  if (!combatActive || !area) return;
  const mob = document.createElement("div");
  mob.className = `mob ${config.mobClass}`;
  const areaRect = area.getBoundingClientRect();
  const safeZone = getArenaHudSafeZone(area);
  const mobWidth = config.width || 88;
  const mobHeight = config.height || mobWidth;
  const maxLeftPercent = Math.max(14, 92 - mobWidth / Math.max(1, areaRect.width) * 100);
  const maxTopPercent = Math.max(18, 78 - mobHeight / Math.max(1, areaRect.height) * 100);
  const randomLeft = () => 6 + Math.random() * Math.max(8, maxLeftPercent - 6);
  const randomTop = () => 12 + Math.random() * Math.max(8, maxTopPercent - 12);
  let leftPercent = randomLeft();
  let topPercent = randomTop();

  for (let attempt = 0; attempt < 24; attempt++) {
    const candidateLeft = randomLeft();
    const candidateTop = randomTop();
    const candidateRect = {
      left: areaRect.width * candidateLeft / 100,
      top: areaRect.height * candidateTop / 100,
      right: areaRect.width * candidateLeft / 100 + mobWidth,
      bottom: areaRect.height * candidateTop / 100 + mobHeight
    };

    if ((!safeZone || !rectsOverlap(candidateRect, safeZone)) && !isCandidateInsidePlayerZone(candidateRect, area)) {
      leftPercent = candidateLeft;
      topPercent = candidateTop;
      break;
    }

    if (attempt === 23) {
      leftPercent = Math.min(maxLeftPercent, Math.max(58, maxLeftPercent - 6));
      topPercent = Math.min(maxTopPercent, 16 + Math.random() * Math.max(10, maxTopPercent - 16));
    }
  }

  mob.style.width = `${mobWidth}px`;
  mob.style.height = `${mobHeight}px`;
  mob.innerHTML = `<div class="mob-core"></div><div class="mob-hp"><div class="mob-hp-bar"></div></div><div class="mob-sigil">${config.sigil}</div>`;
  mob.dataset.hp = String(config.hp);
  mob.dataset.maxHp = String(config.hp);
  mob.dataset.damage = String(config.damage);
  mob.dataset.tier = String(config.rewardTier);
  mob.dataset.boss = String(config.bossWave);
  mob.dataset.dead = "false";
  mob.dataset.attacking = "false";
  mob.dataset.width = String(mobWidth);
  mob.dataset.height = String(mobHeight);
  mob.dataset.speed = String(config.speed || 58);
  mob.onclick = () => killMob(mob);
  area.appendChild(mob);
  applyMobPosition(
    mob,
    areaRect.width * leftPercent / 100 + mobWidth / 2,
    areaRect.height * topPercent / 100 + mobHeight / 2
  );
  mobs.push(mob);
  updateUI();
}

async function killMob(mobElement) {
  if (!combatActive || mobElement.dataset.dead === "true") return;
  let hp = parseInt(mobElement.dataset.hp, 10) - (currentUser.dmg || 1);
  mobElement.dataset.hp = String(hp);
  const bar = mobElement.querySelector(".mob-hp-bar");
  if (bar) bar.style.width = `${Math.max(0, hp / parseInt(mobElement.dataset.maxHp, 10) * 100)}%`;
  if (hp <= 0) {
    mobElement.dataset.dead = "true";
    mobElement.style.pointerEvents = "none";
    mobElement.style.transform = "scale(0)";
    setTimeout(() => {
      mobElement.remove();
      mobs = mobs.filter((mob) => mob !== mobElement);
      updateUI();
    }, 180);
    const data = await request("/api/kill-mob", {
      method: "POST",
      body: JSON.stringify({
        tier: parseInt(mobElement.dataset.tier, 10) || 1,
        boss: mobElement.dataset.boss === "true"
      })
    });
    currentUser = data.user;
    waveState.defeated += 1;
    if (mobElement.dataset.boss === "true") unlockCheckpoint(waveState.current);
    updateUI();
    createFlyingDrop("coin", data.goldGain || 1);
    createFlyingDrop("scrap", 1);
    createFlyingDrop("xp", data.xpGain || 15);
    if (data.lootboxesGained) createFlyingDrop("lootbox", data.lootboxesGained);
    if (data.leveledUp) showLevelUpChoice(data.levelsGained);
  } else {
    mobElement.style.transform = "scale(1.12)";
    setTimeout(() => {
      mobElement.style.transform = "";
    }, 120);
  }
}

function showLevelUpChoice(levelsGained) {
  const modal = document.createElement("div");
  modal.className = "custom-modal";
  modal.innerHTML = `
    <div class="modal-content success">
      <h2>Level Up +${levelsGained}</h2>
      <p>Wähle den Bonus für deinen nächsten Run.</p>
      <div class="modal-actions split">
        <button onclick="applyLevelBonus('dmg');this.closest('.custom-modal').remove()" class="primary-btn">+1 Schaden</button>
        <button onclick="applyLevelBonus('hp');this.closest('.custom-modal').remove()" class="ghost-btn">+15 HP</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add("show"), 10);
}

window.applyLevelBonus = async function(choice) {
  try {
    const data = await request("/api/apply-level-bonus", { method: "POST", body: JSON.stringify({ choice }) });
    currentUser = data.user;
    updateUI();
    showModal("Bonus angewendet", choice === "dmg" ? "+1 Schaden erhalten." : "+15 HP erhalten.", "success");
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
};

async function takeDamage(damage) {
  if (!combatActive) return;
  const data = await request("/api/take-damage", { method: "POST", body: JSON.stringify({ damage }) });
  currentUser = data.user;
  updateUI();
  if (data.isDead) {
    combatActive = false;
    menuPausedCombat = false;
    clearArena();
    resetWaveState(waveState.checkpointWave || 0);
    refreshArenaStage();
    if (currentTab === "game") switchTab("game");
    showModal("Held gefallen", "Kein Auto-Respawn mehr. Starte deinen Lauf im Hub neu, wenn du wieder in die Wildnis willst.", "error");
  }
}

function renderLootboxen() {
  return `
    <section class="panel">
      <div class="panel-head">
        <div class="section-caption">
          <span>Kistenbereich</span>
          <h2>Kisten</h2>
        </div>
        <div class="price-tag">${LOOTBOX_OFFERS.length} Slots</div>
      </div>
      <p class="panel-note">Sauber vorbereitet für mehrere Kisten. Aktuell ist die Starter-Kiste live, weitere Slots können später direkt erweitert werden.</p>
      <div class="lootbox-catalog">
        ${LOOTBOX_OFFERS.map((box) => `
          <article class="lootbox-offer ${box.accent}">
            <div class="lootbox-offer-head">
              <div>
                <span class="eyebrow">${box.label}</span>
                <h3>${box.title}</h3>
              </div>
              <div class="price-tag">${box.price} Coins</div>
            </div>
            <p class="lootbox-offer-copy">${box.description}</p>
            <div class="lootbox-preview-grid">
              ${box.loot.map((item) => `
                <div class="lootbox-preview-item ${item.rarity}">
                  <div class="loot-icon">${item.icon}</div>
                  <strong>${item.name}</strong>
                  <span>${item.chance}</span>
                </div>`).join("")}
            </div>
            <div class="panel-actions lootbox-offer-actions">
              ${box.action === "open"
                ? `<button onclick="openLootboxen()" id="openLootBtn" class="open-case-btn full-width">Starter-Kiste öffnen</button>`
                : `<button class="ghost-btn full-width" disabled>Bald verfügbar</button>`
              }
            </div>
          </article>`).join("")}
      </div>
    </section>`;
}

async function openLootboxen() {
  const btn = document.getElementById("openLootBtn");
  if (btn) {
    btn.disabled = true;
    btn.style.transform = "scale(.96)";
    setTimeout(() => {
      btn.style.transform = "";
    }, 180);
  }
  try {
    const data = await request("/api/open-starter-box", { method: "POST" });
    currentUser = data.user;
    updateUI();
    showLootboxReel(data.itemWon);
    if (currentTab === "lootboxen") switchTab("lootboxen");
  } catch (e) {
    showModal("Fehler", e.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}
function renderInventory() {
  const equipped = currentUser.equipped || {};
  const inventoryItems = currentUser.inventory || [];
  return `
    <section class="panel">
      <div class="panel-head">
        <div class="section-caption">
          <span>Ausrüstung</span>
          <h2>Inventar</h2>
        </div>
      </div>
      <div class="inventory-layout">
        <div class="character-shell">
          <div class="character-stage">
            <div class="player-rank">Level ${currentUser.level}</div>
            <div class="character-slots-overlay">
              ${["cap", "shirt", "pants", "shoes"].map((slot) => {
                const item = equipped[slot];
                return `
                  <div class="slot-overlay slot-overlay-${slot}">
                    <div class="slot-label">${slot.toUpperCase()}</div>
                    <div
                      class="slot-box ${item ? "filled" : ""}"
                      ondblclick="unequipItem('${slot}')"
                      ondragover="allowInventoryDrop(event)"
                      ondrop="handleEquipDrop('${slot}', event)"
                      ${item ? `draggable="true" ondragstart="startInventoryDrag(event, 'equipped-slot', '${slot}')"` : ""}
                    >
                      ${item ? `<div class="slot-icon">${getItemIcon(item)}</div><div class="slot-level">Lv. ${item.upgradeLevel || 0}</div>` : `<div class="slot-empty">+</div>`}
                    </div>
                  </div>`;
              }).join("")}
            </div>
            <div class="player-core showcase"></div>
            <div class="player-core-label">SPIELER</div>
          </div>
          <div class="inventory-character-note">Item auf einen Slot ziehen zum Anziehen. Slot doppelklicken oder in die Item-Liste ziehen zum Ausziehen.</div>
        </div>
        <div class="inventory-panel-drop" ondragover="allowInventoryDrop(event)" ondrop="handleInventoryDrop(event)">
          <div class="inventory-headline">
            <h3 class="section-title">Items</h3>
            <p class="panel-note">Drag-and-drop, direkt ausruesten und Upgrades ohne gequetschte Buttons.</p>
          </div>
          <div class="grid inventory-grid compact-grid">
            ${inventoryItems.length ? inventoryItems.map((item) => {
              const actions = [];
              if (item.slot) actions.push(`<button onclick="equipItem('${item.id}');event.stopImmediatePropagation()" class="inventory-action-btn action-equip">Anziehen</button>`);
              if (item.type === "sellable") actions.push(`<button onclick="sellItem('${item.id}');event.stopImmediatePropagation()" class="inventory-action-btn action-sell">Verkaufen</button>`);
              if (item.slot && (item.rarity === "gray" || item.rarity === "green")) actions.push(`<button onclick="openUpgradeModal('${item.id}');event.stopImmediatePropagation()" class="inventory-action-btn action-upgrade">Verbessern</button>`);
              return `
                <div
                  class="card ${item.rarity || "common"} item-card compact-item-card ${item.slot ? "draggable-item" : ""}"
                  ${item.slot ? `draggable="true" ondragstart="startInventoryDrag(event, 'inventory-item', '${item.id}')"` : ""}
                >
                  <div class="item-card-top">
                    <div class="item-emblem compact-emblem">${getItemIcon(item)}</div>
                    <div class="item-copy">
                      <h3>${item.name} ${item.quantity > 1 ? `<span class="item-qty">x${item.quantity}</span>` : ""}</h3>
                      <p class="item-meta">${item.rarity || "common"} ${item.upgradeLevel !== undefined ? ` / Lv.${item.upgradeLevel}` : ""}</p>
                    </div>
                  </div>
                  <div class="item-stats">
                    ${item.dmgBonus ? `<p>Schaden +${item.dmgBonus}</p>` : ""}
                    ${item.hpBonus ? `<p>HP +${item.hpBonus}</p>` : ""}
                    ${item.defenseBonus ? `<p>Verteidigung +${item.defenseBonus}</p>` : ""}
                    ${!item.slot ? `<p>Wert ${Math.floor((item.value || 0) * 0.65)} Coins</p>` : ""}
                  </div>
                  ${actions.length ? `<div class="item-actions item-actions-${actions.length}">${actions.join("")}</div>` : ""}
                </div>`;
            }).join("") : `<div class="panel-note">Dein Inventar ist aktuell leer.</div>`}
          </div>
        </div>
      </div>
    </section>`;
}

window.startInventoryDrag = function(event, type, value) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData("text/plain", JSON.stringify({ type, value }));
  event.dataTransfer.effectAllowed = "move";
};

window.allowInventoryDrop = function(event) {
  event.preventDefault();
};

window.handleEquipDrop = async function(slot, event) {
  event.preventDefault();
  const raw = event.dataTransfer?.getData("text/plain");
  if (!raw) return;
  try {
    const payload = JSON.parse(raw);
    if (payload.type !== "inventory-item") return;
    await equipItem(payload.value);
  } catch (_) {}
};

window.handleInventoryDrop = async function(event) {
  event.preventDefault();
  const raw = event.dataTransfer?.getData("text/plain");
  if (!raw) return;
  try {
    const payload = JSON.parse(raw);
    if (payload.type !== "equipped-slot") return;
    await unequipItem(payload.value);
  } catch (_) {}
};

async function equipItem(itemId) {
  try {
    const data = await request("/api/equip-item", { method: "POST", body: JSON.stringify({ itemId }) });
    currentUser = data.user;
    updateUI();
    if (currentTab === "inventory") switchTab("inventory");
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
}

async function unequipItem(slot) {
  try {
    const data = await request("/api/unequip-item", { method: "POST", body: JSON.stringify({ slot }) });
    currentUser = data.user;
    updateUI();
    if (currentTab === "inventory") switchTab("inventory");
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
}

function getInventoryItem(itemId) {
  return (currentUser.inventory || []).find((entry) => String(entry.id) === String(itemId));
}

function showSellModal(itemId) {
  const item = getInventoryItem(itemId);
  if (!item || item.type !== "sellable") return showModal("Fehler", "Item kann nicht verkauft werden.", "error");
  const maxQty = item.quantity || 1;
  const valuePer = item.value || 0;
  const modal = document.createElement("div");
  modal.className = "custom-modal";
  modal.innerHTML = `
    <div class="modal-content success">
      <h2>${escapeHTML(item.name)} verkaufen</h2>
      <p>Verfügbar: <strong>${maxQty}</strong></p>
      <input id="sellQtyInput" type="number" min="1" max="${maxQty}" value="${maxQty}" class="auth-input" />
      <p class="modal-note">Wert pro St?ck: <strong>${Math.floor(valuePer * 0.65)} Coins</strong></p>
      <div class="modal-actions">
        <button onclick="this.closest('.custom-modal').remove()" class="inventory-action-btn">Abbrechen</button>
        <button onclick="confirmSell('${itemId}')" class="inventory-action-btn">Verkaufen</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add("show"), 10);
}

async function sellItem(itemId) {
  showSellModal(itemId);
}

window.confirmSell = async function(itemId) {
  const input = document.getElementById("sellQtyInput");
  const item = getInventoryItem(itemId);
  if (!item) return showModal("Fehler", "Item nicht gefunden.", "error");
  const qty = Math.max(1, Math.min(item.quantity || 1, parseInt(input.value, 10) || 1));
  input.closest(".custom-modal").remove();
  try {
    const data = await request("/api/sell-item", { method: "POST", body: JSON.stringify({ itemId, quantity: qty }) });
    currentUser = data.user;
    updateUI();
    showModal("Verkauft", `${data.soldQty}x ${data.itemName} für <strong>${data.soldFor}</strong> Coins.`, "success");
    if (currentTab === "inventory") switchTab("inventory");
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
};

window.confirmUpgrade = async function(itemId) {
  const input = document.getElementById("upgradeShardInput");
  const item = getInventoryItem(itemId);
  if (!input || !item) return showModal("Fehler", "Item nicht gefunden.", "error");
  const amount = Math.max(1, parseInt(input.value, 10) || 1);
  input.closest(".custom-modal").remove();
  try {
    const data = await request("/api/upgrade-item-progress", { method: "POST", body: JSON.stringify({ itemId, amount }) });
    currentUser = data.user;
    updateUI();
    showModal(
      data.upgraded ? "Upgrade erfolgreich" : "Shards eingesetzt",
      data.upgraded
        ? `${item.name} wurde verbessert.`
        : `${data.used} ${data.shardName} wurden eingesetzt.`,
      "success"
    );
    if (currentTab === "inventory") switchTab("inventory");
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
};

window.openUpgradeModal = function(itemId) {
  const item = getInventoryItem(itemId);
  if (!item || !item.slot) return showModal("Fehler", "Item nicht gefunden.", "error");
  const isGray = item.rarity === "gray";
  const isGreen = item.rarity === "green";
  if (!isGray && !isGreen) return showModal("Hinweis", "Dieses Item kann nicht weiter verbessert werden.", "error");

  const shardName = isGray ? "Green Shard" : "Blue Shard";
  const needed = isGray ? 30 : 50;
  const progress = item.progress || 0;
  const available = (currentUser.inventory || []).reduce((sum, entry) => entry.name === shardName ? sum + (entry.quantity || 1) : sum, 0);
  const maxUse = Math.max(1, Math.min(available, needed - progress));

  const modal = document.createElement("div");
  modal.className = "custom-modal";
  modal.innerHTML = `
    <div class="modal-content success upgrade-modal">
      <h2>${escapeHTML(item.name)} verbessern</h2>
      <div class="upgrade-summary">
        <div class="item-emblem">${getItemIcon(item)}</div>
        <div>
          <p class="item-meta">${item.rarity} / Lv.${item.upgradeLevel || 0}</p>
          <p>Fortschritt <strong>${progress}/${needed}</strong></p>
          <p>Verfügbar <strong>${available} ${shardName}</strong></p>
        </div>
      </div>
      <div class="xp-track full-width"><div class="xp-fill" style="width:${Math.min(100, progress / needed * 100)}%"></div></div>
      <input id="upgradeShardInput" type="number" min="1" max="${maxUse}" value="${maxUse}" class="auth-input" ${available <= 0 ? "disabled" : ""} />
      <p class="modal-note">Nutze Shards direkt aus dem Inventar. Kein Amboss mehr.</p>
      <div class="modal-actions">
        <button onclick="this.closest('.custom-modal').remove()" class="inventory-action-btn">Schließen</button>
        <button onclick="confirmUpgrade('${item.id}')" class="inventory-action-btn" ${available <= 0 ? "disabled" : ""}>Shards nutzen</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add("show"), 10);
}

function renderKasino() {
  return `
    <section class="panel">
      <div class="panel-head">
        <div class="section-caption">
          <span>Glücksspiel</span>
          <h2>Kasino</h2>
        </div>
      </div>
      <div class="section-switch casino-switch">
        <button onclick="switchCasinoGame('roulette')" class="${currentCasinoGame === "roulette" ? "filter-btn active" : "filter-btn"}">Roulette</button>
        <button onclick="switchCasinoGame('slots')" class="${currentCasinoGame === "slots" ? "filter-btn active" : "filter-btn"}">Slots</button>
        <button onclick="switchCasinoGame('blackjack')" class="${currentCasinoGame === "blackjack" ? "filter-btn active" : "filter-btn"}">Blackjack</button>
      </div>
      ${currentCasinoGame === "roulette" ? renderRouletteGame() : currentCasinoGame === "slots" ? renderSlotsGame() : renderBlackjackGame()}
    </section>`;
}

function renderRouletteGame() {
  const roulette = casinoVisualState.roulette;
  const selectedColor = roulette.selectedColor || "rot";
  const landedColor = roulette.landedColor || "rot";
  return `
    <div class="casino-shell roulette-layout">
      <div class="card casino-stage roulette-stage ${roulette.spinning ? "is-spinning" : ""}">
        <div class="casino-stage-head">
          <div class="item-emblem casino-emblem roulette">${renderRouletteWheelSvg(roulette.rolledNumber)}</div>
          <div>
            <h3>Roulette</h3>
            <p>Setze auf rot, schwarz oder grün. Die Animation läuft komplett über CSS.</p>
          </div>
        </div>
        <div class="roulette-wheel-shell">
          <div class="roulette-pointer"></div>
          <div id="rouletteWheel" class="roulette-wheel ${roulette.spinning ? "spinning" : ""}">
            ${renderRouletteWheelSvg(roulette.rolledNumber)}
          </div>
          <div id="rouletteBall" class="roulette-ball ${roulette.spinning ? "spinning" : landedColor}">
            <span></span>
          </div>
        </div>
        <div class="roulette-board">
          <div class="roulette-pocket ${roulette.rolledNumber !== null ? landedColor : ""}">
            <span>Letzte Zahl</span>
            <strong>${roulette.rolledNumber !== null ? roulette.rolledNumber : "--"}</strong>
          </div>
          <div class="roulette-chip ${selectedColor}">
            ${renderCasinoSymbol(`roulette-${selectedColor}`)}
            <span>${selectedColor}</span>
          </div>
        </div>
      </div>
      <div class="card casino-stage casino-controls">
        <div class="casino-stage-head">
          <div class="item-emblem casino-emblem chip">${renderCasinoSymbol(`roulette-${selectedColor}`)}</div>
          <div>
            <h3>Einsatz</h3>
            <p>Rot und Schwarz zahlen 2x, Grün zahlt 14x.</p>
          </div>
        </div>
        <input id="rouletteBet" class="auth-input" type="number" min="10" value="${roulette.betAmount}" placeholder="Einsatz" ${roulette.spinning ? "disabled" : ""} />
        <div class="panel-actions casino-bet-grid">
          <button onclick="playRoulette('rot')" class="casino-color-btn rot ${selectedColor === "rot" ? "selected" : ""}" ${roulette.spinning ? "disabled" : ""}>${renderCasinoSymbol("roulette-red")}<span>Rot</span></button>
          <button onclick="playRoulette('schwarz')" class="casino-color-btn schwarz ${selectedColor === "schwarz" ? "selected" : ""}" ${roulette.spinning ? "disabled" : ""}>${renderCasinoSymbol("roulette-black")}<span>Schwarz</span></button>
          <button onclick="playRoulette('gruen')" class="casino-color-btn gruen ${selectedColor === "gruen" ? "selected" : ""}" ${roulette.spinning ? "disabled" : ""}>${renderCasinoSymbol("roulette-green")}<span>Grün</span></button>
        </div>
        <div id="casinoResult" class="panel-note casino-result ${roulette.win ? "win" : roulette.rolledNumber !== null ? "lose" : ""}">${roulette.message}</div>
      </div>
    </div>`;
}

function renderSlotsGame() {
  const slots = casinoVisualState.slots;
  return `
    <div class="casino-shell slots-layout">
      <div class="card casino-stage">
        <div class="casino-stage-head">
          <div class="item-emblem casino-emblem slots">${renderCasinoSymbol("7")}</div>
          <div>
            <h3>Slot Machine</h3>
            <p>Drei gleiche Symbole bringen den grossen Gewinn. Zwei gleiche geben x2.</p>
          </div>
        </div>
        <div class="slot-machine ${slots.spinning ? "spinning" : ""}">
          ${slots.reels.map((symbol, index) => {
            const meta = getSlotSymbolMeta(symbol);
            return `
              <div class="slot-window" style="--slot-accent:${meta.accent};--slot-order:${index};">
                <div class="slot-window-glow"></div>
                <div class="slot-reel">
                  ${renderCasinoSymbol(symbol)}
                  <strong>${meta.label}</strong>
                </div>
              </div>`;
          }).join("")}
        </div>
        <p id="slotsResultLine" class="slots-result-line">${slots.reels.map((symbol) => getSlotSymbolMeta(symbol).label).join(" | ")}</p>
      </div>
      <div class="card casino-stage casino-controls">
        <div class="casino-stage-head">
          <div class="item-emblem casino-emblem crown">${renderCasinoSymbol("KRONE")}</div>
          <div>
            <h3>Walzen</h3>
            <p>7 zahlt x8, Krone x6, alle anderen Drillinge x5.</p>
          </div>
        </div>
        <input id="slotsBet" class="auth-input" type="number" min="10" value="${slots.betAmount}" placeholder="Einsatz" ${slots.spinning ? "disabled" : ""} />
        <button onclick="playSlots()" class="primary-btn full-width" ${slots.spinning ? "disabled" : ""}>Drehen</button>
        <div id="casinoResult" class="panel-note casino-result ${slots.win ? "win" : slots.multiplier > 0 ? "lose" : ""}">${slots.message}</div>
      </div>
    </div>`;
}

function renderBlackjackGame() {
  const game = blackjackState;
  const dealerCards = game ? game.dealerHand.map((card, index) => renderBlackjackCard(card, index, !game.finished && index === 1)).join("") : `<div class="bj-card bj-card-placeholder">?</div>`;
  const playerCards = game ? game.playerHand.map((card, index) => renderBlackjackCard(card, index)).join("") : `<div class="bj-card bj-card-placeholder">?</div>`;
  return `
    <div class="casino-shell blackjack-layout">
      <div class="card casino-stage casino-controls">
        <div class="casino-stage-head">
          <div class="item-emblem casino-emblem blackjack">${renderSuitMark("spade", "blackjack-emblem-svg")}</div>
          <div>
            <h3>Blackjack</h3>
            <p>21 schlagen, ohne drüber zu gehen. Karten und Symbole sind komplett als SVG gerendert.</p>
          </div>
        </div>
        <input id="blackjackBet" class="auth-input" type="number" min="10" value="${game?.betAmount || 100}" placeholder="Einsatz" ${game && !game.finished ? "disabled" : ""} />
        ${!game || game.finished ? `<button onclick="startBlackjack()" class="primary-btn full-width">Neue Runde</button>` : `<div class="panel-actions"><button onclick="blackjackHit()" class="primary-btn">Karte</button><button onclick="blackjackStand()" class="ghost-btn">Halten</button></div>`}
        <div id="casinoResult" class="panel-note casino-result ${game?.finished && (game?.resultText || "").includes("gewinn") ? "win" : game?.finished ? "lose" : ""}">${game?.resultText || "Noch keine Runde gestartet."}</div>
      </div>
      <div class="card casino-stage blackjack-table ${game && !game.finished ? "live" : ""}">
        <div class="blackjack-table-felt"></div>
        <div class="casino-stage-head">
          <div class="item-emblem casino-emblem twentyone">${renderCasinoSymbol("roulette-black")}</div>
          <div>
            <h3>Tisch</h3>
            <p>Dealer ${game?.dealerTotal ? `(${game.dealerTotal})` : ""} und Spieler ${game?.playerTotal ? `(${game.playerTotal})` : ""}</p>
          </div>
        </div>
        <div class="blackjack-zone">
          <div class="blackjack-seat">
            <span class="blackjack-label">Dealer ${game?.dealerTotal ? `· ${game.dealerTotal}` : ""}</span>
            <div class="card-hand dealer-hand">${dealerCards}</div>
          </div>
          <div class="blackjack-seat player">
            <span class="blackjack-label">Du ${game?.playerTotal ? `· ${game.playerTotal}` : ""}</span>
            <div class="card-hand player-hand">${playerCards}</div>
          </div>
        </div>
      </div>
    </div>`;
}
window.switchCasinoGame = function(game) {
  currentCasinoGame = game;
  switchTab("kasino");
};

async function playRoulette(color) {
  const input = document.getElementById("rouletteBet");
  const betAmount = parseInt(input?.value, 10) || 0;
  try {
    casinoVisualState.roulette = {
      ...casinoVisualState.roulette,
      betAmount,
      spinning: true,
      selectedColor: color,
      message: "Die Kugel rollt..."
    };
    await switchTab("kasino");
    const [data] = await Promise.all([
      request("/api/casino/roulette", { method: "POST", body: JSON.stringify({ betAmount, color }) }),
      sleep(1400)
    ]);
    currentUser = data.user;
    casinoVisualState.roulette = {
      ...casinoVisualState.roulette,
      spinning: false,
      rolledNumber: data.rolledNumber,
      landedColor: data.landedColor,
      payout: data.payout,
      win: data.win,
      message: `Zahl ${data.rolledNumber}, Feld ${data.landedColor}. ${data.win ? `Gewinn: ${data.payout} Coins.` : "Verloren."}`
    };
    await switchTab("kasino");
  } catch (e) {
    casinoVisualState.roulette = {
      ...casinoVisualState.roulette,
      spinning: false
    };
    showModal("Fehler", e.message, "error");
  }
}

async function playSlots() {
  const input = document.getElementById("slotsBet");
  const betAmount = parseInt(input?.value, 10) || 0;
  try {
    casinoVisualState.slots = {
      ...casinoVisualState.slots,
      betAmount,
      spinning: true,
      message: "Die Walzen drehen..."
    };
    await switchTab("kasino");
    const [data] = await Promise.all([
      request("/api/casino/slots", { method: "POST", body: JSON.stringify({ betAmount }) }),
      sleep(1500)
    ]);
    currentUser = data.user;
    casinoVisualState.slots = {
      ...casinoVisualState.slots,
      reels: data.reels,
      multiplier: data.multiplier,
      payout: data.payout,
      win: data.win,
      spinning: false,
      message: data.win ? `Gewinn: ${data.payout} Coins bei x${data.multiplier}.` : "Leider nichts getroffen."
    };
    await switchTab("kasino");
  } catch (e) {
    casinoVisualState.slots = {
      ...casinoVisualState.slots,
      spinning: false
    };
    showModal("Fehler", e.message, "error");
  }
}

async function startBlackjack() {
  const input = document.getElementById("blackjackBet");
  const betAmount = parseInt(input?.value, 10) || 0;
  try {
    const data = await request("/api/casino/blackjack/start", { method: "POST", body: JSON.stringify({ betAmount }) });
    blackjackState = data.game;
    currentUser = data.user;
    switchTab("kasino");
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
}

async function blackjackHit() {
  try {
    const data = await request("/api/casino/blackjack/hit", { method: "POST" });
    blackjackState = data.game;
    currentUser = data.user;
    switchTab("kasino");
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
}

async function blackjackStand() {
  try {
    const data = await request("/api/casino/blackjack/stand", { method: "POST" });
    blackjackState = data.game;
    currentUser = data.user;
    switchTab("kasino");
  } catch (e) {
    showModal("Fehler", e.message, "error");
  }
}

async function renderLeaderboard() {
  const data = await request(`/api/leaderboard?type=${currentLeaderboardType}`);
  return `
    <section class="panel">
      <div class="panel-head">
        <div class="section-caption">
          <span>Rangliste</span>
          <h2>Bestenliste</h2>
        </div>
      </div>
      <div class="section-switch leaderboard-switch">
        <button onclick="switchLeaderboard('gold')" class="${currentLeaderboardType === "gold" ? "filter-btn active" : "filter-btn"}">Coins</button>
        <button onclick="switchLeaderboard('level')" class="${currentLeaderboardType === "level" ? "filter-btn active" : "filter-btn"}">Level</button>
        <button onclick="switchLeaderboard('lootboxes')" class="${currentLeaderboardType === "lootboxes" ? "filter-btn active" : "filter-btn"}">Kisten</button>
      </div>
      <div class="leaderboard-list">
        ${data.leaderboard.map((user, index) => `
          <div onclick="viewProfile(${user.id})" class="leaderboard-row">
            <div class="leaderboard-main">
              <div class="leaderboard-position">#${index + 1}</div>
              <div class="leaderboard-meta">
                <strong>${user.displayName}</strong>
                <span class="leaderboard-level">Lv.${user.level}</span>
              </div>
            </div>
            <div>${currentLeaderboardType === "lootboxes" ? `${user.lootboxes} Kisten` : currentLeaderboardType === "level" ? `Level ${user.level}` : `${Math.floor(user.coins)} Coins`}</div>
          </div>`).join("")}
      </div>
    </section>`;
}

window.switchLeaderboard = function(type) {
  currentLeaderboardType = type;
  switchTab("leaderboard");
};

window.viewProfile = async function(userId) {
  try {
    const data = await request(`/api/user-profile/${userId}`);
    const profile = data.profile;
    const modal = document.createElement("div");
    modal.className = "custom-modal";
    modal.innerHTML = `<div class="modal-content success"><h2>${profile.displayName}</h2><p>Level <strong>${profile.level}</strong> / <strong>${Math.floor(profile.coins)}</strong> Coins</p><p>Schaden <strong>${profile.dmg}</strong> | Verteidigung <strong>${profile.defense}</strong></p><p>HP <strong>${profile.currentHp}/${profile.maxHp}</strong></p><button onclick="this.closest('.custom-modal').remove()" class="primary-btn">Schließen</button></div>`;
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add("show"), 10);
  } catch (_) {
    showModal("Fehler", "Profil konnte nicht geladen werden.", "error");
  }
};

function renderProfile() {
  return `
    <section class="profile-card">
      <div class="section-caption">
        <span>Profil</span>
        <h2>${currentUser.displayName}</h2>
      </div>
      <div class="profile-layout">
        <div class="profile-shell">
          <div class="profile-figure">
            <div class="player-rank">Level ${currentUser.level}</div>
            <div class="player-core showcase"></div>
            <div class="player-core-label">SPIELERPROFIL</div>
          </div>
          <div class="profile-meta">Hier sitzt später direkt deine 2D-Figur. Bis dahin bleibt die Ansicht bewusst einfach.</div>
        </div>
        <div>
          <div class="profile-grid">
            <div class="status-card"><span class="metric-label">Schaden</span><strong class="status-value">${currentUser.dmg}</strong></div>
            <div class="status-card"><span class="metric-label">Verteidigung</span><strong class="status-value">${currentUser.defense}</strong></div>
            <div class="status-card"><span class="metric-label">HP</span><strong class="status-value">${currentUser.currentHp}/${currentUser.maxHp}</strong></div>
            <div class="status-card"><span class="metric-label">Coins</span><strong class="status-value">${Math.floor(currentUser.coins)}</strong></div>
          </div>
          <div class="threat-panel">
            <div class="brief-item"><span>Status</span><strong>${getMatchState()}</strong></div>
            <div class="brief-item"><span>Kisten</span><strong>${currentUser.lootboxes}</strong></div>
            <div class="brief-item"><span>Items</span><strong>${currentUser.inventory.length}</strong></div>
          </div>
        </div>
      </div>
    </section>`;
}

async function switchTab(tab) {
  if (tab === "schmiede") tab = "inventory";
  currentTab = tab;
  const content = document.getElementById("content");
  if (!content) return;
  const heading = document.getElementById("moduleTitle");
  if (heading) heading.textContent = getTopbarTitle(tab);
  document.querySelectorAll(".nav-btn").forEach((button) => {
    const label = button.textContent.toLowerCase();
    const isActive =
      (tab === "game" && label.includes("spiel")) ||
      (tab === "lootboxen" && label.includes("kisten")) ||
      (tab === "inventory" && label.includes("inventar")) ||
      (tab === "kasino" && label.includes("kasino")) ||
      (tab === "profile" && label.includes("profil")) ||
      (tab === "leaderboard" && label.includes("bestenliste"));
    button.classList.toggle("active", isActive);
  });
  if (tab === "game") content.innerHTML = renderGame();
  else if (tab === "lootboxen") content.innerHTML = renderLootboxen();
  else if (tab === "inventory") content.innerHTML = renderInventory();
  else if (tab === "kasino") content.innerHTML = renderKasino();
  else if (tab === "profile") content.innerHTML = renderProfile();
  else if (tab === "leaderboard") content.innerHTML = await renderLeaderboard();
  updateUI();
}

function updateUI() {
  const xpNeeded = currentUser.level * 60;
  const xpPercent = Math.min(100, Math.floor(currentUser.xp / xpNeeded * 100));
  const waveProgress = waveState.current ? `${waveState.defeated} / ${waveState.totalSpawns}` : "0 / 0";
  const map = {
    topLevel: currentUser.level,
    coins: Math.floor(currentUser.coins),
    lootboxes: currentUser.lootboxes,
    dmg: currentUser.dmg,
    defense: currentUser.defense || 0
  };
  Object.entries(map).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
  const xpBar = document.getElementById("xpBar");
  const xpText = document.getElementById("xpText");
  if (xpBar) xpBar.style.width = `${xpPercent}%`;
  if (xpText) xpText.textContent = `${currentUser.xp} / ${xpNeeded}`;
  const waveLabel = getWaveDisplayLabel();
  const waveBannerText = document.getElementById("waveBannerText");
  const waveInfoText = document.getElementById("waveInfoText");
  const gameWaveValue = document.getElementById("gameWaveValue");
  const waveProgressValue = document.getElementById("waveProgressValue");
  const nextBossValue = document.getElementById("nextBossValue");
  const checkpointValue = document.getElementById("checkpointValue");
  if (waveBannerText) waveBannerText.textContent = waveLabel;
  if (waveInfoText) waveInfoText.textContent = waveLabel;
  if (gameWaveValue) gameWaveValue.textContent = waveLabel;
  if (waveProgressValue) waveProgressValue.textContent = waveProgress;
  if (nextBossValue) nextBossValue.textContent = `Welle ${getNextBossWave()}`;
  if (checkpointValue) checkpointValue.textContent = getCheckpointLabel();
  const waveBanner = document.getElementById("waveBanner");
  if (waveBanner) {
    waveBanner.className = `wave-banner ${combatActive ? "live" : ""} ${waveState.bossWave ? "boss" : waveState.current >= 4 ? "elite" : ""}`.trim();
  }
  const hpBar = document.getElementById("hpBar");
  const hpText = document.getElementById("hpText");
  if (hpBar) hpBar.style.width = `${Math.max(0, Math.floor(currentUser.currentHp / currentUser.maxHp * 100))}%`;
  if (hpText) hpText.innerHTML = `<span id="hpValue">${Math.floor(currentUser.currentHp)}</span> / ${currentUser.maxHp}`;
  const playerMeta = document.getElementById("playerMeta");
  if (playerMeta) {
    const isDead = (currentUser.currentHp || 0) <= 0;
    playerMeta.className = `hud-state-pill ${isDead ? "danger" : combatActive ? "live" : "idle"}`;
    playerMeta.innerHTML = `Level <span id="topLevel">${currentUser.level}</span> / ${getMatchState()}`;
  }
  const stateValue = document.getElementById("matchStateValue");
  if (stateValue) {
    const isDead = (currentUser.currentHp || 0) <= 0;
    stateValue.textContent = isDead ? "Tot" : combatActive ? "Läuft" : "Warten";
    stateValue.classList.toggle("alert", isDead);
  }
}

async function bootstrap() {
  try {
    const { user } = await request("/api/me");
    currentUser = user;
    renderApp();
  } catch (_) {
    renderAuth();
  }
}

async function logout() {
  await request("/api/logout", { method: "POST" });
  location.reload();
}

bootstrap();
