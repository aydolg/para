/*
  Portföy Terminali Pro Max · app.js (Düzeltilmiş - Hata Yakalama + Debug)
*/

const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv";

let DATA = [];
let ACTIVE = "ALL";
let CACHE = {};
let ALERTS = {};
let SORT_KEY = "default";
let AUTO_REFRESH = { enabled:false, ms:60000, timer:null, lastUpdate:null };
let RETRY_COUNT = 0;
const MAX_RETRIES = 3;

const qs = (s, r=document) => r.querySelector(s);
const qsa = (s, r=document) => [...r.querySelectorAll(s)];
const cleanStr = (s) => s ? s.toString().trim().replace(/\s+/g, " ") : "";

function toNumber(v){ 
  if (!v) return 0; 
  const s = v.toString().replace(/[^\d,\.-]/g,"").replace(/\./g,"").replace(",","."); 
  return parseFloat(s)||0; 
}

const formatTRY = (n) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
const sum = (arr, key) => arr.reduce((a,b) => a + (b[key] ?? 0), 0);

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
  const d = new Date(date);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function calculateHoldDays(tarihStr) {
  if (!tarihStr || typeof tarihStr !== 'string') return null;
  const parts = tarihStr.trim().split('.');
  if (parts.length !== 3) return null;
  const gun = parseInt(parts[0], 10);
  const ay = parseInt(parts[1], 10);
  const yil = parseInt(parts[2], 10);
  if (isNaN(gun) || isNaN(ay) || isNaN(yil)) return null;
  const alimTarihi = new Date(yil, ay - 1, gun);
  if (isNaN(alimTarihi.getTime())) return null;
  const bugun = new Date();
  const alimGun = new Date(alimTarihi.getFullYear(), alimTarihi.getMonth(), alimTarihi.getDate());
  const bugunGun = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate());
  const farkMs = bugunGun - alimGun;
  const farkGun = Math.floor(farkMs / (1000 * 60 * 60 * 24));
  return farkGun >= 0 ? farkGun : 0;
}

function formatHoldTime(days) {
  if (!days && days !== 0) return "Bilinmiyor";
  if (days < 30) return `${days} gün`;
  if (days < 365) return `${Math.floor(days/30)} ay ${days%30} gün`;
  const years = Math.floor(days/365);
  const remainingDays = days % 365;
  const months = Math.floor(remainingDays/30);
  return `${years} yıl ${months} ay`;
}

// === DEBUG PANELI ===
function showDebugInfo(info) {
  console.log('[DEBUG]', info);
  const debugEl = qs('#debug-panel') || document.createElement('div');
  debugEl.id = 'debug-panel';
  debugEl.style.cssText = 'position:fixed; bottom:10px; left:10px; right:10px; background:rgba(0,0,0,.9); color:#0f0; padding:10px; font-size:11px; z-index:9999; border-radius:8px; max-height:100px; overflow-y:auto;';
  debugEl.innerHTML += `<div>${new Date().toLocaleTimeString()}: ${info}</div>`;
  if (!qs('#debug-panel')) document.body.appendChild(debugEl);
}

// === ANA INIT FONKSIYONU (Güçlendirilmiş) ===
async function init(){
  showDebugInfo('Init başladı...');
  
  // Viewport kontrolü
  ensureViewport();
  
  // Loader'ı göster
  const loader = qs('#loader');
  if (loader) loader.removeAttribute('hidden');
  
  try {
    showDebugInfo(`CSV fetch deneniyor... (Deneme: ${RETRY_COUNT + 1}/${MAX_RETRIES})`);
    
    // Timeout ekle (10 saniye)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    showDebugInfo(`Response status: ${resp.status}`);
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    
    const text = await resp.text();
    showDebugInfo(`CSV boyut: ${text.length} karakter`);
    
    if (!text || text.trim().length === 0) throw new Error("CSV boş");
    if (text.includes('<!DOCTYPE') || text.includes('<html')) throw new Error("HTML dönüyor, CSV değil");
    
    // Papa Parse kontrolü
    if (typeof Papa === 'undefined') {
      showDebugInfo('HATA: Papa Parse yüklenmemiş! Script eklenmeli.');
      throw new Error("Papa Parse kütüphanesi bulunamadı");
    }
    
    showDebugInfo('Papa Parse başlatılıyor...');
    const parsed = Papa.parse(text.trim(), { 
      header: true, 
      skipEmptyLines: true,
      delimiter: ",",
      encoding: "UTF-8"
    });
    
    showDebugInfo(`Satır sayısı: ${parsed.data.length}, Hatalar: ${parsed.errors.length}`);
    
    if (parsed.errors.length > 0) {
      console.warn('Parse hataları:', parsed.errors);
    }
    
    // Veri işleme
    DATA = parsed.data.map(row => {
      const o = {}; 
      for (let k in row) { 
        const keyLower = k.toString().trim().toLowerCase();
        if (keyLower === "urun" || keyLower === "tur") {
          o[keyLower] = cleanStr(row[k]);
        } else if (keyLower === "tarih") {
          o.tarih = row[k] ? row[k].toString().trim() : "";
        } else {
          o[keyLower] = toNumber(row[k]);
        }
      }
      return o;
    }).filter(x => {
      const valid = x.urun && x.toplamYatirim > 0;
      if (!valid && x.urun) showDebugInfo(`Filtrelenen satır: ${x.urun} (toplamYatirim: ${x.toplamYatirim})`);
      return valid;
    });
    
    showDebugInfo(`İşlenen veri: ${DATA.length} ürün`);
    
    if (!DATA.length) throw new Error("İşlenecek veri bulunamadı");
    
    // Başarılı - devam et
    RETRY_COUNT = 0;
    ALERTS = lsGet('alerts', {});
    AUTO_REFRESH.lastUpdate = new Date();
    
    showDebugInfo('UI oluşturuluyor...');
    ensureUI();
    
    if (loader) loader.setAttribute('hidden', '');
    
    showDebugInfo('Render başlıyor...');
    renderAll();
    
    MOBILE_OPTIMIZER.init();
    
    if (AUTO_REFRESH.enabled) startAutoRefresh();
    
    showDebugInfo('✅ Init tamamlandı!');
    showToast('Veriler yüklendi', 2000);
    
  } catch(err) {
    console.error('Init hatası:', err);
    showDebugInfo(`❌ HATA: ${err.message}`);
    
    if (RETRY_COUNT < MAX_RETRIES) {
      RETRY_COUNT++;
      showToast(`Hata: ${err.message}. Yeniden deneniyor (${RETRY_COUNT}/${MAX_RETRIES})...`, 3000);
      showDebugInfo(`Yeniden deneme ${RETRY_COUNT}...`);
      setTimeout(init, 2000);
    } else {
      showToast(`Veri yüklenemedi: ${err.message}. Sayfayı yenileyin.`, 5000);
      if (loader) {
        loader.innerHTML = `<div style="color:#ef4444; padding:20px;">
          <div style="font-size:18px; margin-bottom:10px;">⚠️ Yükleme Hatası</div>
          <div style="font-size:14px;">${err.message}</div>
          <button onclick="location.reload()" style="margin-top:15px; padding:10px 20px; background:#3b82f6; border:none; border-radius:6px; color:white; cursor:pointer;">Sayfayı Yenile</button>
        </div>`;
      }
    }
  }
}

