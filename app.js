
/*
  Portföy Terminali Pro Max · Dark Nebula Edition
  app.js (Enhanced++)
  Eklenenler: 
   - 🧭 Trend sekmesi (Günlük/Haftalık/Aylık) + sparkline vurgusu
   - 📝 CSV başlık doğrulama (eksik/yanlış başlıkta uyarı ve güvenli duruş)
   - 🌓 Tema anahtarı: Dark Nebula ↔ Light Nebula (LocalStorage kalıcı)
   - Mevcut özellikler korunmuştur (Uyarılar, Ağırlık, Modal, Oto-yenile, Sıralama/Filtre, Ticker)
*/

/* =========================================================
   0) Sabitler & Global Durum
========================================================= */
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv";
let DATA = [];
let ACTIVE = "ALL";
let CACHE = {};                 // filtre-cache
let ALERTS = {};                // { [urun]: { guncel:null|num, kz:null|num, dailyPerc:null|num } }
let SORT_KEY = "default";      // default | kzDesc | kzAsc | maliyetDesc | guncelDesc | nameAZ | nameZA
let FILTER_KZ = "all";         // all | pos | neg
let AUTO_REFRESH = { enabled:false, ms:60000, timer:null };
let THEME = "dark";            // dark | light

/* =========================================================
   1) Yardımcılar
========================================================= */
const qs = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => [...r.querySelectorAll(s)];
const cleanStr = (s) => s ? s.toString().trim().replace(/\\s+/g, " ") : "";
function toNumber(v){ if (!v) return 0; const s = v.toString().replace(/[^\\d,\\.-]/g,"").replace(/\\./g,"").replace(",","."); return parseFloat(s)||0; }
const formatTRY = (n) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
const sum = (arr, key) => arr.reduce((a,b) => a + (b[key] ?? 0), 0);
function showToast(msg){ const t = qs("#toast"); if(!t) return; t.textContent = msg; t.hidden=false; setTimeout(()=> t.hidden=true, 2500); }
function lsGet(key, def){ try{ return JSON.parse(localStorage.getItem(key)) ?? def }catch{ return def } }
function lsSet(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)) }catch{} }

