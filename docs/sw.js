/* 貓咪大戰爭 通關紀錄本 PWA Service Worker（介面與離線圖示包分層快取＋即時更新） */
const SHELL_CACHE = "bc-logbook-shell-v5";
// 與既有離線資料包共用相同快取名稱：日後更新介面文字／樣式時，完全不會清除已下載的 25MB 圖示與出怪包
const ASSETS_CACHE = "bc-logbook-pwa-v2";
const KEEP_CACHES = new Set([SHELL_CACHE, ASSETS_CACHE]);

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/styles.css?v=20261124c",
  "./assets/storage.js?v=20261124c",
  "./assets/app.js?v=20261124c",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

const CORE_DATA = [
  "./data/bootstrap.json",
  "./data/units.json",
  "./data/enemies.json",
  "./data/maps.json",
  "./data/stages.json",
  "./data/enemy_stages.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await Promise.all(
        APP_SHELL.map(async (u) => {
          try {
            const resp = await fetch(u, { cache: "no-cache", credentials: "same-origin" });
            if (resp.ok) await shell.put(u, resp);
          } catch (_) {}
        })
      );
      const assets = await caches.open(ASSETS_CACHE);
      await Promise.all(
        CORE_DATA.map(async (u) => {
          try {
            const existing = await assets.match(u, { ignoreSearch: true });
            if (!existing) {
              const resp = await fetch(u, { credentials: "same-origin" });
              if (resp.ok) await assets.put(u, resp);
            }
          } catch (_) {}
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP_CACHES.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 1. 圖示檔：Cache-First（優先讀本機離線包，沒快取才抓網路並寫入 ASSETS_CACHE）
  if (url.pathname.includes("/icons/")) {
    event.respondWith(
      caches.open(ASSETS_CACHE).then(async (cache) => {
        const cached = await cache.match(req.url, { ignoreSearch: true });
        if (cached) return cached;
        const resp = await fetch(req);
        if (resp.ok) {
          event.waitUntil(cache.put(req.url, resp.clone()).catch(() => {}));
        }
        return resp;
      })
    );
    return;
  }

  // 2. 遊戲資料庫 JSON（含 stage_enemies/*.json）：強制向伺服器驗證 ETag（略過 10 分鐘 HTTP 快取），無網自動讀 ASSETS_CACHE
  if (url.pathname.includes("/data/")) {
    event.respondWith(
      fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            event.waitUntil(caches.open(ASSETS_CACHE).then((c) => c.put(req.url, copy)).catch(() => {}));
          }
          return resp;
        })
        .catch(() => caches.open(ASSETS_CACHE).then((c) => c.match(req.url, { ignoreSearch: true })))
    );
    return;
  }

  // 3. 網頁殼層（HTML / CSS / JS / manifest）：強制向伺服器驗證更新（略過 GitHub Pages 10 分鐘瀏覽器快取），離線讀 SHELL_CACHE
  event.respondWith(
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(req.url, copy)).catch(() => {}));
        }
        return resp;
      })
      .catch(async () => {
        const shell = await caches.open(SHELL_CACHE);
        const hit = await shell.match(req.url, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === "navigate") {
          return shell.match("./index.html", { ignoreSearch: true });
        }
        return caches.match(req.url, { ignoreSearch: true });
      })
  );
});