function ensureViewport() {
  if (!qs('meta[name="viewport"]')) {
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    document.head.appendChild(meta);
    showDebugInfo('Viewport eklendi');
  }
}

// === GERI KALAN KOD (Öncekiyle aynı, kısaltılmış gösterim) ===

const AI_ANALYZER = {
  calculateRiskScore(data) {
    const volatilities = data.map(d => Math.abs(d.gunluk || 0) / (d.guncelDeger || 1) * 100);
    const avgVolatility = volatilities.reduce((a,b) => a+b, 0) / volatilities.length || 0;
    const concentration = this.calculateConcentration(data);
    return {
      score: Math.min(100, (avgVolatility * 2 + concentration * 30)),
      level: avgVolatility > 5 ? 'Yüksek' : avgVolatility > 2 ? 'Orta' : 'Düşük',
      details: { volatility: avgVolatility.toFixed(2), concentration: concentration.toFixed(2) }
    };
  },
  calculateConcentration(data) {
    const total = data.reduce((a,b) => a + b.guncelDeger, 0) || 1;
    const weights = data.map(d => d.guncelDeger / total);
    return weights.reduce((a, w) => a + (w * w), 0);
  },
  analyzeTrends(data) {
    return data.map(item => {
      const periods = ['gunluk', 'haftalik', 'aylik', 'ucAylik', 'altiAylik', 'birYillik'];
      const values = periods.map(p => item[p] || 0);
      const trend = values.reduce((a,b) => a+b, 0) > 0 ? 'Yükseliş' : 'Düşüş';
      const momentum = Math.abs(values[0] || 0) > Math.abs(values[1] || 0) ? 'Hızlanıyor' : 'Yavaşlıyor';
      return { urun: item.urun, trend, momentum, suggestion: this.generateSuggestion(item, trend, momentum) };
    });
  },
  generateSuggestion(item, trend, momentum) {
    const kz = item.guncelDeger - item.toplamYatirim;
    const kzPercent = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100) : 0;
    if (kzPercent > 20 && trend === 'Yükseliş') return 'Kar realizasyonu düşünülebilir';
    if (kzPercent < -15 && trend === 'Düşüş') return 'Maliyet düşürme veya stop-loss değerlendirilebilir';
    if (momentum === 'Hızlanıyor' && trend === 'Yükseliş') return 'Pozisyon korunabilir';
    return 'İzlemeye devam';
  },
  generateReport(data) {
    const totalValue = data.reduce((a,b) => a + b.guncelDeger, 0);
    const totalCost = data.reduce((a,b) => a + b.toplamYatirim, 0);
    const totalKz = totalValue - totalCost;
    const risk = this.calculateRiskScore(data);
    const trends = this.analyzeTrends(data);
    const winners = data.filter(d => d.guncelDeger > d.toplamYatirim).length;
    const losers = data.length - winners;
    return {
      summary: {
        totalValue: formatTRY(totalValue),
        totalKz: formatTRY(totalKz),
        kzPercent: totalCost ? ((totalKz/totalCost)*100).toFixed(1) : 0,
        riskLevel: risk.level,
        diversification: risk.details.concentration > 0.3 ? 'Zayıf' : risk.details.concentration > 0.2 ? 'Orta' : 'İyi'
      },
      insights: [
        `Portföyünüzde ${winners} kazançlı, ${losers} zararlı pozisyon var.`,
        `Risk seviyesi: ${risk.level} (Volatilite: %${risk.details.volatility})`,
        `Çeşitlendirme: ${risk.details.concentration > 0.3 ? 'Tekilleşme riski yüksek' : 'Çeşitlendirme seviyesi kabul edilebilir'}`,
        ...trends.filter(t => t.suggestion !== 'İzlemeye devam').map(t => `${t.urun}: ${t.suggestion}`)
      ],
      recommendations: this.generateRecommendations(data, risk, trends)
    };
  },
  generateRecommendations(data, risk, trends) {
    const recs = [];
    if (risk.details.concentration > 0.3) recs.push('En büyük pozisyonunuzu %15\'in altına düşürmeyi düşünün');
    const bigLosers = trends.filter(t => {
      const item = data.find(d => d.urun === t.urun);
      return item && (item.guncelDeger - item.toplamYatirim) / item.toplamYatirim < -20;
    });
    if (bigLosers.length > 0) recs.push(`${bigLosers.length} üründe derin zarar var. Stop-loss stratejisi gözden geçirilmeli.`);
    const totalKz = data.reduce((a,b) => a + (b.guncelDeger - b.toplamYatirim), 0);
    const totalCost = data.reduce((a,b) => a + b.toplamYatirim, 0);
    if (totalKz > totalCost * 0.3) recs.push('Önemli kar realizasyonu fırsatı. Portföy rebalancing değerlendirilebilir.');
    return recs;
  }
};

