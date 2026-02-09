/**
 * Portföy Terminali Pro Max - app.js (Stable v2.1)
 * Hata düzeltmeleri: Loader takılması, async init, DOM kontrolü
 */

// ==================== KONFİGÜRASYON ====================
const CONFIG = {
  CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv",
  MAX_RETRIES: 3,
  RETRY_DELAY: 1500,
  VISIBLE_ITEMS: 50,
  DEBOUNCE_DELAY: 200
};

// ==================== GLOBAL STATE ====================
let state = {
  data: [],
  filtered: [],
  active: "ALL",
  cache: new Map(),
  alerts: {},
  sortKey: "default",
  filterKz: "all",
  autoRefresh: { enabled: false, ms: 60000, timer: null },
  retryCount: 0,
  visibleCount: CONFIG.VISIBLE_ITEMS,
  searchQuery: "",
  isLoading: false
};

// ==================== YARDIMCI FONKSİYONLAR ====================
const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => Array.from(context.querySelectorAll(selector));

function cleanStr(str) {
  return str ? String(str).trim().replace(/\s+/g, " ") : "";
}

function toNumber(val) {
  if (!val) return 0;
  const cleaned = String(val)
    .replace(/[^\d,\.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return parseFloat(cleaned) || 0;
}

function formatTRY(num) {
  if (isNaN(num)) return "0 ₺";
  return Math.round(num).toLocaleString("tr-TR") + " ₺";
}

function formatPercent(num) {
  if (isNaN(num)) return "0%";
  const sign = num >= 0 ? "+" : "";
  return sign + num.toFixed(2) + "%";
}

function sum(arr, key) {
  return arr.reduce((acc, item) => acc + (item[key] || 0), 0);
}

// LocalStorage
const storage = {
  get(key, defaultVal = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultVal;
    } catch (e) {
      console.warn("Storage read error:", e);
      return defaultVal;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn("Storage write error:", e);
      return false;
    }
  }
};

// Debounce
function debounce(fn, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      fn(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ==================== TOAST SİSTEMİ ====================
const Toast = {
  element: null,
  timeout: null,
  
  init() {
    this.element = $("#toast");
  },
  
  show(message, type = "info", duration = 3000) {
    if (!this.element) return;
    
    // Reset
    if (this.timeout) clearTimeout(this.timeout);
    
    // Set content and type
    this.element.textContent = message;
    this.element.className = `toast ${type}`;
    this.element.hidden = false;
    
    // Auto hide
    this.timeout = setTimeout(() => {
      this.element.hidden = true;
    }, duration);
  },
  
  success(msg) { this.show(msg, "success"); },
  error(msg) { this.show(msg, "error", 5000); },
  warning(msg) { this.show(msg, "warning"); }
};

// ==================== LOADER YÖNETİMİ ====================
const Loader = {
  element: null,
  textElement: null,
  progressElement: null,
  
  init() {
    this.element = $("#loader");
    this.textElement = $("#loader-text");
    this.progressElement = $("#loader-progress");
  },
  
  setProgress(percent, text) {
    if (this.textElement) this.textElement.textContent = text || "Yükleniyor...";
    if (this.progressElement) this.progressElement.textContent = percent + "%";
  },
  
  hide() {
    if (this.element) {
      this.element.setAttribute("hidden", "");
      this.element.style.display = "none";
    }
    // Show app
    const app = $("#app");
    if (app) app.style.display = "block";
  },
  
  showError(message) {
    if (this.textElement) this.textElement.textContent = message;
    if (this.progressElement) this.progressElement.textContent = "Hata";
    this.element.style.background = "rgba(139, 0, 0, 0.9)";
  }
};

// ==================== VERİ YÜKLEME ====================
async function loadData() {
  if (state.isLoading) return false;
  state.isLoading = true;
  
  Loader.setProgress(10, "Bağlanıyor...");
  
  try {
    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    Loader.setProgress(30, "Veri çekiliyor...");
    
    const response = await fetch(`${CONFIG.CSV_URL}&t=${Date.now()}`, {
      signal: controller.signal,
      headers: { "Accept": "text/csv" }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP Hatası: ${response.status}`);
    }
    
    Loader.setProgress(60, "İşleniyor...");
    
    const text = await response.text();
    
    if (!text || text.length < 100) {
      throw new Error("Boş veri");
    }
    
    // Parse CSV
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => cleanStr(h).toLowerCase()
    });
    
    Loader.setProgress(80, "Ayrıştırılıyor...");
    
    if (!parsed.data || parsed.data.length === 0) {
      throw new Error("Veri bulunamadı");
    }
    
    // Process data
    state.data = parsed.data
      .map(row => {
        const obj = {};
        for (let key in row) {
          const cleanKey = cleanStr(key);
          if (cleanKey === "urun" || cleanKey === "tur") {
            obj[cleanKey] = cleanStr(row[key]);
          } else {
            obj[cleanKey] = toNumber(row[key]);
          }
        }
        return obj;
      })
      .filter(item => item.urun && item.toplamYatirim > 0);
    
    if (state.data.length === 0) {
      throw new Error("Geçerli veri yok");
    }
    
    Loader.setProgress(100, "Tamamlandı");
    state.retryCount = 0;
    state.isLoading = false;
    
    // Kısa gecikme ile loader'ı gizle (smooth transition)
    setTimeout(() => Loader.hide(), 300);
    
    return true;
    
  } catch (error) {
    console.error("Veri yükleme hatası:", error);
    state.isLoading = false;
    
    state.retryCount++;
    
    if (state.retryCount < CONFIG.MAX_RETRIES) {
      Loader.setProgress(
        Math.round((state.retryCount / CONFIG.MAX_RETRIES) * 100),
        `Yeniden deneniyor... (${state.retryCount}/${CONFIG.MAX_RETRIES})`
      );
      
      await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY));
      return loadData();
    } else {
      Loader.showError(`Veri yüklenemedi: ${error.message}`);
      Toast.error("Veri kaynağına ulaşılamıyor. Sayfayı yenileyin.");
      return false;
    }
  }
}

// ==================== RENDER FONKSİYONLARI ====================
function renderSummary() {
  const container = $("#summary");
  if (!container) return;
  
  const totalCost = sum(state.filtered, "toplamyatirim");
  const currentValue = sum(state.filtered, "gunceldeger");
  const profit = currentValue - totalCost;
  const percent = totalCost ? ((profit / totalCost) * 100) : 0;
  
  container.innerHTML = `
    <div class="card">
      <div class="small">Toplam Maliyet</div>
      <div class="big">${formatTRY(totalCost)}</div>
    </div>
    <div class="card">
      <div class="small">Güncel Değer</div>
      <div class="big">${formatTRY(currentValue)}</div>
    </div>
    <div class="card ${profit >= 0 ? 'pos' : 'neg'}">
      <div class="small">K/Z</div>
      <div class="big">${formatPercent(percent)}</div>
      <div class="small" style="margin-top:4px">${formatTRY(profit)}</div>
    </div>
    <div class="card">
      <div class="small">Ürün</div>
      <div class="big">${state.filtered.length}</div>
    </div>
  `;
}

function renderTypes() {
  const container = $("#types");
  if (!container) return;
  
  const types = [...new Set(state.data.map(x => x.tur))].sort();
  
  let html = `
    <div class="card type-card ${state.active === 'ALL' ? 'active' : ''}" 
         data-type="ALL" role="button" tabindex="0">
      <div class="small">TÜM PORTFÖY</div>
      <div class="big">${state.data.length} Ürün</div>
    </div>
  `;
  
  types.forEach(type => {
    const items = state.data.filter(x => x.tur === type);
    const typeValue = sum(items, "gunceldeger");
    const typeCost = sum(items, "toplamyatirim");
    const profit = typeValue - typeCost;
    
    html += `
      <div class="card type-card ${state.active === type ? 'active' : ''}" 
           data-type="${type}" role="button" tabindex="0">
        <div class="small">${type.toUpperCase()}</div>
        <div class="big ${profit >= 0 ? 'pos' : 'neg'}">${formatTRY(profit)}</div>
        <div style="font-size:10px;opacity:0.7;margin-top:4px">${items.length} ürün</div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Event listeners
  $$(".type-card", container).forEach(card => {
    const clickHandler = () => {
      state.active = card.dataset.type;
      state.visibleCount = CONFIG.VISIBLE_ITEMS;
      applyFilters();
    };
    
    card.addEventListener("click", clickHandler);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        clickHandler();
      }
    });
  });
}

function renderPeriods() {
  const container = $("#periods");
  if (!container) return;
  
  const periods = [
    ["Günlük", "gunluk"],
    ["Haftalık", "haftalik"],
    ["Aylık", "aylik"],
    ["3 Ay", "ucaylik"],
    ["6 Ay", "altiaylik"],
    ["1 Yıl", "biryillik"]
  ];
  
  const currentValue = sum(state.filtered, "gunceldeger");
  
  let html = "";
  periods.forEach(([label, key]) => {
    const change = sum(state.filtered, key);
    const previous = currentValue - change;
    const percent = previous ? ((change / previous) * 100) : 0;
    
    html += `
      <div class="card ${change >= 0 ? 'pos' : 'neg'}">
        <div class="small">${label}</div>
        <div class="big">${formatTRY(change)}</div>
        <div style="font-size:11px;opacity:0.8;margin-top:4px">${formatPercent(percent)}</div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

function renderDetails() {
  const container = $("#detail-list");
  if (!container) return;
  
  const totalValue = sum(state.data, "gunceldeger");
  const toShow = state.filtered.slice(0, state.visibleCount);
  
  // Update title
  const title = $("#detail-title");
  if (title) {
    title.textContent = state.active === "ALL" 
      ? `📦 TÜM ÜRÜNLER (${state.filtered.length})`
      : `📦 ${state.active.toUpperCase()} (${state.filtered.length})`;
  }
  
  let html = "";
  toShow.forEach((item, index) => {
    const profit = item.gunceldeger - item.toplamyatirim;
    const weight = totalValue ? ((item.gunceldeger / totalValue) * 100).toFixed(1) : 0;
    const hasAlert = state.alerts[item.urun];
    
    html += `
      <div class="detail-item" data-urun="${item.urun}" data-index="${index}" 
           role="button" tabindex="0">
        <div class="detail-info">
          <div>
            ${item.urun}
            <span class="weight-badge">%${weight}</span>
            ${hasAlert ? '<span style="margin-left:4px">🔔</span>' : ''}
          </div>
          <div style="font-size:11px;opacity:0.6">
            Maliyet: ${formatTRY(item.toplamyatirim)} · ${item.tur}
          </div>
        </div>
        <div class="detail-values">
          <div class="detail-val">${formatTRY(item.gunceldeger)}</div>
          <div class="detail-perc ${profit >= 0 ? 'pos' : 'neg'}">
            ${formatTRY(profit)}
          </div>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Pagination
  const pagination = $("#pagination");
  if (pagination) {
    pagination.hidden = state.visibleCount >= state.filtered.length;
  }
  
  // Click handlers
  $$(".detail-item", container).forEach(item => {
    const handler = () => openModal(item.dataset.urun);
    item.addEventListener("click", handler);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    });
  });
}

function renderTicker() {
  const container = $("#ticker-content");
  if (!container) return;
  
  const items = state.data.slice(0, 15);
  let html = "";
  
  items.forEach(item => {
    const daily = item.gunluk || 0;
    const prev = item.gunceldeger - daily;
    const percent = prev ? ((daily / prev) * 100) : 0;
    const isPositive = daily >= 0;
    
    html += `
      <div class="ticker-item" style="color: ${isPositive ? 'var(--pos)' : 'var(--neg)'}">
        <span style="opacity:0.8">${item.urun}</span>
        <span style="margin-left:6px">${formatPercent(percent)}</span>
      </div>
    `;
  });
  
  // Duplicate for infinite scroll effect
  container.innerHTML = html + html;
}

// ==================== FİLTRELEME VE SIRALAMA ====================
function applyFilters() {
  const cacheKey = `${state.active}_${state.sortKey}_${state.filterKz}_${state.searchQuery}`;
  
  if (state.cache.has(cacheKey)) {
    state.filtered = state.cache.get(cacheKey);
  } else {
    let result = state.active === "ALL" 
      ? [...state.data]
      : state.data.filter(x => x.tur === state.active);
    
    // Search filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      result = result.filter(x => 
        x.urun.toLowerCase().includes(q) || 
        x.tur.toLowerCase().includes(q)
      );
    }
    
    // K/Z filter
    if (state.filterKz !== "all") {
      result = result.filter(x => {
        const profit = x.gunceldeger - x.toplamyatirim;
        return state.filterKz === "pos" ? profit >= 0 : profit < 0;
      });
    }
    
    // Sort
    const sorters = {
      kzDesc: (a, b) => (b.gunceldeger - b.toplamyatirim) - (a.gunceldeger - a.toplamyatirim),
      kzAsc: (a, b) => (a.gunceldeger - a.toplamyatirim) - (b.gunceldeger - b.toplamyatirim),
      maliyetDesc: (a, b) => b.toplamyatirim - a.toplamyatirim,
      guncelDesc: (a, b) => b.gunceldeger - a.gunceldeger,
      nameAZ: (a, b) => a.urun.localeCompare(b.urun, "tr"),
      nameZA: (a, b) => b.urun.localeCompare(a.urun, "tr")
    };
    
    if (sorters[state.sortKey]) {
      result.sort(sorters[state.sortKey]);
    }
    
    state.filtered = result;
    state.cache.set(cacheKey, result);
  }
  
  state.visibleCount = CONFIG.VISIBLE_ITEMS;
  renderAll();
}

function renderAll() {
  renderSummary();
  renderTypes();
  renderPeriods();
  renderDetails();
  renderTicker();
  checkAlerts();
}

// ==================== MODAL ====================
function openModal(urun) {
  const item = state.data.find(x => x.urun === urun);
  if (!item) return;
  
  // Create modal if not exists
  let modal = $("#product-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "product-modal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">Ürün Detayı</div>
          <button class="modal-close" aria-label="Kapat">×</button>
        </div>
        <div class="modal-body"></div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop") || 
          e.target.classList.contains("modal-close")) {
        closeModal();
      }
    });
  }
  
  const body = modal.querySelector(".modal-body");
  const totalValue = sum(state.data, "gunceldeger");
  const profit = item.gunceldeger - item.toplamyatirim;
  const weight = totalValue ? ((item.gunceldeger / totalValue) * 100).toFixed(1) : 0;
  const alerts = state.alerts[item.urun] || {};
  
  body.innerHTML = `
    <div class="modal-grid">
      <div class="stat">
        <div class="small">Ürün</div>
        <div class="big" style="font-size:18px">${item.urun}</div>
        <div style="margin-top:8px;font-size:12px;opacity:0.8">Tür: ${item.tur}</div>
        <div style="font-size:12px;color:var(--accent)">Ağırlık: %${weight}</div>
      </div>
      <div class="stat">
        <div class="small">Finansal</div>
        <div class="big">Güncel: ${formatTRY(item.gunceldeger)}</div>
        <div class="big">Maliyet: ${formatTRY(item.toplamyatirim)}</div>
        <div class="big ${profit >= 0 ? 'pos' : 'neg'}">K/Z: ${formatTRY(profit)}</div>
      </div>
    </div>
    
    <div class="stat" style="margin-top:12px">
      <div class="small">🔔 Uyarı Ayarları</div>
      <div class="alert-form" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px">
        <div>
          <label style="font-size:11px;opacity:0.7">Güncel Değer ≥</label>
          <input type="number" id="alert-guncel" placeholder="100000" 
                 value="${alerts.guncel || ''}" style="width:100%;padding:8px;margin-top:4px;border-radius:6px;border:1px solid var(--line);background:rgba(0,0,0,0.3);color:white">
        </div>
        <div>
          <label style="font-size:11px;opacity:0.7">K/Z ≥</label>
          <input type="number" id="alert-kz" placeholder="5000" 
                 value="${alerts.kz || ''}" style="width:100%;padding:8px;margin-top:4px;border-radius:6px;border:1px solid var(--line);background:rgba(0,0,0,0.3);color:white">
        </div>
        <div>
          <label style="font-size:11px;opacity:0.7">Günlük % ≥</label>
          <input type="number" id="alert-daily" placeholder="2.5" step="0.1"
                 value="${alerts.daily || ''}" style="width:100%;padding:8px;margin-top:4px;border-radius:6px;border:1px solid var(--line);background:rgba(0,0,0,0.3);color:white">
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn" id="alert-delete" style="background:rgba(239,68,68,0.2);color:var(--neg)">Sil</button>
        <button class="btn primary" id="alert-save">Kaydet</button>
      </div>
    </div>
  `;
  
  // Event listeners
  body.querySelector("#alert-save").addEventListener("click", () => {
    const g = parseFloat($("#alert-guncel", body)?.value) || null;
    const k = parseFloat($("#alert-kz", body)?.value) || null;
    const d = parseFloat($("#alert-daily", body)?.value) || null;
    
    state.alerts[item.urun] = {
      guncel: g,
      kz: k,
      daily: d
    };
    
    storage.set("portfolio_alerts", state.alerts);
    Toast.success("Uyarı kaydedildi");
    renderDetails();
  });
  
  body.querySelector("#alert-delete").addEventListener("click", () => {
    delete state.alerts[item.urun];
    storage.set("portfolio_alerts", state.alerts);
    Toast.show("Uyarı silindi");
    renderDetails();
  });
  
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  const modal = $("#product-modal");
  if (modal) {
    modal.classList.remove("active");
    document.body.style.overflow = "";
  }
}

