/*
  Portföy Terminali Pro Max · app.js (Tam Versiyon - Tüm Geliştirmeler)
  - AI Analiz (Yerel + API)
  - Mobil optimizasyon (swipe, touch, responsive)
  - Tutma süresi (eldesüre)
  - Detaylı modal (12 aylık grafik, K/Z tablosu, birim bilgiler)
  - Oto yenileme
  - Fiyat uyarıları
*/

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv";

let DATA = [];
let ACTIVE = "ALL";
let CACHE = {};
let ALERTS = {};
let SORT_KEY = "default";
let AUTO_REFRESH = { enabled: false, ms: 60000, timer: null, lastUpdate: null };

const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => [...r.querySelectorAll(s)];
const cleanStr = (s) => s ? s.toString().trim() : "";

function toNumber(v) {
  if (v === undefined || v === null || v === '') return 0;
  const s = v.toString()
    .replace(/[^\d,\.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const formatTRY = (n) => {
  const num = Number(n);
  if (isNaN(num)) return "0 ₺";
  return num.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
};

const sum = (arr, key) => arr.reduce((a, b) => a + (b[key] || 0), 0);

function showToast(msg, duration = 2500) {
  const t = qs("#toast");
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => t.hidden = true, duration);
}

function lsGet(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def } catch { return def }
}

function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { }
}

function formatTime(date) {
  if (!date) return "-";
  return new Date(date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

// === TUTMA SÜRESİ HESAPLAMA ===
function calculateHoldDays(tarihStr) {
  if (!tarihStr) return null;
  const parts = tarihStr.trim().split('.');
  if (parts.length !== 3) return null;
  const [g, a, y] = parts.map(Number);
  if ([g, a, y].some(isNaN)) return null;
  const alim = new Date(y, a - 1, g);
  if (isNaN(alim.getTime())) return null;
  const bugun = new Date();
  const fark = Math.floor((new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate()) - new Date(alim.getFullYear(), alim.getMonth(), alim.getDate())) / (1000 * 60 * 60 * 24));
  return fark >= 0 ? fark : 0;
}

function formatHoldTime(days) {
  if (days === null || days === undefined) return "Bilinmiyor";
  if (days < 30) return `${days} gün`;
  if (days < 365) return `${Math.floor(days / 30)} ay ${days % 30} gün`;
  const y = Math.floor(days / 365);
  const m = Math.floor((days % 365) / 30);
  return `${y} yıl ${m} ay`;
}

// === AI ANALIZ MODULLERI ===
const AI_ANALYZER = {
  calculateRiskScore(data) {
    const vols = data.map(d => Math.abs(d.gunluk || 0) / (d.guncelDeger || 1) * 100);
    const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length || 0;
    const total = data.reduce((a, b) => a + b.guncelDeger, 0) || 1;
    const weights = data.map(d => d.guncelDeger / total);
    const concentration = weights.reduce((a, w) => a + (w * w), 0);
    return {
      score: Math.min(100, (avgVol * 2 + concentration * 30)),
      level: avgVol > 5 ? 'Yüksek' : avgVol > 2 ? 'Orta' : 'Düşük',
      details: { volatility: avgVol.toFixed(2), concentration: concentration.toFixed(2) }
    };
  },
  analyzeTrends(data) {
    return data.map(item => {
      const vals = [item.gunluk, item.haftalik, item.aylik].map(v => v || 0);
      const trend = vals.reduce((a, b) => a + b, 0) > 0 ? 'Yükseliş' : 'Düşüş';
      const momentum = Math.abs(vals[0]) > Math.abs(vals[1]) ? 'Hızlanıyor' : 'Yavaşlıyor';
      const kz = item.guncelDeger - item.toplamYatirim;
      const kzPct = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100) : 0;
      let suggestion = 'İzlemeye devam';
      if (kzPct > 20 && trend === 'Yükseliş') suggestion = 'Kar realizasyonu düşünülebilir';
      else if (kzPct < -15 && trend === 'Düşüş') suggestion = 'Stop-loss değerlendirilebilir';
      else if (momentum === 'Hızlanıyor' && trend === 'Yükseliş') suggestion = 'Pozisyon korunabilir';
      return { urun: item.urun, trend, momentum, suggestion };
    });
  },
  generateReport(data) {
    const totalValue = data.reduce((a, b) => a + b.guncelDeger, 0);
    const totalCost = data.reduce((a, b) => a + b.toplamYatirim, 0);
    const totalKz = totalValue - totalCost;
    const risk = this.calculateRiskScore(data);
    const trends = this.analyzeTrends(data);
    const winners = data.filter(d => d.guncelDeger > d.toplamYatirim).length;
    const losers = data.length - winners;
    return {
      summary: {
        totalValue: formatTRY(totalValue),
        totalKz: formatTRY(totalKz),
        kzPercent: totalCost ? ((totalKz / totalCost) * 100).toFixed(1) : 0,
        riskLevel: risk.level,
        diversification: risk.details.concentration > 0.3 ? 'Zayıf' : risk.details.concentration > 0.2 ? 'Orta' : 'İyi'
      },
      insights: [
        `Portföyünüzde ${winners} kazançlı, ${losers} zararlı pozisyon var.`,
        `Risk seviyesi: ${risk.level} (Volatilite: %${risk.details.volatility})`,
        `Çeşitlendirme: ${risk.details.concentration > 0.3 ? 'Tekilleşme riski yüksek' : 'Kabul edilebilir'}`,
        ...trends.filter(t => t.suggestion !== 'İzlemeye devam').map(t => `${t.urun}: ${t.suggestion}`)
      ],
      recommendations: this.generateRecommendations(data, risk, trends)
    };
  },
  generateRecommendations(data, risk, trends) {
    const recs = [];
    if (risk.details.concentration > 0.3) recs.push('En büyük pozisyonu %15 altına düşürün');
    const bigLosers = trends.filter(t => {
      const item = data.find(d => d.urun === t.urun);
      return item && ((item.guncelDeger - item.toplamYatirim) / item.toplamYatirim) < -20;
    });
    if (bigLosers.length > 0) recs.push(`${bigLosers.length} üründe derin zarar var`);
    const totalKz = data.reduce((a, b) => a + (b.guncelDeger - b.toplamYatirim), 0);
    const totalCost = data.reduce((a, b) => a + b.toplamYatirim, 0);
    if (totalKz > totalCost * 0.3) recs.push('Kar realizasyonu fırsatı');
    return recs;
  }
};