const SMART_ANALYZER = {
  analyzePersonality(data) {
    const total = data.reduce((a,b) => a + b.guncelDeger, 0) || 1;
    const byType = {};
    data.forEach(d => { byType[d.tur] = (byType[d.tur] || 0) + d.guncelDeger; });
    const maxType = Object.entries(byType).sort((a,b) => b[1]-a[1])[0] || ['Karışık', 0];
    const concentration = maxType[1] / total;
    const personalities = {
      'Hisse': { name: 'Aktif Yatırımcı', desc: 'Yüksek getiri potansiyeli arayan, risk toleransı yüksek', advice: concentration > 0.7 ? 'Tek hisse riski yüksek, sektörel çeşitlendirme önerilir' : 'Hisse ağırlığı dengeli' },
      'Fon': { name: 'Dengeli Yatırımcı', desc: 'Profesyonel yönetime güvenen, orta risk', advice: 'Fon maliyet oranlarını (TER) yıllık kontrol edin' },
      'Tahvil': { name: 'Korumacı Yatırımcı', desc: 'Anapana korumaya öncelik veren, düşük risk', advice: 'Enflasyon riskine karşı az miktarda hisse/altın düşünülebilir' },
      'Kripto': { name: 'Spekülatif Yatırımcı', desc: 'Yüksek volatilite tolere eden, büyüme odaklı', advice: 'Kripto oranını portföyün %10\'undan fazla tutmayın' }
    };
    return personalities[maxType[0]] || { name: 'Karışık', desc: 'Çeşitlendirilmiş', advice: 'Tür dağılımınız dengeli görünüyor' };
  },
  seasonalAnalysis() {
    const month = new Date().getMonth();
    const seasons = [
      { name: 'Kış', risk: 'Yüksek', advice: 'Yılbaşı rallisi bekleyebilirsiniz' },
      { name: 'İlkbahar', risk: 'Orta', advice: 'Sell in May yaklaşıyor, dikkatli olun' },
      { name: 'Yaz', risk: 'Düşük', advice: 'Yaz durgunluğu, alım fırsatı olabilir' },
      { name: 'Sonbahar', risk: 'Yüksek', advice: 'Eylül ayı volatilitesine hazırlıklı olun' }
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
    const totalKz = data.reduce((a,b) => a + (b.guncelDeger - b.toplamYatirim), 0);
    const totalCost = data.reduce((a,b) => a + b.toplamYatirim, 0);
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
    const parts = [];
    parts.push(`Portföyünüz ${personality.name} profiline uygun. ${personality.desc} bir yaklaşım sergiliyorsunuz.`);
    parts.push(`Mevcut ${season.name} döneminde piyasa riski ${season.risk.toLowerCase()}. ${season.advice}.`);
    if (performance > 15) parts.push(`%${performance.toFixed(1)} getiri ile harika bir performans. ${personality.advice}`);
    else if (performance > 0) parts.push(`%${performance.toFixed(1)} pozitif getiri elde etmişsiniz. Sabırlı olmaya devam edin.`);
    else parts.push(`%${performance.toFixed(1)} gerileme yaşanıyor. Panik yapmayın, uzun vade önemli.`);
    const types = [...new Set(data.map(d => d.tur))].length;
    if (types < 3) parts.push(`Sadece ${types} farklı türde yatırım var. Çeşitlendirme artırılabilir.`);
    return parts.join(' ');
  }
};

const MOBILE_OPTIMIZER = {
  isMobile: () => window.innerWidth <= 640 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
  
  init() {
    this.optimizeDetailItems();
    this.addSwipeSupport();
    this.optimizeModal();
    this.handleOrientationChange();
    this.addTouchFeedback();
  },
  
  optimizeDetailItems() {
    if (!this.isMobile()) return;
    const items = qsa('.detail-item');
    items.forEach(item => {
      const nameEl = item.querySelector('.detail-info > div:first-child');
      if (nameEl && nameEl.textContent.length > 25) {
        nameEl.title = nameEl.textContent;
      }
    });
  },
  
  addSwipeSupport() {
    let touchStartX = 0;
    const typesContainer = qs('#types');
    if (!typesContainer) return;
    
    typesContainer.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
    }, {passive: true});
    
    typesContainer.addEventListener('touchend', e => {
      const touchEndX = e.changedTouches[0].screenX;
      const diff = touchStartX - touchEndX;
      if (Math.abs(diff) > 50) this.handleSwipe(diff > 0 ? 'left' : 'right');
    }, {passive: true});
  },
  
  handleSwipe(direction) {
    const types = ['ALL', ...new Set(DATA.map(x => x.tur))];
    const currentIndex = types.indexOf(ACTIVE);
    if (direction === 'left' && currentIndex < types.length - 1) {
      ACTIVE = types[currentIndex + 1];
      renderAll();
    } else if (direction === 'right' && currentIndex > 0) {
      ACTIVE = types[currentIndex - 1];
      renderAll();
    }
  },
  
  optimizeModal() {
    const modal = qs('#modal');
    if (!modal) return;
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.target.classList.contains('active')) {
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
  
  handleOrientationChange() {
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        const charts = qsa('.monthly-chart');
        charts.forEach(canvas => {
          const event = new Event('resize');
          window.dispatchEvent(event);
        });
        renderAll();
      }, 300);
    });
  },
  
  addTouchFeedback() {
    document.addEventListener('touchstart', (e) => {
      if (e.target.closest('.detail-item, .type-card, .btn')) {
        e.target.closest('.detail-item, .type-card, .btn').style.transform = 'scale(0.98)';
      }
    }, {passive: true});
    
    document.addEventListener('touchend', (e) => {
      if (e.target.closest('.detail-item, .type-card, .btn')) {
        setTimeout(() => {
          e.target.closest('.detail-item, .type-card, .btn').style.transform = '';
        }, 100);
      }
    }, {passive: true});
  }
};

