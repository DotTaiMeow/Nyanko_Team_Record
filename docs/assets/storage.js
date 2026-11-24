/* 貓咪大戰爭 通關紀錄本 PWA：純本機 IndexedDB 儲存層（免後端伺服器 + 備份匯出/還原） */
(() => {
  "use strict";

  const DB_NAME = "BattleCatsLogbookPWA_v1";
  const DB_VERSION = 1;
  const STORES = [
    "clear_records",
    "stage_progress",
    "favorite_stages",
    "stage_notes",
    "my_units",
    "lineup_templates",
  ];

  let dbPromise = null;

  function nowIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("clear_records")) {
          const s = db.createObjectStore("clear_records", { keyPath: "id", autoIncrement: true });
          s.createIndex("stage_key", "stage_key", { unique: false });
        }
        if (!db.objectStoreNames.contains("stage_progress")) {
          db.createObjectStore("stage_progress", { keyPath: "stage_key" });
        }
        if (!db.objectStoreNames.contains("favorite_stages")) {
          db.createObjectStore("favorite_stages", { keyPath: "stage_key" });
        }
        if (!db.objectStoreNames.contains("stage_notes")) {
          db.createObjectStore("stage_notes", { keyPath: "stage_key" });
        }
        if (!db.objectStoreNames.contains("my_units")) {
          db.createObjectStore("my_units", { keyPath: "key" }); // `${account_region}:${unit_id}`
        }
        if (!db.objectStoreNames.contains("lineup_templates")) {
          db.createObjectStore("lineup_templates", { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB 開啟失敗"));
    });
    return dbPromise;
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = fn(store);
      } catch (err) {
        reject(err);
        return;
      }
      if (result && typeof result.onsuccess !== "undefined") {
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      } else {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      }
    });
  }

  async function getAll(storeName) {
    return withStore(storeName, "readonly", (s) => s.getAll());
  }

  async function getOne(storeName, key) {
    return withStore(storeName, "readonly", (s) => s.get(key));
  }

  async function putOne(storeName, val) {
    return withStore(storeName, "readwrite", (s) => s.put(val));
  }

  async function addOne(storeName, val) {
    return withStore(storeName, "readwrite", (s) => s.add(val));
  }

  async function delOne(storeName, key) {
    return withStore(storeName, "readwrite", (s) => s.delete(key));
  }

  function clampCrowns(arr, maxCrown) {
    const maxC = Math.max(1, Math.min(4, Number(maxCrown || 4)));
    const set = new Set();
    for (const c of arr || []) {
      const n = Number(c);
      if (Number.isInteger(n) && n >= 1 && n <= maxC) set.add(n);
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  // 壓縮上傳截圖（避免手機原圖太大佔滿瀏覽器儲存空間）
  async function compressImageFileToDataUrl(file, maxSide = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > maxSide || h > maxSide) {
            if (w >= h) {
              h = Math.round((h * maxSide) / w);
              w = maxSide;
            } else {
              w = Math.round((w * maxSide) / h);
              h = maxSide;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          try {
            const webp = canvas.toDataURL("image/webp", quality);
            resolve(webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality));
          } catch (_) {
            resolve(canvas.toDataURL("image/jpeg", quality));
          }
        };
        img.onerror = () => resolve(reader.result);
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const LocalStore = {
    openDb,
    compressImageFileToDataUrl,

    async loadAllSnapshot() {
      const [records, progressRows, favRows, noteRows, myUnitRows, templates] = await Promise.all([
        getAll("clear_records"),
        getAll("stage_progress"),
        getAll("favorite_stages"),
        getAll("stage_notes"),
        getAll("my_units"),
        getAll("lineup_templates"),
      ]);
      records.sort((a, b) => Number(Boolean(b.is_featured)) - Number(Boolean(a.is_featured)) || String(b.updated_at).localeCompare(String(a.updated_at)));
      templates.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      return { records, progressRows, favRows, noteRows, myUnitRows, templates };
    },

    async setStageProgress(stageKey, crowns, maxCrown) {
      const cleaned = clampCrowns(crowns, maxCrown);
      const row = { stage_key: stageKey, cleared_crowns: cleaned, updated_at: nowIso() };
      await putOne("stage_progress", row);
      return cleaned;
    },

    async ensureCrownCleared(stageKey, crown, maxCrown) {
      const cur = await getOne("stage_progress", stageKey);
      const set = new Set(clampCrowns(cur?.cleared_crowns || [], maxCrown));
      set.add(Math.max(1, Math.min(maxCrown || 4, Number(crown || 1))));
      return this.setStageProgress(stageKey, Array.from(set), maxCrown);
    },

    async setFavoriteStage(stageKey, isFav) {
      if (isFav) {
        await putOne("favorite_stages", { stage_key: stageKey, created_at: nowIso() });
      } else {
        await delOne("favorite_stages", stageKey);
      }
      return Boolean(isFav);
    },

    async saveStageNote(stageKey, stageTags, stageNote) {
      const tags = (stageTags || []).map((t) => String(t).trim()).filter(Boolean);
      const note = String(stageNote || "");
      const row = { stage_key: stageKey, stage_tags: tags, stage_note: note, updated_at: nowIso() };
      await putOne("stage_notes", row);
      return row;
    },

    async upsertMyUnit(unitId, accountRegion, payload) {
      const acc = accountRegion === "jp" ? "jp" : "tw";
      const row = {
        key: `${acc}:${unitId}`,
        unit_id: Number(unitId),
        account_region: acc,
        owned: Boolean(payload.owned ?? true),
        default_form_idx: Number(payload.default_form_idx ?? 0),
        base_lv: Math.max(1, Number(payload.base_lv ?? 50)),
        plus_lv: Math.max(0, Number(payload.plus_lv ?? 0)),
        talents: Array.isArray(payload.talents) ? payload.talents : [],
        note: String(payload.note || ""),
        updated_at: nowIso(),
      };
      await putOne("my_units", row);
      return row;
    },

    async createRecord(payload, maxCrown) {
      const now = nowIso();
      const crown = Math.max(1, Math.min(maxCrown || 4, Number(payload.crown || 1)));
      const rec = {
        stage_key: String(payload.stage_key),
        region: payload.region === "jp" ? "jp" : "tw",
        crown,
        is_cleared: Boolean(payload.is_cleared ?? true),
        is_featured: Boolean(payload.is_featured ?? false),
        title: String(payload.title || "").trim(),
        cannon_id: Number(payload.cannon_id ?? 0),
        items: Array.isArray(payload.items) ? payload.items : [],
        lineup: Array.isArray(payload.lineup) ? payload.lineup : [],
        tags: (payload.tags || []).map((t) => String(t).trim()).filter(Boolean),
        notes: String(payload.notes || ""),
        video_url: String(payload.video_url || "").trim(),
        screenshots: Array.isArray(payload.screenshots) ? payload.screenshots : [],
        cleared_at: String(payload.cleared_at || "").trim() || todayStr(),
        created_at: now,
        updated_at: now,
      };
      const id = await addOne("clear_records", rec);
      rec.id = id;
      if (rec.is_cleared) {
        await this.ensureCrownCleared(rec.stage_key, crown, maxCrown);
      }
      return rec;
    },

    async updateRecord(recId, payload, maxCrown) {
      const old = await getOne("clear_records", Number(recId));
      if (!old) return null;
      const crown = Math.max(1, Math.min(maxCrown || 4, Number(payload.crown ?? old.crown)));
      const updated = {
        ...old,
        region: (payload.region ?? old.region) === "jp" ? "jp" : "tw",
        crown,
        is_cleared: Boolean(payload.is_cleared ?? old.is_cleared),
        is_featured: Boolean(payload.is_featured ?? old.is_featured),
        title: String(payload.title ?? old.title).trim(),
        cannon_id: Number(payload.cannon_id ?? old.cannon_id),
        items: Array.isArray(payload.items) ? payload.items : old.items,
        lineup: Array.isArray(payload.lineup) ? payload.lineup : old.lineup,
        tags: Array.isArray(payload.tags) ? payload.tags.map((t) => String(t).trim()).filter(Boolean) : old.tags,
        notes: String(payload.notes ?? old.notes),
        video_url: String(payload.video_url ?? old.video_url).trim(),
        screenshots: Array.isArray(payload.screenshots) ? payload.screenshots : old.screenshots,
        cleared_at: String(payload.cleared_at ?? old.cleared_at).trim() || todayStr(),
        updated_at: nowIso(),
      };
      await putOne("clear_records", updated);
      if (updated.is_cleared) {
        await this.ensureCrownCleared(updated.stage_key, crown, maxCrown);
      }
      return updated;
    },

    async setRecordFeatured(recId, isFeatured) {
      const old = await getOne("clear_records", Number(recId));
      if (!old) return null;
      const updated = { ...old, is_featured: Boolean(isFeatured), updated_at: nowIso() };
      await putOne("clear_records", updated);
      return updated;
    },

    async deleteRecord(recId) {
      await delOne("clear_records", Number(recId));
      return true;
    },

    async createTemplate(payload) {
      const now = nowIso();
      const tpl = {
        name: String(payload.name || "").trim() || "未命名模板",
        cannon_id: Number(payload.cannon_id ?? 0),
        items: Array.isArray(payload.items) ? payload.items : [],
        lineup: Array.isArray(payload.lineup) ? payload.lineup : [],
        note: String(payload.note || ""),
        created_at: now,
        updated_at: now,
      };
      const id = await addOne("lineup_templates", tpl);
      tpl.id = id;
      return tpl;
    },

    async deleteTemplate(tid) {
      await delOne("lineup_templates", Number(tid));
      return true;
    },

    async exportBackupJson() {
      const snap = await this.loadAllSnapshot();
      return {
        format: "battle_cats_logbook_pwa_backup",
        version: 1,
        exported_at: nowIso(),
        data: snap,
      };
    },

    async importBackupJson(obj, mode = "replace") {
      if (!obj || obj.format !== "battle_cats_logbook_pwa_backup" || !obj.data) {
        throw new Error("備份檔格式不正確，請選擇本工具匯出的 JSON 檔案");
      }
      const d = obj.data;
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES, "readwrite");
        const mapPairs = [
          ["clear_records", d.records || []],
          ["stage_progress", d.progressRows || []],
          ["favorite_stages", d.favRows || []],
          ["stage_notes", d.noteRows || []],
          ["my_units", d.myUnitRows || []],
          ["lineup_templates", d.templates || []],
        ];
        for (const [storeName, rows] of mapPairs) {
          const st = tx.objectStore(storeName);
          if (mode === "replace") st.clear();
          for (const r of rows) {
            if (storeName === "clear_records" || storeName === "lineup_templates") {
              const copy = { ...r };
              if (mode !== "replace") delete copy.id;
              st.put(copy);
            } else {
              st.put(r);
            }
          }
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error("匯入還原失敗"));
      });
    },

    async clearAllData() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES, "readwrite");
        for (const name of STORES) tx.objectStore(name).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error("清空資料失敗"));
      });
    },
  };

  window.LocalStore = LocalStore;
})();