// ==================== UYARI KONTROLÜ ====================
function checkAlerts() {
  $$(".alert-pulse").forEach(el => el.classList.remove("alert-pulse"));
  
  let triggered = 0;
  
  state.data.forEach(item => {
    const alert = state.alerts[item.urun];
    if (!alert) return;
    
    const profit = item.gunceldeger - item.toplamyatirim;
    const dailyChange = item.gunluk || 0;
    const prevValue = item.gunceldeger - dailyChange;
    const dailyPercent = prevValue ? ((dailyChange / prevValue) * 100) : 0;
    
    let hit = false;
    if (alert.guncel && item.gunceldeger >= alert.guncel) hit = true;
    if (alert.kz && profit >= alert.kz) hit = true;
    if (alert.daily && dailyPercent >= alert.daily) hit = true;
    
    if (hit) {
      triggered++;
      const el = $(`.detail-item[data-urun="${CSS.escape(item.urun)}"]`);
      if (el) el.classList.add("alert-pulse");
    }
  });
  
  if (triggered > 0) {
    Toast.warning(`${triggered} ürün için uyarı tetiklendi!`);
  }
}

// ==================== UI KURULUMU ====================
function initUI() {
  // Load saved data
  state.alerts = storage.get("portfolio_alerts", {});
  const savedRefresh = storage.get("portfolio_autorefresh", { enabled: false, ms: 60000 });
  state.autoRefresh = { ...savedRefresh, timer: null };
  
  // Create toolbar
  createToolbar();
  
  // Setup search
  const searchInput = $("#search");
  if (searchInput) {
    searchInput.disabled = false;
    searchInput.addEventListener("input", debounce((e) => {
      state.searchQuery = e.target.value;
      const clearBtn = $("#clear-search");
      if (clearBtn) clearBtn.hidden = !state.searchQuery;
      applyFilters();
    }, CONFIG.DEBOUNCE_DELAY));
  }
  
  // Clear search
  $("#clear-search")?.addEventListener("click", () => {
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    state.searchQuery = "";
    $("#clear-search").hidden = true;
    applyFilters();
  });
  
  // Load more
  $("#load-more")?.addEventListener("click", () => {
    state.visibleCount += CONFIG.VISIBLE_ITEMS;
    renderDetails();
  });
  
  // Export
  $("#export-csv")?.addEventListener("click", exportCSV);
  $("#export-csv").disabled = false;
  
  // Refresh
  $("#refresh-data")?.addEventListener("click", async () => {
    Toast.show("Yenileniyor...");
    state.cache.clear();
    const success = await loadData();
    if (success) {
      applyFilters();
      Toast.success("Güncellendi");
    }
  });
  $("#refresh-data").disabled = false;
  
  // Auto refresh on visibility change
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAutoRefresh();
    } else if (state.autoRefresh.enabled) {
      startAutoRefresh();
    }
  });
}