(function injectStyles(){
  if (qs('#dynamic-styles')) return;
  const css = `
    :root { --mobile-gutter: 12px; --card-padding: 12px; --pos: #22c55e; --neg: #ef4444; --accent: #3b82f6; --accent-2: #60a5fa; --text: #e5e7eb; --line: rgba(255,255,255,.08); --gutter: 16px; }
    
    .toolbar{display:grid; grid-template-columns:1fr; gap:8px; padding:8px var(--gutter); margin:10px 0}
    .toolbar .card{padding:12px; display:flex; gap:16px; align-items:center; justify-content:flex-start; flex-wrap:wrap}
    .toolbar-group{display:flex; gap:8px; align-items:center}
    .toolbar select, .toolbar input[type="checkbox"]{
      background:linear-gradient(180deg, rgba(17,24,39,.85), rgba(17,24,39,.65)); color:var(--text);
      border:1px solid var(--line); border-radius:8px; padding:6px 10px; font-size:12px;
    }
    .last-update{font-size:11px; opacity:0.8; color:var(--accent-2); margin-left:auto; padding:4px 10px; background:rgba(59,130,246,.1); border-radius:6px}
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
    .btn{padding:8px 10px; border-radius:9px; border:1px solid var(--line); background:rgba(17,24,39,.85); color:var(--text); cursor:pointer; transition:all 0.2s}
    .btn.primary{border-color:rgba(59,130,246,.6); box-shadow:0 0 12px rgba(59,130,246,.25)}
    .weight-badge{font-size:11px; opacity:.85; color:#cfe2ff}
    .hold-badge{font-size:10px; opacity:0.8; background:rgba(245,158,11,.15); color:#f59e0b; padding:2px 8px; border-radius:4px; margin-left:6px}
    .percent-badge{font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px}
    .percent-badge.pos{background:rgba(34,197,94,.2); color:var(--pos)}
    .percent-badge.neg{background:rgba(239,68,68,.2); color:var(--neg)}
    .alert-pulse{animation:alertPulse 1.4s ease-in-out infinite}
    @keyframes alertPulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.35)}70%{box-shadow:0 0 0 12px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
    .kz-table{width:100%; border-collapse:collapse; margin-top:10px; font-size:11px}
    .kz-table th, .kz-table td{padding:6px 4px; text-align:center; border:1px solid var(--line)}
    .kz-table th{background:rgba(59,130,246,.15); font-weight:600; font-size:10px}
    .kz-table td{font-size:11px}
    .kz-table .pos{color:var(--pos)}
    .kz-table .neg{color:var(--neg)}
    .kz-table tr:hover{background:rgba(59,130,246,.05)}
    .monthly-chart-container{position:relative; width:100%; height:140px; margin-top:10px}
    .monthly-chart{width:100%; height:100%}
    .chart-tooltip{position:absolute; background:rgba(0,0,0,.95); border:1px solid var(--accent); padding:8px 12px; border-radius:8px; font-size:12px; pointer-events:none; opacity:0; transition:opacity .2s; z-index:100; white-space:nowrap; box-shadow:0 4px 20px rgba(0,0,0,.5)}
    .chart-tooltip.visible{opacity:1}
    .chart-legend{display:flex; gap:16px; justify-content:center; margin-top:8px; font-size:11px}
    .chart-legend span{display:flex; align-items:center; gap:4px}
    .legend-dot{width:8px; height:8px; border-radius:50%}
    
    .ai-panel{margin:16px 0; border:1px solid var(--accent); animation:slideDown 0.3s ease}
    .ai-header{display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid var(--line)}
    .ai-content{padding:16px}
    .ai-summary-grid{display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:16px}
    .ai-metric{background:rgba(59,130,246,.1); padding:12px; border-radius:8px; text-align:center}
    .ai-insights{background:rgba(17,24,39,.5); padding:12px; border-radius:8px; margin-bottom:12px}
    .insight-item{padding:6px 0; font-size:12px; border-bottom:1px solid rgba(255,255,255,.05)}
    .insight-item:last-child{border-bottom:none}
    .ai-recommendations{background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.3); padding:12px; border-radius:8px}
    .rec-item{display:flex; gap:8px; align-items:flex-start; padding:6px 0; font-size:12px; color:#fbbf24}
    @keyframes slideDown{from{opacity:0; transform:translateY(-20px)}to{opacity:1; transform:translateY(0)}}
    
    @media (max-width: 640px) {
      :root { --gutter: var(--mobile-gutter); }
      body { font-size: 14px; -webkit-text-size-adjust: 100%; }
      
      .toolbar { padding: 8px var(--mobile-gutter) !important; margin: 8px 0 !important; }
      .toolbar .card { padding: 10px !important; gap: 10px !important; flex-direction: column !important; align-items: stretch !important; }
      .toolbar-group { width: 100%; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
      .toolbar select { flex: 1; min-width: 120px; font-size: 13px; padding: 8px; }
      .last-update { margin-left: 0 !important; margin-top: 8px; width: 100%; text-align: center; font-size: 10px; }
      
      #summary { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; gap: 8px !important; padding: 0 var(--mobile-gutter) !important; }
      #summary .card { padding: 10px 6px !important; text-align: center !important; }
      #summary .big { font-size: 13px !important; }
      #summary .small { font-size: 9px !important; }
      
      #types { display: flex !important; overflow-x: auto !important; gap: 8px !important; padding: 0 var(--mobile-gutter) !important; scrollbar-width: none !important; -ms-overflow-style: none !important; scroll-snap-type: x mandatory; }
      #types::-webkit-scrollbar { display: none !important; }
      #types .card { flex: 0 0 auto !important; min-width: 90px !important; padding: 10px 12px !important; text-align: center !important; scroll-snap-align: start; }
      #types .big { font-size: 11px !important; }
      
      #periods { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 8px !important; padding: 0 var(--mobile-gutter) !important; }
      #periods .card { padding: 10px 6px !important; text-align: center !important; }
      #periods .big { font-size: 12px !important; display: flex !important; flex-direction: column !important; gap: 2px !important; }
      #periods .big span { font-size: 10px !important; opacity: 0.8 !important; }
      #periods .small { font-size: 10px !important; margin-bottom: 2px !important; }
      
      #detail-list { display: flex; flex-direction: column; gap: 10px; padding: 0 var(--mobile-gutter); }
      
      .detail-item {
        display: grid !important;
        grid-template-columns: 1fr auto !important;
        grid-template-rows: auto auto auto !important;
        gap: 6px !important;
        padding: 12px !important;
        border-radius: 12px !important;
        background: linear-gradient(145deg, rgba(17,24,39,.95), rgba(14,20,34,.9)) !important;
        border: 1px solid var(--line) !important;
        position: relative;
        overflow: hidden;
        min-height: 80px;
      }
      
      .detail-info { grid-column: 1 / 2 !important; grid-row: 1 / -1 !important; min-width: 0 !important; display: flex !important; flex-direction: column !important; justify-content: center !important; }
      .detail-info > div:first-child {
        font-size: 14px !important;
        font-weight: 600 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        max-width: 100% !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        margin-bottom: 4px;
      }
      .weight-badge { font-size: 9px !important; padding: 2px 6px !important; flex-shrink: 0 !important; background: rgba(59,130,246,.2); border-radius: 4px; }
      
      .detail-info > div:nth-child(2) {
        font-size: 11px !important;
        opacity: 0.8 !important;
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 8px !important;
        margin-bottom: 2px;
      }
      
      .detail-info > div:nth-child(3) {
        font-size: 10px !important;
        opacity: 0.6 !important;
      }
      
      .hold-badge { font-size: 9px !important; margin-left: 0 !important; margin-top: 4px !important; width: fit-content !important; padding: 2px 6px; }
      
      .detail-values {
        grid-column: 2 / 3 !important;
        grid-row: 1 / -1 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        justify-content: center !important;
        gap: 4px !important;
        min-width: 85px !important;
      }
      
      .detail-val { font-size: 15px !important; font-weight: 700 !important; white-space: nowrap !important; }
      
      .detail-perc {
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        gap: 2px !important;
        font-size: 11px !important;
      }
      
      .percent-badge { font-size: 10px !important; padding: 2px 6px !important; border-radius: 4px !important; font-weight: 700 !important; }
      
      #search { margin: 8px var(--mobile-gutter) !important; width: calc(100% - 24px) !important; padding: 12px !important; font-size: 14px !important; border-radius: 10px !important; }
      
      .modal-card { width: 95vw !important; max-height: 90vh !important; overflow-y: auto !important; padding: 12px !important; margin: 10px !important; }
      .modal-grid { grid-template-columns: 1fr !important; gap: 10px !important; }
      .modal-title { font-size: 15px !important; }
      .stat { padding: 12px !important; }
      .stat .big { font-size: 14px !important; }
      .monthly-chart-container { height: 160px !important; }
      .kz-table { font-size: 10px !important; }
      .kz-table th, .kz-table td { padding: 4px 2px !important; }
      .alert-form { grid-template-columns: 1fr !important; gap: 10px !important; }
      
      .ai-panel { margin: 10px var(--mobile-gutter) !important; }
      .ai-summary-grid { grid-template-columns: 1fr !important; gap: 8px !important; }
      .ai-metric { padding: 10px !important; }
      
      .ticker-item { font-size: 11px !important; padding: 4px 8px !important; }
      
      .card { border-radius: 10px !important; }
    }
    
    @media (max-height: 500px) and (orientation: landscape) {
      .modal-card { max-height: 85vh !important; }
      .monthly-chart-container { height: 120px !important; }
    }
    
    @media (hover: none) and (pointer: coarse) {
      .detail-item, .type-card, #summary .card, .btn { min-height: 44px; }
      .detail-item:active, .type-card:active, .btn:active { transform: scale(0.98); transition: transform 0.1s; }
    }
  `;
  const style = document.createElement('style'); style.id='dynamic-styles'; style.textContent = css; document.head.appendChild(style);
})();