/* =========================================================
   2) CSS Enjeksiyonu (Modal + Toolbar + Theme Light Overrides)
========================================================= */
(function injectStyles(){
  if (qs('#dynamic-styles')) return;
  const css = `
    .toolbar{display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:8px var(--gutter); margin:4px 0 10px}
    .toolbar .card{padding:8px; display:flex; gap:8px; align-items:center; justify-content:space-between}
    .toolbar-group{display:flex; gap:8px; align-items:center; flex-wrap:wrap}
    .toolbar select, .toolbar input[type="checkbox"], .toolbar input[type="number"]{
      background:linear-gradient(180deg, rgba(17,24,39,.85), rgba(17,24,39,.65)); color:var(--text);
      border:1px solid var(--line); border-radius:8px; padding:6px 8px; font-size:12px;
    }
    .modal{position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:200}
    .modal.active{display:flex}
    .modal-backdrop{position:absolute; inset:0; backdrop-filter:blur(calc(var(--blur) * .9)); background:rgba(8,14,26,.6)}
    .modal-card{position:relative; width:min(720px, 92vw); border-radius:14px; padding:14px; z-index:1;
      background:linear-gradient(145deg, rgba(17,24,39,.95), rgba(14,20,34,.85)); border:1px solid var(--line);
      box-shadow:0 10px 40px rgba(0,0,0,.55), 0 0 60px rgba(59,130,246,.18)}
    .modal-header{display:flex; justify-content:space-between; align-items:center; margin-bottom:10px}
    .modal-title{font-weight:800; font-size:16px}
    .modal-close{cursor:pointer; border:0; background:transparent; color:#cfe2ff; font-size:20px}
    .modal-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
    .stat{border:1px solid var(--line); border-radius:12px; padding:10px; background:linear-gradient(145deg, rgba(17,24,39,.9), rgba(17,24,39,.7))}
    .spark{width:100%; height:64px; display:block}
    .alert-form{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:10px}
    .alert-form label{font-size:11px; opacity:.7; display:block; margin-bottom:4px}
    .alert-form input{width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); background:rgba(17,24,39,.8); color:var(--text)}
    .modal-actions{display:flex; gap:8px; justify-content:flex-end; margin-top:10px}
    .btn{padding:8px 10px; border-radius:9px; border:1px solid var(--line); background:rgba(17,24,39,.85); color:var(--text); cursor:pointer}
    .btn.primary{border-color:rgba(59,130,246,.6); box-shadow:0 0 12px rgba(59,130,246,.25)}
    .weight-badge{font-size:11px; opacity:.85; color:#cfe2ff}
    .alert-pulse{animation:alertPulse 1.4s ease-in-out infinite}
    @keyframes alertPulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.35)}70%{box-shadow:0 0 0 12px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
    .trend-tabs{display:inline-flex; gap:8px; margin:8px 0}
    .trend-tabs .tab{padding:6px 10px; border-radius:999px; border:1px solid var(--line); cursor:pointer; font-size:12px; background:rgba(17,24,39,.6); color:var(--text)}
    .trend-tabs .tab.active{border-color:rgba(59,130,246,.6); box-shadow:0 0 10px rgba(59,130,246,.25)}
    .trend-info{font-size:12px; opacity:.8; margin-top:4px}
    /* Tema Light Nebula değişkenleri */
    html[data-theme="light-nebula"]{
      --bg:#eaf1ff; --bg-2:#dfe8fb; --surface:#f7f9ff; --surface-2:#eef3ff; --line:#cfd7ea; --text:#0f172a; --muted:#475569;
      --accent:#2563eb; --accent-2:#60a5fa;
      --shadow-soft: 0 1px 0 rgba(0,0,0,.04) inset, 0 10px 30px rgba(0,0,0,.08);
      --shadow-strong: 0 10px 30px rgba(0,0,0,.15), 0 0 60px rgba(37,99,235,.15);
    }
    /* Light modda bazı alanların arka planını yumuşat */
    html[data-theme="light-nebula"] .search,
    html[data-theme="light-nebula"] .card,
    html[data-theme="light-nebula"] .detail-item,
    html[data-theme="light-nebula"] .toast{
      background:linear-gradient(180deg, rgba(255,255,255,.92), rgba(255,255,255,.86));
    }
    @media (max-width:640px){ .modal-grid{grid-template-columns:1fr} .alert-form{grid-template-columns:1fr} .toolbar{grid-template-columns:1fr} }
  `;
  const style = document.createElement('style'); style.id='dynamic-styles'; style.textContent = css; document.head.appendChild(style);
})();

/* =========================================================
   3) Başlat — Veri Yükle + Başlık Doğrulama
========================================================= */
function validateHeaders(fields){
  const required = ["urun","tur","toplamYatirim","guncelDeger","gunluk","haftalik","aylik","ucAylik","altiAylik","birYillik"];
  const missing = required.filter(f => !fields.includes(f));
  return { ok: missing.length === 0, missing };
}

function showHeaderError(missing){
  const loader = qs('#loader');
  if (loader){
    loader.hidden = false;
    loader.innerHTML = `
      <div class="loader-core">
        <div class="loader-ring"></div>
        <div class="loader-text" style="color:#ffb4b4">CSV sütunları eksik: ${missing.join(', ')}</div>
        <div class="small" style="margin-top:6px;opacity:.8">Lütfen Google Sheet başlıklarını kontrol edin.</div>
      </div>`;
  }
  showToast(`CSV sütunları hatalı: ${missing.join(', ')}`);
}

