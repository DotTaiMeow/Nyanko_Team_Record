/* 貓咪大戰爭 通關紀錄本 — 純靜態跨平台 PWA 核心邏輯（免後端、支援離線與手機 App 模式） */
(() => {
  "use strict";

  const TRAIT_LABELS = {
    red: "紅色敵人",
    floating: "漂浮敵人",
    black: "黑色敵人",
    metal: "鋼鐵敵人",
    traitless: "無屬性",
    angel: "天使",
    alien: "異星戰士",
    starred_alien: "有星異星",
    zombie: "不死生物",
    relic: "古代種",
    aku: "惡魔",
    witch: "魔女",
    eva: "使徒",
  };
  const FORM_LABELS = ["一階", "二階", "三階", "四階"];

  const TALENT_SHORT_NAMES = {
    1: "降攻", 2: "暫停", 3: "緩速", 5: "善於攻擊", 6: "很耐打", 7: "超大傷害", 8: "打飛",
    10: "體力下降增攻", 11: "死前存活", 13: "會心一擊", 14: "終結不死", 15: "破壞護盾",
    16: "擊倒2倍金錢", 17: "波動攻擊", 18: "抗降攻耐性", 19: "抗暫停耐性", 20: "動慢耐性",
    21: "抗打飛耐性", 22: "抗波動耐性", 25: "生產成本減少", 26: "再生產縮短", 27: "移動速度上升",
    29: "古代詛咒無效", 30: "抗詛咒耐性", 31: "基本攻擊力上升", 32: "基本體力上升",
    33: "追加紅色", 34: "追加漂浮", 35: "追加黑色", 36: "追加鋼鐵", 37: "追加天使",
    38: "追加異星", 39: "追加不死", 40: "追加古代種", 41: "追加無屬性",
    44: "降攻無效", 45: "暫停無效", 46: "緩速無效", 47: "打飛無效", 48: "波動無效",
    49: "傳送無效", 50: "渾身一擊", 51: "攻擊無效", 52: "抗毒擊耐性", 53: "毒擊無效",
    54: "抗烈波耐性", 55: "烈波無效", 56: "烈波攻擊", 57: "追加惡魔", 58: "破壞惡魔盾",
    59: "靈魂攻擊", 60: "詛咒", 61: "攻擊間隔縮短", 62: "小波動", 63: "超生命體特效",
    64: "超獸特效", 65: "小烈波", 66: "超賢者特效", 67: "爆波攻擊", 68: "烈波反擊",
    69: "爆波無效", 71: "基本體力大幅上升", 72: "生產時間縮短",
  };

  // -------------------- 全域狀態與記憶體索引 --------------------
  const state = {
    lang: localStorage.getItem("bc_lang") || "tw",
    catboxAccount: localStorage.getItem("bc_catbox_acc") || "tw",
    theme: localStorage.getItem("bc_theme") || "dark",
    view: "stages",

    // 靜態遊戲資料（自 ./data/*.json 載入）
    bootstrap: null,
    unitsCatalog: [],
    unitsById: new Map(),
    enemiesCatalog: [],
    enemiesById: new Map(),
    mapsAll: [],
    mapsById: new Map(),
    stagesAll: [],
    stagesByKey: new Map(),
    stagesByMap: new Map(),
    categoriesById: new Map(),
    bucketSpawnsCache: new Map(), // bucket_id -> { stage_key: [[eid, cnt, boss, mhp, matk, bhp], ...] }
    enemyStagesIndex: null,

    // 使用者本機資料（自 IndexedDB 載入並同步於記憶體）
    records: [],
    progressMap: new Map(),    // stage_key -> [1, 2, ...]
    favoritesSet: new Set(),   // stage_key
    stageNotesMap: new Map(),  // stage_key -> { stage_tags, stage_note }
    myUnitsMap: new Map(),     // unit_id -> { tw: row|null, jp: row|null }
    templates: [],

    // 關卡瀏覽狀態
    mapFilter: "all",
    selectedBucketId: null,
    expandedMapIds: new Set(),
    selectedStageKey: null,
    stageDetail: null,
    stageTags: [],
    viewingCrown: 1,
    _stageEnemiesGrouped: [],

    // 篩選與預覽
    recFilterUnitId: null,
    recFeaturedOnly: false,
    tplPreviewMode: "raw",

    // PWA 安裝提示事件
    deferredInstallPrompt: null,

    // 編輯器狀態
    editor: {
      mode: "record",
      editId: null,
      stageKey: null,
      accountRegion: "tw",
      isCleared: true,
      isFeatured: false,
      lineup: Array(10).fill(null),
      activeSlot: 0,
      items: new Set(),
      tags: [],
      screenshots: [],
      dragFromSlot: null,
    },
  };

  // -------------------- 基礎工具 --------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pickText(tw, jp, lang = state.lang) {
    return lang === "jp" ? (jp || tw || "") : (tw || jp || "");
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString("zh-Hant");
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    $("#toastContainer").appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function debounce(fn, ms = 140) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function regionTagHtml(onlyRegion, corner = false) {
    if (onlyRegion !== "jp" && onlyRegion !== "tw") return "";
    const label = onlyRegion.toUpperCase();
    if (corner) {
      return `<span class="corner-region-badge ${onlyRegion}" title="${onlyRegion === "jp" ? "日服獨有／搶先內容" : "台服獨有內容"}">${label}</span>`;
    }
    return `<span class="badge badge-${onlyRegion}" title="${onlyRegion === "jp" ? "日服獨有／搶先內容" : "台服獨有內容"}">${label}</span>`;
  }

  function shortTalentLabel(t) {
    let base = TALENT_SHORT_NAMES[t.ability_id];
    if (!base) {
      const raw = pickText(t.desc_tw, t.desc_jp) || "";
      const m = raw.match(/「([^」]+)」/);
      base = m ? m[1] : raw.split(/[ 。\n]/)[0].slice(0, 12) || `本能#${t.ability_id}`;
    }
    const prefix = `${t.is_ultra ? "[超] " : ""}${t.only_region === "jp" ? "[JP] " : ""}`;
    return `${prefix}${base}`;
  }

  function getSmartDefaultLevel(u) {
    if (!u) return { base_lv: 50, plus_lv: 0 };
    const maxB = u.max_base_lv > 0 ? u.max_base_lv : 50;
    const maxP = Math.max(0, u.max_plus_lv || 0);
    if (u.rarity === 0) return { base_lv: Math.min(20, maxB), plus_lv: Math.min(90, maxP) };
    if (u.rarity === 1) return { base_lv: maxB, plus_lv: maxP };
    return { base_lv: Math.min(50, maxB), plus_lv: 0 };
  }

  function calcLevelMultiplier(totalLv, curve) {
    const lvTarget = Math.max(1, Number(totalLv || 1));
    const c = Array.isArray(curve) && curve.length ? curve : [20, 20, 20, 20, 20, 20, 10];
    let pct = 100;
    for (let lv = 2; lv <= lvTarget; lv++) {
      const idx = Math.min(Math.floor((lv - 1) / 10), c.length - 1);
      pct += Number(c[idx] || 0);
    }
    return pct / 100;
  }

  function calcUnitStat(baseStat, totalLv, curve) {
    return Math.floor(Math.round(Number(baseStat || 0) * calcLevelMultiplier(totalLv, curve)) * 2.5);
  }

  function formatLdRangesText(ldRanges) {
    if (!Array.isArray(ldRanges) || !ldRanges.length) return "";
    const hasOmni = ldRanges.some((r) => r.kind === "omni");
    const prefix = hasOmni ? "全方位" : "遠距";
    if (ldRanges.length === 1) return `${prefix} ${ldRanges[0].min}~${ldRanges[0].max}`;
    const circ = ["①", "②", "③"];
    return `${prefix} ` + ldRanges.map((r) => `${circ[r.hit - 1] || r.hit}${r.min}~${r.max}`).join(" / ");
  }

  function getMaxCrownsForStage(stageKey) {
    const st = state.stagesByKey.get(stageKey);
    const m = st ? state.mapsById.get(st.map_id) : null;
    return m ? Math.max(1, Math.min(4, m.star_count || 1)) : 4;
  }

  function clampCrowns(crowns, maxC) {
    const set = new Set();
    for (const c of crowns || []) {
      const n = Number(c);
      if (Number.isInteger(n) && n >= 1 && n <= maxC) set.add(n);
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  function getClearedCrowns(stageKey) {
    const maxC = getMaxCrownsForStage(stageKey);
    return clampCrowns(state.progressMap.get(stageKey) || [], maxC);
  }

  function getMyUnit(uOrId, accRegion) {
    const uid = typeof uOrId === "object" ? uOrId?.unit_id : Number(uOrId);
    const entry = state.myUnitsMap.get(uid);
    if (!entry) return null;
    return entry[accRegion === "jp" ? "jp" : "tw"] || null;
  }

  function getUnitForm(unitId, formIdx) {
    const u = state.unitsById.get(unitId);
    if (!u || !u.forms.length) return null;
    return u.forms[Math.min(formIdx ?? 0, u.forms.length - 1)] || u.forms[0];
  }

  function getFormDisplayName(f, unitId) {
    if (!f) return `#${unitId}`;
    return pickText(f.name_tw, f.name_jp) || `#${unitId}`;
  }

  function applyAccountToLineup(lineup, accRegion) {
    const out = Array(10).fill(null);
    if (!Array.isArray(lineup)) return out;
    for (let i = 0; i < Math.min(10, lineup.length); i++) {
      const src = lineup[i];
      if (!src || src.unit_id == null) continue;
      const u = state.unitsById.get(src.unit_id);
      if (!u) {
        out[i] = JSON.parse(JSON.stringify(src));
        continue;
      }
      const my = getMyUnit(u, accRegion);
      if (my) {
        out[i] = {
          unit_id: src.unit_id,
          form_idx: Math.min(my.default_form_idx, u.forms.length - 1),
          base_lv: my.base_lv,
          plus_lv: my.plus_lv,
          talents: Array.isArray(my.talents) ? [...my.talents] : [],
          note: my.note || src.note || "",
        };
      } else {
        const def = getSmartDefaultLevel(u);
        out[i] = {
          unit_id: src.unit_id,
          form_idx: Math.min(src.form_idx ?? u.forms.length - 1, u.forms.length - 1),
          base_lv: def.base_lv,
          plus_lv: def.plus_lv,
          talents: Array.isArray(src.talents) ? [...src.talents] : [],
          note: src.note || "",
        };
      }
    }
    return out;
  }

  function unitMatchesQuery(u, qLow) {
    if (!qLow) return true;
    return u._search.includes(qLow);
  }

  function enemyMatchesQuery(e, qLow) {
    if (!qLow) return true;
    return e._search.includes(qLow);
  }

  function setMobileStageStep(step) {
    const el = $("#stagesLayout");
    if (el) el.dataset.mobileStep = step;
  }

  // -------------------- 靜態資料載入與使用者資料同步 --------------------
  async function fetchJson(path) {
    try {
      const res = await fetch(path);
      if (res.ok) return await res.json();
    } catch (_) {
      // 斷網時直接改從本機 Cache API 讀取（雙重離線保險）
    }
    if ("caches" in window) {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      const hit = await cache.match(new URL(path, window.location.href).href, { ignoreSearch: true });
      if (hit) return await hit.json();
    }
    throw new Error(`無法載入 ${path}`);
  }

  async function refreshUserSnapshot() {
    const snap = await window.LocalStore.loadAllSnapshot();
    state.records = snap.records || [];
    state.templates = snap.templates || [];

    state.progressMap.clear();
    for (const p of snap.progressRows || []) {
      const cleaned = clampCrowns(p.cleared_crowns || [], getMaxCrownsForStage(p.stage_key));
      if (cleaned.length) state.progressMap.set(p.stage_key, cleaned);
    }

    state.favoritesSet.clear();
    for (const f of snap.favRows || []) state.favoritesSet.add(f.stage_key);

    state.stageNotesMap.clear();
    for (const n of snap.noteRows || []) {
      state.stageNotesMap.set(n.stage_key, {
        stage_tags: n.stage_tags || [],
        stage_note: n.stage_note || "",
      });
    }

    state.myUnitsMap.clear();
    for (const m of snap.myUnitRows || []) {
      let entry = state.myUnitsMap.get(m.unit_id);
      if (!entry) {
        entry = { tw: null, jp: null };
        state.myUnitsMap.set(m.unit_id, entry);
      }
      entry[m.account_region === "jp" ? "jp" : "tw"] = m;
    }
  }

  const OFFLINE_CACHE_NAME = "bc-logbook-pwa-v2";
  let offlineSyncPromise = null;

  function collectAllOfflineUrls() {
    const spawnUrls = (state.bootstrap?.categories || []).map((c) => `./data/stage_enemies/${c.bucket_id}.json`);
    const coreUrls = [
      "./data/bootstrap.json",
      "./data/units.json",
      "./data/enemies.json",
      "./data/maps.json",
      "./data/stages.json",
      "./data/enemy_stages.json",
      ...spawnUrls,
    ];
    const iconSet = new Set();
    for (const u of state.unitsCatalog) {
      for (const f of u.forms || []) {
        if (f.icon_url) iconSet.add(f.icon_url);
      }
    }
    for (const e of state.enemiesCatalog) {
      if (e.icon_url) iconSet.add(e.icon_url);
    }
    for (const it of state.bootstrap?.battle_items || []) {
      if (it.icon_url) iconSet.add(it.icon_url);
    }
    for (const can of state.bootstrap?.cannons || []) {
      if (can.icon_url) iconSet.add(can.icon_url);
    }
    return { coreUrls, spawnUrls, iconUrls: Array.from(iconSet) };
  }

  function toAbsCacheUrl(rel) {
    return new URL(rel, window.location.href).href.split("?")[0];
  }

  async function getCachedUrlSet(cache) {
    const reqs = await cache.keys();
    const set = new Set();
    for (const r of reqs) set.add(r.url.split("?")[0]);
    return set;
  }

  async function cacheUrlsBatch(urls, onProgress = null, concurrency = 6) {
    if (!("caches" in window)) return { done: 0, fetched: 0, failed: 0, alreadyCached: 0, total: urls.length };
    const cache = await caches.open(OFFLINE_CACHE_NAME);
    const cachedSet = await getCachedUrlSet(cache);

    const total = urls.length;
    const missing = [];
    for (const rel of urls) {
      const absUrl = toAbsCacheUrl(rel);
      if (!cachedSet.has(absUrl)) missing.push(absUrl);
    }

    const alreadyCached = total - missing.length;
    let cachedCount = alreadyCached;
    let fetched = 0;
    let failed = 0;
    if (onProgress) onProgress(cachedCount, total, missing.length > 0 ? 1 : 0, alreadyCached);
    if (!missing.length) return { done: total, fetched: 0, failed: 0, alreadyCached, total };

    let idx = 0;
    async function fetchAndCacheOnce(absUrl) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const resp = await fetch(absUrl, { credentials: "same-origin" });
          if (resp.ok) {
            try {
              await cache.put(absUrl, resp.clone());
            } catch (_) {
              // 若 Service Worker 同時已寫入相同 URL，檢查是否已存在快取
              const hit = await cache.match(absUrl, { ignoreSearch: true });
              if (!hit) throw new Error("cache.put failed");
            }
            return true;
          }
        } catch (_) {}
        if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
      }
      return false;
    }

    async function worker() {
      while (idx < missing.length) {
        const myIdx = idx++;
        const absUrl = missing[myIdx];
        const ok = await fetchAndCacheOnce(absUrl);
        if (ok) {
          fetched++;
          cachedCount++;
        } else {
          failed++;
        }
        if (onProgress) onProgress(cachedCount, total, fetched, alreadyCached);
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()));
    return { done: cachedCount, fetched, failed, alreadyCached, total };
  }

  async function updateOfflineStatusText() {
    const el = $("#offlineCacheStatus");
    if (!el) return;
    if (!("caches" in window)) {
      el.textContent = "目前瀏覽器環境不支援離線快取（需透過 HTTPS 網址開啟）";
      return;
    }
    try {
      const cache = await caches.open(OFFLINE_CACHE_NAME);
      const cachedSet = await getCachedUrlSet(cache);
      const { spawnUrls, iconUrls } = collectAllOfflineUrls();
      let cachedSpawns = 0;
      for (const u of spawnUrls) {
        if (cachedSet.has(toAbsCacheUrl(u))) cachedSpawns++;
      }
      let cachedIcons = 0;
      for (const u of iconUrls) {
        if (cachedSet.has(toAbsCacheUrl(u))) cachedIcons++;
      }
      const allReady = cachedSpawns === spawnUrls.length && cachedIcons === iconUrls.length;
      el.textContent = allReady
        ? `✅ 完整離線包已就緒！出怪表 ${cachedSpawns}/${spawnUrls.length}・圖示 ${cachedIcons}/${iconUrls.length}（斷網可 100% 完整使用）`
        : `目前快取進度：出怪表 ${cachedSpawns}/${spawnUrls.length}・圖示 ${cachedIcons}/${iconUrls.length}`;
      const fill = $("#offlineProgressFill");
      const wrap = $("#offlineProgressWrap");
      if (fill && wrap) {
        const totalAll = spawnUrls.length + iconUrls.length;
        const doneAll = cachedSpawns + cachedIcons;
        wrap.classList.remove("hidden");
        fill.style.width = `${totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0}%`;
      }
    } catch (_) {
      el.textContent = "無法讀取快取狀態";
    }
  }

  async function runFullOfflineSync({ manual = false } = {}) {
    if (!("caches" in window)) {
      if (manual) toast("目前環境不支援離線快取，請透過 HTTPS 網址開啟");
      return;
    }
    if (!navigator.onLine) {
      if (manual) toast("目前處於離線狀態，連線後會自動補齊離線包");
      return;
    }
    if (offlineSyncPromise) {
      if (manual) toast("背景正在自動同步完整離線資料包中...");
      return offlineSyncPromise;
    }

    offlineSyncPromise = (async () => {
      // 向瀏覽器請求持久化儲存，避免手機系統在待機時自動清除已下載的離線圖示快取
      try {
        if (navigator.storage && navigator.storage.persist) {
          await navigator.storage.persist();
        }
      } catch (_) {}

      const pill = $("#offlineSyncPill");
      const btn = $("#btnDownloadOfflinePack");
      const wrap = $("#offlineProgressWrap");
      const fill = $("#offlineProgressFill");
      const status = $("#offlineCacheStatus");
      const { coreUrls, iconUrls } = collectAllOfflineUrls();
      const allUrls = [...coreUrls, ...iconUrls];

      if (btn) {
        btn.disabled = true;
        btn.textContent = "⏳ 正在自動同步離線包...";
      }
      if (wrap) wrap.classList.remove("hidden");

      const res = await cacheUrlsBatch(
        allUrls,
        (done, total, fetched, alreadyCached) => {
          const pct = Math.round((done / total) * 100);
          if (fill) fill.style.width = `${pct}%`;
          if ((fetched > 0 || manual) && pill && done < total) {
            pill.classList.remove("hidden");
            pill.textContent = `📥 離線同步中 ${pct}%`;
          }
          if (status && (done % 20 === 0 || done === total)) {
            const verb = alreadyCached > 0 ? "正在續傳離線資料" : "正在同步離線資料";
            status.textContent = `${verb}：${done} / ${total}（${pct}%）...`;
          }
        },
        manual ? 8 : 6
      );

      if (pill) pill.classList.add("hidden");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "🔄 重新檢查／補齊離線資料包";
      }
      await updateOfflineStatusText();
      if (res.failed > 0) {
        toast(`離線同步已完成 ${res.done}/${res.total}，尚有 ${res.failed} 個可稍後自動補齊`);
      } else if (res.fetched > 0 || manual) {
        toast("✅ 完整離線資料包已下載完成！斷網也能看全部圖示與出怪！");
      }
    })().finally(() => {
      offlineSyncPromise = null;
    });

    return offlineSyncPromise;
  }

  async function loadBucketSpawns(bucketId) {
    if (state.bucketSpawnsCache.has(bucketId)) {
      return state.bucketSpawnsCache.get(bucketId);
    }
    try {
      const data = await fetchJson(`./data/stage_enemies/${bucketId}.json`);
      state.bucketSpawnsCache.set(bucketId, data);
      return data;
    } catch (_) {
      return {};
    }
  }

  async function ensureEnemyStagesIndex() {
    if (state.enemyStagesIndex) return state.enemyStagesIndex;
    state.enemyStagesIndex = await fetchJson("./data/enemy_stages.json");
    return state.enemyStagesIndex;
  }

  function updateGlobalStatsUi() {
    const boot = state.bootstrap;
    if (!boot) return;
    const clearedCnt = state.progressMap.size;
    const totalRecs = state.records.length;
    const c = boot.counts;

    $("#navRecordCount").textContent = String(totalRecs);
    $("#mNavRecordCount").textContent = String(totalRecs);
    $("#overallProgressText").textContent = `已通關 ${clearedCnt} / ${c.total_stages}`;

    $("#heroStats").innerHTML = `
      <div class="stat-box"><div class="stat-num">${fmtNum(c.total_units)}</div><div class="stat-lbl">全部貓咪</div></div>
      <div class="stat-box stat-box-clickable stat-box-tw" data-open-region-units="tw" title="點擊查看台服獨有貓咪清單"><div class="stat-num stat-tw">${fmtNum(c.tw_only_units)}</div><div class="stat-lbl">台服獨有貓咪</div><div class="stat-hint">點擊查看 ↗</div></div>
      <div class="stat-box stat-box-clickable stat-box-jp" data-open-region-units="jp" title="點擊查看日服獨有貓咪清單"><div class="stat-num stat-jp">${fmtNum(c.jp_only_units)}</div><div class="stat-lbl">日服獨有貓咪</div><div class="stat-hint">點擊查看 ↗</div></div>
      <div class="stat-box"><div class="stat-num">${fmtNum(c.total_enemies)}</div><div class="stat-lbl">全部敵人</div></div>
      <div class="stat-box"><div class="stat-num">${fmtNum(c.total_stages)}</div><div class="stat-lbl">全部關卡</div></div>
      <div class="stat-box"><div class="stat-num">${fmtNum(clearedCnt)}</div><div class="stat-lbl">已通關關卡</div></div>
      <div class="stat-box"><div class="stat-num">${fmtNum(totalRecs)}</div><div class="stat-lbl">已存通關紀錄</div></div>
    `;

    // 手機版分類列表頂部精簡統計條（可直接點 TW／JP 獨有貓咪清單）
    $("#mobileStatsStrip").innerHTML = `
      <span class="m-stat-chip">貓咪 <strong>${fmtNum(c.total_units)}</strong></span>
      <span class="m-stat-chip m-tw" data-open-region-units="tw">TW <strong>${fmtNum(c.tw_only_units)}</strong>↗</span>
      <span class="m-stat-chip m-jp" data-open-region-units="jp">JP <strong>${fmtNum(c.jp_only_units)}</strong>↗</span>
      <span class="m-stat-chip">關卡 <strong>${fmtNum(c.total_stages)}</strong></span>
    `;
  }

  // -------------------- 貓咪聯組自動偵測 --------------------
  function detectCombos(lineup) {
    if (!state.bootstrap || !state.bootstrap.combos) return [];
    const present = new Map();
    for (const slot of lineup) {
      if (!slot || slot.unit_id == null) continue;
      const prev = present.get(slot.unit_id);
      if (prev === undefined || slot.form_idx > prev) {
        present.set(slot.unit_id, slot.form_idx);
      }
    }
    if (present.size === 0) return [];

    const matched = [];
    for (const combo of state.bootstrap.combos) {
      if (!combo.units || !combo.units.length) continue;
      let ok = true;
      for (const req of combo.units) {
        const curForm = present.get(req.unit_id);
        if (curForm === undefined || curForm < req.form_idx) {
          ok = false;
          break;
        }
      }
      if (ok) matched.push(combo);
    }
    return matched;
  }

  function renderComboBarHtml(lineup) {
    const combos = detectCombos(lineup);
    if (!combos.length) return `<span class="muted-text">尚無觸發貓咪聯組</span>`;
    return (
      `<span class="muted-text" style="font-weight:700;">✨ 觸發聯組：</span>` +
      combos
        .map((c) => {
          const name = pickText(c.name_tw, c.name_jp);
          const eff = pickText(c.effect_tw, c.effect_jp);
          const lv = pickText(c.level_tw, c.level_jp);
          return `<span class="combo-pill">${regionTagHtml(c.only_region)} ${esc(name)}：${esc(eff)}${esc(lv)}</span>`;
        })
        .join("")
    );
  }

  function renderLineup5x2Html(lineup, interactive = false, activeSlot = -1) {
    const cells = [];
    for (let i = 0; i < 10; i++) {
      const slot = lineup[i] || null;
      const activeCls = interactive && i === activeSlot ? "active-slot" : "";
      if (!slot) {
        cells.push(
          `<div class="lineup-slot ${activeCls}" data-slot="${i}" ${interactive ? 'draggable="true"' : ""}>
            <span class="slot-empty-num">${i + 1}</span>
          </div>`
        );
      } else {
        const f = getUnitForm(slot.unit_id, slot.form_idx);
        const fName = getFormDisplayName(f, slot.unit_id);
        const imgSrc = f?.icon_url || "";
        const lvText = slot.plus_lv > 0 ? `${slot.base_lv}+${slot.plus_lv}` : `${slot.base_lv}`;
        const fLabel = FORM_LABELS[slot.form_idx] || `${slot.form_idx + 1}階`;
        const tCount = Array.isArray(slot.talents) ? slot.talents.length : 0;
        const titleTip = `${fName} Lv.${lvText}${f?.only_region === "jp" ? " [JP]" : ""}${slot.note ? "｜" + slot.note : ""}`;
        cells.push(
          `<div class="lineup-slot ${activeCls}" data-slot="${i}" data-unit-id="${slot.unit_id}" data-form-idx="${slot.form_idx}" data-base-lv="${slot.base_lv}" data-plus-lv="${slot.plus_lv}" ${interactive ? 'draggable="true"' : ""} title="${esc(titleTip)}">
            <span class="slot-form-badge">${fLabel}${f?.only_region === "jp" ? " JP" : ""}</span>
            ${tCount > 0 ? `<span class="slot-talent-dot">本${tCount}</span>` : ""}
            ${imgSrc ? `<img src="${imgSrc}" alt="${esc(fName)}" loading="lazy" />` : `<span class="slot-empty-num">#${slot.unit_id}</span>`}
            <span class="slot-lv-badge">${lvText}</span>
            <div class="slot-caption">${esc(fName)}</div>
          </div>`
        );
      }
    }
    return cells.join("");
  }

  // -------------------- 主題、語言與初始化 --------------------
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("bc_theme", theme);
    $("#themeToggleBtn").textContent = theme === "dark" ? "🌙" : "☀️";
  }

  function updateLangButtons() {
    $$("#langSwitcher .region-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === state.lang);
    });
  }

  function updateCatboxAccountButtons() {
    $$("#catboxAccountSwitcher .region-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.account === state.catboxAccount);
    });
  }

  function renderCannonAndItemControls() {
    const boot = state.bootstrap;
    if (!boot) return;
    const prevVal = $("#edCannon").value;
    $("#edCannon").innerHTML = boot.cannons
      .map((c) => `<option value="${c.cannon_id}">${esc(pickText(c.name_tw, c.name_jp))}</option>`)
      .join("");
    if (prevVal) $("#edCannon").value = prevVal;

    $("#edItemsBar").innerHTML = boot.battle_items
      .map((it) => {
        const name = pickText(it.name_tw, it.name_jp);
        const desc = pickText(it.desc_tw, it.desc_jp);
        return `<button type="button" class="item-toggle-btn" data-item-id="${it.item_id}" title="${esc(name)}：${esc(desc)}">
          <img src="${it.icon_url}" alt="${esc(name)}" />
        </button>`;
      })
      .join("");
    renderEditorItems();
  }

  async function switchDisplayLanguage(newLang) {
    if (newLang === state.lang) return;
    state.lang = newLang;
    localStorage.setItem("bc_lang", newLang);
    updateLangButtons();
    renderCannonAndItemControls();
    renderCategories();
    renderMapsList();
    if (state.selectedStageKey) await selectStage(state.selectedStageKey, false);
    if (state.view === "records") renderAllRecordsView();
    if (state.view === "catbox") renderCatboxGrid();
    if (state.view === "enemies") renderEnemyCatalogGrid();
    if (state.view === "templates") renderTemplatesView();
    if (!$("#recordModal").classList.contains("hidden")) {
      renderEditorLineup();
      renderPickerUnits();
    }
    toast(`顯示語言已切換為：${newLang === "tw" ? "繁體中文" : "日文"}`);
  }

  // -------------------- 視圖 1：關卡分類、地圖與詳情 --------------------
  function getRecordCountsByStage() {
    const map = new Map();
    for (const r of state.records) {
      map.set(r.stage_key, (map.get(r.stage_key) || 0) + 1);
    }
    return map;
  }

  function renderCategories() {
    const cats = state.bootstrap?.categories || [];
    const recCntMap = getRecordCountsByStage();
    const favCnt = state.favoritesSet.size;
    const favActive = state.selectedBucketId === "__favorites__" ? "active" : "";

    const favHtml = `
      <div class="cat-item cat-favorites ${favActive}" data-bucket="__favorites__">
        <div class="cat-row">
          <span class="cat-name">📌 收藏關卡</span>
          <span class="badge badge-gold">${favCnt} 關</span>
        </div>
        <div class="cat-sub"><span>跨分類快速直達收藏的關卡</span></div>
      </div>`;

    $("#categoryList").innerHTML =
      favHtml +
      cats
        .map((c) => {
          let clearedCnt = 0;
          let recCnt = 0;
          for (const m of state.mapsAll) {
            if (m.bucket_id !== c.bucket_id) continue;
            const mStages = state.stagesByMap.get(m.map_id) || [];
            for (const s of mStages) {
              if (state.progressMap.has(s.stage_key)) clearedCnt++;
              recCnt += recCntMap.get(s.stage_key) || 0;
            }
          }
          const pct = c.stage_count > 0 ? Math.round((clearedCnt / c.stage_count) * 100) : 0;
          const active = c.bucket_id === state.selectedBucketId ? "active" : "";
          return `
            <div class="cat-item ${active}" data-bucket="${c.bucket_id}">
              <div class="cat-row">
                <span class="cat-name">${esc(c.name)}</span>
                ${recCnt > 0 ? `<span class="badge badge-gold">${recCnt} 筆</span>` : ""}
              </div>
              <div class="cat-sub">
                <span>${c.map_count} 圖 / ${c.stage_count} 關</span>
                <span>${clearedCnt}/${c.stage_count} (${pct}%)</span>
              </div>
              <div class="progress-mini"><div class="progress-mini-fill" style="width:${pct}%"></div></div>
            </div>`;
        })
        .join("");
  }

  function selectCategory(bucketId, advanceMobile = true) {
    state.selectedBucketId = bucketId;
    if (bucketId === "__favorites__") {
      $("#currentCategoryTitle").textContent = "📌 收藏關卡";
    } else {
      const cat = state.categoriesById.get(bucketId);
      $("#currentCategoryTitle").textContent = cat ? cat.name : "關卡列表";
    }
    renderCategories();
    renderMapsList();
    if (advanceMobile) setMobileStageStep("maps");
  }

  function renderMapsList() {
    const qLow = $("#mapSearchInput").value.trim().toLowerCase();
    const recCntMap = getRecordCountsByStage();

    if (state.selectedBucketId === "__favorites__") {
      const favList = [];
      for (const sk of state.favoritesSet) {
        const st = state.stagesByKey.get(sk);
        if (!st) continue;
        const m = state.mapsById.get(st.map_id);
        const cat = m ? state.categoriesById.get(m.bucket_id) : null;
        if (qLow) {
          const hay = `${st._search} ${m ? m._search : ""} ${cat ? cat.name.toLowerCase() : ""}`;
          if (!hay.includes(qLow)) continue;
        }
        favList.push({ st, m, cat });
      }
      if (!favList.length) {
        $("#mapList").innerHTML = `<div class="muted-text" style="padding:24px;text-align:center;">尚無收藏的關卡<br/>進入任一關卡點右上「📌 收藏關卡」即可加入。</div>`;
        return;
      }
      $("#mapList").innerHTML = favList
        .map(({ st, m, cat }) => {
          const cleared = getClearedCrowns(st.stage_key);
          const rc = recCntMap.get(st.stage_key) || 0;
          const active = st.stage_key === state.selectedStageKey ? "active" : "";
          const stars = cleared.length ? "★".repeat(cleared.length) : "";
          const stName = pickText(st.name_tw, st.name_jp);
          const mName = m ? pickText(m.name_tw, m.name_jp) : "";
          return `
            <div class="stage-row-item ${active}" data-stage-key="${esc(st.stage_key)}" style="margin-bottom:4px;background:var(--bg-elevated);border:1px solid var(--border);">
              ${st.preview_icon_url ? `<img class="stage-row-thumb" src="${st.preview_icon_url}" loading="lazy" alt="" />` : `<div class="stage-row-thumb"></div>`}
              <div class="stage-row-info">
                <div class="stage-row-name">📌 ${regionTagHtml(st.only_region)} ${esc(stName)}</div>
                <div class="stage-row-sub">
                  <span>${esc(cat ? cat.name : "")} › ${esc(mName)}</span>
                  ${stars ? `<span style="color:var(--accent);">${stars}</span>` : ""}
                  ${rc > 0 ? `<span class="badge badge-gold">${rc} 筆</span>` : ""}
                </div>
              </div>
            </div>`;
        })
        .join("");
      return;
    }

    const filteredMaps = [];
    for (const m of state.mapsAll) {
      if (state.selectedBucketId != null && m.bucket_id !== state.selectedBucketId) continue;
      if (qLow && !m._search.includes(qLow)) continue;
      const mStages = state.stagesByMap.get(m.map_id) || [];
      let clCnt = 0;
      let rcCnt = 0;
      for (const s of mStages) {
        if (state.progressMap.has(s.stage_key)) clCnt++;
        rcCnt += recCntMap.get(s.stage_key) || 0;
      }
      if (state.mapFilter === "has_records" && rcCnt === 0) continue;
      if (state.mapFilter === "cleared" && clCnt === 0) continue;
      if (state.mapFilter === "uncleared" && clCnt >= mStages.length) continue;
      filteredMaps.push({ m, mStages, clCnt, rcCnt });
    }

    if (!filteredMaps.length) {
      $("#mapList").innerHTML = `<div class="muted-text" style="padding:20px;text-align:center;">沒有符合條件的地圖</div>`;
      return;
    }

    const autoExpand = filteredMaps.length <= 3 || Boolean(qLow);
    $("#mapList").innerHTML = filteredMaps
      .map(({ m, mStages, clCnt, rcCnt }) => {
        const expanded = autoExpand || state.expandedMapIds.has(m.map_id);
        if (autoExpand) state.expandedMapIds.add(m.map_id);
        const mName = pickText(m.name_tw, m.name_jp);
        const stagesHtml = expanded
          ? `<div class="map-stages-list">${mStages
              .map((s) => {
                const cleared = getClearedCrowns(s.stage_key);
                const rc = recCntMap.get(s.stage_key) || 0;
                const active = s.stage_key === state.selectedStageKey ? "active" : "";
                const stars = cleared.length ? "★".repeat(cleared.length) : "";
                const favMark = state.favoritesSet.has(s.stage_key) ? "📌 " : "";
                const sName = pickText(s.name_tw, s.name_jp);
                return `
                  <div class="stage-row-item ${active}" data-stage-key="${esc(s.stage_key)}">
                    ${s.preview_icon_url ? `<img class="stage-row-thumb" src="${s.preview_icon_url}" loading="lazy" alt="" />` : `<div class="stage-row-thumb"></div>`}
                    <div class="stage-row-info">
                      <div class="stage-row-name">${favMark}${regionTagHtml(s.only_region)} ${esc(sName)}</div>
                      <div class="stage-row-sub">
                        <span>⚡${s.energy}</span>
                        ${stars ? `<span style="color:var(--accent);">${stars}</span>` : ""}
                        ${rc > 0 ? `<span class="badge badge-gold">${rc} 筆</span>` : ""}
                      </div>
                    </div>
                  </div>`;
              })
              .join("")}</div>`
          : "";

        return `
          <div class="map-card">
            <div class="map-header" data-map-id="${m.map_id}">
              <div>
                <div class="map-title">${expanded ? "▾" : "▸"} ${regionTagHtml(m.only_region)} ${esc(mName)}</div>
                <div class="map-meta">${m.stage_count} 關 · 已通關 ${clCnt}/${m.stage_count}</div>
              </div>
              <div>${rcCnt > 0 ? `<span class="badge badge-gold">${rcCnt} 筆</span>` : ""}</div>
            </div>
            ${stagesHtml}
          </div>`;
      })
      .join("");
  }

  function toggleMapExpand(mapId) {
    if (state.expandedMapIds.has(mapId)) state.expandedMapIds.delete(mapId);
    else state.expandedMapIds.add(mapId);
    renderMapsList();
  }

  async function selectStage(stageKey, advanceMobile = true) {
    const st = state.stagesByKey.get(stageKey);
    if (!st) return;
    const m = state.mapsById.get(st.map_id);
    const cat = m ? state.categoriesById.get(m.bucket_id) : null;
    const bucketId = m ? m.bucket_id : 0;

    state.selectedStageKey = stageKey;
    const bucketSpawns = await loadBucketSpawns(bucketId);
    const rawSpawns = bucketSpawns[stageKey] || [];
    const enemies = rawSpawns.map((arr) => {
      const [eid, count, isBoss, magHp, magAtk, baseHpPct] = arr;
      const eObj = state.enemiesById.get(eid);
      return {
        enemy_id: eid,
        count,
        is_boss: Boolean(isBoss),
        mag_hp: magHp,
        mag_atk: magAtk,
        base_hp_pct: baseHpPct,
        name: eObj ? pickText(eObj.name_tw, eObj.name_jp) : `敵人 #${eid}`,
        only_region: eObj ? eObj.only_region : null,
        icon_url: eObj ? eObj.icon_url : "",
        base_hp: eObj ? eObj.hp : 0,
        base_atk: eObj ? eObj.total_atk : 0,
        range: eObj ? eObj.range : 0,
        ld_ranges: eObj ? eObj.ld_ranges : [],
        traits: eObj ? eObj.traits : [],
      };
    });

    const stageRecords = state.records.filter((r) => r.stage_key === stageKey);
    const noteRow = state.stageNotesMap.get(stageKey) || { stage_tags: [], stage_note: "" };

    state.stageDetail = {
      ...st,
      name: pickText(st.name_tw, st.name_jp),
      bucket_id: bucketId,
      category_name: cat ? cat.name : "",
      map_name: m ? pickText(m.name_tw, m.name_jp) : "",
      map_only_region: m ? m.only_region : null,
      star_count: m ? m.star_count : 1,
      star_mags: m ? m.star_mags : [100],
      cleared_crowns: getClearedCrowns(stageKey),
      is_favorite: state.favoritesSet.has(stageKey),
      stage_tags: noteRow.stage_tags,
      stage_note: noteRow.stage_note,
      enemies,
      records: stageRecords,
    };

    state.viewingCrown = Math.min(state.viewingCrown, Math.max(1, state.stageDetail.star_count || 1));
    if (state.viewingCrown < 1) state.viewingCrown = 1;

    renderStageDetail();
    renderMapsList();
    if (advanceMobile) setMobileStageStep("detail");
  }

  function renderStageDetail() {
    const d = state.stageDetail;
    if (!d) return;
    $("#stageEmptyHero").classList.add("hidden");
    $("#stageDetailContent").classList.remove("hidden");

    const subAlt = d.name_tw && d.name_jp && d.name_tw !== d.name_jp ? `（${state.lang === "tw" ? d.name_jp : d.name_tw}）` : "";
    $("#mobileDetailBarTitle").textContent = d.name;
    $("#sdBreadcrumb").innerHTML = `${esc(d.category_name)} › ${regionTagHtml(d.map_only_region)} ${esc(d.map_name)}`;
    $("#sdTitle").innerHTML = `${regionTagHtml(d.only_region)} ${esc(d.name)} <span class="muted-text" style="font-size:13px;font-weight:400;">${esc(subAlt)}</span>`;
    $("#sdEnergy").textContent = d.energy;
    $("#sdCastleHp").textContent = fmtNum(d.castle_hp);
    $("#sdMaxEnemies").textContent = d.max_enemies;
    $("#sdWidth").textContent = d.stage_width;

    const favBtn = $("#btnToggleFavoriteStage");
    favBtn.textContent = d.is_favorite ? "📌 已收藏關卡" : "📌 收藏關卡";
    favBtn.classList.toggle("btn-featured-active", Boolean(d.is_favorite));

    state.stageTags = Array.isArray(d.stage_tags) ? [...d.stage_tags] : [];
    renderStageTagsList();
    $("#sdStageNoteInput").value = d.stage_note || "";
    autoResizeTextarea($("#sdStageNoteInput"));

    const starCount = Math.max(1, Math.min(4, d.star_count || 1));
    const starMags = d.star_mags || [100];
    const viewingMag = starMags[state.viewingCrown - 1] || 100;

    $("#sdCrownButtons").innerHTML = Array.from({ length: starCount }, (_, idx) => {
      const c = idx + 1;
      const cleared = d.cleared_crowns.includes(c);
      const viewing = state.viewingCrown === c;
      const mag = starMags[idx] || 100;
      return `
        <div class="crown-chip ${cleared ? "cleared" : ""} ${viewing ? "viewing" : ""}" data-crown="${c}">
          <span class="crown-toggle-check" data-toggle-crown="${c}">${cleared ? "✅" : "⬜"}</span>
          <span>${c}冠 (${mag}%)</span>
        </div>`;
    }).join("");

    $("#sdEnemyMagNote").textContent = starCount > 1 ? `（目前 ${state.viewingCrown} 冠 ${viewingMag}%）` : "";
    if (!d.enemies.length) {
      $("#sdEnemyList").innerHTML = `<div class="muted-text">此關卡無固定出怪表</div>`;
    } else {
      const grouped = [];
      const seen = new Map();
      for (const en of d.enemies) {
        const key = `${en.enemy_id}_${en.mag_hp}_${en.is_boss}`;
        if (seen.has(key)) {
          const item = seen.get(key);
          item.count = item.count === 0 || en.count === 0 ? 0 : item.count + en.count;
        } else {
          const clone = { ...en };
          seen.set(key, clone);
          grouped.push(clone);
        }
      }
      grouped.sort((a, b) => Number(b.is_boss) - Number(a.is_boss));
      state._stageEnemiesGrouped = grouped;

      $("#sdEnemyList").innerHTML = grouped
        .map((en, gIdx) => {
          const effMagHp = Math.round((en.mag_hp * viewingMag) / 100);
          const effMagAtk = Math.round((en.mag_atk * viewingMag) / 100);
          const realHp = Math.round((en.base_hp * effMagHp) / 100);
          const realAtk = Math.round((en.base_atk * effMagAtk) / 100);
          const traitText = (en.traits || []).map((t) => TRAIT_LABELS[t] || t).join(" / ");
          const ldText = formatLdRangesText(en.ld_ranges);
          return `
            <div class="enemy-mini-card ${en.is_boss ? "is-boss" : ""}" data-enemy-id="${en.enemy_id}" data-gidx="${gIdx}">
              ${en.icon_url ? `<img src="${en.icon_url}" loading="lazy" alt="" />` : `<div style="width:48px;height:48px;background:var(--bg-panel);border-radius:6px;"></div>`}
              <div class="enemy-mini-info">
                <div class="enemy-mini-name">
                  ${en.is_boss ? `<span class="badge badge-red">BOSS</span>` : ""}
                  ${regionTagHtml(en.only_region)}
                  <span>${esc(en.name)}</span>
                </div>
                <div class="enemy-mini-stats">
                  <div>倍率：<strong>${effMagHp}%</strong>${effMagAtk !== effMagHp ? ` / 攻${effMagAtk}%` : ""} · 數量：${en.count === 0 ? "無限" : en.count}</div>
                  <div>HP ${fmtNum(realHp)} · 攻 ${fmtNum(realAtk)} · 射 ${en.range}${ldText ? ` (${esc(ldText)})` : ""}</div>
                  ${traitText ? `<div style="color:var(--info);">${esc(traitText)}</div>` : ""}
                </div>
              </div>
            </div>`;
        })
        .join("");
    }

    $("#sdRecordBadge").textContent = String(d.records.length);
    if (!d.records.length) {
      $("#sdRecordsList").innerHTML = `<div class="muted-text" style="padding:24px;text-align:center;">這關還沒有任何通關紀錄，點上方「<strong>＋ 新增通關紀錄</strong>」記下你的第一隊吧！</div>`;
    } else {
      $("#sdRecordsList").innerHTML = d.records.map((r) => renderRecordCardHtml(r, false)).join("");
    }
  }

  function renderRecordCardHtml(rec, showStageLink = false) {
    const cannon = (state.bootstrap?.cannons || []).find((c) => c.cannon_id === rec.cannon_id);
    const cannonName = cannon ? pickText(cannon.name_tw, cannon.name_jp) : "貓咪砲";
    const itemsHtml = (rec.items || [])
      .map((iid) => {
        const it = (state.bootstrap?.battle_items || []).find((x) => x.item_id === iid);
        const nm = it ? pickText(it.name_tw, it.name_jp) : "";
        return it ? `<img class="item-icon-mini" src="${it.icon_url}" title="${esc(nm)}" alt="${esc(nm)}" />` : "";
      })
      .join("");
    const tagsHtml = (rec.tags || []).map((t) => `<span class="badge badge-blue">#${esc(t)}</span>`).join("");
    const shotsHtml = (rec.screenshots || []).length
      ? `<div class="record-shots">${rec.screenshots.map((src) => `<img src="${src}" class="zoomable-shot" alt="截圖" />`).join("")}</div>`
      : "";

    let stageHeaderLink = "";
    if (showStageLink) {
      const st = state.stagesByKey.get(rec.stage_key);
      const m = st ? state.mapsById.get(st.map_id) : null;
      const cat = m ? state.categoriesById.get(m.bucket_id) : null;
      const stName = st ? pickText(st.name_tw, st.name_jp) : rec.stage_key;
      const mName = m ? pickText(m.name_tw, m.name_jp) : "";
      stageHeaderLink = `<div style="margin-bottom:6px;">
        <a href="#" class="jump-stage-link" data-bucket="${m ? m.bucket_id : ""}" data-map="${st ? st.map_id : ""}" data-stage="${esc(rec.stage_key)}" style="color:var(--accent);font-weight:700;text-decoration:none;">
          🗺️ ${esc(cat ? cat.name : "")} › ${esc(mName)} › ${esc(stName)}
        </a>
      </div>`;
    }

    const regBadgeCls = rec.region === "jp" ? "badge-jp" : "badge-tw";
    const cardExtraCls = `${rec.is_featured ? "is-featured" : ""} ${!rec.is_cleared ? "is-failed" : ""}`.trim();
    const statusBadge = rec.is_cleared
      ? `<span class="badge badge-gold">${"⭐".repeat(rec.crown)} ${rec.crown}冠</span>`
      : `<span class="badge badge-red">❌ 未通關 (${rec.crown}冠)</span>`;
    const featBadge = rec.is_featured ? `<span class="badge badge-gold">⭐ 珍藏紀錄</span>` : "";

    return `
      <div class="record-card ${cardExtraCls}" data-record-id="${rec.id}">
        ${stageHeaderLink}
        <div class="record-card-head">
          <div class="record-title-row">
            ${featBadge}
            ${statusBadge}
            <span class="badge ${regBadgeCls}">${rec.region.toUpperCase()}</span>
            <span class="record-title">${esc(rec.title || (rec.is_cleared ? "通關隊伍" : "測試／未通關隊伍"))}</span>
            ${tagsHtml}
          </div>
          <div class="record-actions">
            <button class="btn btn-secondary btn-xs btn-toggle-feat ${rec.is_featured ? "btn-featured-active" : ""}" data-id="${rec.id}">${rec.is_featured ? "⭐ 已珍藏" : "☆ 珍藏"}</button>
            <button class="btn btn-secondary btn-xs btn-edit-rec" data-id="${rec.id}">✏️ 編輯</button>
            <button class="btn btn-secondary btn-xs btn-clone-rec" data-id="${rec.id}">📋 複製</button>
            <button class="btn btn-secondary btn-xs btn-save-tpl" data-id="${rec.id}">💾 模板</button>
            <button class="btn btn-danger btn-xs btn-del-rec" data-id="${rec.id}">刪除</button>
          </div>
        </div>
        <div class="record-setup-bar">
          <span>🔫 砲台：<strong>${esc(cannonName)}</strong></span>
          <span>🎒 道具：${itemsHtml || "<span>無</span>"}</span>
          ${rec.cleared_at ? `<span>📅 ${esc(rec.cleared_at)}</span>` : ""}
          ${rec.video_url ? `<a href="${esc(rec.video_url)}" target="_blank" rel="noopener" style="color:var(--info);font-weight:600;">🎬 影片 ↗</a>` : ""}
        </div>
        <div class="lineup-grid-5x2 rec-readonly-lineup">${renderLineup5x2Html(rec.lineup || [], false)}</div>
        <div class="combo-bar">${renderComboBarHtml(rec.lineup || [])}</div>
        ${rec.notes ? `<div class="record-notes">${esc(rec.notes)}</div>` : ""}
        ${shotsHtml}
      </div>`;
  }

  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(68, el.scrollHeight + 2)}px`;
  }

  function renderStageTagsList() {
    $("#sdStageTagsList").innerHTML = state.stageTags
      .map((t, idx) => `<span class="tag-chip">#${esc(t)} <button type="button" data-del-stagetag="${idx}">×</button></span>`)
      .join("");
  }

  async function saveCurrentStageNote(silent = false) {
    if (!state.stageDetail) return;
    const saved = await window.LocalStore.saveStageNote(
      state.stageDetail.stage_key,
      state.stageTags,
      $("#sdStageNoteInput").value
    );
    state.stageNotesMap.set(state.stageDetail.stage_key, {
      stage_tags: saved.stage_tags,
      stage_note: saved.stage_note,
    });
    state.stageDetail.stage_tags = saved.stage_tags;
    state.stageDetail.stage_note = saved.stage_note;
    if (!silent) toast("已儲存關卡備註與標籤");
  }

  async function jumpToStage(bucketId, mapId, stageKey) {
    switchView("stages");
    if (bucketId !== null && bucketId !== undefined && bucketId !== "") {
      selectCategory(Number(bucketId), false);
    }
    if (mapId) state.expandedMapIds.add(Number(mapId));
    await selectStage(stageKey, true);
  }

  // -------------------- 編輯器（通關紀錄 / 模板共用） --------------------
  function updateEditorAccountBadge() {
    const acc = state.editor.accountRegion;
    $$("#edRegionSwitcher .region-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.region === acc);
    });
    $("#pickerAccountBadge").textContent = acc === "jp" ? "帶入：日服帳號貓棚" : "帶入：台服帳號貓棚";
    $("#pickerAccountBadge").className = `badge ${acc === "jp" ? "badge-jp" : "badge-tw"}`;
    $("#btnSyncSlotToCatbox").textContent = acc === "jp" ? "💾 同步至日服貓棚" : "💾 同步至台服貓棚";
    $("#btnApplyAccountLevels").textContent = acc === "jp" ? "🔄 套用日服貓棚等級" : "🔄 套用台服貓棚等級";
  }

  function updateEditorStatusControls() {
    const isClr = state.editor.isCleared;
    $$("#edClearedSwitcher .region-btn").forEach((b) => {
      const val = b.dataset.cleared === "1";
      b.classList.toggle("active", isClr && val);
      b.classList.toggle("active-failed", !isClr && !val);
    });
    const fBtn = $("#btnEdToggleFeatured");
    fBtn.textContent = state.editor.isFeatured ? "⭐ 已設為珍藏紀錄" : "☆ 設為珍藏紀錄";
    fBtn.classList.toggle("btn-featured-active", state.editor.isFeatured);
  }

  function openRecordEditor({ mode = "record", record = null, stageKey = null, cloneFrom = null }) {
    const ed = state.editor;
    ed.mode = mode;
    ed.editId = record ? record.id : null;
    ed.stageKey = stageKey || (record ? record.stage_key : state.selectedStageKey);
    ed.activeSlot = 0;

    const src = record || cloneFrom;
    ed.accountRegion = src?.region || state.catboxAccount || "tw";
    ed.isCleared = record ? Boolean(record.is_cleared) : true;
    ed.isFeatured = record ? Boolean(record.is_featured) : false;
    ed.lineup = Array(10).fill(null);
    if (src && Array.isArray(src.lineup)) {
      for (let i = 0; i < Math.min(10, src.lineup.length); i++) {
        ed.lineup[i] = src.lineup[i] ? JSON.parse(JSON.stringify(src.lineup[i])) : null;
      }
    }
    ed.items = new Set(src && Array.isArray(src.items) ? src.items : []);
    ed.tags = src && Array.isArray(src.tags) ? [...src.tags] : [];
    ed.screenshots = record && Array.isArray(record.screenshots) ? [...record.screenshots] : [];

    const isTpl = mode === "template";
    const stObj = ed.stageKey ? state.stagesByKey.get(ed.stageKey) : null;
    const mapObj = stObj ? state.mapsById.get(stObj.map_id) : null;
    const stageDisplayName = stObj ? pickText(stObj.name_tw, stObj.name_jp) : ed.stageKey || "";

    $("#recordModalTitle").textContent = isTpl
      ? "建立常用隊伍模板"
      : record
      ? `編輯通關紀錄（${stageDisplayName}）`
      : `新增通關紀錄（${stageDisplayName}）`;

    $("#edCrownGroup").classList.toggle("hidden", isTpl);
    $("#edRegionGroup").classList.remove("hidden");
    $("#edRegionGroup label").textContent = isTpl ? "參考貓棚帳號" : "紀錄帳號標籤";
    $("#edClearedGroup").classList.toggle("hidden", isTpl);
    $("#edFeaturedRow").classList.toggle("hidden", isTpl);
    $("#edDateGroup").classList.toggle("hidden", isTpl);
    $("#edApplyTemplateWrap").classList.toggle("hidden", isTpl);
    $("#recordExtraFields").classList.toggle("hidden", isTpl);

    const maxCrowns = Math.max(1, Math.min(4, mapObj?.star_count || 4));
    const starMags = mapObj?.star_mags || [];
    $("#edCrown").innerHTML = Array.from({ length: maxCrowns }, (_, idx) => {
      const c = idx + 1;
      const magTxt = starMags[idx] ? ` (${starMags[idx]}%)` : "";
      return `<option value="${c}">${"⭐".repeat(c)} ${c} 冠${magTxt}</option>`;
    }).join("");
    const initCrown = Math.min(maxCrowns, Math.max(1, Number(src?.crown || state.viewingCrown || 1)));

    $("#edTitle").placeholder = isTpl ? "請輸入模板名稱（如：零傳奇泛用隊）" : "例如：4星無超激穩定隊、速刷隊";
    $("#edTitle").value = record ? record.title : cloneFrom ? `${cloneFrom.title || "複製隊伍"} (複本)` : "";
    $("#edCrown").value = String(initCrown);
    $("#edClearedAt").value = record?.cleared_at || new Date().toISOString().slice(0, 10);
    $("#edCannon").value = String(src?.cannon_id ?? 0);
    $("#edNotes").value = record ? record.notes : cloneFrom ? cloneFrom.notes : "";
    $("#edVideoUrl").value = record ? record.video_url : "";

    $("#edTemplateSelect").innerHTML =
      `<option value="">-- 套用常用模板 --</option>` +
      state.templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");

    updateEditorAccountBadge();
    updateEditorStatusControls();
    renderEditorItems();
    renderEditorLineup();
    renderEditorTags();
    renderEditorScreenshots();
    renderPickerUnits();

    $("#recordModal").classList.remove("hidden");
    autoResizeTextarea($("#edNotes"));
  }

  function closeRecordEditor() {
    $("#recordModal").classList.add("hidden");
  }

  function renderEditorItems() {
    $$("#edItemsBar .item-toggle-btn").forEach((btn) => {
      btn.classList.toggle("active", state.editor.items.has(Number(btn.dataset.itemId)));
    });
  }

  function renderEditorLineup() {
    const ed = state.editor;
    $("#edLineupGrid").innerHTML = renderLineup5x2Html(ed.lineup, true, ed.activeSlot);
    $("#edComboBar").innerHTML = renderComboBarHtml(ed.lineup);
    $("#pickerActiveSlotNum").textContent = String(ed.activeSlot + 1);
    renderActiveSlotDetail();
  }

  function renderActiveSlotDetail() {
    const ed = state.editor;
    const slot = ed.lineup[ed.activeSlot];
    const bar = $("#edSlotDetail");
    if (!slot) {
      bar.classList.add("hidden");
      return;
    }
    const u = state.unitsById.get(slot.unit_id);
    const f = getUnitForm(slot.unit_id, slot.form_idx);
    bar.classList.remove("hidden");

    $("#sdSlotIcon").src = f?.icon_url || "";
    $("#sdSlotName").innerHTML = `${esc(getFormDisplayName(f, slot.unit_id))} ${regionTagHtml(f?.only_region)}`;
    $("#sdSlotSub").textContent = u ? `#${String(u.unit_id).padStart(3, "0")} · ${u.rarity_name} · 上限 ${u.max_base_lv}+${u.max_plus_lv}` : "";
    $("#sdSlotBaseLv").value = slot.base_lv;
    $("#sdSlotPlusLv").value = slot.plus_lv;
    $("#sdSlotNote").value = slot.note || "";

    $("#sdSlotForms").innerHTML = (u?.forms || [])
      .map(
        (fm) =>
          `<button type="button" class="form-pill-btn ${fm.form_idx === slot.form_idx ? "active" : ""}" data-form-idx="${fm.form_idx}">
            ${FORM_LABELS[fm.form_idx] || `${fm.form_idx + 1}階`}${fm.only_region === "jp" ? " [JP]" : fm.only_region === "tw" ? " [TW]" : ""}
          </button>`
      )
      .join("");

    const talents = u?.talents || [];
    if (talents.length > 0) {
      $("#sdSlotTalentsWrap").classList.remove("hidden");
      const selSet = new Set(slot.talents || []);
      $("#sdSlotTalents").innerHTML = talents
        .map((t) => {
          const rawDesc = pickText(t.desc_tw, t.desc_jp);
          const active = selSet.has(t.ability_id) ? "active" : "";
          return `<button type="button" class="talent-chip ${active}" data-ability-id="${t.ability_id}" title="${esc(rawDesc)}">${esc(shortTalentLabel(t))}</button>`;
        })
        .join("");
    } else {
      $("#sdSlotTalentsWrap").classList.add("hidden");
    }
  }

  function putUnitIntoActiveSlot(unitId) {
    const ed = state.editor;
    const u = state.unitsById.get(unitId);
    if (!u) return;

    const existingIdx = ed.lineup.findIndex((s) => s && s.unit_id === unitId);
    if (existingIdx >= 0 && existingIdx !== ed.activeSlot) {
      ed.activeSlot = existingIdx;
      renderEditorLineup();
      toast("此貓咪已在隊伍中，已切換至該格");
      return;
    }

    const my = getMyUnit(u, ed.accountRegion);
    const defLv = getSmartDefaultLevel(u);
    const defaultForm = my ? Math.min(my.default_form_idx, u.forms.length - 1) : u.forms.length - 1;
    ed.lineup[ed.activeSlot] = {
      unit_id: unitId,
      form_idx: defaultForm,
      base_lv: my ? my.base_lv : defLv.base_lv,
      plus_lv: my ? my.plus_lv : defLv.plus_lv,
      talents: my && Array.isArray(my.talents) ? [...my.talents] : [],
      note: my ? my.note || "" : "",
    };

    const nextEmpty = ed.lineup.findIndex((s, idx) => idx > ed.activeSlot && !s);
    const anyEmpty = nextEmpty >= 0 ? nextEmpty : ed.lineup.findIndex((s) => !s);
    if (anyEmpty >= 0) ed.activeSlot = anyEmpty;
    renderEditorLineup();
  }

  function renderPickerUnits() {
    const qLow = $("#pickerSearch").value.trim().toLowerCase();
    const rarity = $("#pickerRarity").value;
    const trait = $("#pickerTrait").value;
    const ownedOnly = $("#pickerOwnedOnly").checked;
    const acc = state.editor.accountRegion;

    const filtered = [];
    for (const u of state.unitsCatalog) {
      if (rarity !== "" && String(u.rarity) !== rarity) continue;
      const my = getMyUnit(u, acc);
      if (ownedOnly && !(my && my.owned)) continue;
      if (trait && !u.forms.some((f) => f.traits.includes(trait))) continue;
      if (!unitMatchesQuery(u, qLow)) continue;
      filtered.push(u);
      if (filtered.length >= 150) break;
    }

    $("#pickerUnitGrid").innerHTML = filtered
      .map((u) => {
        const my = getMyUnit(u, acc);
        const fIdx = my ? Math.min(my.default_form_idx, u.forms.length - 1) : u.forms.length - 1;
        const f = u.forms[fIdx];
        const fName = getFormDisplayName(f, u.unit_id);
        const lvBadge = my ? `<span class="slot-lv-badge">${my.base_lv}${my.plus_lv > 0 ? `+${my.plus_lv}` : ""}</span>` : "";
        const regCorner = regionTagHtml(u.only_region || (u.has_jp_ahead ? "jp" : null), true);
        return `
          <button type="button" class="picker-unit-btn" data-pick-uid="${u.unit_id}" title="${esc(fName)} (#${u.unit_id})">
            ${regCorner}
            ${f.icon_url ? `<img src="${f.icon_url}" loading="lazy" alt="" />` : ""}
            ${lvBadge}
            <div class="p-name">${esc(fName)}</div>
          </button>`;
      })
      .join("");
  }

  function renderEditorTags() {
    $("#edTagsList").innerHTML = state.editor.tags
      .map((t, idx) => `<span class="tag-chip">#${esc(t)} <button type="button" data-del-tag="${idx}">×</button></span>`)
      .join("");
  }

  function renderEditorScreenshots() {
    $("#edScreenshotsList").innerHTML = state.editor.screenshots
      .map(
        (src, idx) =>
          `<div class="shot-thumb-wrap">
            <img src="${src}" class="zoomable-shot" alt="截圖" />
            <button type="button" class="shot-del-btn" data-del-shot="${idx}">×</button>
          </div>`
      )
      .join("");
  }

  async function addImageFile(file) {
    try {
      const dataUrl = await window.LocalStore.compressImageFileToDataUrl(file);
      state.editor.screenshots.push(dataUrl);
      renderEditorScreenshots();
      toast("已加入通關截圖（已自動壓縮）");
    } catch (e) {
      toast(`圖片處理失敗：${e.message}`);
    }
  }

  async function saveEditorModal() {
    const ed = state.editor;
    if (ed.mode === "template") {
      const name = $("#edTitle").value.trim() || "常用隊伍模板";
      await window.LocalStore.createTemplate({
        name,
        cannon_id: Number($("#edCannon").value || 0),
        items: Array.from(ed.items),
        lineup: ed.lineup,
        note: "",
      });
      await refreshUserSnapshot();
      closeRecordEditor();
      toast(`已儲存模板「${name}」`);
      if (state.view === "templates") renderTemplatesView();
      return;
    }

    const maxC = getMaxCrownsForStage(ed.stageKey);
    const payload = {
      stage_key: ed.stageKey,
      region: ed.accountRegion,
      crown: Number($("#edCrown").value || 1),
      is_cleared: ed.isCleared,
      is_featured: ed.isFeatured,
      title: $("#edTitle").value.trim(),
      cannon_id: Number($("#edCannon").value || 0),
      items: Array.from(ed.items),
      lineup: ed.lineup,
      tags: ed.tags,
      notes: $("#edNotes").value,
      video_url: $("#edVideoUrl").value.trim(),
      screenshots: ed.screenshots,
      cleared_at: $("#edClearedAt").value,
    };

    if (ed.editId) {
      await window.LocalStore.updateRecord(ed.editId, payload, maxC);
      toast("已更新通關紀錄");
    } else {
      await window.LocalStore.createRecord(payload, maxC);
      toast("已新增通關紀錄！");
    }

    await refreshUserSnapshot();
    closeRecordEditor();
    updateGlobalStatsUi();
    renderCategories();
    renderMapsList();
    if (state.selectedStageKey) await selectStage(state.selectedStageKey, false);
    if (state.view === "records") renderAllRecordsView();
  }

  // -------------------- 視圖 2：紀錄總覽 --------------------
  function renderAllRecordsView() {
    const filterRegion = $("#recFilterRegion").value;
    const qLow = $("#recFilterQ").value.trim().toLowerCase();
    const crownVal = $("#recFilterCrown").value;
    const clearedState = $("#recFilterCleared").value;

    const matched = state.records.filter((r) => {
      if (filterRegion !== "all" && r.region !== filterRegion) return false;
      if (crownVal && String(r.crown) !== crownVal) return false;
      if (clearedState === "cleared" && !r.is_cleared) return false;
      if (clearedState === "failed" && r.is_cleared) return false;
      if (state.recFeaturedOnly && !r.is_featured) return false;
      if (state.recFilterUnitId !== null) {
        if (!Array.isArray(r.lineup) || !r.lineup.some((s) => s && s.unit_id === state.recFilterUnitId)) return false;
      }
      if (qLow) {
        const st = state.stagesByKey.get(r.stage_key);
        const m = st ? state.mapsById.get(st.map_id) : null;
        const hay = `${st ? st._search : r.stage_key} ${m ? m._search : ""} ${r.title} ${r.notes} ${(r.tags || []).join(" ")}`.toLowerCase();
        if (!hay.includes(qLow)) return false;
      }
      return true;
    });

    if (!matched.length) {
      $("#allRecordsList").innerHTML = `<div class="muted-text" style="padding:36px;text-align:center;">沒有符合條件的通關紀錄</div>`;
      return;
    }
    $("#allRecordsList").innerHTML = matched.map((r) => renderRecordCardHtml(r, true)).join("");
  }

  function updateRecUnitFilterChip() {
    if (state.recFilterUnitId === null) {
      $("#recUnitFilterChip").innerHTML = `<button class="btn btn-secondary" id="btnPickFilterUnit">🐱 篩選特定貓咪</button>`;
    } else {
      const f = getUnitForm(state.recFilterUnitId, 0);
      $("#recUnitFilterChip").innerHTML = `
        <span class="badge badge-gold" style="padding:6px 10px;gap:6px;">
          🐱 包含：${esc(getFormDisplayName(f, state.recFilterUnitId))}
          <button type="button" id="btnClearFilterUnit" style="background:none;border:none;color:inherit;cursor:pointer;font-weight:800;">✕</button>
        </span>`;
    }
  }

  // -------------------- 視圖 3：我的貓棚與獨有貓咪彈窗 --------------------
  function renderCatboxGrid() {
    const qLow = $("#catboxSearch").value.trim().toLowerCase();
    const rarity = $("#catboxRarity").value;
    const trait = $("#catboxTrait").value;
    const ownedOnly = $("#catboxOwnedOnly").checked;
    const acc = state.catboxAccount;

    const list = state.unitsCatalog.filter((u) => {
      if (rarity !== "" && String(u.rarity) !== rarity) return false;
      const my = getMyUnit(u, acc);
      if (ownedOnly && !(my && my.owned)) return false;
      if (trait && !u.forms.some((f) => f.traits.includes(trait))) return false;
      return unitMatchesQuery(u, qLow);
    });

    const accLabel = acc === "jp" ? "日服帳號" : "台服帳號";
    $("#catboxCountText").textContent = `[${accLabel}] 顯示 ${list.length} / ${state.unitsCatalog.length} 隻`;
    $("#catboxGrid").innerHTML = list
      .slice(0, 360)
      .map((u) => {
        const my = getMyUnit(u, acc);
        const fIdx = my ? Math.min(my.default_form_idx, u.forms.length - 1) : u.forms.length - 1;
        const f = u.forms[fIdx];
        const fName = getFormDisplayName(f, u.unit_id);
        const ownedCls = my && my.owned ? "owned" : "";
        const lvText = my ? `Lv.${my.base_lv}${my.plus_lv > 0 ? `+${my.plus_lv}` : ""}` : u.rarity_name;
        const regCorner = regionTagHtml(u.only_region || (u.has_jp_ahead ? "jp" : null), true);
        return `
          <div class="catalog-card ${ownedCls}" data-open-unit="${u.unit_id}">
            ${regCorner}
            ${f.icon_url ? `<img src="${f.icon_url}" loading="lazy" alt="" />` : ""}
            <div class="catalog-card-name">${esc(fName)}</div>
            <div class="catalog-card-sub">#${String(u.unit_id).padStart(3, "0")} · ${esc(lvText)}</div>
          </div>`;
      })
      .join("");
  }

  function openRegionUnitsModal(region) {
    const isTw = region === "tw";
    const list = state.unitsCatalog.filter((u) => u.only_region === region);
    $("#regionUnitsModalTitle").textContent = isTw
      ? `台服獨有貓咪（${list.length} 隻）`
      : `日服獨有貓咪（${list.length} 隻）`;
    $("#regionUnitsModalDesc").textContent = isTw
      ? "僅存在於台服資料庫（日服無實裝或僅為佔位字）的限定角色；點擊卡片可唯讀檢視詳細數值與介紹。"
      : "僅存在於日服資料庫（台服連一階皆尚未實裝或無翻譯）的角色；點擊卡片可唯讀檢視詳細數值與介紹。";

    $("#regionUnitsGrid").innerHTML = list
      .map((u) => {
        const f = u.forms[u.forms.length - 1];
        const fName = isTw ? (f.name_tw || f.name_jp || `#${u.unit_id}`) : (f.name_jp || f.name_tw || `#${u.unit_id}`);
        return `
          <div class="catalog-card" data-open-region-uid="${u.unit_id}">
            ${regionTagHtml(region, true)}
            ${f.icon_url ? `<img src="${f.icon_url}" loading="lazy" alt="" />` : ""}
            <div class="catalog-card-name">${esc(fName)}</div>
            <div class="catalog-card-sub">#${String(u.unit_id).padStart(3, "0")} · ${esc(u.rarity_name)}</div>
          </div>`;
      })
      .join("");
    $("#regionUnitsModal").classList.remove("hidden");
  }

  function openUnitDetailModal(unitId, opts = {}) {
    const u = state.unitsById.get(unitId);
    if (!u) return;
    const editable = Boolean(opts.editable);
    const usageRecs = state.records.filter(
      (r) => Array.isArray(r.lineup) && r.lineup.some((s) => s && s.unit_id === unitId)
    );
    const defLv = getSmartDefaultLevel(u);

    let modalAcc = opts.initialAcc === "jp" ? "jp" : state.catboxAccount === "jp" ? "jp" : "tw";
    let curFormIdx = opts.initialFormIdx != null ? Math.min(opts.initialFormIdx, u.forms.length - 1) : u.forms.length - 1;
    let previewBaseLv = opts.fixedLevel ? opts.fixedLevel.base_lv : defLv.base_lv;
    let previewPlusLv = opts.fixedLevel ? opts.fixedLevel.plus_lv : defLv.plus_lv;
    let selTalents = new Set();

    const syncFromAcc = () => {
      const my = getMyUnit(u, modalAcc);
      if (opts.initialFormIdx == null || editable) {
        curFormIdx = my ? Math.min(my.default_form_idx, u.forms.length - 1) : u.forms.length - 1;
      }
      if (!opts.fixedLevel || editable) {
        previewBaseLv = my ? my.base_lv : defLv.base_lv;
        previewPlusLv = my ? my.plus_lv : defLv.plus_lv;
      }
      selTalents = new Set(my && Array.isArray(my.talents) ? my.talents : []);
    };
    syncFromAcc();

    const updateLiveStatsDom = () => {
      const f = u.forms[curFormIdx];
      const totalLv = Math.max(1, previewBaseLv + previewPlusLv);
      const lvLabel = previewPlusLv > 0 ? `Lv.${previewBaseLv}+${previewPlusLv}` : `Lv.${previewBaseLv}`;
      const hpVal = calcUnitStat(f.hp, totalLv, u.level_curve);
      const atkVal = calcUnitStat(f.total_atk, totalLv, u.level_curve);
      if ($("#umHpLabel")) $("#umHpLabel").textContent = `體力 (${lvLabel})`;
      if ($("#umAtkLabel")) $("#umAtkLabel").textContent = `攻擊 (${lvLabel})`;
      if ($("#umHpVal")) $("#umHpVal").textContent = fmtNum(hpVal);
      if ($("#umAtkVal")) $("#umAtkVal").textContent = fmtNum(atkVal);
    };

    const renderModal = () => {
      const f = u.forms[curFormIdx];
      const myTw = getMyUnit(u, "tw");
      const myJp = getMyUnit(u, "jp");
      const my = getMyUnit(u, modalAcc) || {
        owned: true,
        default_form_idx: curFormIdx,
        base_lv: defLv.base_lv,
        plus_lv: defLv.plus_lv,
        talents: [],
        note: "",
      };
      const fName = getFormDisplayName(f, u.unit_id);
      const altName = f.name_tw && f.name_jp && f.name_tw !== f.name_jp ? (state.lang === "tw" ? f.name_jp : f.name_tw) : "";
      const fDesc = pickText(f.desc_tw, f.desc_jp);

      $("#unitModalTitle").innerHTML = `#${String(u.unit_id).padStart(3, "0")} ${esc(fName)} ${regionTagHtml(u.only_region)} <span class="muted-text" style="font-size:13px;">${esc(altName)}</span>`;
      const traitText = (f.traits || []).map((t) => TRAIT_LABELS[t] || t).join("、") || "無";
      const abText = (f.abilities || []).join("、") || "無特殊能力";
      const ldText = formatLdRangesText(f.ld_ranges);

      const twInfo = myTw ? `Lv.${myTw.base_lv}${myTw.plus_lv > 0 ? `+${myTw.plus_lv}` : ""}` : "未設定";
      const jpInfo = myJp ? `Lv.${myJp.base_lv}${myJp.plus_lv > 0 ? `+${myJp.plus_lv}` : ""}` : "未設定";

      const totalLv = Math.max(1, previewBaseLv + previewPlusLv);
      const lvLabel = previewPlusLv > 0 ? `Lv.${previewBaseLv}+${previewPlusLv}` : `Lv.${previewBaseLv}`;
      const hpVal = calcUnitStat(f.hp, totalLv, u.level_curve);
      const atkVal = calcUnitStat(f.total_atk, totalLv, u.level_curve);

      const readonlyPreviewBar = !editable
        ? `<div class="section-card" style="background:var(--bg-elevated);padding:10px 14px;">
             <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;">
               <div class="muted-text">
                 <strong>檢視等級數值：</strong>
                 <span>台服：${twInfo}</span>　｜　<span>日服：${jpInfo}</span>
               </div>
               <div class="form-btn-group">
                 ${opts.fixedLevel ? `<button type="button" class="form-pill-btn um-pv-lv" data-b="${opts.fixedLevel.base_lv}" data-p="${opts.fixedLevel.plus_lv}">紀錄 Lv.${opts.fixedLevel.base_lv}${opts.fixedLevel.plus_lv > 0 ? `+${opts.fixedLevel.plus_lv}` : ""}</button>` : ""}
                 <button type="button" class="form-pill-btn um-pv-lv" data-b="${defLv.base_lv}" data-p="${defLv.plus_lv}">預設 (${defLv.base_lv}${defLv.plus_lv > 0 ? `+${defLv.plus_lv}` : ""})</button>
                 <button type="button" class="form-pill-btn um-pv-lv" data-b="30" data-p="0">Lv.30</button>
                 <button type="button" class="form-pill-btn um-pv-lv" data-b="50" data-p="0">Lv.50</button>
                 ${myTw ? `<button type="button" class="form-pill-btn um-pv-lv" data-b="${myTw.base_lv}" data-p="${myTw.plus_lv}">台帳</button>` : ""}
                 ${myJp ? `<button type="button" class="form-pill-btn um-pv-lv" data-b="${myJp.base_lv}" data-p="${myJp.plus_lv}">日帳</button>` : ""}
               </div>
             </div>
           </div>`
        : "";

      const catboxEditorCard = editable
        ? `<div class="section-card" style="background:var(--bg-elevated);">
            <div class="section-head">
              <h3>🐱 我的貓棚預設設定（分帳號記錄等級）</h3>
              <div class="region-switcher">
                <button type="button" class="region-btn um-acc-btn ${modalAcc === "tw" ? "active" : ""}" data-acc="tw">台服 (${twInfo})</button>
                <button type="button" class="region-btn um-acc-btn ${modalAcc === "jp" ? "active" : ""}" data-acc="jp">日服 (${jpInfo})</button>
              </div>
            </div>
            <div class="form-row align-center">
              <label class="checkbox-label"><input type="checkbox" id="umOwned" ${my.owned ? "checked" : ""} /> 已擁有</label>
              <div class="form-group form-xs"><label>基礎等級</label><input type="number" id="umBaseLv" value="${previewBaseLv}" min="1" max="100" /></div>
              <div class="form-group form-xs"><label>加值 (+)</label><input type="number" id="umPlusLv" value="${previewPlusLv}" min="0" max="150" /></div>
              <div class="form-group"><label>個人備註</label><input type="text" id="umNote" value="${esc(my.note || "")}" placeholder="如：超本能未開" /></div>
              <button class="btn btn-primary" id="btnSaveMyUnit">💾 儲存至${modalAcc === "jp" ? "日服" : "台服"}貓棚</button>
            </div>
            ${
              u.talents.length
                ? `<div class="talents-check-wrap" style="margin-top:10px;">
                     <label>預設已開啟的本能／超本能：</label>
                     <div class="talents-pills">
                       ${u.talents
                         .map((t) => {
                           const rawDesc = pickText(t.desc_tw, t.desc_jp);
                           const active = selTalents.has(t.ability_id) ? "active" : "";
                           return `<button type="button" class="talent-chip um-talent-btn ${active}" data-aid="${t.ability_id}" title="${esc(rawDesc)}">${esc(shortTalentLabel(t))}</button>`;
                         })
                         .join("")}
                     </div>
                   </div>`
                : ""
            }
          </div>`
        : "";

      $("#unitModalBody").innerHTML = `
        <div class="detail-top-grid">
          ${f.icon_url ? `<img class="detail-big-icon" src="${f.icon_url}" alt="" />` : ""}
          <div style="flex:1;min-width:0;">
            <div class="form-btn-group" style="margin-bottom:8px;">
              ${u.forms
                .map((fm) => {
                  const nm = getFormDisplayName(fm, u.unit_id);
                  const rTag = fm.only_region === "jp" ? " [JP]" : fm.only_region === "tw" ? " [TW]" : "";
                  return `<button type="button" class="form-pill-btn um-form-btn ${fm.form_idx === curFormIdx ? "active" : ""}" data-fi="${fm.form_idx}">
                    ${FORM_LABELS[fm.form_idx]}：${esc(nm)}${rTag}
                  </button>`;
                })
                .join("")}
            </div>
            <div class="muted-text" style="white-space:pre-wrap;line-height:1.5;">${esc(fDesc)}</div>
          </div>
        </div>

        <div class="stats-kv-grid">
          <div class="kv-box"><div class="kv-label" id="umHpLabel">體力 (${lvLabel})</div><div class="kv-val" id="umHpVal">${fmtNum(hpVal)}</div></div>
          <div class="kv-box"><div class="kv-label" id="umAtkLabel">攻擊 (${lvLabel})</div><div class="kv-val" id="umAtkVal">${fmtNum(atkVal)}</div></div>
          <div class="kv-box">
            <div class="kv-label">射程 / 範圍</div>
            <div class="kv-val">${f.range} (${f.area_attack ? "範圍" : "單體"})</div>
            ${ldText ? `<div class="muted-text" style="color:var(--accent);font-weight:600;margin-top:2px;">${esc(ldText)}</div>` : ""}
          </div>
          <div class="kv-box">
            <div class="kv-label">KB / 跑速 / 費用</div>
            <div class="kv-val">${f.kb} / ${f.speed} / $${Math.round(f.cost * 1.5)}</div>
          </div>
        </div>
        <div class="muted-text" style="margin-bottom:12px;">
          <strong>針對屬性：</strong>${esc(traitText)}　｜　<strong>能力：</strong>${esc(abText)}
        </div>

        ${readonlyPreviewBar}
        ${catboxEditorCard}

        <div class="section-card" style="margin-bottom:0;">
          <div class="section-head"><h3>🏆 反向查詢：此貓登場過的通關紀錄（${usageRecs.length} 筆）</h3></div>
          <div class="reverse-list">
            ${
              usageRecs.length
                ? usageRecs
                    .map((r) => {
                      const st = state.stagesByKey.get(r.stage_key);
                      const m = st ? state.mapsById.get(st.map_id) : null;
                      const stName = st ? pickText(st.name_tw, st.name_jp) : r.stage_key;
                      const mName = m ? pickText(m.name_tw, m.name_jp) : "";
                      return `
                      <div class="reverse-row jump-stage-link" data-bucket="${m ? m.bucket_id : ""}" data-map="${st ? st.map_id : ""}" data-stage="${esc(r.stage_key)}">
                        <div>
                          <strong>${esc(mName)} › ${esc(stName)}</strong>
                          <div class="muted-text">${esc(r.title || "通關隊伍")} · ${r.crown}冠 · ${r.region.toUpperCase()}</div>
                        </div>
                        <span class="badge badge-gold">前往 →</span>
                      </div>`;
                    })
                    .join("")
                : `<div class="muted-text">尚無使用這隻貓咪的通關紀錄</div>`
            }
          </div>
        </div>`;

      $$(".um-form-btn").forEach((b) =>
        b.addEventListener("click", () => {
          curFormIdx = Number(b.dataset.fi);
          renderModal();
        })
      );
      $$(".um-pv-lv").forEach((b) =>
        b.addEventListener("click", () => {
          previewBaseLv = Number(b.dataset.b);
          previewPlusLv = Number(b.dataset.p);
          updateLiveStatsDom();
        })
      );

      if (editable) {
        $$(".um-acc-btn").forEach((b) =>
          b.addEventListener("click", () => {
            modalAcc = b.dataset.acc;
            syncFromAcc();
            renderModal();
          })
        );
        $("#umBaseLv").addEventListener("input", (e) => {
          previewBaseLv = Math.max(1, Number(e.target.value || 1));
          updateLiveStatsDom();
        });
        $("#umPlusLv").addEventListener("input", (e) => {
          previewPlusLv = Math.max(0, Number(e.target.value || 0));
          updateLiveStatsDom();
        });
        $$(".um-talent-btn").forEach((b) =>
          b.addEventListener("click", () => {
            const aid = Number(b.dataset.aid);
            if (selTalents.has(aid)) selTalents.delete(aid);
            else selTalents.add(aid);
            b.classList.toggle("active", selTalents.has(aid));
          })
        );
        $("#btnSaveMyUnit").addEventListener("click", async () => {
          await window.LocalStore.upsertMyUnit(unitId, modalAcc, {
            owned: $("#umOwned").checked,
            default_form_idx: curFormIdx,
            base_lv: Number($("#umBaseLv").value || defLv.base_lv),
            plus_lv: Number($("#umPlusLv").value || 0),
            talents: Array.from(selTalents),
            note: $("#umNote").value,
          });
          await refreshUserSnapshot();
          toast(`已儲存「${getFormDisplayName(u.forms[curFormIdx], unitId)}」至${modalAcc === "jp" ? "日服" : "台服"}貓棚`);
          renderModal();
          renderCatboxGrid();
        });
      }
    };

    renderModal();
    $("#unitModal").classList.remove("hidden");
  }

  // -------------------- 視圖 4：敵人圖鑑 --------------------
  function renderEnemyCatalogGrid() {
    const qLow = $("#enemySearch").value.trim().toLowerCase();
    const trait = $("#enemyTrait").value;
    const list = state.enemiesCatalog.filter((e) => {
      if (trait && !e.traits.includes(trait)) return false;
      return enemyMatchesQuery(e, qLow);
    });
    $("#enemyCountText").textContent = `顯示 ${list.length} / ${state.enemiesCatalog.length} 種敵人`;
    $("#enemyCatalogGrid").innerHTML = list
      .slice(0, 360)
      .map((e) => {
        const name = pickText(e.name_tw, e.name_jp);
        const tr = (e.traits || []).slice(0, 2).map((t) => TRAIT_LABELS[t] || t).join("/");
        return `
          <div class="catalog-card enemy-card" data-open-enemy="${e.enemy_id}">
            ${regionTagHtml(e.only_region, true)}
            ${e.icon_url ? `<img src="${e.icon_url}" loading="lazy" alt="" />` : `<div style="height:58px;"></div>`}
            <div class="catalog-card-name">${esc(name)}</div>
            <div class="catalog-card-sub">#${String(e.enemy_id).padStart(3, "0")} ${esc(tr)}</div>
          </div>`;
      })
      .join("");
  }

  async function openEnemyDetailModal(enemyId, stageCtx = null) {
    const e = state.enemiesById.get(enemyId);
    if (!e) return;
    const idxMap = await ensureEnemyStagesIndex();
    const stageTuples = idxMap[String(enemyId)] || [];
    const stages = stageTuples
      .map(([sk, isBoss, maxMagHp]) => {
        const st = state.stagesByKey.get(sk);
        if (!st) return null;
        const m = state.mapsById.get(st.map_id);
        const cat = m ? state.categoriesById.get(m.bucket_id) : null;
        return {
          stage_key: sk,
          is_boss: Boolean(isBoss),
          max_mag_hp: maxMagHp,
          stage_name: pickText(st.name_tw, st.name_jp),
          only_region: st.only_region,
          map_id: st.map_id,
          map_name: m ? pickText(m.name_tw, m.name_jp) : "",
          bucket_id: m ? m.bucket_id : 0,
          category_name: cat ? cat.name : "",
        };
      })
      .filter(Boolean);

    const eName = pickText(e.name_tw, e.name_jp);
    const altName = e.name_tw && e.name_jp && e.name_tw !== e.name_jp ? (state.lang === "tw" ? e.name_jp : e.name_tw) : "";
    const eDesc = pickText(e.desc_tw, e.desc_jp);
    const traitText = (e.traits || []).map((t) => TRAIT_LABELS[t] || t).join("、") || "無";
    const abText = (e.abilities || []).join("、") || "無特殊能力";
    const ldText = formatLdRangesText(e.ld_ranges);

    let selectedMode = stageCtx ? String(stageCtx.initialCrown || 1) : "raw";

    const renderEnemyModal = () => {
      let hpMult = 100;
      let atkMult = 100;
      let modeDesc = "基礎 (100%)";

      if (stageCtx && selectedMode !== "raw") {
        const crownNum = Number(selectedMode);
        const starMags = stageCtx.stageDetail.star_mags || [100];
        const crownMag = starMags[crownNum - 1] || 100;
        const baseMagHp = stageCtx.enemyEntry.mag_hp || 100;
        const baseMagAtk = stageCtx.enemyEntry.mag_atk || baseMagHp;
        hpMult = Math.round((baseMagHp * crownMag) / 100);
        atkMult = Math.round((baseMagAtk * crownMag) / 100);
        modeDesc = `${crownNum}冠 ${hpMult}%${atkMult !== hpMult ? ` / 攻${atkMult}%` : ""}`;
      }

      const dispHp = Math.round((e.hp * hpMult) / 100);
      const dispAtk = Math.round((e.total_atk * atkMult) / 100);

      let switcherHtml = "";
      if (stageCtx) {
        const maxC = Math.max(1, Math.min(4, stageCtx.stageDetail.star_count || 1));
        const starMags = stageCtx.stageDetail.star_mags || [100];
        const crownBtns = Array.from({ length: maxC }, (_, idx) => {
          const c = idx + 1;
          const cm = starMags[idx] || 100;
          const eff = Math.round(((stageCtx.enemyEntry.mag_hp || 100) * cm) / 100);
          return `<button type="button" class="region-btn em-mode-btn ${selectedMode === String(c) ? "active" : ""}" data-em-mode="${c}">${c}冠 (${eff}%)</button>`;
        }).join("");
        switcherHtml = `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <span class="muted-text"><strong>本關（${esc(stageCtx.stageDetail.name)}）倍率切換：</strong></span>
            <div class="region-switcher" style="flex-wrap:wrap;">
              <button type="button" class="region-btn em-mode-btn ${selectedMode === "raw" ? "active" : ""}" data-em-mode="raw">原始 (100%)</button>
              ${crownBtns}
            </div>
          </div>`;
      }

      $("#enemyModalTitle").innerHTML = `#${String(e.enemy_id).padStart(3, "0")} ${esc(eName)} ${regionTagHtml(e.only_region)} <span class="muted-text" style="font-size:13px;">${esc(altName)}</span>`;
      $("#enemyModalBody").innerHTML = `
        <div class="detail-top-grid">
          ${e.icon_url ? `<img class="detail-big-icon" src="${e.icon_url}" alt="" />` : ""}
          <div style="flex:1;"><div class="muted-text" style="white-space:pre-wrap;line-height:1.5;">${esc(eDesc)}</div></div>
        </div>
        ${switcherHtml}
        <div class="stats-kv-grid">
          <div class="kv-box"><div class="kv-label">體力 (${esc(modeDesc)})</div><div class="kv-val">${fmtNum(dispHp)}</div></div>
          <div class="kv-box"><div class="kv-label">攻擊 (${selectedMode === "raw" ? "100%" : `${atkMult}%`})</div><div class="kv-val">${fmtNum(dispAtk)}</div></div>
          <div class="kv-box">
            <div class="kv-label">射程 / 範圍</div>
            <div class="kv-val">${e.range} (${e.area_attack ? "範圍" : "單體"})</div>
            ${ldText ? `<div class="muted-text" style="color:var(--accent);font-weight:600;margin-top:2px;">${esc(ldText)}</div>` : ""}
          </div>
          <div class="kv-box"><div class="kv-label">KB / 跑速 / 賞金</div><div class="kv-val">${e.kb} / ${e.speed} / $${e.bounty}</div></div>
        </div>
        <div class="muted-text" style="margin-bottom:12px;">
          <strong>屬性：</strong>${esc(traitText)}　｜　<strong>能力：</strong>${esc(abText)}
        </div>
        <div class="section-card" style="margin-bottom:0;">
          <div class="section-head"><h3>🗺️ 反向查詢：出現此敵人的關卡（前 ${stages.length} 關）</h3></div>
          <div class="reverse-list">
            ${
              stages.length
                ? stages
                    .map(
                      (s) => `
                      <div class="reverse-row jump-stage-link" data-bucket="${s.bucket_id}" data-map="${s.map_id}" data-stage="${esc(s.stage_key)}">
                        <div>
                          ${s.is_boss ? `<span class="badge badge-red">BOSS</span>` : ""}
                          ${regionTagHtml(s.only_region)}
                          <strong>${esc(s.category_name)} › ${esc(s.map_name)} › ${esc(s.stage_name)}</strong>
                        </div>
                        <span class="badge badge-gold">${s.max_mag_hp}% →</span>
                      </div>`
                    )
                    .join("")
                : `<div class="muted-text">此敵人目前未出現在靜態關卡中</div>`
            }
          </div>
        </div>`;

      $$(".em-mode-btn").forEach((b) =>
        b.addEventListener("click", () => {
          selectedMode = b.dataset.emMode;
          renderEnemyModal();
        })
      );
    };

    renderEnemyModal();
    $("#enemyModal").classList.remove("hidden");
  }

  // -------------------- 視圖 5：常用隊伍模板 --------------------
  function renderTemplatesView() {
    if (!state.templates.length) {
      $("#templatesList").innerHTML = `<div class="muted-text" style="padding:36px;text-align:center;">還沒有常用隊伍模板，點擊上方「＋ 建立模板」或在通關紀錄卡片上點「💾 模板」。</div>`;
      return;
    }
    const pvMode = state.tplPreviewMode;
    $("#templatesList").innerHTML = state.templates
      .map((t) => {
        const cannon = (state.bootstrap?.cannons || []).find((c) => c.cannon_id === t.cannon_id);
        const cname = cannon ? pickText(cannon.name_tw, cannon.name_jp) : "貓咪砲";
        const dispLineup = pvMode === "raw" ? (t.lineup || []) : applyAccountToLineup(t.lineup || [], pvMode);
        const pvBadge =
          pvMode === "tw"
            ? `<span class="badge badge-tw">預覽：台服貓棚</span>`
            : pvMode === "jp"
            ? `<span class="badge badge-jp">預覽：日服貓棚</span>`
            : "";
        return `
          <div class="record-card">
            <div class="record-card-head">
              <div class="record-title-row">
                <span class="badge badge-gold">常用模板</span>
                ${pvBadge}
                <span class="record-title">${esc(t.name)}</span>
                <span class="muted-text">🔫 ${esc(cname)}</span>
              </div>
              <div class="record-actions">
                <button class="btn btn-danger btn-xs btn-del-tpl" data-tpl-id="${t.id}">刪除</button>
              </div>
            </div>
            <div class="lineup-grid-5x2 rec-readonly-lineup">${renderLineup5x2Html(dispLineup, false)}</div>
            <div class="combo-bar">${renderComboBarHtml(dispLineup)}</div>
          </div>`;
      })
      .join("");
  }

  // -------------------- 跨語言全域搜尋（純前端即時運算） --------------------
  function buildGlobalSearchHtml(q) {
    const qLow = q.trim().toLowerCase();
    if (!qLow) return "";

    const matchedStages = [];
    for (const s of state.stagesAll) {
      const m = state.mapsById.get(s.map_id);
      if (s._search.includes(qLow) || (m && m._mapNameSearch.includes(qLow))) {
        const cat = m ? state.categoriesById.get(m.bucket_id) : null;
        matchedStages.push({
          stage_key: s.stage_key,
          name: pickText(s.name_tw, s.name_jp),
          only_region: s.only_region,
          map_id: s.map_id,
          map_name: m ? pickText(m.name_tw, m.name_jp) : "",
          bucket_id: m ? m.bucket_id : 0,
          category_name: cat ? cat.name : "",
          direct: s._search.includes(qLow) ? 0 : 1,
        });
        if (matchedStages.length >= 50) break;
      }
    }
    matchedStages.sort((a, b) => a.direct - b.direct);

    const matchedUnits = [];
    for (const u of state.unitsCatalog) {
      if (u._search.includes(qLow)) {
        const f = u.forms[u.forms.length - 1];
        matchedUnits.push({
          unit_id: u.unit_id,
          name: getFormDisplayName(f, u.unit_id),
          only_region: u.only_region,
          icon_url: f.icon_url,
          rarity_name: u.rarity_name,
        });
        if (matchedUnits.length >= 20) break;
      }
    }

    const matchedEnemies = [];
    for (const e of state.enemiesCatalog) {
      if (e._search.includes(qLow)) {
        matchedEnemies.push({
          enemy_id: e.enemy_id,
          name: pickText(e.name_tw, e.name_jp),
          only_region: e.only_region,
          icon_url: e.icon_url,
        });
        if (matchedEnemies.length >= 16) break;
      }
    }

    let html = "";
    if (matchedStages.length) {
      html += `<div class="search-group-title">關卡 (${matchedStages.length})</div>`;
      html += matchedStages
        .slice(0, 24)
        .map(
          (s) =>
            `<div class="search-item gs-stage" data-bucket="${s.bucket_id}" data-map="${s.map_id}" data-stage="${esc(s.stage_key)}">
              <div><strong>${regionTagHtml(s.only_region)} ${esc(s.name)}</strong><div class="muted-text">${esc(s.category_name)} › ${esc(s.map_name)}</div></div>
            </div>`
        )
        .join("");
    }
    if (matchedUnits.length) {
      html += `<div class="search-group-title">我方貓咪 (${matchedUnits.length})</div>`;
      html += matchedUnits
        .map(
          (u) =>
            `<div class="search-item gs-unit" data-uid="${u.unit_id}">
              ${u.icon_url ? `<img src="${u.icon_url}" alt="" />` : ""}
              <div><strong>${regionTagHtml(u.only_region)} ${esc(u.name)}</strong><div class="muted-text">#${String(u.unit_id).padStart(3, "0")} · ${esc(u.rarity_name)}</div></div>
            </div>`
        )
        .join("");
    }
    if (matchedEnemies.length) {
      html += `<div class="search-group-title">敵人 (${matchedEnemies.length})</div>`;
      html += matchedEnemies
        .map(
          (en) =>
            `<div class="search-item gs-enemy" data-eid="${en.enemy_id}">
              ${en.icon_url ? `<img src="${en.icon_url}" alt="" />` : ""}
              <div><strong>${regionTagHtml(en.only_region)} ${esc(en.name)}</strong><div class="muted-text">#${String(en.enemy_id).padStart(3, "0")}</div></div>
            </div>`
        )
        .join("");
    }
    return html || `<div class="muted-text" style="padding:12px;">找不到符合「${esc(q)}」的結果</div>`;
  }

  // -------------------- 視圖切換與事件綁定 --------------------
  function switchView(viewName) {
    state.view = viewName;
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === viewName));
    $$(".m-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === viewName));
    $$(".view-pane").forEach((p) => p.classList.toggle("active", p.id === `view-${viewName}`));
    if (viewName === "records") renderAllRecordsView();
    if (viewName === "catbox") renderCatboxGrid();
    if (viewName === "enemies") renderEnemyCatalogGrid();
    if (viewName === "templates") renderTemplatesView();
  }

  function bindEvents() {
    $("#mainNav").addEventListener("click", (e) => {
      const btn = e.target.closest(".nav-btn");
      if (btn) switchView(btn.dataset.view);
    });
    $("#mobileBottomNav").addEventListener("click", (e) => {
      const btn = e.target.closest(".m-nav-btn");
      if (btn) switchView(btn.dataset.view);
    });
    $("#btnMobileBackToCats").addEventListener("click", () => setMobileStageStep("categories"));
    $("#btnMobileBackToMaps").addEventListener("click", () => setMobileStageStep("maps"));

    $("#themeToggleBtn").addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });
    $("#langSwitcher").addEventListener("click", (e) => {
      const btn = e.target.closest(".region-btn");
      if (btn) switchDisplayLanguage(btn.dataset.lang);
    });
    $("#catboxAccountSwitcher").addEventListener("click", (e) => {
      const btn = e.target.closest(".region-btn");
      if (!btn) return;
      state.catboxAccount = btn.dataset.account;
      localStorage.setItem("bc_catbox_acc", state.catboxAccount);
      updateCatboxAccountButtons();
      renderCatboxGrid();
    });

    // 設定／備份還原／安裝 App 彈窗
    $("#btnOpenSettings").addEventListener("click", () => {
      $("#settingsModal").classList.remove("hidden");
      updateOfflineStatusText();
    });
    $("#offlineSyncPill").addEventListener("click", () => {
      $("#settingsModal").classList.remove("hidden");
      updateOfflineStatusText();
    });
    $("#btnDownloadOfflinePack").addEventListener("click", () => {
      runFullOfflineSync({ manual: true });
    });
    $("#btnCheckAppUpdate")?.addEventListener("click", async () => {
      if (!navigator.onLine) {
        toast("目前處於離線狀態，請連上網路後再檢查更新");
        return;
      }
      toast("正在向伺服器檢查最新介面...");
      try {
        if (state.swReg) await state.swReg.update();
      } catch (_) {}
      setTimeout(() => window.location.reload(), 450);
    });
    $("#btnCloseSettingsModal").addEventListener("click", () => $("#settingsModal").classList.add("hidden"));
    $("#btnExportBackup").addEventListener("click", async () => {
      const obj = await window.LocalStore.exportBackupJson();
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `battle_cats_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("已匯出備份檔 (.json)");
    });
    $("#btnImportBackup").addEventListener("click", () => $("#importBackupFile").click());
    $("#importBackupFile").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      try {
        const text = await f.text();
        const obj = JSON.parse(text);
        if (!confirm("匯入備份檔將覆蓋目前這台裝置的個人紀錄與貓棚，確定繼續？")) return;
        await window.LocalStore.importBackupJson(obj, "replace");
        await refreshUserSnapshot();
        updateGlobalStatsUi();
        renderCategories();
        renderMapsList();
        if (state.selectedStageKey) await selectStage(state.selectedStageKey, false);
        renderAllRecordsView();
        renderCatboxGrid();
        renderTemplatesView();
        $("#settingsModal").classList.add("hidden");
        toast("已成功還原備份資料！");
      } catch (err) {
        toast(`匯入失敗：${err.message}`);
      }
    });
    $("#btnClearAllLocalData").addEventListener("click", async () => {
      if (!confirm("確定要清空這台裝置的所有通關紀錄、貓棚與模板？建議先匯出備份！")) return;
      await window.LocalStore.clearAllData();
      await refreshUserSnapshot();
      updateGlobalStatsUi();
      renderCategories();
      renderMapsList();
      if (state.selectedStageKey) await selectStage(state.selectedStageKey, false);
      renderAllRecordsView();
      renderCatboxGrid();
      renderTemplatesView();
      toast("已清空本機所有個人紀錄");
    });
    $("#btnTriggerPwaInstall").addEventListener("click", async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      $("#pwaInstallBtnWrap").classList.add("hidden");
    });

    // 桌機 & 手機搜尋共用處理
    const bindSearchPair = (inputSel, ddSel, onDone) => {
      const run = debounce(() => {
        const q = $(inputSel).value.trim();
        const dd = $(ddSel);
        if (!q) {
          dd.classList.add("hidden");
          return;
        }
        dd.innerHTML = buildGlobalSearchHtml(q);
        dd.classList.remove("hidden");
      }, 120);
      $(inputSel).addEventListener("input", run);
      $(ddSel).addEventListener("click", (e) => {
        const st = e.target.closest(".gs-stage");
        const un = e.target.closest(".gs-unit");
        const en = e.target.closest(".gs-enemy");
        $(ddSel).classList.add("hidden");
        if (onDone) onDone();
        if (st) jumpToStage(Number(st.dataset.bucket), Number(st.dataset.map), st.dataset.stage);
        if (un) openUnitDetailModal(Number(un.dataset.uid), { editable: false });
        if (en) openEnemyDetailModal(Number(en.dataset.eid), null);
      });
    };
    bindSearchPair("#globalSearchInput", "#globalSearchDropdown");
    bindSearchPair("#mobileSearchInput", "#mobileSearchDropdown", () => {
      $("#mobileSearchBar").classList.add("hidden");
    });
    $("#btnMobileSearchToggle").addEventListener("click", () => {
      const bar = $("#mobileSearchBar");
      bar.classList.toggle("hidden");
      if (!bar.classList.contains("hidden")) $("#mobileSearchInput").focus();
    });
    $("#btnCloseMobileSearch").addEventListener("click", () => {
      $("#mobileSearchBar").classList.add("hidden");
      $("#mobileSearchDropdown").classList.add("hidden");
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        $("#globalSearchInput").focus();
        $("#globalSearchInput").select();
      }
      if (e.key === "Escape") {
        $("#globalSearchDropdown").classList.add("hidden");
        $("#lightbox").classList.add("hidden");
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".global-search-wrap")) {
        $("#globalSearchDropdown").classList.add("hidden");
      }
    });

    // 編輯器切換鈕
    $("#edRegionSwitcher").addEventListener("click", (e) => {
      const btn = e.target.closest(".region-btn");
      if (!btn) return;
      state.editor.accountRegion = btn.dataset.region === "jp" ? "jp" : "tw";
      updateEditorAccountBadge();
      renderPickerUnits();
    });
    $("#edClearedSwitcher").addEventListener("click", (e) => {
      const btn = e.target.closest(".region-btn");
      if (!btn) return;
      state.editor.isCleared = btn.dataset.cleared === "1";
      updateEditorStatusControls();
    });
    $("#btnEdToggleFeatured").addEventListener("click", () => {
      state.editor.isFeatured = !state.editor.isFeatured;
      updateEditorStatusControls();
    });

    // 分類、地圖與關卡操作
    $("#categoryList").addEventListener("click", (e) => {
      const item = e.target.closest(".cat-item");
      if (!item) return;
      const raw = item.dataset.bucket;
      selectCategory(raw === "__favorites__" ? "__favorites__" : Number(raw), true);
    });
    $("#mapFilterPills").addEventListener("click", (e) => {
      const p = e.target.closest(".pill");
      if (!p) return;
      state.mapFilter = p.dataset.filter;
      $$("#mapFilterPills .pill").forEach((x) => x.classList.toggle("active", x === p));
      renderMapsList();
    });
    $("#mapSearchInput").addEventListener("input", debounce(renderMapsList, 150));
    $("#mapList").addEventListener("click", (e) => {
      const stRow = e.target.closest(".stage-row-item");
      if (stRow) {
        selectStage(stRow.dataset.stageKey, true);
        return;
      }
      const mh = e.target.closest(".map-header");
      if (mh) toggleMapExpand(Number(mh.dataset.mapId));
    });

    $("#sdCrownButtons").addEventListener("click", async (e) => {
      const toggleEl = e.target.closest(".crown-toggle-check");
      const chip = e.target.closest(".crown-chip");
      if (!chip || !state.stageDetail) return;
      const crown = Number(chip.dataset.crown);
      if (toggleEl) {
        const set = new Set(state.stageDetail.cleared_crowns);
        if (set.has(crown)) set.delete(crown);
        else set.add(crown);
        const maxC = getMaxCrownsForStage(state.stageDetail.stage_key);
        const saved = await window.LocalStore.setStageProgress(state.stageDetail.stage_key, Array.from(set), maxC);
        await refreshUserSnapshot();
        state.stageDetail.cleared_crowns = saved;
        updateGlobalStatsUi();
        renderStageDetail();
        renderCategories();
        renderMapsList();
        return;
      }
      state.viewingCrown = crown;
      renderStageDetail();
    });

    $("#sdEnemyList").addEventListener("click", (e) => {
      const card = e.target.closest(".enemy-mini-card");
      if (!card) return;
      const eid = Number(card.dataset.enemyId);
      const gIdx = Number(card.dataset.gidx);
      const entry = (state._stageEnemiesGrouped || [])[gIdx];
      const stageCtx = state.stageDetail && entry
        ? { stageDetail: state.stageDetail, enemyEntry: entry, initialCrown: state.viewingCrown }
        : null;
      openEnemyDetailModal(eid, stageCtx);
    });

    $("#btnAddRecord").addEventListener("click", () => {
      openRecordEditor({ mode: "record", stageKey: state.selectedStageKey });
    });

    $("#btnToggleFavoriteStage").addEventListener("click", async () => {
      if (!state.stageDetail) return;
      const nextFav = !state.stageDetail.is_favorite;
      await window.LocalStore.setFavoriteStage(state.stageDetail.stage_key, nextFav);
      await refreshUserSnapshot();
      state.stageDetail.is_favorite = nextFav;
      renderStageDetail();
      renderCategories();
      renderMapsList();
      toast(nextFav ? "已加入「📌 收藏關卡」" : "已取消收藏此關卡");
    });

    $("#sdStageTagInput").addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val && !state.stageTags.includes(val)) {
          state.stageTags.push(val);
          renderStageTagsList();
          await saveCurrentStageNote(true);
        }
        e.target.value = "";
      }
    });
    $("#sdStageQuickTags").addEventListener("click", async (e) => {
      const btn = e.target.closest(".qtag");
      if (!btn) return;
      const val = btn.textContent.trim();
      if (!state.stageTags.includes(val)) {
        state.stageTags.push(val);
        renderStageTagsList();
        await saveCurrentStageNote(true);
      }
    });
    $("#sdStageTagsList").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-del-stagetag]");
      if (!btn) return;
      state.stageTags.splice(Number(btn.dataset.delStagetag), 1);
      renderStageTagsList();
      await saveCurrentStageNote(true);
    });
    $("#btnSaveStageNote").addEventListener("click", () => saveCurrentStageNote(false));
    $("#sdStageNoteInput").addEventListener("input", (e) => autoResizeTextarea(e.target));
    $("#edNotes").addEventListener("input", (e) => autoResizeTextarea(e.target));

    // 全域委派事件（跳轉關卡、放大截圖、唯讀貓卡、紀錄卡片按鈕、獨有貓卡）
    document.addEventListener("click", async (e) => {
      const regBox = e.target.closest("[data-open-region-units]");
      if (regBox) {
        openRegionUnitsModal(regBox.dataset.openRegionUnits);
        return;
      }

      const jump = e.target.closest(".jump-stage-link");
      if (jump) {
        e.preventDefault();
        $("#unitModal").classList.add("hidden");
        $("#enemyModal").classList.add("hidden");
        $("#regionUnitsModal").classList.add("hidden");
        const b = jump.dataset.bucket !== "" ? Number(jump.dataset.bucket) : null;
        const m = jump.dataset.map !== "" ? Number(jump.dataset.map) : null;
        jumpToStage(b, m, jump.dataset.stage);
        return;
      }

      if (e.target.classList.contains("zoomable-shot")) {
        $("#lightboxImg").src = e.target.src;
        $("#lightbox").classList.remove("hidden");
        return;
      }

      const roSlot = e.target.closest(".rec-readonly-lineup .lineup-slot[data-unit-id]");
      if (roSlot) {
        const uid = Number(roSlot.dataset.unitId);
        const fIdx = roSlot.dataset.formIdx !== undefined ? Number(roSlot.dataset.formIdx) : null;
        const bLv = roSlot.dataset.baseLv !== undefined ? Number(roSlot.dataset.baseLv) : null;
        const pLv = roSlot.dataset.plusLv !== undefined ? Number(roSlot.dataset.plusLv) : 0;
        openUnitDetailModal(uid, {
          editable: false,
          initialFormIdx: fIdx,
          fixedLevel: bLv !== null ? { base_lv: bLv, plus_lv: pLv } : null,
        });
        return;
      }

      const featBtn = e.target.closest(".btn-toggle-feat");
      const editBtn = e.target.closest(".btn-edit-rec");
      const cloneBtn = e.target.closest(".btn-clone-rec");
      const tplBtn = e.target.closest(".btn-save-tpl");
      const delBtn = e.target.closest(".btn-del-rec");
      if (featBtn || editBtn || cloneBtn || tplBtn || delBtn) {
        const recId = Number((featBtn || editBtn || cloneBtn || tplBtn || delBtn).dataset.id);
        const rec = state.records.find((r) => r.id === recId);
        if (!rec) return;

        if (featBtn) {
          const nextFeat = !rec.is_featured;
          await window.LocalStore.setRecordFeatured(recId, nextFeat);
          await refreshUserSnapshot();
          toast(nextFeat ? "已加入「⭐ 珍藏紀錄」" : "已取消珍藏標記");
          if (state.selectedStageKey) await selectStage(state.selectedStageKey, false);
          if (state.view === "records") renderAllRecordsView();
        } else if (editBtn) {
          openRecordEditor({ mode: "record", record: rec });
        } else if (cloneBtn) {
          openRecordEditor({ mode: "record", stageKey: rec.stage_key, cloneFrom: rec });
        } else if (tplBtn) {
          const name = prompt("請輸入模板名稱：", rec.title || "常用隊伍");
          if (name !== null && name.trim()) {
            await window.LocalStore.createTemplate({
              name: name.trim(),
              cannon_id: rec.cannon_id,
              items: rec.items,
              lineup: rec.lineup,
            });
            await refreshUserSnapshot();
            toast(`已將隊伍存為模板「${name.trim()}」`);
          }
        } else if (delBtn) {
          const msg = rec.is_featured ? "這是「⭐ 珍藏紀錄」，確定真的要刪除嗎？" : "確定要刪除這筆紀錄嗎？";
          if (!confirm(msg)) return;
          await window.LocalStore.deleteRecord(recId);
          await refreshUserSnapshot();
          updateGlobalStatsUi();
          renderCategories();
          renderMapsList();
          if (state.selectedStageKey) await selectStage(state.selectedStageKey, false);
          if (state.view === "records") renderAllRecordsView();
          toast("已刪除紀錄");
        }
      }
    });

    // 編輯器事件
    $("#btnCloseRecordModal").addEventListener("click", closeRecordEditor);
    $("#btnCancelRecordModal").addEventListener("click", closeRecordEditor);
    $("#btnSaveRecordModal").addEventListener("click", saveEditorModal);
    $("#edItemsBar").addEventListener("click", (e) => {
      const btn = e.target.closest(".item-toggle-btn");
      if (!btn) return;
      const iid = Number(btn.dataset.itemId);
      if (state.editor.items.has(iid)) state.editor.items.delete(iid);
      else state.editor.items.add(iid);
      renderEditorItems();
    });
    $("#edTemplateSelect").addEventListener("change", (e) => {
      const tid = Number(e.target.value);
      if (!tid) return;
      const tpl = state.templates.find((t) => t.id === tid);
      if (!tpl) return;
      const acc = state.editor.accountRegion;
      state.editor.lineup = applyAccountToLineup(tpl.lineup || [], acc);
      $("#edCannon").value = String(tpl.cannon_id ?? 0);
      state.editor.items = new Set(tpl.items || []);
      renderEditorItems();
      renderEditorLineup();
      toast(`已套用模板「${tpl.name}」（同步為${acc === "jp" ? "日服" : "台服"}貓棚等級）`);
      e.target.value = "";
    });
    $("#btnApplyAccountLevels").addEventListener("click", () => {
      const acc = state.editor.accountRegion;
      state.editor.lineup = applyAccountToLineup(state.editor.lineup, acc);
      renderEditorLineup();
      toast(`已更新整隊為【${acc === "jp" ? "日服" : "台服"}帳號貓棚】`);
    });
    $("#btnClearLineup").addEventListener("click", () => {
      state.editor.lineup = Array(10).fill(null);
      state.editor.activeSlot = 0;
      renderEditorLineup();
    });

    $("#edLineupGrid").addEventListener("click", (e) => {
      const slotEl = e.target.closest(".lineup-slot");
      if (!slotEl) return;
      state.editor.activeSlot = Number(slotEl.dataset.slot);
      renderEditorLineup();
    });
    $("#edLineupGrid").addEventListener("dragstart", (e) => {
      const slotEl = e.target.closest(".lineup-slot");
      if (slotEl) state.editor.dragFromSlot = Number(slotEl.dataset.slot);
    });
    $("#edLineupGrid").addEventListener("dragover", (e) => {
      e.preventDefault();
      const slotEl = e.target.closest(".lineup-slot");
      $$("#edLineupGrid .lineup-slot").forEach((el) => el.classList.toggle("drag-over", el === slotEl));
    });
    $("#edLineupGrid").addEventListener("dragleave", () => {
      $$("#edLineupGrid .lineup-slot").forEach((el) => el.classList.remove("drag-over"));
    });
    $("#edLineupGrid").addEventListener("drop", (e) => {
      e.preventDefault();
      $$("#edLineupGrid .lineup-slot").forEach((el) => el.classList.remove("drag-over"));
      const slotEl = e.target.closest(".lineup-slot");
      if (!slotEl || state.editor.dragFromSlot === null) return;
      const to = Number(slotEl.dataset.slot);
      const from = state.editor.dragFromSlot;
      if (from !== to) {
        const tmp = state.editor.lineup[from];
        state.editor.lineup[from] = state.editor.lineup[to];
        state.editor.lineup[to] = tmp;
        state.editor.activeSlot = to;
        renderEditorLineup();
      }
      state.editor.dragFromSlot = null;
    });

    $("#sdSlotForms").addEventListener("click", (e) => {
      const btn = e.target.closest(".form-pill-btn");
      const slot = state.editor.lineup[state.editor.activeSlot];
      if (!btn || !slot) return;
      slot.form_idx = Number(btn.dataset.formIdx);
      renderEditorLineup();
    });
    $("#sdSlotBaseLv").addEventListener("input", (e) => {
      const slot = state.editor.lineup[state.editor.activeSlot];
      if (slot) {
        slot.base_lv = Math.max(1, Number(e.target.value || 1));
        $("#edLineupGrid").innerHTML = renderLineup5x2Html(state.editor.lineup, true, state.editor.activeSlot);
      }
    });
    $("#sdSlotPlusLv").addEventListener("input", (e) => {
      const slot = state.editor.lineup[state.editor.activeSlot];
      if (slot) {
        slot.plus_lv = Math.max(0, Number(e.target.value || 0));
        $("#edLineupGrid").innerHTML = renderLineup5x2Html(state.editor.lineup, true, state.editor.activeSlot);
      }
    });
    $("#sdSlotNote").addEventListener("input", (e) => {
      const slot = state.editor.lineup[state.editor.activeSlot];
      if (slot) slot.note = e.target.value;
    });
    $("#sdSlotTalents").addEventListener("click", (e) => {
      const btn = e.target.closest(".talent-chip");
      const slot = state.editor.lineup[state.editor.activeSlot];
      if (!btn || !slot) return;
      const aid = Number(btn.dataset.abilityId);
      const set = new Set(slot.talents || []);
      if (set.has(aid)) set.delete(aid);
      else set.add(aid);
      slot.talents = Array.from(set);
      renderEditorLineup();
    });
    $("#btnRemoveSlot").addEventListener("click", () => {
      state.editor.lineup[state.editor.activeSlot] = null;
      renderEditorLineup();
    });
    $("#btnSyncSlotToCatbox").addEventListener("click", async () => {
      const slot = state.editor.lineup[state.editor.activeSlot];
      if (!slot) return;
      const acc = state.editor.accountRegion;
      await window.LocalStore.upsertMyUnit(slot.unit_id, acc, {
        owned: true,
        default_form_idx: slot.form_idx,
        base_lv: slot.base_lv,
        plus_lv: slot.plus_lv,
        talents: slot.talents || [],
        note: slot.note || "",
      });
      await refreshUserSnapshot();
      renderPickerUnits();
      toast(`已同步至${acc === "jp" ? "日服" : "台服"}帳號貓棚預設`);
    });

    $("#pickerSearch").addEventListener("input", debounce(renderPickerUnits, 100));
    $("#pickerRarity").addEventListener("change", renderPickerUnits);
    $("#pickerTrait").addEventListener("change", renderPickerUnits);
    $("#pickerOwnedOnly").addEventListener("change", renderPickerUnits);
    $("#pickerUnitGrid").addEventListener("click", (e) => {
      const btn = e.target.closest(".picker-unit-btn");
      if (btn) putUnitIntoActiveSlot(Number(btn.dataset.pickUid));
    });

    $("#edTagInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val && !state.editor.tags.includes(val)) {
          state.editor.tags.push(val);
          renderEditorTags();
        }
        e.target.value = "";
      }
    });
    $("#edQuickTags").addEventListener("click", (e) => {
      const btn = e.target.closest(".qtag");
      if (!btn) return;
      const val = btn.textContent.trim();
      if (!state.editor.tags.includes(val)) {
        state.editor.tags.push(val);
        renderEditorTags();
      }
    });
    $("#edTagsList").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del-tag]");
      if (!btn) return;
      state.editor.tags.splice(Number(btn.dataset.delTag), 1);
      renderEditorTags();
    });

    const dz = $("#edDropzone");
    dz.addEventListener("click", () => $("#edFileInput").click());
    $("#edFileInput").addEventListener("change", async (e) => {
      for (const f of e.target.files) await addImageFile(f);
      e.target.value = "";
    });
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    });
    dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
    dz.addEventListener("drop", async (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
      for (const f of e.dataTransfer.files) {
        if (f.type.startsWith("image/")) await addImageFile(f);
      }
    });
    document.addEventListener("paste", async (e) => {
      if ($("#recordModal").classList.contains("hidden") || state.editor.mode !== "record") return;
      for (const item of e.clipboardData?.items || []) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) await addImageFile(f);
        }
      }
    });
    $("#edScreenshotsList").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-del-shot]");
      if (!btn) return;
      state.editor.screenshots.splice(Number(btn.dataset.delShot), 1);
      renderEditorScreenshots();
    });

    // 紀錄總覽篩選
    $("#recFilterQ").addEventListener("input", debounce(renderAllRecordsView, 150));
    $("#recFilterRegion").addEventListener("change", renderAllRecordsView);
    $("#recFilterCrown").addEventListener("change", renderAllRecordsView);
    $("#recFilterCleared").addEventListener("change", renderAllRecordsView);
    $("#btnRecFilterFeatured").addEventListener("click", () => {
      state.recFeaturedOnly = !state.recFeaturedOnly;
      $("#btnRecFilterFeatured").classList.toggle("btn-featured-active", state.recFeaturedOnly);
      renderAllRecordsView();
    });
    $("#btnResetRecFilters").addEventListener("click", () => {
      $("#recFilterQ").value = "";
      $("#recFilterRegion").value = "all";
      $("#recFilterCrown").value = "";
      $("#recFilterCleared").value = "all";
      state.recFeaturedOnly = false;
      $("#btnRecFilterFeatured").classList.remove("btn-featured-active");
      state.recFilterUnitId = null;
      updateRecUnitFilterChip();
      renderAllRecordsView();
    });
    $("#recUnitFilterChip").addEventListener("click", (e) => {
      if (e.target.id === "btnClearFilterUnit") {
        state.recFilterUnitId = null;
        updateRecUnitFilterChip();
        renderAllRecordsView();
        return;
      }
      if (e.target.id === "btnPickFilterUnit") {
        $("#quickUnitSearch").value = "";
        renderQuickUnitModalGrid();
        $("#quickUnitModal").classList.remove("hidden");
      }
    });

    const renderQuickUnitModalGrid = () => {
      const qLow = $("#quickUnitSearch").value.trim().toLowerCase();
      const list = state.unitsCatalog.filter((u) => unitMatchesQuery(u, qLow)).slice(0, 90);
      $("#quickUnitGrid").innerHTML = list
        .map((u) => {
          const f = u.forms[u.forms.length - 1];
          const nm = getFormDisplayName(f, u.unit_id);
          return `<button type="button" class="picker-unit-btn" data-qu-id="${u.unit_id}">
            ${regionTagHtml(u.only_region, true)}
            ${f.icon_url ? `<img src="${f.icon_url}" loading="lazy" alt="" />` : ""}
            <div class="p-name">${esc(nm)}</div>
          </button>`;
        })
        .join("");
    };
    $("#quickUnitSearch").addEventListener("input", debounce(renderQuickUnitModalGrid, 100));
    $("#quickUnitGrid").addEventListener("click", (e) => {
      const b = e.target.closest("[data-qu-id]");
      if (!b) return;
      state.recFilterUnitId = Number(b.dataset.quId);
      $("#quickUnitModal").classList.add("hidden");
      updateRecUnitFilterChip();
      renderAllRecordsView();
    });
    $("#btnCloseQuickUnitModal").addEventListener("click", () => $("#quickUnitModal").classList.add("hidden"));

    // 貓棚、獨有清單、敵人、模板
    $("#catboxSearch").addEventListener("input", debounce(renderCatboxGrid, 140));
    $("#catboxRarity").addEventListener("change", renderCatboxGrid);
    $("#catboxTrait").addEventListener("change", renderCatboxGrid);
    $("#catboxOwnedOnly").addEventListener("change", renderCatboxGrid);
    $("#catboxGrid").addEventListener("click", (e) => {
      const c = e.target.closest("[data-open-unit]");
      if (c) openUnitDetailModal(Number(c.dataset.openUnit), { editable: true, initialAcc: state.catboxAccount });
    });
    $("#regionUnitsGrid").addEventListener("click", (e) => {
      const card = e.target.closest("[data-open-region-uid]");
      if (card) openUnitDetailModal(Number(card.dataset.openRegionUid), { editable: false });
    });
    $("#btnCloseRegionUnitsModal").addEventListener("click", () => $("#regionUnitsModal").classList.add("hidden"));
    $("#btnCloseUnitModal").addEventListener("click", () => $("#unitModal").classList.add("hidden"));

    $("#enemySearch").addEventListener("input", debounce(renderEnemyCatalogGrid, 140));
    $("#enemyTrait").addEventListener("change", renderEnemyCatalogGrid);
    $("#enemyCatalogGrid").addEventListener("click", (e) => {
      const c = e.target.closest("[data-open-enemy]");
      if (c) openEnemyDetailModal(Number(c.dataset.openEnemy), null);
    });
    $("#btnCloseEnemyModal").addEventListener("click", () => $("#enemyModal").classList.add("hidden"));

    $("#tplPreviewSwitcher").addEventListener("click", (e) => {
      const btn = e.target.closest(".region-btn");
      if (!btn) return;
      state.tplPreviewMode = btn.dataset.tplPreview;
      $$("#tplPreviewSwitcher .region-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderTemplatesView();
    });
    $("#btnNewTemplate").addEventListener("click", () => openRecordEditor({ mode: "template" }));
    $("#templatesList").addEventListener("click", async (e) => {
      const del = e.target.closest(".btn-del-tpl");
      if (!del) return;
      if (!confirm("確定刪除此模板？")) return;
      await window.LocalStore.deleteTemplate(Number(del.dataset.tplId));
      await refreshUserSnapshot();
      renderTemplatesView();
      toast("已刪除模板");
    });

    $("#lightbox").addEventListener("click", () => $("#lightbox").classList.add("hidden"));
  }

  // -------------------- 啟動流程與 PWA 註冊 --------------------
  async function initApp() {
    applyTheme(state.theme);
    updateLangButtons();
    updateCatboxAccountButtons();
    bindEvents();

    // 註冊 PWA Service Worker（略過 sw.js HTTP 快取，有新版時自動切換並重新載入介面）
    if ("serviceWorker" in navigator) {
      const hadController = Boolean(navigator.serviceWorker.controller);
      let swReloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || swReloading) return;
        swReloading = true;
        window.location.reload();
      });
      navigator.serviceWorker
        .register("./sw.js", { updateViaCache: "none" })
        .then((reg) => {
          state.swReg = reg;
          reg.update().catch(() => {});
        })
        .catch(() => {});
    }
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      $("#pwaInstallBtnWrap").classList.remove("hidden");
    });

    try {
      $("#bootLoaderText").textContent = "正在載入台日雙區遊戲資料與本機紀錄...";
      const [boot, units, enemies, maps, stages] = await Promise.all([
        fetchJson("./data/bootstrap.json"),
        fetchJson("./data/units.json"),
        fetchJson("./data/enemies.json"),
        fetchJson("./data/maps.json"),
        fetchJson("./data/stages.json"),
        window.LocalStore.openDb(),
      ]);

      state.bootstrap = boot;
      state.categoriesById = new Map(boot.categories.map((c) => [c.bucket_id, c]));

      for (const u of units) {
        u._search = [
          String(u.unit_id),
          String(u.unit_id).padStart(3, "0"),
          ...u.forms.map((f) => `${f.name_tw || ""} ${f.name_jp || ""}`),
        ]
          .join(" ")
          .toLowerCase();
      }
      state.unitsCatalog = units;
      state.unitsById = new Map(units.map((u) => [u.unit_id, u]));

      for (const e of enemies) {
        e._search = `${e.enemy_id} ${String(e.enemy_id).padStart(3, "0")} ${e.name_tw || ""} ${e.name_jp || ""}`.toLowerCase();
      }
      state.enemiesCatalog = enemies;
      state.enemiesById = new Map(enemies.map((e) => [e.enemy_id, e]));

      state.stagesAll = stages;
      state.stagesByKey = new Map();
      state.stagesByMap = new Map();
      for (const s of stages) {
        s._search = `${s.stage_key} ${s.name_tw || ""} ${s.name_jp || ""}`.toLowerCase();
        state.stagesByKey.set(s.stage_key, s);
        let arr = state.stagesByMap.get(s.map_id);
        if (!arr) {
          arr = [];
          state.stagesByMap.set(s.map_id, arr);
        }
        arr.push(s);
      }

      state.mapsAll = maps;
      state.mapsById = new Map();
      for (const m of maps) {
        const mStages = state.stagesByMap.get(m.map_id) || [];
        m._mapNameSearch = `${m.name_tw || ""} ${m.name_jp || ""}`.toLowerCase();
        m._search = `${m._mapNameSearch} ${mStages.map((s) => `${s.name_tw || ""} ${s.name_jp || ""}`).join(" ")}`.toLowerCase();
        state.mapsById.set(m.map_id, m);
      }

      await refreshUserSnapshot();

      const verParts = boot.available_regions
        .filter((r) => r.available)
        .map((r) => `${r.region.toUpperCase()} v${r.app_version}`);
      $("#appVersionBadge").textContent = verParts.join(" + ") || "無資料";

      renderCannonAndItemControls();
      updateGlobalStatsUi();
      renderCategories();
      if (boot.categories.length > 0) {
        selectCategory(boot.categories[0].bucket_id, false);
      }
      $("#bootLoader").classList.add("hidden");
      // 預設開啟後立即於背景自動下載全部出怪表與全部圖示（不阻擋操作，完成後彈出提示）
      setTimeout(() => {
        runFullOfflineSync({ manual: false }).catch(() => {});
      }, 600);
    } catch (err) {
      $("#bootLoaderText").textContent = `載入失敗：${err.message}（請透過 HTTP 伺服器或 GitHub Pages 開啟）`;
    }
  }

  initApp();
})();