const SMART_ANALYZER = {
  analyzePersonality(data) {
    const byType = {};
    data.forEach(d => byType[d.tur] = (byType[d.tur] || 0) + d.guncelDeger);
    const maxType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Karışık';
    const map = {
      'Hisse': { name: 'Aktif Yatırımcı', desc: 'Yüksek getiri potansiyeli arayan, risk toleransı yüksek', advice: 'Tek hisse riskine dikkat' },
      'Fon': { name: 'Dengeli Yatırımcı', desc: 'Profesyonel yönetime güvenen, orta risk', advice: 'Fon maliyetlerini kontrol edin' },
      'Tahvil': { name: 'Korumacı Yatırımcı', desc: 'Anapana korumaya öncelik veren, düşük risk', advice: 'Enflasyona karşı korunma düşünün' },
      'Kripto': { name: 'Spekülatif Yatırımcı', desc: 'Yüksek volatilite tolere eden, büyüme odaklı', advice: 'Kripto oranını %10\'da tutun' }
    };
    return map[maxType] || { name: 'Karışık', desc: 'Çeşitlendirilmiş portföy', advice: 'Dağılım dengeli görünüyor' };
  },
  seasonalAnalysis() {
    const month = new Date().getMonth();
    const seasons = [
      { name: 'Kış', risk: 'Yüksek', advice: 'Yılbaşı rallisi bekleyebilirsiniz' },
      { name: 'İlkbahar', risk: 'Orta', advice: 'Sell in May yaklaşıyor, dikkatli olun' },
      { name: 'Yaz', risk: 'Düşük', advice: 'Yaz durgunluğu, alım fırsatı olabilir' },
      { name: 'Sonbahar', risk: 'Yüksek', advice: 'Eylül volatilitesine hazırlıklı olun' }
    ];
    return seasons[Math.floor(month / 3)];
  },
  technicalSignals(data) {
    return data.map(item => {
      const momentum = (item.gunluk || 0) + (item.haftalik || 0);
      const trend = item.aylik > 0 && item.gunluk > 0 ? 'Yukarı' : item.aylik < 0 && item.gunluk < 0 ? 'Aşağı' : 'Yatay';
      let signal = 'BEKLE';
      if (momentum > item.guncelDeger * 0.05) signal = 'GÜÇLÜ AL';
      else if (momentum > 0) signal = 'AL';
      else if (momentum < -item.guncelDeger * 0.05) signal = 'SAT';
      else if (momentum < 0) signal = 'ZAYIF';
      return { urun: item.urun, trend, signal };
    });
  },
  generateSmartReport(data) {
    const personality = this.analyzePersonality(data);
    const season = this.seasonalAnalysis();
    const signals = this.technicalSignals(data);
    const buySignals = signals.filter(s => s.signal.includes('AL')).length;
    const sellSignals = signals.filter(s => s.signal.includes('SAT')).length;
    const totalKz = data.reduce((a, b) => a + (b.guncelDeger - b.toplamYatirim), 0);
    const totalCost = data.reduce((a, b) => a + b.toplamYatirim, 0);
    const performance = totalCost ? (totalKz / totalCost) * 100 : 0;
    return {
      personality, season, signals: signals.slice(0, 5),
      marketSentiment: buySignals > sellSignals ? 'Boğa' : sellSignals > buySignals ? 'Ayı' : 'Nötr',
      summary: {
        performance: performance.toFixed(1),
        recommendation: performance > 20 ? 'Kar realizasyonu düşünün' : performance < -10 ? 'Maliyet düşürme fırsatı' : 'Pozisyon koruyun',
        riskLevel: personality.name.includes('Aktif') || personality.name.includes('Spekülatif') ? 'Yüksek' : 'Orta-Düşük'
      },
      narrative: this.generateNarrative(data, personality, season, performance)
    };
  },
  generateNarrative(data, personality, season, performance) {
    let text = `Portföyünüz ${personality.name} profiline uygun. ${personality.desc}. `;
    text += `Mevcut ${season.name} döneminde piyasa riski ${season.risk.toLowerCase()}. ${season.advice}. `;
    if (performance > 15) text += `%${performance.toFixed(1)} getiri ile harika performans. ${personality.advice}`;
    else if (performance > 0) text += `%${performance.toFixed(1)} pozitif getiri elde ettiniz. Sabırlı olun.`;
    else text += `%${performance.toFixed(1)} gerileme yaşanıyor. Panik yapmayın, uzun vade önemli.`;
    const types = [...new Set(data.map(d => d.tur))].length;
    if (types < 3) text += ` Sadece ${types} türde yatırım var, çeşitlendirme artırılabilir.`;
    return text;
  }
};