function createToolbar() {
  const content = $(".content-section");
  if (!content || $(".toolbar")) return;
  
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  toolbar.innerHTML = `
    <div class="card" style="padding:12px">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div>
          <label style="font-size:10px;opacity:0.7;text-transform:uppercase">Sıralama</label>
          <select id="sort-select" style="margin-left:6px;padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:rgba(0,0,0,0.3);color:white">
            <option value="default">Varsayılan</option>
            <option value="kzDesc">K/Z (Yüksek)</option>
            <option value="kzAsc">K/Z (Düşük)</option>
            <option value="maliyetDesc">Maliyet</option>
            <option value="guncelDesc">Güncel Değer</option>
            <option value="nameAZ">A-Z</option>
            <option value="nameZA">Z-A</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <label style="font-size:10px;opacity:0.7">Filtre:</label>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
            <input type="radio" name="kzfilter" value="all" checked> Tümü
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
            <input type="radio" name="kzfilter" value="pos"> K/Z +
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
            <input type="radio" name="kzfilter" value="neg"> K/Z -
          </label>
        </div>
      </div>
    </div>
    <div class="card" style="padding:12px">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div>
          <label style="font-size:10px;opacity:0.7;text-transform:uppercase">Oto-Yenile</label>
          <label style="display:flex;align-items:center;gap:6px;margin-left:6px;cursor:pointer">
            <input type="checkbox" id="autoref" ${state.autoRefresh.enabled ? 'checked' : ''}> Aç
          </label>
        </div>
        <select id="arate" style="padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:rgba(0,0,0,0.3);color:white">
          <option value="30000" ${state.autoRefresh.ms === 30000 ? 'selected' : ''}>30 sn</option>
          <option value="60000" ${state.autoRefresh.ms === 60000 ? 'selected' : ''}>1 dk</option>
          <option value="300000" ${state.autoRefresh.ms === 300000 ? 'selected' : ''}>5 dk</option>
        </select>
      </div>
    </div>
  `;
  
  content.insertBefore(toolbar, content.firstChild);
  
  // Events
  $("#sort-select")?.addEventListener("change", (e) => {
    state.sortKey = e.target.value;
    applyFilters();
  });
  
  $$('input[name="kzfilter"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      state.filterKz = e.target.value;
      applyFilters();
    });
  });
  
  $("#autoref")?.addEventListener("change", (e) => {
    state.autoRefresh.enabled = e.target.checked;
    storage.set("portfolio_autorefresh", { enabled: state.autoRefresh.enabled, ms: state.autoRefresh.ms });
    state.autoRefresh.enabled ? startAutoRefresh() : stopAutoRefresh();
  });
  
  $("#arate")?.addEventListener("change", (e) => {
    state.autoRefresh.ms = parseInt(e.target.value);
    storage.set("portfolio_autorefresh", { enabled: state.autoRefresh.enabled, ms: state.autoRefresh.ms });
    if (state.autoRefresh.enabled) startAutoRefresh();
  });
}