function ensureUI(){
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
          <label class="small" for="arate">Oto Yenile</label>
          <label style="display:inline-flex; gap:6px; align-items:center"><input id="autoref" type="checkbox"> Aç</label>
          <select id="arate">
            <option value="30000">30 sn</option>
            <option value="60000" selected>1 dk</option>
            <option value="300000">5 dk</option>
          </select>
        </div>
        <div class="toolbar-group">
          <button class="btn primary" id="ai-analyze-btn" style="font-size:12px; padding:6px 12px">🤖 AI Analiz</button>
          <span class="last-update" id="last-update">Son güncelleme: -</span>
        </div>
      </div>`;

    const periodsSection = qs('#periods');
    if (periodsSection && periodsSection.parentNode) {
      periodsSection.parentNode.insertBefore(toolbar, periodsSection.nextSibling);
    }

    qs('#sort-select').onchange = (e)=>{ SORT_KEY = e.target.value; renderAll(); };
    qs('#autoref').onchange = (e)=>{ 
      AUTO_REFRESH.enabled = !!e.target.checked; 
      AUTO_REFRESH.enabled ? startAutoRefresh() : stopAutoRefresh(); 
    };
    qs('#arate').onchange = (e)=>{ 
      AUTO_REFRESH.ms = +e.target.value; 
      if (AUTO_REFRESH.enabled){ startAutoRefresh(); } 
    };
    qs('#ai-analyze-btn').onclick = () => renderAIAnalysis(DATA);
  }

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

function updateLastUpdateTime() {
  const el = qs('#last-update');
  if (el) el.textContent = `Son güncelleme: ${formatTime(AUTO_REFRESH.lastUpdate)}`;
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
  const currentMonth = new Date().getMonth();

  const chartData = months.map((m, i) => {
    const monthIndex = (currentMonth - 11 + i + 12) % 12;
    const progress = i / 11;
    const baseValue = data.maliyet || data.base || 0;
    const targetValue = data.guncel || data.current || 0;
    const value = baseValue + (targetValue - baseValue) * progress;
    const kz = value - baseValue;
    return { 
      month: months[monthIndex], 
      value: value, 
      kz: kz,
      fullDate: `${months[monthIndex]} ${new Date().getFullYear()}`
    };
  });

  const values = chartData.map(d => d.value);
  const kzValues = chartData.map(d => d.kz);

  const minValue = Math.min(...values) * 0.98;
  const maxValue = Math.max(...values) * 1.02;
  const valueRange = maxValue - minValue || 1;

  const minKz = Math.min(...kzValues, 0);
  const maxKz = Math.max(...kzValues, 0);
  const kzRange = maxKz - minKz || 1;

  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  const getX = (i) => pad.left + (i / 11) * chartW;
  const getY = (val) => pad.top + chartH - ((val - minValue) / valueRange) * chartH;
  const getKzY = (kz) => pad.top + chartH - ((kz - minKz) / kzRange) * chartH;

  ctx.beginPath();
  ctx.moveTo(getX(0), getY(chartData[0].value));
  chartData.forEach((d, i) => ctx.lineTo(getX(i), getY(d.value)));
  ctx.lineTo(getX(11), h - pad.bottom);
  ctx.lineTo(getX(0), h - pad.bottom);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  gradient.addColorStop(0, 'rgba(59,130,246,0.3)');
  gradient.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(59,130,246,1)';
  ctx.lineWidth = 2;
  chartData.forEach((d, i) => {
    if (i === 0) ctx.moveTo(getX(i), getY(d.value));
    else ctx.lineTo(getX(i), getY(d.value));
  });
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = kzValues[kzValues.length-1] >= 0 ? 'rgba(34,197,94,1)' : 'rgba(239,68,68,1)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  chartData.forEach((d, i) => {
    if (i === 0) ctx.moveTo(getX(i), getKzY(d.kz));
    else ctx.lineTo(getX(i), getKzY(d.kz));
  });
  ctx.stroke();
  ctx.setLineDash([]);

  const points = [];
  chartData.forEach((d, i) => {
    const x = getX(i);
    const y = getY(d.value);
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

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = minValue + (valueRange / 4) * i;
    const y = pad.top + chartH - (chartH / 4) * i;
    ctx.fillText((val/1000).toFixed(0) + 'K', pad.left - 5, y + 3);
  }

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

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
        <strong>${d.fullDate}</strong><br>
        Değer: ${formatTRY(d.value)}<br>
        K/Z: <span style="color:${d.kz >= 0 ? '#22c55e' : '#ef4444'}">${d.kz >= 0 ? '+' : ''}${formatTRY(d.kz)}</span><br>
        Getiri: %${getiri}
      `;
      tooltip.style.left = Math.min(nearest.x + 10, rect.width - 150) + 'px';
      tooltip.style.top = Math.max(nearest.y - 60, 10) + 'px';
      tooltip.classList.add('visible');

      ctx.beginPath();
      ctx.arc(nearest.x, nearest.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59,130,246,0.3)';
      ctx.fill();
    } else {
      tooltip.classList.remove('visible');
      drawMonthlyChart(canvas, data, tooltip);
    }
  };

  canvas.onmouseleave = () => {
    tooltip.classList.remove('visible');
    drawMonthlyChart(canvas, data, tooltip);
  };
  
  canvas.ontouchstart = (e) => {
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
        <strong>${d.fullDate}</strong><br>
        Değer: ${formatTRY(d.value)}<br>
        K/Z: <span style="color:${d.kz >= 0 ? '#22c55e' : '#ef4444'}">${d.kz >= 0 ? '+' : ''}${formatTRY(d.kz)}</span><br>
        Getiri: %${getiri}
      `;
      tooltip.style.left = Math.min(nearest.x + 10, rect.width - 150) + 'px';
      tooltip.style.top = Math.max(nearest.y - 60, 10) + 'px';
      tooltip.classList.add('visible');
      setTimeout(() => tooltip.classList.remove('visible'), 2000);
    }
  };
}

function openModal(item){
  const modal = qs('#modal');
  const body = modal.querySelector('.modal-body');
  const portSum = sum(DATA, 'guncelDeger');
  const kz = item.guncelDeger - item.toplamYatirim;
  const weight = portSum ? ((item.guncelDeger/portSum)*100).toFixed(1) : 0;
  const alerts = ALERTS[item.urun] || { guncel:null, kz:null, dailyPerc:null };
  const holdDays = calculateHoldDays(item.tarih);
  const holdText = formatHoldTime(holdDays);
  const adet = item.adet || Math.floor(item.toplamYatirim / (item.alisFiyati || item.guncelDeger)) || 1;
  const birimMaliyet = item.toplamYatirim / adet;
  const birimGuncel = item.guncelDeger / adet;

  body.innerHTML = `
    <div class="modal-grid">
      <div class="stat">
        <div class="small">Ürün</div>
        <div class="big" style="font-size:16px">${item.urun}</div>
        <div class="small" style="margin-top:6px">
          Tür: ${item.tur} · Ağırlık: <b>${weight}%</b>
          <span class="hold-badge">⏱ ${holdText}</span>
        </div>
      </div>
      <div class="stat">
        <div class="small">Değerler</div>
        <div class="big">Güncel: ${formatTRY(item.guncelDeger)}</div>
        <div class="big">Maliyet: ${formatTRY(item.toplamYatirim)}</div>
        <div class="big ${kz>=0?"pos":"neg"}">K/Z: ${formatTRY(kz)}</div>
      </div>
      
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">📊 Adet ve Birim Bilgileri</div>
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-top:8px; font-size:12px">
          <div style="text-align:center; padding:8px; background:rgba(59,130,246,.1); border-radius:8px">
            <div style="opacity:.7; font-size:10px">Adet</div>
            <div style="font-weight:700; font-size:14px">${adet.toLocaleString('tr-TR')}</div>
          </div>
          <div style="text-align:center; padding:8px; background:rgba(59,130,246,.1); border-radius:8px">
            <div style="opacity:.7; font-size:10px">Ort. Maliyet</div>
            <div style="font-weight:700; font-size:14px">${formatTRY(birimMaliyet)}</div>
          </div>
          <div style="text-align:center; padding:8px; background:rgba(34,197,94,.1); border-radius:8px">
            <div style="opacity:.7; font-size:10px">Güncel Fiyat</div>
            <div style="font-weight:700; font-size:14px; color:var(--pos)">${formatTRY(birimGuncel)}</div>
          </div>
          <div style="text-align:center; padding:8px; background:${kz>=0 ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)'}; border-radius:8px">
            <div style="opacity:.7; font-size:10px">Birim K/Z</div>
            <div style="font-weight:700; font-size:14px; color:${kz>=0 ? 'var(--pos)' : 'var(--neg)'}">${formatTRY(birimGuncel - birimMaliyet)}</div>
          </div>
        </div>
      </div>
      
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">📈 Tüm Dönemler K/Z</div>
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
      
      <div class="stat" style="grid-column:1 / -1">
        <div class="small">📊 Aylık Performans (Son 12 Ay)</div>
        <div class="monthly-chart-container">
          <canvas class="monthly-chart" id="month-chart"></canvas>
          <div class="chart-tooltip" id="chart-tooltip"></div>
        </div>
        <div class="chart-legend">
          <span><span class="legend-dot" style="background:rgba(59,130,246,1)"></span>Portföy Değeri</span>
          <span><span class="legend-dot" style="background:rgba(34,197,94,1)"></span>K/Z (Noktalı)</span>
        </div>
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

  const chartCanvas = body.querySelector('#month-chart');
  const tooltip = body.querySelector('#chart-tooltip');
  setTimeout(() => drawMonthlyChart(chartCanvas, {
    maliyet: item.toplamYatirim,
    guncel: item.guncelDeger
  }, tooltip), 100);

  body.querySelector('#al-save').onclick = ()=>{
    const g = toNumber(qs('#al-guncel', body)?.value);
    const k = toNumber(qs('#al-kz', body)?.value);
    const d = parseFloat(qs('#al-dp', body)?.value);
    ALERTS[item.urun] = {
      guncel: isNaN(g)||g<=0 ? null : g,
      kz:     isNaN(k)||k<=0 ? null : k,
      dailyPerc: isNaN(d)||d<=0 ? null : d
    };
    lsSet('alerts', ALERTS);
    showToast('Uyarılar kaydedildi');
  };

  body.querySelector('#al-remove').onclick = ()=>{
    delete ALERTS[item.urun]; 
    lsSet('alerts', ALERTS); 
    showToast('Uyarılar silindi');
  };

  modal.classList.add('active');
}