async function init(){
  try{
    const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`);
    const text = await resp.text();
    const parsed = Papa.parse(text.trim(), { header:true, skipEmptyLines:true });

    const fields = parsed.meta?.fields || Object.keys(parsed.data?.[0] || {});
    const vh = validateHeaders(fields);
    if (!vh.ok){ showHeaderError(vh.missing); return; }

    DATA = parsed.data.map(row => {
      const o = {}; for (let k in row){ o[k] = (k==="urun"||k==="tur") ? cleanStr(row[k]) : toNumber(row[k]); }
      return o;
    }).filter(x => x.urun && x.toplamYatirim > 0);
    if (!DATA.length) throw new Error("CSV boş geldi");

    ALERTS = lsGet('alerts', {});
    THEME = lsGet('theme', 'dark');
    ensureUI();
    applyTheme(THEME);
    qs('#loader')?.setAttribute('hidden','');
    renderAll();
    if (AUTO_REFRESH.enabled) startAutoRefresh();
  }catch(err){
    console.warn('Veri yüklenemedi, yeniden deneniyor...', err);
    showToast('Veri yüklenemedi, tekrar deneniyor...');
    setTimeout(init, 1200);
  }
}

/* =========================================================
   4) UI Kurulumu (Toolbar + Modal + Tema Seç)
========================================================= */
function ensureUI(){
  // Toolbar
  if (!qs('.toolbar')){
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML = `
      <div class="card">
        <div class="toolbar-group">
          <label for="sort-select" class="small">Sıralama</label>
          <select id="sort-select">
            <option value="default">Varsayılan</option>
            <option value="kzDesc">K/Z (yüksek → düşük)</option>
            <option value="kzAsc">K/Z (düşük → yüksek)</option>
            <option value="maliyetDesc">Maliyet (yüksek → düşük)</option>
            <option value="guncelDesc">Güncel (yüksek → düşük)</option>
            <option value="nameAZ">A→Z</option>
            <option value="nameZA">Z→A</option>
          </select>
        </div>
        <div class="toolbar-group">
          <label class="small">Filtre</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input type="radio" name="kzfilter" value="all" checked> Hepsi</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input type="radio" name="kzfilter" value="pos"> K/Z (+)</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input type="radio" name="kzfilter" value="neg"> K/Z (−)</label>
        </div>
      </div>
      <div class="card">
        <div class="toolbar-group">
          <label class="small" for="arate">Oto Yenile</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input id="autoref" type="checkbox"> Aç</label>
          <select id="arate">
            <option value="30000">30 sn</option>
            <option value="60000" selected>1 dk</option>
            <option value="300000">5 dk</option>
          </select>
        </div>
        <div class="toolbar-group">
          <label for="theme-select" class="small">Tema</label>
          <select id="theme-select">
            <option value="dark">Dark Nebula</option>
            <option value="light">Light Nebula</option>
          </select>
        </div>
      </div>`;
    const content = qs('.content-section');
    content?.insertBefore(toolbar, content.firstChild);

    // Events
    qs('#sort-select').onchange = (e)=>{ SORT_KEY = e.target.value; renderAll(); };
    qsa('input[name="kzfilter"]').forEach(inp => inp.onchange = (e)=>{ FILTER_KZ = e.target.value; renderAll(); });
    qs('#autoref').onchange = (e)=>{ AUTO_REFRESH.enabled = !!e.target.checked; AUTO_REFRESH.enabled ? startAutoRefresh() : stopAutoRefresh(); };
    qs('#arate').onchange = (e)=>{ AUTO_REFRESH.ms = +e.target.value; if (AUTO_REFRESH.enabled){ startAutoRefresh(); } };
    qs('#theme-select').onchange = (e)=>{ applyTheme(e.target.value); };
  }

  // Theme select current state
  const thSel = qs('#theme-select'); if (thSel){ thSel.value = THEME; }

  // Modal
  if (!qs('#modal')){
    const modal = document.createElement('div');
    modal.id = 'modal'; modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">Detay</div>
          <button class="modal-close" aria-label="Kapat">×</button>
        </div>
        <div class="modal-body"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e)=>{ if (e.target.classList.contains('modal-backdrop') || e.target.classList.contains('modal-close')) closeModal(); });
  }
}

function applyTheme(theme){
  THEME = theme;
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light-nebula' : 'dark-nebula');
  lsSet('theme', theme);
}

/* =========================================================
   5) Modal + Trend Sekmesi
========================================================= */
function openModal(item){
  const modal = qs('#modal');
  const body = modal.querySelector('.modal-body');
  const portSum = sum(DATA, 'guncelDeger');
  const kz = item.guncelDeger - item.toplamYatirim;
  const weight = portSum ? ((item.guncelDeger/portSum)*100).toFixed(1) : 0;
  const alerts = ALERTS[item.urun] || { guncel:null, kz:null, dailyPerc:null };

  body.innerHTML = `
    <div class="modal-grid">
      <div class="stat">
        <div class="small">Ürün</div>
        <div class="big" style="font-size:16px">${item.urun}</div>
        <div class="small" style="margin-top:6px">Tür: ${item.tur} · Ağırlık: <b>${weight}%</b></div>
      </div>
      <div class="stat">
        <div class="small">Değerler</div>
        <div class="big">Güncel: ${formatTRY(item.guncelDeger)}</div>
        <div class="big">Maliyet: ${formatTRY(item.toplamYatirim)}</div>
        <div class="big ${kz>=0?"pos":"neg"}">K/Z: ${formatTRY(kz)}</div>
      </div>
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">Trend</div>
        <div class="trend-tabs" role="tablist">
          <button class="tab active" data-key="gunluk" role="tab" aria-selected="true">Günlük</button>
          <button class="tab" data-key="haftalik" role="tab">Haftalık</button>
          <button class="tab" data-key="aylik" role="tab">Aylık</button>
        </div>
        <canvas class="spark" width="640" height="64" aria-label="Trend grafiği"></canvas>
        <div class="trend-info" id="trend-info"></div>
      </div>
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">Uyarı Tanımları</div>
        <div class="alert-form">
          <div><label>Güncel ≥</label><input id="al-guncel" type="number" placeholder="Örn: 100000" value="${alerts.guncel ?? ''}"></div>
          <div><label>K/Z ≥</label><input id="al-kz" type="number" placeholder="Örn: 5000" value="${alerts.kz ?? ''}"></div>
          <div><label>Günlük % ≥</label><input id="al-dp" type="number" placeholder="Örn: 2.5" step="0.1" value="${alerts.dailyPerc ?? ''}"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="al-remove">Uyarıları Sil</button>
          <button class="btn primary" id="al-save">Kaydet</button>
        </div>
      </div>
    </div>`;

  // Trend başlangıç durumu
  const series = [item.gunluk||0, item.haftalik||0, item.aylik||0];
  const canvas = body.querySelector('.spark');
  let activeKey = 'gunluk';
  const keyIndex = { gunluk:0, haftalik:1, aylik:2 };

  drawSparkline(canvas, series, keyIndex[activeKey]);
  updateTrendInfo();

  // Sekme tıklamaları
  body.querySelectorAll('.trend-tabs .tab').forEach(btn =>{
    btn.onclick = ()=>{
      body.querySelectorAll('.trend-tabs .tab').forEach(b=> b.classList.remove('active'));
      btn.classList.add('active'); activeKey = btn.dataset.key;
      drawSparkline(canvas, series, keyIndex[activeKey]);
      updateTrendInfo();
    };
  });

  function updateTrendInfo(){
    const v = series[keyIndex[activeKey]];
    const prev = item.guncelDeger - v;
    const perc = prev ? ((v/prev)*100).toFixed(2) : 0;
    const label = activeKey==='gunluk'?'Günlük': activeKey==='haftalik'?'Haftalık':'Aylık';
    body.querySelector('#trend-info').textContent = `${label}: ${v>=0?'+':''}${formatTRY(v)} (${v>=0?'+':''}${perc}%)`;
  }

  // Alert actions
  body.querySelector('#al-save').onclick = ()=>{
    const g = toNumber(qs('#al-guncel', body)?.value);
    const k = toNumber(qs('#al-kz', body)?.value);
    const d = parseFloat(qs('#al-dp', body)?.value);
    ALERTS[item.urun] = { guncel: isNaN(g)||g<=0 ? null : g, kz: isNaN(k)||k<=0 ? null : k, dailyPerc: isNaN(d)||d<=0 ? null : d };
    lsSet('alerts', ALERTS);
    showToast('Uyarılar kaydedildi');
  };
  body.querySelector('#al-remove').onclick = ()=>{ delete ALERTS[item.urun]; lsSet('alerts', ALERTS); showToast('Uyarılar silindi'); };

  modal.classList.add('active');
}
function closeModal(){ qs('#modal')?.classList.remove('active'); }

function drawSparkline(canvas, data, activeIndex=0){
  if (!canvas) return; const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad=6;
  const min = Math.min(...data, 0), max = Math.max(...data, 1);
  const range = max - min || 1; ctx.clearRect(0,0,w,h);
  // grid fade
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0,h-1,w,1);
  // line
  ctx.strokeStyle = 'rgba(96,165,250,.95)'; ctx.lineWidth = 2; ctx.beginPath();
  const points = data.map((v,i)=>{
  const x = pad + i * ((w-2*pad)/(data.length-1 || 1));