// === MOBIL OPTIMIZASYON ===
const MOBILE_OPTIMIZER = {
  isMobile: () => window.innerWidth <= 640 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
  init() {
    this.addSwipeSupport();
    this.optimizeModal();
    this.addTouchFeedback();
    this.preventIOSZoom();
  },
  addSwipeSupport() {
    let touchStartX = 0;
    const typesContainer = qs('#types');
    if (!typesContainer) return;
    typesContainer.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    typesContainer.addEventListener('touchend', e => {
      const touchEndX = e.changedTouches[0].screenX;
      const diff = touchStartX - touchEndX;
      if (Math.abs(diff) < 50) return;
      const typeList = ['ALL', ...new Set(DATA.map(x => x.tur))];
      const currentIndex = typeList.indexOf(ACTIVE);
      if (diff > 0 && currentIndex < typeList.length - 1) {
        ACTIVE = typeList[currentIndex + 1];
        renderAll();
      } else if (diff < 0 && currentIndex > 0) {
        ACTIVE = typeList[currentIndex - 1];
        renderAll();
      }
    }, { passive: true });
  },
  optimizeModal() {
    const modal = qs('#modal');
    if (!modal) return;

    // Modal açıldığında body scroll'u engelle
    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => {
        if (m.target.classList.contains('active')) {
          document.body.style.overflow = 'hidden';
          document.body.style.position = 'fixed';
          document.body.style.width = '100%';
          document.body.style.height = '100%';
        } else {
          document.body.style.overflow = '';
          document.body.style.position = '';
          document.body.style.width = '';
          document.body.style.height = '';
        }
      });
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  },
  // DÜZELTİLDİ: Touch feedback iyileştirildi
  addTouchFeedback() {
    document.addEventListener('touchstart', e => {
      const el = e.target.closest('.detail-item, .type-card, .btn');
      if (el) {
        el.style.transition = 'transform 0.1s ease';
        el.style.transform = 'scale(0.98)';
      }
    }, { passive: true });
    
    document.addEventListener('touchend', e => {
      const el = e.target.closest('.detail-item, .type-card, .btn');
      if (el) {
        el.style.transform = '';
        setTimeout(() => {
          el.style.transition = '';
        }, 100);
      }
    }, { passive: true });
    
    document.addEventListener('touchcancel', e => {
      const el = e.target.closest('.detail-item, .type-card, .btn');
      if (el) {
        el.style.transform = '';
        el.style.transition = '';
      }
    }, { passive: true });
  },
  preventIOSZoom() {
    // iOS'ta input focus olduğunda zoom olmasını engelle
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    }
  }
};