function generateKzRows(item) {
  const periods = [
    {key: 'gunluk', label: 'Günlük'},
    {key: 'haftalik', label: 'Haftalık'},
    {key: 'aylik', label: 'Aylık'},
    {key: 'ucAylik', label: '3 Aylık'},
    {key: 'altiAylik', label: '6 Aylık'},
    {key: 'birYillik', label: '1 Yıllık'}
  ];

  let rows = '';
  let runningValue = item.guncelDeger;

  periods.forEach((p) => {
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

function closeModal(){ qs('#modal')?.classList.remove('active'); }

function drawSparkline(canvas, data){
  if (!canvas) return; 
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, pad=6;
  const min = Math.min(...data, 0), max = Math.max(...data, 1);
  const range = max - min || 1; 
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; 
  ctx.fillRect(0,h-1,w,1);
  ctx.strokeStyle = 'rgba(96,165,250,.95)'; 
  ctx.lineWidth = 2; 
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = pad + i * ((w-2*pad)/(data.length-1 || 1));
    const y = h - pad - ((v - min)/range) * (h-2*pad);
    i?ctx.lineTo(x,y):ctx.moveTo(x,y);
  });
  ctx.stroke();
}

function renderAll(){
  const key = `filter:${ACTIVE}`;
  let d = CACHE[key];
  if (!d){ 
    d = ACTIVE === 'ALL' ? DATA : DATA.filter(x => x.tur.toUpperCase() === ACTIVE.toUpperCase()); 
    CACHE[key] = d; 
  }
  renderSummary(d); 
  renderTypes(); 
  renderPeriods(d); 
  renderDetails(d); 
  renderTicker(DATA); 
  checkAlerts();
  updateLastUpdateTime();
  MOBILE_OPTIMIZER.optimizeDetailItems();
}

function renderSummary(d){
  const t = sum(d, 'toplamYatirim'), g = sum(d,'guncelDeger'), kz = g - t; 
  const p = t?((kz/t)*100).toFixed(1):0;
  qs('#summary').innerHTML = `
    <div class="card"><div class="small">Maliyet</div><div class="big">${formatTRY(t)}</div></div>
    <div class="card"><div class="small">Güncel</div><div class="big">${formatTRY(g)}</div></div>
    <div class="card ${kz>=0?'pos':'neg'}"><div class="small">Toplam K/Z</div><div class="big">${kz>=0?'+':''}${p}%</div><div class="small" style="font-size:11px;margin-top:4px;">${formatTRY(kz)}</div></div>`;
}

function renderTypes(){
  const turlar = [...new Set(DATA.map(x=>x.tur))];
  let h = `<div class="card type-card ${ACTIVE==='ALL'?'active':''}" data-type="ALL">GENEL<br><span class="big">HEPSİ</span></div>`;
  turlar.forEach(tur=>{
    const sub = DATA.filter(x=>x.tur===tur); 
    const kz = sum(sub,'guncelDeger') - sum(sub,'toplamYatirim');
    h += `<div class="card type-card ${ACTIVE===tur?'active':''}" data-type="${tur}"><div class="small">${tur.toUpperCase()}</div><div class="big ${kz>=0?'pos':'neg'}" style="font-size:12px">${formatTRY(kz)}</div></div>`;
  });
  const types = qs('#types'); 
  types.innerHTML = h; 
  [...types.children].forEach(el=> el.onclick = ()=>{ ACTIVE = el.dataset.type; renderAll(); });
}

function renderPeriods(d){
  const periods = [["Günlük","gunluk"],["Haftalık","haftalik"],["Aylık","aylik"],["3 Ay","ucAylik"],["6 Ay","altiAylik"],["1 Yıl","birYillik"]];
  const guncel = sum(d,'guncelDeger'); 
  let h='';
  periods.forEach(([label,key])=>{ 
    const degisim = sum(d,key); 
    const onceki = guncel - degisim; 
    const perc = onceki?((degisim/onceki)*100).toFixed(1):0;
    h += `<div class="card ${degisim>=0?'pos':'neg'}"><div class="small">${label}</div><div class="big">${formatTRY(degisim)} <span style="font-size:11px">(${degisim>=0?'+':''}${perc}%)</span></div></div>`; 
  });
  qs('#periods').innerHTML = h;
}

function applySortAndFilter(arr){
  let out = [...arr];
  const cmp = {
    'kzDesc': (a,b)=> (b.guncelDeger-b.toplamYatirim) - (a.guncelDeger-a.toplamYatirim),
    'kzAsc':  (a,b)=> (a.guncelDeger-a.toplamYatirim) - (b.guncelDeger-b.toplamYatirim),
    'maliyetDesc': (a,b)=> b.toplamYatirim - a.toplamYatirim,
    'guncelDesc':  (a,b)=> b.guncelDeger - a.guncelDeger,
    'nameAZ': (a,b)=> a.urun.localeCompare(b.urun,'tr'),
    'nameZA': (a,b)=> b.urun.localeCompare(a.urun,'tr'),
  }[SORT_KEY];
  if (cmp) out.sort(cmp);
  return out;
}

function renderDetails(d){
  const list = qs('#detail-list');
  const portSum = sum(DATA, 'guncelDeger');
  const applied = applySortAndFilter(d);
  const isMobile = window.innerWidth <= 640;
  
  qs('#detail-title').textContent = ACTIVE==='ALL' ? '📦 TÜM ÜRÜNLER' : `📦 ${ACTIVE.toUpperCase()} DETAYLARI`;
  
  let h='';
  applied.forEach((item, idx)=>{
    const kz = item.guncelDeger - item.toplamYatirim; 
    const weight = portSum?((item.guncelDeger/portSum)*100).toFixed(1):0;
    const percent = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100).toFixed(1) : 0;
    const adet = item.adet || Math.floor(item.toplamYatirim / (item.alisFiyati || item.guncelDeger)) || 1;
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
            </div>
            <div>${formatTRY(birimFiyat)} ${holdText !== 'Bilinmiyor' ? `• ⏱ ${holdText}` : ''}</div>
          </div>
          <div class="detail-values">
            <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
            <div class="detail-perc ${kz>=0?'pos':'neg'}">
              <span>${kz>=0?'+':''}${formatTRY(kz)}</span>
              <span class="percent-badge ${kz>=0?'pos':'neg'}">%${percent}</span>
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
            <div style="font-size:10px; opacity:0.7; margin-top:2px">Birim: ${formatTRY(birimFiyat)} ${holdText !== 'Bilinmiyor' ? `• ⏱ ${holdText}` : ''}</div>
          </div>
          <div class="detail-values">
            <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
            <div class="detail-perc ${kz>=0?'pos':'neg'}">
              ${formatTRY(kz)}
              <span class="percent-badge ${kz>=0?'pos':'neg'}">${percent}%</span>
            </div>
          </div>
        </div>
      `;
    }
  });
  
  list.innerHTML = h;
  qsa('.detail-item', list).forEach((el)=>{
    el.onclick = ()=>{ 
      const urun = el.dataset.urun; 
      const item = applied.find(x=>x.urun===urun); 
      if (item) openModal(item); 
    };
  });
}

function renderAIAnalysis(data) {
  const report = SMART_ANALYZER.generateSmartReport(data);
  const existing = qs('.ai-panel');
  if (existing) existing.remove();
  
  const div = document.createElement('div');
  div.className = 'ai-panel card';
  div.style.borderColor = report.summary.performance > 0 ? '#22c55e' : '#ef4444';
  div.innerHTML = `
    <div class="ai-header">
      <div style="display:flex; align-items:center; gap:10px">
        <span style="font-size:24px">🧠</span>
        <div>
          <div style="font-weight:800; font-size:15px">Akıllı Portföy Analizi</div>
          <div style="font-size:11px; opacity:0.7">Ücretsiz AI • ${new Date().toLocaleTimeString('tr-TR')}</div>
        </div>
      </div>
      <button class="btn" onclick="this.closest('.ai-panel').remove()" style="font-size:18px; padding:4px 8px">×</button>
    </div>
    <div class="ai-content">
      <div style="background:linear-gradient(135deg, rgba(59,130,246,.2), rgba(147,51,234,.2)); padding:16px; border-radius:12px; margin-bottom:16px">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <div style="font-size:12px; opacity:0.8">Yatırımcı Profili</div>
          <div style="font-size:11px; background:rgba(255,255,255,.1); padding:4px 8px; border-radius:4px">${report.personality.name}</div>
        </div>
        <div style="font-size:13px; line-height:1.5">${report.personality.desc}</div>
        <div style="margin-top:8px; font-size:11px; color:var(--accent-2)">💡 ${report.personality.advice}</div>
      </div>
      
      <div style="background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.3); padding:12px; border-radius:8px; margin-bottom:16px; display:flex; align-items:center; gap:10px">
        <span style="font-size:20px">🗓️</span>
        <div>
          <div style="font-weight:600; font-size:12px; color:#fbbf24">${report.season.name} Dönemi Uyarısı</div>
          <div style="font-size:11px; margin-top:2px">${report.season.advice}</div>
        </div>
      </div>
      
      <div style="background:rgba(17,24,39,.8); padding:16px; border-radius:12px; margin-bottom:16px; border-left:3px solid ${report.summary.performance > 0 ? '#22c55e' : '#ef4444'}">
        <div style="font-size:13px; line-height:1.6; font-style:italic">"${report.narrative}"</div>
      </div>
      
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(100px, 1fr)); gap:8px; margin-bottom:16px">
        ${report.signals.map(s => `
          <div style="background:rgba(17,24,39,.6); padding:8px; border-radius:8px; text-align:center; border:1px solid ${s.signal.includes('AL') ? 'rgba(34,197,94,.3)' : s.signal.includes('SAT') ? 'rgba(239,68,68,.3)' : 'rgba(255,255,255,.1)'}">
            <div style="font-size:10px; opacity:0.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${s.urun}</div>
            <div style="font-size:11px; font-weight:700; color:${s.signal.includes('AL') ? '#22c55e' : s.signal.includes('SAT') ? '#ef4444' : '#9ca3af'}">${s.signal}</div>
          </div>
        `).join('')}
      </div>
      
      <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px">
        <div style="text-align:center; padding:12px; background:rgba(17,24,39,.6); border-radius:8px">
          <div style="font-size:10px; opacity:0.7">Getiri</div>
          <div style="font-size:16px; font-weight:700; color:${report.summary.performance > 0 ? '#22c55e' : '#ef4444'}">%${report.summary.performance}</div>
        </div>
        <div style="text-align:center; padding:12px; background:rgba(17,24,39,.6); border-radius:8px">
          <div style="font-size:10px; opacity:0.7">Piyasa</div>
          <div style="font-size:14px; font-weight:700">${report.marketSentiment}</div>
        </div>
        <div style="text-align:center; padding:12px; background:rgba(17,24,39,.6); border-radius:8px">
          <div style="font-size:10px; opacity:0.7">Öneri</div>
          <div style="font-size:11px; font-weight:600; color:var(--accent-2); line-height:1.3">${report.summary.recommendation}</div>
        </div>
      </div>
    </div>
  `;
  
  const toolbar = qs('.toolbar');
  if (toolbar && toolbar.parentNode) {
    toolbar.parentNode.insertBefore(div, toolbar);
  }
}

function renderTicker(list){
  let h=''; 
  list.forEach(d=>{ 
    const degisim=d.gunluk || 0; 
    const onceki=d.guncelDeger-degisim; 
    const perc= onceki?((degisim/onceki)*100).toFixed(2):0;
    h += `<div class="ticker-item" style="color:${degisim>=0?'var(--pos)':'var(--neg)'}">${d.urun} %${degisim>=0?'+':''}${perc}</div>`; 
  });
  qs('#ticker-content').innerHTML = h + h;
}

qs('#search')?.addEventListener('input', e=>{
  const q = e.target.value.toLowerCase(); 
  const items = qsa('.detail-item');
  requestAnimationFrame(()=>{ 
    items.forEach(it=>{ it.style.display = it.textContent.toLowerCase().includes(q) ? '' : 'none'; }); 
  });
});

function checkAlerts(){
  const portSum = sum(DATA,'guncelDeger');
  qsa('.detail-item').forEach(el=> el.classList.remove('alert-pulse'));
  DATA.forEach(item=>{
    const a = ALERTS[item.urun]; 
    if (!a) return;
    const kz = item.guncelDeger - item.toplamYatirim;
    const dailyPerc = (item.guncelDeger - (item.gunluk || 0)) ? ((item.gunluk || 0) / (item.guncelDeger - (item.gunluk || 0)))*100 : 0;
    let hit = false;
    if (a.guncel!=null && item.guncelDeger >= a.guncel) hit = true;
    if (a.kz!=null && kz >= a.kz) hit = true;
    if (a.dailyPerc!=null && dailyPerc >= a.dailyPerc) hit = true;
    if (hit){
      const el = qsa('.detail-item').find(n=> n.dataset.urun===item.urun);
      if (el){ el.classList.add('alert-pulse'); }
      showToast(`${item.urun}: uyarı tetiklendi`);
    }
  });
}

function startAutoRefresh(){ 
  stopAutoRefresh(); 
  if (!AUTO_REFRESH.ms) AUTO_REFRESH.ms = 60000; 
  AUTO_REFRESH.timer = setInterval(async()=>{
    try{ 
      const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`); 
      const text = await resp.text(); 
      const parsed = Papa.parse(text.trim(), { header:true, skipEmptyLines:true });
      DATA = parsed.data.map(row=>{ 
        const o={}; 
        for(let k in row){ 
          const keyLower = k.toString().trim().toLowerCase();
          if (keyLower === "urun" || keyLower === "tur") o[keyLower] = cleanStr(row[k]);
          else if (keyLower === "tarih") o.tarih = row[k] ? row[k].toString().trim() : "";
          else o[keyLower] = toNumber(row[k]);
        }
        return o; 
      }).filter(x=> x.urun && x.toplamYatirim>0);
      AUTO_REFRESH.lastUpdate = new Date();
      CACHE = {}; 
      renderAll(); 
      showToast('Veriler yenilendi');
    }catch(e){ 
      console.warn('Yenileme başarısız', e); 
    }
  }, AUTO_REFRESH.ms); 
}

function stopAutoRefresh(){ 
  if (AUTO_REFRESH.timer){ 
    clearInterval(AUTO_REFRESH.timer); 
    AUTO_REFRESH.timer=null; 
  } 
}

// Başlat
document.addEventListener('DOMContentLoaded', init);