// ==================== OTO-YENİLEME ====================
function startAutoRefresh() {
  stopAutoRefresh();
  if (document.hidden) return;
  
  state.autoRefresh.timer = setInterval(async () => {
    if ($("#product-modal.active")) return;
    
    try {
      await loadData();
      state.cache.clear();
      applyFilters();
    } catch (e) {
      console.warn("Oto-yenileme hatası:", e);
    }
  }, state.autoRefresh.ms);
}

function stopAutoRefresh() {
  if (state.autoRefresh.timer) {
    clearInterval(state.autoRefresh.timer);
    state.autoRefresh.timer = null;
  }
}

// ==================== EXPORT ====================
function exportCSV() {
  const headers = ["urun", "tur", "toplamyatirim", "gunceldeger", "gunluk", "haftalik", "aylik"];
  const rows = state.filtered.map(item => 
    headers.map(h => `"${item[h] || ''}"`).join(",")
  );
  
  const csv = "\ufeff" + [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = `portfoy_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  Toast.success("CSV indirildi");
}

// ==================== BAŞLATMA ====================
async function init() {
  // Init components
  Loader.init();
  Toast.init();
  
  // Load data
  const success = await loadData();
  if (!success) return;
  
  // Setup UI
  initUI();
  
  // Initial render
  applyFilters();
  
  // Start auto-refresh if enabled
  if (state.autoRefresh.enabled) {
    startAutoRefresh();
  }
}

// DOM Ready kontrolü
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