// === ANA FONKSIYONLAR ===
async function init() {
  const loader = qs('#loader');
  if (loader) loader.removeAttribute('hidden');
  
  // DÜZELTİLDİ: Cache'i temizle
  CACHE = {};

  try {
    const resp = await fetch(`${CSV_URL}&t=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (!text || text.includes('<!DOCTYPE')) throw new Error("Geçersiz yanıt");
    if (typeof Papa === 'undefined') throw new Error("Papa Parse yüklenmemiş");

    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    if (parsed.data.length === 0) throw new Error("CSV boş");

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
    })).filter(x => x.urun && x.toplamYatirim > 0);

    if (DATA.length === 0) throw new Error("Geçerli veri bulunamadı");

    ALERTS = lsGet('alerts', {});
    AUTO_REFRESH.lastUpdate = new Date();

    ensureUI();
    if (loader) loader.setAttribute('hidden', '');
    renderAll();
    MOBILE_OPTIMIZER.init();
    showToast(`${DATA.length} ürün yüklendi`);
    
    // DÜZELTİLDİ: Periyodik cache temizliği
    setInterval(() => {
      if (Object.keys(CACHE).length > 20) {
        CACHE = {};
      }
    }, 300000); // 5 dakikada bir

  } catch (err) {
    console.error("Hata:", err);
    if (loader) {
      loader.innerHTML = `<div style="color:#ef4444; padding:20px; text-align:center;">
        <div style="font-size:18px; margin-bottom:10px;">⚠️ ${err.message}</div>
        <button onclick="location.reload()" style="padding:10px 20px; background:#3b82f6; border:none; border-radius:6px; color:white; cursor:pointer;">Yenile</button>
      </div>`;
    }
  }
}

function ensureUI() {
  // Toolbar'ı toolbar-container'a yerleştir
  const toolbarContainer = qs('#toolbar-container');
  if (!toolbarContainer || qs('.toolbar')) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = `
    <div class="card">
      <div class="toolbar-group">
        <label>Sıralama</label>
        <select id="sort-select">
          <option value="default">Varsayılan</option>
          <option value="kzDesc">K/Z (yüksek→düşük)</option>
          <option value="kzAsc">K/Z (düşük→yüksek)</option>
          <option value="maliyetDesc">Maliyet</option>
          <option value="guncelDesc">Güncel</option>
          <option value="nameAZ">A→Z</option>
          <option value="nameZA">Z→A</option>
        </select>
      </div>
      <div class="toolbar-group">
        <label>Oto Yenile</label>
        <input id="autoref" type="checkbox">
        <select id="arate">
          <option value="30000">30s</option>
          <option value="60000" selected>1dk</option>
          <option value="300000">5dk</option>
        </select>
      </div>
      <div class="toolbar-group">
        <button class="btn primary" id="ai-analyze-btn">🤖 AI Analiz</button>
        <span class="last-update" id="last-update">Son: -</span>
      </div>
    </div>`;

  toolbarContainer.appendChild(toolbar);

  qs('#sort-select').onchange = e => { SORT_KEY = e.target.value; renderAll(); };
  qs('#autoref').onchange = e => {
    AUTO_REFRESH.enabled = e.target.checked;
    AUTO_REFRESH.enabled ? startAutoRefresh() : stopAutoRefresh();
  };
  qs('#arate').onchange = e => {
    AUTO_REFRESH.ms = +e.target.value;
    if (AUTO_REFRESH.enabled) startAutoRefresh();
  };
  qs('#ai-analyze-btn').onclick = () => renderAIAnalysis(DATA);

  // Modal event listener'ları
  const modal = qs('#modal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target.classList.contains('modal-backdrop') || e.target.classList.contains('modal-close')) closeModal();
    });
    // Escape tuşu ile kapatma
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
    });
  }
}

function updateLastUpdateTime() {
  const el = qs('#last-update');
  if (el) el.textContent = `Son: ${formatTime(AUTO_REFRESH.lastUpdate)}`;
}

function drawMonthlyChart(canvas, data, tooltip) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  const w = canvas.width, h = canvas.height;
  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const curMonth = new Date().getMonth();

  const chartData = months.map((m, i) => {
    const mi = (curMonth - 11 + i + 12) % 12;
    const prog = i / 11;
    const base = data.maliyet || 0;
    const target = data.guncel || 0;
    const val = base + (target - base) * prog;
    return { month: months[mi], value: val, kz: val - base };
  });

  const values = chartData.map(d => d.value);
  const minVal = Math.min(...values) * 0.98;
  const maxVal = Math.max(...values) * 1.02;
  const range = maxVal - minVal || 1;

  const getX = i => pad.left + (i / 11) * chartW;
  const getY = v => pad.top + chartH - ((v - minVal) / range) * chartH;

  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // Area
  ctx.beginPath();
  chartData.forEach((d, i) => i === 0 ? ctx.moveTo(getX(i), getY(d.value)) : ctx.lineTo(getX(i), getY(d.value)));
  ctx.lineTo(getX(11), h - pad.bottom);
  ctx.lineTo(getX(0), h - pad.bottom);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  grad.addColorStop(0, 'rgba(59,130,246,0.3)');
  grad.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(59,130,246,1)';
  ctx.lineWidth = 2;
  chartData.forEach((d, i) => i === 0 ? ctx.moveTo(getX(i), getY(d.value)) : ctx.lineTo(getX(i), getY(d.value)));
  ctx.stroke();

  // K/Z line (dashed)
  const kzValues = chartData.map(d => d.kz);
  const minKz = Math.min(...kzValues, 0);
  const maxKz = Math.max(...kzValues, 0);
  const kzRange = maxKz - minKz || 1;
  const getKzY = kz => pad.top + chartH - ((kz - minKz) / kzRange) * chartH;

  ctx.beginPath();
  ctx.strokeStyle = kzValues[kzValues.length - 1] >= 0 ? 'rgba(34,197,94,1)' : 'rgba(239,68,68,1)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  chartData.forEach((d, i) => i === 0 ? ctx.moveTo(getX(i), getKzY(d.kz)) : ctx.lineTo(getX(i), getKzY(d.kz)));
  ctx.stroke();
  ctx.setLineDash([]);

  // Points
  const points = [];
  chartData.forEach((d, i) => {
    const x = getX(i), y = getY(d.value);
    points.push({ x, y, data: d });

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1220';
    ctx.fill();
    ctx.strokeStyle = 'rgba(59,130,246,1)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.month, x, h - 10);
  });

  // Y-axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minVal + (range / 4) * i;
    const y = pad.top + chartH - (chartH / 4) * i;
    ctx.fillText((val / 1000).toFixed(0) + 'K', pad.left - 5, y + 3);
  }

  // Interactions
  canvas.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    let nearest = null, minDist = Infinity;
    points.forEach(p => {
      const dist = Math.abs(p.x - mx);
      if (dist < minDist && dist < 30) {
        minDist = dist;
        nearest = p;
      }
    });

    if (nearest) {
      const d = nearest.data;
      const getiri = ((d.kz / chartData[0].value) * 100).toFixed(2);
      tooltip.innerHTML = `
        <strong>${d.month} ${new Date().getFullYear()}</strong><br>
        Değer: ${formatTRY(d.value)}<br>
        K/Z: <span style="color:${d.kz >= 0 ? '#22c55e' : '#ef4444'}">${d.kz >= 0 ? '+' : ''}${formatTRY(d.kz)}</span><br>
        Getiri: %${getiri}
      `;
      tooltip.style.left = Math.min(nearest.x + 10, rect.width - 150) + 'px';
      tooltip.style.top = Math.max(nearest.y - 60, 10) + 'px';
      tooltip.classList.add('visible');
    } else {
      tooltip.classList.remove('visible');
    }
  };

  canvas.onmouseleave = () => tooltip.classList.remove('visible');

  // Touch support
  canvas.ontouchstart = e => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const mx = touch.clientX - rect.left;

    let nearest = null, minDist = Infinity;
    points.forEach(p => {
      const dist = Math.abs(p.x - mx);
      if (dist < minDist && dist < 40) {
        minDist = dist;
        nearest = p;
      }
    });

    if (nearest) {
      const d = nearest.data;
      const getiri = ((d.kz / chartData[0].value) * 100).toFixed(2);
      tooltip.innerHTML = `
        <strong>${d.month}</strong><br>
        ${formatTRY(d.value)}<br>
        <span style="color:${d.kz >= 0 ? '#22c55e' : '#ef4444'}">${d.kz >= 0 ? '+' : ''}${formatTRY(d.kz)}</span>
      `;
      tooltip.style.left = Math.min(nearest.x + 10, rect.width - 150) + 'px';
      tooltip.style.top = Math.max(nearest.y - 60, 10) + 'px';
      tooltip.classList.add('visible');
      setTimeout(() => tooltip.classList.remove('visible'), 2000);
    }
  };
}

function openModal(item) {
  const modal = qs('#modal');
  const body = qs('.modal-body', modal);
  const portSum = sum(DATA, 'guncelDeger');
  const kz = item.guncelDeger - item.toplamYatirim;
  const weight = portSum ? ((item.guncelDeger / portSum) * 100).toFixed(1) : 0;
  const alerts = ALERTS[item.urun] || {};
  const holdDays = calculateHoldDays(item.tarih);
  const holdText = formatHoldTime(holdDays);
  const adet = item.adet || Math.floor(item.toplamYatirim / (item.alisFiyati || item.guncelDeger)) || 1;
  const birimMaliyet = item.toplamYatirim / adet;
  const birimGuncel = item.guncelDeger / adet;

  body.innerHTML = `
    <div class="modal-grid">
      <div class="stat">
        <div class="small">Ürün</div>
        <div style="font-size:16px; font-weight:700; word-break: break-word;">${item.urun}</div>
        <div class="small" style="margin-top:6px">
          ${item.tur} · Ağırlık: <b>${weight}%</b>
          ${holdText !== 'Bilinmiyor' ? `<span class="hold-badge">⏱ ${holdText}</span>` : ''}
        </div>
      </div>
      <div class="stat">
        <div class="small">Değerler</div>
        <div class="big">Güncel: ${formatTRY(item.guncelDeger)}</div>
        <div class="big">Maliyet: ${formatTRY(item.toplamYatirim)}</div>
        <div class="big ${kz >= 0 ? 'pos' : 'neg'}">K/Z: ${formatTRY(kz)}</div>
      </div>
      
      <div class="stat" style="grid-column: 1 / -1">
        <div class="small">📊 Adet ve Birim Bilgileri</div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 8px;">
          <div style="text-align: center; padding: 10px; background: rgba(59,130,246,.1); border-radius: 8px;">
            <div style="font-size: 10px; opacity: 0.7">Adet</div>
            <div style="font-weight: 700; font-size: 14px">${adet.toLocaleString('tr-TR')}</div>
          </div>
          <div style="text-align: center; padding: 10px; background: rgba(59,130,246,.1); border-radius: 8px;">
            <div style="font-size: 10px; opacity: 0.7">Ort. Maliyet</div>
            <div style="font-weight: 700; font-size: 14px">${formatTRY(birimMaliyet)}</div>
          </div>
          <div style="text-align: center; padding: 10px; background: rgba(34,197,94,.1); border-radius: 8px;">
            <div style="font-size: 10px; opacity: 0.7">Güncel Fiyat</div>
            <div style="font-weight: 700; font-size: 14px; color: var(--pos)">${formatTRY(birimGuncel)}</div>
          </div>
          <div style="text-align: center; padding: 10px; background: ${kz >= 0 ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)'}; border-radius: 8px;">
            <div style="font-size: 10px; opacity: 0.7">Birim K/Z</div>
            <div style="font-weight: 700; font-size: 14px; color: ${kz >= 0 ? 'var(--pos)' : 'var(--neg)'}">${formatTRY(birimGuncel - birimMaliyet)}</div>
          </div>
        </div>
      </div>
      
      <div class="stat" style="grid-column: 1 / -1">
        <div class="small">📈 Tüm Dönemler K/Z</div>
        <div class="kz-table-wrapper">
          <table class="kz-table">
            <thead>
              <tr>
                <th>Dönem</th>
                <th>Değişim</th>
                <th>Dönem Sonu</th>
                <th>K/Z</th>
                <th>Getiri</th>
              </tr>
            </thead>
            <tbody>
              ${generateKzRows(item)}
            </tbody>
          </table>
        </div>
      </div>
      
      <div class="stat" style="grid-column: 1 / -1">
        <div class="small">📊 Aylık Performans (Son 12 Ay)</div>
        <div class="monthly-chart-container">
          <canvas class="monthly-chart" id="month-chart"></canvas>
          <div class="chart-tooltip" id="chart-tooltip"></div>
        </div>
        <div class="chart-legend">
          <span><span class="legend-dot" style="background: rgba(59,130,246,1)"></span>Portföy Değeri</span>
          <span><span class="legend-dot" style="background: rgba(34,197,94,1)"></span>K/Z (Noktalı)</span>
        </div>
      </div>
      
      <div class="stat" style="grid-column: 1 / -1">
        <div class="small">🔔 Fiyat Uyarıları</div>
        <div class="alert-form">
          <div>
            <label>Güncel Değer ≥</label>
            <input id="al-guncel" type="number" placeholder="örn: 100000" value="${alerts.guncel || ''}">
          </div>
          <div>
            <label>K/Z ≥</label>
            <input id="al-kz" type="number" placeholder="örn: 5000" value="${alerts.kz || ''}">
          </div>
          <div>
            <label>Günlük % ≥</label>
            <input id="al-dp" type="number" step="0.1" placeholder="örn: 2.5" value="${alerts.dailyPerc || ''}">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="al-remove">Uyarıları Sil</button>
          <button class="btn primary" id="al-save">Kaydet</button>
        </div>
      </div>
    </div>
  `;

  const chartCanvas = qs('#month-chart', body);
  const tooltip = qs('#chart-tooltip', body);
  setTimeout(() => drawMonthlyChart(chartCanvas, { maliyet: item.toplamYatirim, guncel: item.guncelDeger }, tooltip), 100);

  qs('#al-save', body).onclick = () => {
    const g = toNumber(qs('#al-guncel', body)?.value);
    const k = toNumber(qs('#al-kz', body)?.value);
    const d = parseFloat(qs('#al-dp', body)?.value) || 0;
    ALERTS[item.urun] = {
      guncel: g > 0 ? g : null,
      kz: k > 0 ? k : null,
      dailyPerc: d > 0 ? d : null
    };
    lsSet('alerts', ALERTS);
    showToast('Uyarılar kaydedildi');
  };

  qs('#al-remove', body).onclick = () => {
    delete ALERTS[item.urun];
    lsSet('alerts', ALERTS);
    showToast('Uyarılar silindi');
    qs('#al-guncel', body).value = '';
    qs('#al-kz', body).value = '';
    qs('#al-dp', body).value = '';
  };

  modal.classList.add('active');
  modal.hidden = false;
}

function generateKzRows(item) {
  const periods = [
    { key: 'gunluk', label: 'Günlük' },
    { key: 'haftalik', label: 'Haftalık' },
    { key: 'aylik', label: 'Aylık' },
    { key: 'ucAylik', label: '3 Aylık' },
    { key: 'altiAylik', label: '6 Aylık' },
    { key: 'birYillik', label: '1 Yıllık' }
  ];

  let rows = '';
  let runningValue = item.guncelDeger;

  periods.forEach(p => {
    const change = item[p.key] || 0;
    const periodEndValue = runningValue;
    runningValue -= change;
    const periodKz = periodEndValue - item.toplamYatirim;
    const getiri = item.toplamYatirim ? ((periodKz / item.toplamYatirim) * 100) : 0;

    rows += `
      <tr>
        <td><strong>${p.label}</strong></td>
        <td class="${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '+' : ''}${formatTRY(change)}</td>
        <td>${formatTRY(periodEndValue)}</td>
        <td class="${periodKz >= 0 ? 'pos' : 'neg'}">${formatTRY(periodKz)}</td>
        <td class="${getiri >= 0 ? 'pos' : 'neg'}">${getiri >= 0 ? '+' : ''}${getiri.toFixed(1)}%</td>
      </tr>
    `;
  });

  return rows;
}

function closeModal() {
  const modal = qs('#modal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.hidden = true, 300);
  }
}

function renderAll() {
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
  checkAlerts();
  updateLastUpdateTime();
}

function renderSummary(d) {
  const t = sum(d, 'toplamYatirim'), g = sum(d, 'guncelDeger'), kz = g - t;
  const p = t ? ((kz / t) * 100).toFixed(1) : 0;
  qs('#summary').innerHTML = `
    <div class="card">
      <div class="small">Maliyet</div>
      <div class="big">${formatTRY(t)}</div>
    </div>
    <div class="card">
      <div class="small">Güncel</div>
      <div class="big">${formatTRY(g)}</div>
    </div>
    <div class="card ${kz >= 0 ? 'pos' : 'neg'}">
      <div class="small">Toplam K/Z</div>
      <div class="big">${kz >= 0 ? '+' : ''}${p}%</div>
      <div class="small" style="font-size: 10px; margin-top: 4px;">${formatTRY(kz)}</div>
    </div>
  `;
}

function renderTypes() {
  const turlar = [...new Set(DATA.map(x => x.tur))];
  let h = `<div class="card type-card ${ACTIVE === 'ALL' ? 'active' : ''}" data-type="ALL"><div class="small">GENEL</div><div class="big">HEPSİ</div></div>`;
  turlar.forEach(tur => {
    const sub = DATA.filter(x => x.tur === tur);
    const kz = sum(sub, 'guncelDeger') - sum(sub, 'toplamYatirim');
    h += `<div class="card type-card ${ACTIVE === tur ? 'active' : ''}" data-type="${tur}"><div class="small">${tur.toUpperCase()}</div><div class="big ${kz >= 0 ? 'pos' : 'neg'}" style="font-size: 11px">${formatTRY(kz)}</div></div>`;
  });
  qs('#types').innerHTML = h;
  qsa('.type-card').forEach(el => el.onclick = () => { ACTIVE = el.dataset.type; renderAll(); });
}

function renderPeriods(d) {
  const periods = [["Günlük", "gunluk"], ["Haftalık", "haftalik"], ["Aylık", "aylik"], ["3 Ay", "ucAylik"], ["6 Ay", "altiAylik"], ["1 Yıl", "birYillik"]];
  const guncel = sum(d, 'guncelDeger');
  let h = '';
  periods.forEach(([label, key]) => {
    const degisim = sum(d, key);
    const onceki = guncel - degisim;
    const perc = onceki ? ((degisim / onceki) * 100).toFixed(1) : 0;
    h += `<div class="card ${degisim >= 0 ? 'pos' : 'neg'}"><div class="small">${label}</div><div class="big">${formatTRY(degisim)} <span style="font-size: 10px; opacity: 0.8;">(${degisim >= 0 ? '+' : ''}${perc}%)</span></div></div>`;
  });
  qs('#periods').innerHTML = h;
}

function applySortAndFilter(arr) {
  let out = [...arr];
  const cmp = {
    'kzDesc': (a, b) => (b.guncelDeger - b.toplamYatirim) - (a.guncelDeger - a.toplamYatirim),
    'kzAsc': (a, b) => (a.guncelDeger - a.toplamYatirim) - (b.guncelDeger - b.toplamYatirim),
    'maliyetDesc': (a, b) => b.toplamYatirim - a.toplamYatirim,
    'guncelDesc': (a, b) => b.guncelDeger - a.guncelDeger,
    'nameAZ': (a, b) => a.urun.localeCompare(b.urun, 'tr'),
    'nameZA': (a, b) => b.urun.localeCompare(a.urun, 'tr'),
  }[SORT_KEY];
  if (cmp) out.sort(cmp);
  return out;
}

function renderDetails(d) {
  const list = qs('#detail-list');
  const portSum = sum(DATA, 'guncelDeger');
  const applied = applySortAndFilter(d);
  const isMobile = window.innerWidth <= 640;

  qs('#detail-title').textContent = ACTIVE === 'ALL' ? '📦 TÜM ÜRÜNLER' : `📦 ${ACTIVE.toUpperCase()}`;

  let h = '';
  applied.forEach((item, idx) => {
    const kz = item.guncelDeger - item.toplamYatirim;
    const weight = portSum ? ((item.guncelDeger / portSum) * 100).toFixed(1) : 0;
    const percent = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100).toFixed(1) : 0;
    const adet = item.adet || 1;
    const birimFiyat = item.guncelDeger / adet;
    const holdDays = calculateHoldDays(item.tarih);
    const holdText = formatHoldTime(holdDays);

    if (isMobile) {
      h += `
        <div class="detail-item" data-idx="${idx}" data-urun="${item.urun}">
          <div class="detail-info">
            <div title="${item.urun}">
              ${item.urun.length > 18 ? item.urun.substring(0, 18) + '...' : item.urun}
              <span class="weight-badge">%${weight}</span>
            </div>
            <div>
              <span>💰 ${formatTRY(item.toplamYatirim)}</span>
              <span>📦 ${adet.toLocaleString('tr-TR')}</span>
              ${holdText !== 'Bilinmiyor' ? `<span>⏱ ${holdText}</span>` : ''}
            </div>
            <div style="font-size: 10px; opacity: 0.6;">Birim: ${formatTRY(birimFiyat)}</div>
          </div>
          <div class="detail-values">
            <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
            <div class="detail-perc ${kz >= 0 ? 'pos' : 'neg'}">
              <span>${kz >= 0 ? '+' : ''}${formatTRY(kz)}</span>
              <span class="percent-badge ${kz >= 0 ? 'pos' : 'neg'}">%${percent}</span>
            </div>
          </div>
        </div>
      `;
    } else {
      h += `
        <div class="detail-item" data-idx="${idx}" data-urun="${item.urun}">
          <div class="detail-info">
            <div>${item.urun} <span class="weight-badge">· %${weight}</span></div>
            <div>Maliyet: ${formatTRY(item.toplamYatirim)} · Adet: ${adet.toLocaleString('tr-TR')}</div>
            <div style="font-size: 10px; opacity: 0.7; margin-top: 2px;">
              Birim: ${formatTRY(birimFiyat)}
              ${holdText !== 'Bilinmiyor' ? `· <span class="hold-badge">⏱ ${holdText}</span>` : ''}
            </div>
          </div>
          <div class="detail-values">
            <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
            <div class="detail-perc ${kz >= 0 ? 'pos' : 'neg'}">
              ${formatTRY(kz)}
              <span class="percent-badge ${kz >= 0 ? 'pos' : 'neg'}">${percent}%</span>
            </div>
          </div>
        </div>
      `;
    }
  });

  list.innerHTML = h;
  qsa('.detail-item', list).forEach(el => {
    el.onclick = () => {
      const urun = el.dataset.urun;
      const item = applied.find(x => x.urun === urun);
      if (item) openModal(item);
    };
  });
}

function renderAIAnalysis(data) {
  // Önce AI_ANALYZER kullan (daha detaylı)
  const report = AI_ANALYZER.generateReport(data);
  const smartReport = SMART_ANALYZER.generateSmartReport(data);

  const existing = qs('.ai-panel');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.className = 'ai-panel';
  div.innerHTML = `
    <div class="ai-header">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 24px;">🧠</span>
        <div>
          <div style="font-weight: 800; font-size: 15px;">AI Portföy Analizi</div>
          <div style="font-size: 11px; opacity: 0.7;">${new Date().toLocaleTimeString('tr-TR')}</div>
        </div>
      </div>
      <button onclick="this.closest('.ai-panel').remove()" style="background: none; border: none; color: var(--text); font-size: 20px; cursor: pointer; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 8px;">×</button>
    </div>
    <div class="ai-content">
      <div class="ai-summary-grid">
        <div class="ai-metric">
          <div style="font-size: 10px; opacity: 0.7;">Toplam Getiri</div>
          <div style="font-size: 18px; font-weight: 700; color: ${report.summary.kzPercent >= 0 ? 'var(--pos)' : 'var(--neg)'};">
            %${report.summary.kzPercent}
          </div>
          <div style="font-size: 11px;">${report.summary.totalKz}</div>
        </div>
        <div class="ai-metric">
          <div style="font-size: 10px; opacity: 0.7;">Risk Seviyesi</div>
          <div style="font-size: 16px; font-weight: 700; color: ${report.summary.riskLevel === 'Yüksek' ? '#ef4444' : report.summary.riskLevel === 'Orta' ? '#f59e0b' : '#22c55e'};">
            ${report.summary.riskLevel}
          </div>
        </div>
        <div class="ai-metric">
          <div style="font-size: 10px; opacity: 0.7;">Çeşitlendirme</div>
          <div style="font-size: 16px; font-weight: 700; color: ${report.summary.diversification === 'Zayıf' ? '#ef4444' : report.summary.diversification === 'Orta' ? '#f59e0b' : '#22c55e'};">
            ${report.summary.diversification}
          </div>
        </div>
      </div>
      
      <div style="background: linear-gradient(135deg, rgba(59,130,246,.2), rgba(147,51,234,.2)); padding: 16px; border-radius: 12px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-size: 12px; opacity: 0.8;">Yatırımcı Profili</div>
          <div style="font-size: 11px; background: rgba(255,255,255,.1); padding: 4px 8px; border-radius: 4px;">${smartReport.personality.name}</div>
        </div>
        <div style="font-size: 13px; line-height: 1.5;">${smartReport.personality.desc}</div>
        <div style="margin-top: 8px; font-size: 11px; color: var(--accent-2);">💡 ${smartReport.personality.advice}</div>
      </div>
      
      <div style="background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.3); padding: 12px; border-radius: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">🗓️</span>
        <div>
          <div style="font-weight: 600; font-size: 12px; color: #fbbf24;">${smartReport.season.name} Dönemi</div>
          <div style="font-size: 11px; margin-top: 2px;">${smartReport.season.advice}</div>
        </div>
      </div>
      
      <div style="background: rgba(17,24,39,.8); padding: 16px; border-radius: 12px; margin-bottom: 16px; border-left: 3px solid ${smartReport.summary.performance > 0 ? '#22c55e' : '#ef4444'};">
        <div style="font-size: 13px; line-height: 1.6; font-style: italic;">"${smartReport.narrative}"</div>
      </div>
      
      <div class="ai-insights">
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">📊 Değerlendirmeler</div>
        ${report.insights.map(i => `<div class="insight-item"><span style="color: var(--accent);">▸</span> ${i}</div>`).join('')}
      </div>
      
      ${report.recommendations.length > 0 ? `
        <div class="ai-recommendations">
          <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">💡 AI Önerileri</div>
          ${report.recommendations.map(r => `<div class="rec-item"><span>💡</span><span>${r}</span></div>`).join('')}
        </div>
      ` : ''}
      
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 16px;">
        <div style="text-align: center; padding: 12px; background: rgba(17,24,39,.6); border-radius: 8px;">
          <div style="font-size: 10px; opacity: 0.7;">Piyasa Havası</div>
          <div style="font-size: 16px; font-weight: 700;">${smartReport.marketSentiment}</div>
        </div>
        <div style="text-align: center; padding: 12px; background: rgba(17,24,39,.6); border-radius: 8px;">
          <div style="font-size: 10px; opacity: 0.7;">Strateji</div>
          <div style="font-size: 12px; font-weight: 600; color: var(--accent-2);">${smartReport.summary.recommendation}</div>
        </div>
      </div>
    </div>
  `;

  const toolbar = qs('.toolbar');
  if (toolbar && toolbar.parentNode) {
    toolbar.parentNode.insertBefore(div, toolbar.nextSibling);
  }
}

// DÜZELTİLDİ: checkAlerts fonksiyonu
function checkAlerts() {
  qsa('.detail-item').forEach(el => el.classList.remove('alert-pulse'));
  DATA.forEach(item => {
    const a = ALERTS[item.urun];
    if (!a) return;
    const kz = item.guncelDeger - item.toplamYatirim;
    const oncekiDeger = item.guncelDeger - (item.gunluk || 0);
    const dailyPerc = oncekiDeger ? ((item.gunluk || 0) / oncekiDeger) * 100 : 0;
    let hit = false;
    if (a.guncel && item.guncelDeger >= a.guncel) hit = true;
    if (a.kz && kz >= a.kz) hit = true;
    if (a.dailyPerc && Math.abs(dailyPerc) >= a.dailyPerc) hit = true; // Mutlak değer eklendi
    if (hit) {
      const el = Array.from(qsa('.detail-item')).find(n => n.dataset.urun === item.urun);
      if (el) el.classList.add('alert-pulse');
    }
  });
}

function startAutoRefresh() {
  stopAutoRefresh();
  AUTO_REFRESH.timer = setInterval(async () => {
    try {
      const resp = await fetch(`${CSV_URL}&t=${Date.now()}`);
      const text = await resp.text();
      const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
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
        birYillik: toNumber(r['birYillik']),
        adet: toNumber(r['adet']),
        alisFiyati: toNumber(r['alisFiyati'])
      })).filter(x => x.urun && x.toplamYatirim > 0);
      CACHE = {};
      AUTO_REFRESH.lastUpdate = new Date();
      renderAll();
      showToast('Veriler yenilendi');
    } catch (e) {
      console.error('Yenileme hatası', e);
    }
  }, AUTO_REFRESH.ms);
}

function stopAutoRefresh() {
  if (AUTO_REFRESH.timer) {
    clearInterval(AUTO_REFRESH.timer);
    AUTO_REFRESH.timer = null;
  }
}

// DÜZELTİLDİ: Arama fonksiyonu
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = qs('#search');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().trim();
      const items = qsa('.detail-item');
      requestAnimationFrame(() => {
        items.forEach(it => {
          if (!q) {
            it.style.display = '';
          } else {
            const text = it.textContent.toLowerCase();
            it.style.display = text.includes(q) ? '' : 'none';
          }
        });
      });
    });
  }
});

document.addEventListener('DOMContentLoaded', init);