/*
  Portföy Terminali Pro Max · app.js (Düzeltilmiş - CSV Uyumlu)
*/

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv";

let DATA = [];
let ACTIVE = "ALL";
let CACHE = {};
let ALERTS = {};
let SORT_KEY = "default";
let AUTO_REFRESH = { enabled:false, ms:60000, timer:null, lastUpdate:null };

const qs = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => [...r.querySelectorAll(s)];
const cleanStr = (s) => s ? s.toString().trim() : "";

function toNumber(v){ 
  if (v === undefined || v === null || v === '') return 0; 
  const s = v.toString()
    .replace(/[^\d,\.-]/g,"")
    .replace(/\./g,"")
    .replace(",",".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const formatTRY = (n) => {
  const num = Number(n);
  if (isNaN(num)) return "0 ₺";
  return num.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
};

const sum = (arr, key) => arr.reduce((a,b) => a + (b[key] || 0), 0);

function showToast(msg, duration=2500){ 
  const t = qs("#toast"); 
  if(!t) return; 
  t.textContent = msg; 
  t.hidden=false; 
  setTimeout(()=> t.hidden=true, duration); 
}

function lsGet(key, def){ 
  try{ return JSON.parse(localStorage.getItem(key)) ?? def }catch{ return def } 
}

function lsSet(key, val){ 
  try{ localStorage.setItem(key, JSON.stringify(val)) }catch{} 
}

function formatTime(date) {
  if (!date) return "-";
  return new Date(date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function calculateHoldDays(tarihStr) {
  if (!tarihStr) return null;
  const parts = tarihStr.trim().split('.');
  if (parts.length !== 3) return null;
  const [g, a, y] = parts.map(Number);
  if ([g,a,y].some(isNaN)) return null;
  const alim = new Date(y, a-1, g);
  if (isNaN(alim.getTime())) return null;
  const bugun = new Date();
  const fark = Math.floor((new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate()) - new Date(alim.getFullYear(), alim.getMonth(), alim.getDate())) / (1000*60*60*24));
  return fark >= 0 ? fark : 0;
}

function formatHoldTime(days) {
  if (days === null || days === undefined) return "Bilinmiyor";
  if (days < 30) return `${days} gün`;
  if (days < 365) return `${Math.floor(days/30)} ay`;
  return `${Math.floor(days/365)} yıl ${Math.floor((days%365)/30)} ay`;
}

// === ANA INIT ===
async function init(){
  const loader = qs('#loader');
  if (loader) loader.removeAttribute('hidden');
  
  try {
    const resp = await fetch(`${CSV_URL}&t=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const text = await resp.text();
    if (!text || text.includes('<!DOCTYPE')) throw new Error("Geçersiz yanıt");
    
    if (typeof Papa === 'undefined') throw new Error("Papa Parse yüklenmemiş");
    
    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    if (parsed.data.length === 0) throw new Error("CSV boş");
    
    // İlk satırın anahtarlarını göster (debug)
    console.log("CSV Sütunları:", Object.keys(parsed.data[0]));
    console.log("İlk satır:", parsed.data[0]);
    
    // VERİ İŞLEME - Sütun isimlerini OLDUĞU GİBİ kullan
    DATA = parsed.data.map(row => ({
      urun: cleanStr(row['urun']),
      tur: cleanStr(row['tur']) || 'Hisse',
      tarih: cleanStr(row['tarih']),
      toplamYatirim: toNumber(row['toplamYatirim']),
      guncelDeger: toNumber(row['guncelDeger']),
      gunluk: toNumber(row['gunluk']),
      haftalik: toNumber(row['haftalik']),
      aylik: toNumber(row['aylik']),
      ucAylik: toNumber(row['ucAylik']),
      altiAylik: toNumber(row['altiAylik']),
      birYillik: toNumber(row['birYillik']),
      adet: toNumber(row['adet']),
      alisFiyati: toNumber(row['alisFiyati'])
    })).filter(x => {
      const valid = x.urun && x.toplamYatirim > 0;
      if (!valid) console.log("Filtrelendi:", x.urun, "toplamYatirim:", x.toplamYatirim);
      return valid;
    });
    
    console.log("İşlenen ürün sayısı:", DATA.length);
    if (DATA.length === 0) throw new Error("Geçerli veri bulunamadı");
    
    ALERTS = lsGet('alerts', {});
    AUTO_REFRESH.lastUpdate = new Date();
    
    ensureUI();
    if (loader) loader.setAttribute('hidden', '');
    renderAll();
    MOBILE_OPTIMIZER.init();
    showToast(`${DATA.length} ürün yüklendi`);
    
  } catch(err) {
    console.error("Hata:", err);
    if (loader) {
      loader.innerHTML = `<div style="color:#ef4444; padding:20px; text-align:center;">
        <div style="font-size:18px; margin-bottom:10px;">⚠️ Hata</div>
        <div>${err.message}</div>
        <button onclick="location.reload()" style="margin-top:15px; padding:10px 20px; background:#3b82f6; border:none; border-radius:6px; color:white; cursor:pointer;">Yenile</button>
      </div>`;
    }
  }
}

function ensureViewport() {
  if (!qs('meta[name="viewport"]')) {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1.0';
    document.head.appendChild(meta);
  }
}

// === AI MODULLERI ===
const SMART_ANALYZER = {
  analyzePersonality(data) {
    const byType = {};
    data.forEach(d => byType[d.tur] = (byType[d.tur] || 0) + d.guncelDeger);
    const maxType = Object.entries(byType).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Karışık';
    const map = {
      'Hisse': { name: 'Aktif', desc: 'Yüksek getiri arayan', advice: 'Çeşitlendirmeye dikkat' },
      'Fon': { name: 'Dengeli', desc: 'Profesyonel yönetim', advice: 'Maliyetleri kontrol et' },
      'Tahvil': { name: 'Korumacı', desc: 'Düşük risk', advice: 'Enflasyona karşı korun' },
      'Kripto': { name: 'Spekülatif', desc: 'Yüksek volatilite', advice: 'Oranı %10\'da tut' }
    };
    return map[maxType] || { name: 'Karışık', desc: 'Çeşitlendirilmiş', advice: 'Dengeli' };
  },
  seasonalAnalysis() {
    const seasons = ['Kış', 'İlkbahar', 'Yaz', 'Sonbahar'];
    const advices = ['Yılbaşı rallisi', 'Sell in May', 'Yaz durgunluğu', 'Eylül volatilitesi'];
    const m = Math.floor(new Date().getMonth() / 3);
    return { name: seasons[m], advice: advices[m] };
  },
  generateSmartReport(data) {
    const personality = this.analyzePersonality(data);
    const season = this.seasonalAnalysis();
    const totalKz = data.reduce((a,b) => a + (b.guncelDeger - b.toplamYatirim), 0);
    const totalCost = data.reduce((a,b) => a + b.toplamYatirim, 0);
    const perf = totalCost ? (totalKz / totalCost) * 100 : 0;
    return {
      personality, season,
      summary: { performance: perf.toFixed(1), recommendation: perf > 20 ? 'Kar realizasyonu' : perf < -10 ? 'Maliyet düşürme' : 'Pozisyon koru' },
      narrative: `${personality.name} profili. ${season.name}: ${season.advice}. Getiri: %${perf.toFixed(1)}`
    };
  }
};

const MOBILE_OPTIMIZER = {
  init() {
    this.addSwipe();
    this.fixModal();
  },
  addSwipe() {
    const types = qs('#types');
    if (!types) return;
    let startX = 0;
    types.addEventListener('touchstart', e => startX = e.touches[0].screenX, {passive: true});
    types.addEventListener('touchend', e => {
      const diff = startX - e.changedTouches[0].screenX;
      if (Math.abs(diff) < 50) return;
      const t = ['ALL', ...new Set(DATA.map(x => x.tur))];
      const i = t.indexOf(ACTIVE);
      if (diff > 0 && i < t.length-1) ACTIVE = t[i+1];
      else if (diff < 0 && i > 0) ACTIVE = t[i-1];
      renderAll();
    }, {passive: true});
  },
  fixModal() {
    const modal = qs('#modal');
    if (!modal) return;
    new MutationObserver(muts => {
      muts.forEach(m => {
        document.body.style.overflow = m.target.classList.contains('active') ? 'hidden' : '';
      });
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }
};

(function injectStyles(){
  if (qs('#dynamic-styles')) return;
  const css = `
    :root { --pos: #22c55e; --neg: #ef4444; --accent: #3b82f6; --text: #e5e7eb; --line: rgba(255,255,255,.08); }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0b0f19; color: var(--text); margin: 0; }
    .toolbar { padding: 8px 16px; }
    .toolbar .card { padding: 12px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; background: rgba(17,24,39,.8); border: 1px solid var(--line); border-radius: 12px; }
    .toolbar-group { display: flex; gap: 8px; align-items: center; }
    .toolbar select, .toolbar button { background: rgba(17,24,39,.9); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
    .btn.primary { background: var(--accent); border-color: var(--accent); }
    .last-update { font-size: 11px; opacity: 0.8; color: var(--accent); margin-left: auto; }
    #summary, #types, #periods { display: flex; gap: 8px; padding: 0 16px; margin: 8px 0; overflow-x: auto; }
    #summary { display: grid; grid-template-columns: repeat(3, 1fr); }
    #summary .card, #types .card, #periods .card { background: rgba(17,24,39,.8); border: 1px solid var(--line); border-radius: 12px; padding: 12px; text-align: center; min-width: 100px; }
    #types .card { cursor: pointer; }
    #types .card.active { border-color: var(--accent); background: rgba(59,130,246,.2); }
    #periods { display: grid; grid-template-columns: repeat(3, 1fr); }
    .card .small { font-size: 10px; opacity: 0.7; margin-bottom: 4px; }
    .card .big { font-size: 14px; font-weight: 700; }
    .pos { color: var(--pos); }
    .neg { color: var(--neg); }
    #detail-list { display: flex; flex-direction: column; gap: 8px; padding: 0 16px; }
    .detail-item { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 12px; background: rgba(17,24,39,.9); border: 1px solid var(--line); border-radius: 12px; cursor: pointer; }
    .detail-info { min-width: 0; }
    .detail-info > div:first-child { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
    .detail-info > div:nth-child(2) { font-size: 11px; opacity: 0.8; }
    .weight-badge { font-size: 9px; background: rgba(59,130,246,.2); padding: 2px 6px; border-radius: 4px; margin-left: 6px; }
    .detail-values { text-align: right; }
    .detail-val { font-size: 15px; font-weight: 700; }
    .detail-perc { font-size: 11px; }
    .percent-badge { font-size: 9px; padding: 2px 6px; border-radius: 4px; margin-left: 4px; }
    .modal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 200; }
    .modal.active { display: flex; }
    .modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.8); backdrop-filter: blur(8px); }
    .modal-card { position: relative; width: 92vw; max-height: 90vh; overflow-y: auto; background: linear-gradient(145deg, rgba(17,24,39,.95), rgba(14,20,34,.9)); border: 1px solid var(--line); border-radius: 14px; padding: 16px; z-index: 1; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .modal-close { background: none; border: none; color: var(--text); font-size: 24px; cursor: pointer; }
    .modal-grid { display: grid; gap: 12px; }
    .stat { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: rgba(17,24,39,.9); }
    .kz-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 8px; }
    .kz-table th, .kz-table td { padding: 6px; text-align: center; border: 1px solid var(--line); }
    .kz-table th { background: rgba(59,130,246,.15); }
    .monthly-chart-container { height: 140px; margin-top: 10px; }
    .monthly-chart { width: 100%; height: 100%; }
    .ai-panel { margin: 16px; border: 1px solid var(--accent); border-radius: 12px; overflow: hidden; }
    .ai-header { padding: 12px 16px; background: rgba(59,130,246,.1); display: flex; justify-content: space-between; align-items: center; }
    .ai-content { padding: 16px; }
    @media (max-width: 640px) {
      #summary { grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 0 12px; }
      #summary .card { padding: 10px 6px; }
      #periods { grid-template-columns: repeat(2, 1fr); }
      .detail-item { padding: 10px; }
      .modal-card { padding: 12px; }
    }
  `;
  document.head.appendChild(document.createElement('style')).id = 'dynamic-styles';
  qs('#dynamic-styles').textContent = css;
})();

function ensureUI(){
  if (qs('.toolbar')) return;
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = `
    <div class="card">
      <div class="toolbar-group">
        <select id="sort-select">
          <option value="default">Sıralama</option>
          <option value="kzDesc">K/Z ↑</option>
          <option value="kzAsc">K/Z ↓</option>
          <option value="maliyetDesc">Maliyet</option>
          <option value="guncelDesc">Güncel</option>
        </select>
      </div>
      <div class="toolbar-group">
        <input type="checkbox" id="autoref"> Oto
        <select id="arate"><option value="60000">1dk</option><option value="300000">5dk</option></select>
      </div>
      <button class="btn primary" id="ai-btn">🤖 AI</button>
      <span class="last-update" id="last-update">-</span>
    </div>`;
  qs('#periods')?.parentNode?.insertBefore(toolbar, qs('#periods').nextSibling);
  
  qs('#sort-select').onchange = e => { SORT_KEY = e.target.value; renderAll(); };
  qs('#autoref').onchange = e => { AUTO_REFRESH.enabled = e.target.checked; e.target.checked ? startAutoRefresh() : stopAutoRefresh(); };
  qs('#ai-btn').onclick = () => renderAIAnalysis(DATA);
  
  if (!qs('#modal')) {
    const m = document.createElement('div');
    m.id = 'modal'; m.className = 'modal';
    m.innerHTML = '<div class="modal-backdrop"></div><div class="modal-card"><div class="modal-header"><div class="modal-title">Detay</div><button class="modal-close">&times;</button></div><div class="modal-body"></div></div>';
    document.body.appendChild(m);
    m.onclick = e => { if(e.target.classList.contains('modal-backdrop') || e.target.classList.contains('modal-close')) closeModal(); };
  }
}

function updateLastUpdateTime() {
  const el = qs('#last-update');
  if (el) el.textContent = formatTime(AUTO_REFRESH.lastUpdate);
}

function drawChart(canvas, data) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width; canvas.height = rect.height;
  const w = canvas.width, h = canvas.height, pad = {t:20,r:20,b:30,l:50};
  const chartW = w - pad.l - pad.r, chartH = h - pad.t - pad.b;
  
  const months = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
  const cur = new Date().getMonth();
  const d = months.map((m,i) => {
    const mi = (cur-11+i+12)%12;
    const prog = i/11;
    const base = data.maliyet, target = data.guncel;
    return {m:months[mi], v:base+(target-base)*prog};
  });
  
  const min = Math.min(...d.map(x=>x.v))*0.98, max = Math.max(...d.map(x=>x.v))*1.02, range=max-min||1;
  const getX = i => pad.l + (i/11)*chartW;
  const getY = v => pad.t + chartH - ((v-min)/range)*chartH;
  
  ctx.clearRect(0,0,w,h);
  ctx.beginPath();
  d.forEach((p,i) => i?ctx.lineTo(getX(i),getY(p.v)):ctx.moveTo(getX(i),getY(p.v)));
  ctx.lineTo(getX(11),h-pad.b); ctx.lineTo(getX(0),h-pad.b); ctx.closePath();
  const grad = ctx.createLinearGradient(0,pad.t,0,h-pad.b);
  grad.addColorStop(0,'rgba(59,130,246,0.3)'); grad.addColorStop(1,'rgba(59,130,246,0)');
  ctx.fillStyle=grad; ctx.fill();
  
  ctx.beginPath(); ctx.strokeStyle='#3b82f6'; ctx.lineWidth=2;
  d.forEach((p,i) => i?ctx.lineTo(getX(i),getY(p.v)):ctx.moveTo(getX(i),getY(p.v)));
  ctx.stroke();
  
  d.forEach((p,i) => {
    ctx.beginPath(); ctx.arc(getX(i),getY(p.v),4,0,Math.PI*2);
    ctx.fillStyle='#0b1220'; ctx.fill(); ctx.strokeStyle='#3b82f6'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.font='10px sans-serif'; ctx.textAlign='center';
    ctx.fillText(p.m,getX(i),h-10);
  });
}

function openModal(item){
  const modal = qs('#modal'), body = qs('.modal-body', modal);
  const kz = item.guncelDeger - item.toplamYatirim;
  const portSum = sum(DATA, 'guncelDeger');
  const weight = portSum ? ((item.guncelDeger/portSum)*100).toFixed(1) : 0;
  
  body.innerHTML = `
    <div class="modal-grid">
      <div class="stat">
        <div class="small">Ürün</div>
        <div style="font-size:16px; font-weight:700">${item.urun}</div>
        <div class="small">${item.tur} · %${weight} <span style="color:#f59e0b">⏱ ${formatHoldTime(calculateHoldDays(item.tarih))}</span></div>
      </div>
      <div class="stat">
        <div class="small">Değerler</div>
        <div>Güncel: ${formatTRY(item.guncelDeger)}</div>
        <div>Maliyet: ${formatTRY(item.toplamYatirim)}</div>
        <div class="${kz>=0?'pos':'neg'}">K/Z: ${formatTRY(kz)}</div>
      </div>
      <div class="stat" style="grid-column:1/-1">
        <div class="small">Dönemsel K/Z</div>
        <table class="kz-table">
          <tr><th>Günlük</th><th>Haftalık</th><th>Aylık</th><th>3A</th><th>6A</th><th>1Y</th></tr>
          <tr>
            <td class="${item.gunluk>=0?'pos':'neg'}">${formatTRY(item.gunluk)}</td>
            <td class="${item.haftalik>=0?'pos':'neg'}">${formatTRY(item.haftalik)}</td>
            <td class="${item.aylik>=0?'pos':'neg'}">${formatTRY(item.aylik)}</td>
            <td class="${item.ucAylik>=0?'pos':'neg'}">${formatTRY(item.ucAylik)}</td>
            <td class="${item.altiAylik>=0?'pos':'neg'}">${formatTRY(item.altiAylik)}</td>
            <td class="${item.birYillik>=0?'pos':'neg'}">${formatTRY(item.birYillik)}</td>
          </tr>
        </table>
      </div>
      <div class="stat" style="grid-column:1/-1">
        <div class="small">12 Aylık Grafik</div>
        <div class="monthly-chart-container"><canvas class="monthly-chart" id="m-chart"></canvas></div>
      </div>
    </div>`;
  
  setTimeout(() => drawChart(qs('#m-chart'), {maliyet:item.toplamYatirim,guncel:item.guncelDeger}), 100);
  modal.classList.add('active');
}

function closeModal(){ qs('#modal')?.classList.remove('active'); }

function renderAll(){
  const key = `filter:${ACTIVE}`;
  let d = CACHE[key];
  if (!d) {
    d = ACTIVE === 'ALL' ? DATA : DATA.filter(x => x.tur === ACTIVE);
    CACHE[key] = d;
  }
  renderSummary(d);
  renderTypes();
  renderPeriods(d);
  renderDetails(d);
  updateLastUpdateTime();
}

function renderSummary(d){
  const t = sum(d, 'toplamYatirim'), g = sum(d, 'guncelDeger'), kz = g - t;
  const p = t ? ((kz/t)*100).toFixed(1) : 0;
  qs('#summary').innerHTML = `
    <div class="card"><div class="small">Maliyet</div><div class="big">${formatTRY(t)}</div></div>
    <div class="card"><div class="small">Güncel</div><div class="big">${formatTRY(g)}</div></div>
    <div class="card ${kz>=0?'pos':'neg'}"><div class="small">K/Z</div><div class="big">${p}%</div><div class="small">${formatTRY(kz)}</div></div>`;
}

function renderTypes(){
  const types = [...new Set(DATA.map(x => x.tur))];
  let h = `<div class="card type-card ${ACTIVE==='ALL'?'active':''}" data-type="ALL"><div class="small">TÜMÜ</div><div class="big">HEPSİ</div></div>`;
  types.forEach(t => {
    const sub = DATA.filter(x => x.tur === t);
    const kz = sum(sub, 'guncelDeger') - sum(sub, 'toplamYatirim');
    h += `<div class="card type-card ${ACTIVE===t?'active':''}" data-type="${t}"><div class="small">${t}</div><div class="big ${kz>=0?'pos':'neg'}">${formatTRY(kz)}</div></div>`;
  });
  qs('#types').innerHTML = h;
  qsa('.type-card').forEach(el => el.onclick = () => { ACTIVE = el.dataset.type; renderAll(); });
}

function renderPeriods(d){
  const p = [['Günlük','gunluk'],['Haftalık','haftalik'],['Aylık','aylik']];
  const g = sum(d, 'guncelDeger');
  qs('#periods').innerHTML = p.map(([l,k]) => {
    const ch = sum(d, k);
    const pct = g-ch ? ((ch/(g-ch))*100).toFixed(1) : 0;
    return `<div class="card ${ch>=0?'pos':'neg'}"><div class="small">${l}</div><div class="big">${formatTRY(ch)} (${pct}%)</div></div>`;
  }).join('');
}

function renderDetails(d){
  const list = qs('#detail-list');
  const portSum = sum(DATA, 'guncelDeger');
  
  let h = '';
  d.forEach(item => {
    const kz = item.guncelDeger - item.toplamYatirim;
    const weight = portSum ? ((item.guncelDeger/portSum)*100).toFixed(1) : 0;
    const pct = item.toplamYatirim ? ((kz/item.toplamYatirim)*100).toFixed(1) : 0;
    
    h += `
      <div class="detail-item" data-urun="${item.urun}">
        <div class="detail-info">
          <div>${item.urun}<span class="weight-badge">%${weight}</span></div>
          <div>${formatTRY(item.toplamYatirim)} · ⏱ ${formatHoldTime(calculateHoldDays(item.tarih))}</div>
        </div>
        <div class="detail-values">
          <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
          <div class="detail-perc ${kz>=0?'pos':'neg'}">${formatTRY(kz)}<span class="percent-badge ${kz>=0?'pos':'neg'}">${pct}%</span></div>
        </div>
      </div>`;
  });
  
  list.innerHTML = h;
  qsa('.detail-item').forEach(el => el.onclick = () => {
    const item = DATA.find(x => x.urun === el.dataset.urun);
    if (item) openModal(item);
  });
}

function renderAIAnalysis(data) {
  const r = SMART_ANALYZER.generateSmartReport(data);
  const existing = qs('.ai-panel');
  if (existing) existing.remove();
  
  const div = document.createElement('div');
  div.className = 'ai-panel';
  div.innerHTML = `
    <div class="ai-header">
      <div style="font-weight:700">🧠 AI Analiz</div>
      <button onclick="this.closest('.ai-panel').remove()" style="background:none;border:none;color:white;font-size:20px;cursor:pointer">&times;</button>
    </div>
    <div class="ai-content">
      <div style="background:rgba(59,130,246,.1); padding:12px; border-radius:8px; margin-bottom:12px;">
        <div style="font-size:12px; opacity:0.8">Profil: ${r.personality.name}</div>
        <div style="font-size:13px; margin-top:4px">${r.personality.desc}</div>
      </div>
      <div style="background:rgba(245,158,11,.1); padding:12px; border-radius:8px; margin-bottom:12px; font-size:12px;">
        🗓️ ${r.season.name}: ${r.season.advice}
      </div>
      <div style="font-size:13px; line-height:1.5; margin-bottom:12px;">${r.narrative}</div>
      <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px;">
        <div style="text-align:center; padding:10px; background:rgba(17,24,39,.8); border-radius:8px;">
          <div style="font-size:10px; opacity:0.7">Getiri</div>
          <div style="font-size:16px; font-weight:700; color:${r.summary.performance>0?'#22c55e':'#ef4444'}">${r.summary.performance}%</div>
        </div>
        <div style="text-align:center; padding:10px; background:rgba(17,24,39,.8); border-radius:8px;">
          <div style="font-size:10px; opacity:0.7">Öneri</div>
          <div style="font-size:11px;">${r.summary.recommendation}</div>
        </div>
      </div>
    </div>`;
  
  qs('.toolbar')?.parentNode?.insertBefore(div, qs('.toolbar'));
}

function startAutoRefresh(){
  stopAutoRefresh();
  AUTO_REFRESH.timer = setInterval(async() => {
    try {
      const resp = await fetch(`${CSV_URL}&t=${Date.now()}`);
      const text = await resp.text();
      const parsed = Papa.parse(text.trim(), {header:true, skipEmptyLines:true});
      DATA = parsed.data.map(r => ({
        urun: cleanStr(r['urun']),
        tur: cleanStr(r['tur']) || 'Hisse',
        tarih: cleanStr(r['tarih']),
        toplamYatirim: toNumber(r['toplamYatirim']),
        guncelDeger: toNumber(r['guncelDeger']),
        gunluk: toNumber(r['gunluk']),
        haftalik: toNumber(r['haftalik']),
        aylik: toNumber(r['aylik']),
        ucAylik: toNumber(r['ucAylik']),
        altiAylik: toNumber(r['altiAylik']),
        birYillik: toNumber(r['birYillik'])
      })).filter(x => x.urun && x.toplamYatirim > 0);
      CACHE = {};
      AUTO_REFRESH.lastUpdate = new Date();
      renderAll();
    } catch(e) { console.error('Yenileme hatası', e); }
  }, AUTO_REFRESH.ms);
}

function stopAutoRefresh(){
  if (AUTO_REFRESH.timer) { clearInterval(AUTO_REFRESH.timer); AUTO_REFRESH.timer = null; }
}

document.addEventListener('DOMContentLoaded', init);
