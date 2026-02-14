/*
  Portföy Terminali Pro Max · app.js (Sütun İsimleri Düzeltmeli)
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

// Gelişmiş sayı parse (Türkçe format: 1.234,56)
function toNumber(v){ 
  if (!v || v === '' || v === '-') return 0; 
  const s = v.toString()
    .replace(/[^\d,\.-]/g,"")  // Sadece sayı, virgül, nokta, eksi
    .replace(/\./g,"")          // Binlik ayraçları kaldır (nokta)
    .replace(",",".");          // Ondalık virgülü noktaya çevir
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

const formatTRY = (n) => {
  if (isNaN(n) || n === undefined || n === null) return "0 ₺";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
};
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
  const parts = tarihStr.trim().split(/[./-]/); // Nokta, slash veya tire ayırıcı
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
  debugEl.style.cssText = 'position:fixed; bottom:10px; left:10px; right:10px; background:rgba(0,0,0,.9); color:#0f0; padding:10px; font-size:11px; z-index:9999; border-radius:8px; max-height:150px; overflow-y:auto; font-family:monospace;';
  if (!qs('#debug-panel')) {
    document.body.appendChild(debugEl);
    // Temizle butonu ekle
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'X';
    clearBtn.style.cssText = 'position:absolute; top:5px; right:5px; background:#ef4444; color:white; border:none; border-radius:4px; padding:2px 6px; cursor:pointer; font-size:10px;';
    clearBtn.onclick = () => debugEl.remove();
    debugEl.appendChild(clearBtn);
  }
  const line = document.createElement('div');
  line.innerHTML = `<span style="color:#888">${new Date().toLocaleTimeString()}</span>: ${info}`;
  debugEl.appendChild(line);
  debugEl.scrollTop = debugEl.scrollHeight;
}

// === ANA INIT FONKSIYONU ===
async function init(){
  showDebugInfo('🚀 Init başladı...');
  ensureViewport();
  
  const loader = qs('#loader');
  if (loader) loader.removeAttribute('hidden');
  
  try {
    showDebugInfo(`📡 CSV fetch... (Deneme: ${RETRY_COUNT + 1}/${MAX_RETRIES})`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    showDebugInfo(`✅ Response: ${resp.status}`);
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const text = await resp.text();
    showDebugInfo(`📄 CSV: ${text.length} karakter`);
    
    if (!text || text.trim().length < 100) throw new Error("CSV çok kısa/boş");
    if (text.includes('<!DOCTYPE') || text.includes('<html')) throw new Error("HTML dönüyor");
    
    if (typeof Papa === 'undefined') {
      throw new Error("Papa Parse yüklenmemiş! &lt;script src='https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'&gt;&lt;/script&gt; ekleyin");
    }
    
    // CSV yapısını analiz et
    const firstLine = text.split('\n')[0];
    showDebugInfo(`📋 Sütunlar: ${firstLine.substring(0, 100)}...`);
    
    const parsed = Papa.parse(text.trim(), { 
      header: true, 
      skipEmptyLines: true,
      delimiter: ",",
      encoding: "UTF-8"
    });
    
    showDebugInfo(`📊 Satır: ${parsed.data.length}, Hata: ${parsed.errors.length}`);
    
    if (parsed.data.length === 0) throw new Error("CSV'de veri yok");
    
    // İlk satırı incele (debug için)
    if (parsed.data[0]) {
      showDebugInfo(`🔍 İlk satır anahtarları: ${Object.keys(parsed.data[0]).join(', ')}`);
    }
    
    // SÜTUN EŞLEŞTİRME (Esnek)
    DATA = parsed.data.map((row, idx) => {
      const o = {}; 
      
      // Tüm anahtarları küçük harfe çevir ve normalize et
      const normalizedRow = {};
      for (let k in row) {
        if (row.hasOwnProperty(k)) {
          const keyLower = k.toString().trim().toLowerCase()
            .replace(/\s+/g, '')      // Boşlukları kaldır
            .replace(/[ıİ]/g, 'i')     // Türkçe karakterleri normalize et
            .replace(/[şŞ]/g, 's')
            .replace(/[çÇ]/g, 'c')
            .replace(/[ğĞ]/g, 'g')
            .replace(/[üÜ]/g, 'u')
            .replace(/[öÖ]/g, 'o');
          normalizedRow[keyLower] = row[k];
        }
      }
      
      // Ürün adı (esnek eşleştirme)
      o.urun = cleanStr(normalizedRow['urun'] || normalizedRow['hisse'] || normalizedRow['fon'] || normalizedRow['urunadi'] || normalizedRow['isim'] || row[Object.keys(row)[0]]);
      
      // Tür (esnek)
      o.tur = cleanStr(normalizedRow['tur'] || normalizedRow['tip'] || normalizedRow['kategori'] || normalizedRow['grup'] || 'Hisse');
      
      // Tarih (esnek)
      o.tarih = normalizedRow['tarih'] || normalizedRow['alimtarihi'] || normalizedRow['tarihalis'] || '';
      
      // Sayısal alanlar (çok esnek eşleştirme)
      const getNum = (...keys) => {
        for (let key of keys) {
          if (normalizedRow[key] !== undefined && normalizedRow[key] !== '') {
            const val = toNumber(normalizedRow[key]);
            if (val > 0 || val < 0) return val;
          }
        }
        return 0;
      };
      
      o.toplamYatirim = getNum('toplamyatirim', 'maliyet', 'toplam', 'anapara', 'yatirim', 'tutar', 'cost', 'total', 'alisdeger', 'alitutar', 'portfoy');
      o.guncelDeger = getNum('gunceldeger', 'guncel', 'deger', 'fiyat', 'current', 'value', 'price', 'piyasa', 'market');
      o.gunluk = getNum('gunluk', 'daily', '1g', '1gun', 'degisimgunluk');
      o.haftalik = getNum('haftalik', 'weekly', '1h', '1hafta', 'degisimhaftalik');
      o.aylik = getNum('aylik', 'monthly', '1a', '1ay', 'degisimaylik');
      o.ucAylik = getNum('ucaylik', '3aylik', '3ay', 'quarterly', 'degisim3ay');
      o.altiAylik = getNum('altiaylik', '6aylik', '6ay', 'halfyear', 'degisim6ay');
      o.birYillik = getNum('biryillik', '1yillik', '1yil', 'yearly', 'annual', 'degisim1yil');
      
      // Adet (opsiyonel)
      o.adet = getNum('adet', 'lot', 'miktar', 'quantity', 'amount', 'pieces');
      o.alisFiyati = getNum('alisfiyati', 'alisfiyat', 'maliyetfiyat', 'birimmaliyet');
      
      // Debug: İlk 3 satırı detaylı göster
      if (idx < 3) {
        showDebugInfo(`📝 Satır ${idx + 1}: ${o.urun} | Maliyet:${o.toplamYatirim} | Güncel:${o.guncelDeger} | Tür:${o.tur}`);
      }
      
      return o;
    }).filter(x => {
      const valid = x.urun && (x.toplamYatirim > 0 || x.guncelDeger > 0);
      if (!valid && x.urun) {
        showDebugInfo(`⚠️ Filtrelendi: ${x.urun} (Maliyet:${x.toplamYatirim}, Güncel:${x.guncelDeger})`);
      }
      return valid;
    });
    
    showDebugInfo(`✅ İşlenen: ${DATA.length} ürün`);
    
    if (!DATA.length) {
      // CSV yapısını göster
      if (parsed.data[0]) {
        const sample = parsed.data[0];
        const keys = Object.keys(sample);
        showDebugInfo(`❌ Eşleşme yok! CSV sütunları: ${keys.join(', ')}`);
        showDebugInfo(`💡 Beklenen: urun/tur/tarih/toplamsatirim/gunceldeger/...`);
      }
      throw new Error(`Veri bulunamadı. CSV'deki sütun isimlerini kontrol edin.`);
    }
    
    // Başarılı
    RETRY_COUNT = 0;
    ALERTS = lsGet('alerts', {});
    AUTO_REFRESH.lastUpdate = new Date();
    
    ensureUI();
    if (loader) loader.setAttribute('hidden', '');
    
    renderAll();
    MOBILE_OPTIMIZER.init();
    
    if (AUTO_REFRESH.enabled) startAutoRefresh();
    
    showDebugInfo('🎉 Başarılı!');
    showToast(`${DATA.length} ürün yüklendi`, 2000);
    
  } catch(err) {
    console.error('Hata:', err);
    showDebugInfo(`❌ ${err.message}`);
    
    if (RETRY_COUNT < MAX_RETRIES) {
      RETRY_COUNT++;
      showToast(`Hata: ${err.message}. Yeniden deneniyor...`, 3000);
      setTimeout(init, 2000);
    } else {
      if (loader) {
        loader.innerHTML = `
          <div style="color:#ef4444; padding:20px; text-align:center;">
            <div style="font-size:24px; margin-bottom:10px;">⚠️</div>
            <div style="font-size:16px; font-weight:bold; margin-bottom:10px;">Yükleme Başarısız</div>
            <div style="font-size:13px; margin-bottom:15px; color:#fca5a5;">${err.message}</div>
            <div style="font-size:11px; color:#9ca3af; margin-bottom:15px;">
              CSV sütun isimleri şunlardan biri olmalı:<br>
              urun, tur, toplamYatirim, guncelDeger, gunluk, haftalik, aylik...
            </div>
            <button onclick="location.reload()" style="padding:10px 20px; background:#3b82f6; border:none; border-radius:6px; color:white; cursor:pointer;">Yenile</button>
            <button onclick="qs('#debug-panel').style.display='block'" style="margin-left:10px; padding:10px 20px; background:#6b7280; border:none; border-radius:6px; color:white; cursor:pointer;">Debug</button>
          </div>
        `;
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
  }
}

// === AI MODULLERI (Öncekiyle aynı, kısaltıldı) ===
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
        `Risk seviyesi: ${risk.level}`,
        `Çeşitlendirme: ${risk.details.concentration > 0.3 ? 'Tekilleşme riski yüksek' : 'Kabul edilebilir'}`,
        ...trends.filter(t => t.suggestion !== 'İzlemeye devam').map(t => `${t.urun}: ${t.suggestion}`)
      ],
      recommendations: this.generateRecommendations(data, risk, trends)
    };
  },
  generateRecommendations(data, risk, trends) {
    const recs = [];
    if (risk.details.concentration > 0.3) recs.push('En büyük pozisyonunuzu %15\'in altına düşürün');
    const bigLosers = trends.filter(t => {
      const item = data.find(d => d.urun === t.urun);
      return item && (item.guncelDeger - item.toplamYatirim) / item.toplamYatirim < -20;
    });
    if (bigLosers.length > 0) recs.push(`${bigLosers.length} üründe derin zarar var. Stop-loss gözden geçirin.`);
    return recs;
  }
};

const SMART_ANALYZER = {
  analyzePersonality(data) {
    const total = data.reduce((a,b) => a + b.guncelDeger, 0) || 1;
    const byType = {};
    data.forEach(d => { byType[d.tur] = (byType[d.tur] || 0) + d.guncelDeger; });
    const maxType = Object.entries(byType).sort((a,b) => b[1]-a[1])[0] || ['Karışık', 0];
    const personalities = {
      'Hisse': { name: 'Aktif Yatırımcı', desc: 'Yüksek getiri potansiyeli arayan', advice: 'Tek hisse riskine dikkat' },
      'Fon': { name: 'Dengeli Yatırımcı', desc: 'Profesyonel yönetime güvenen', advice: 'Fon maliyetlerini kontrol edin' },
      'Tahvil': { name: 'Korumacı Yatırımcı', desc: 'Anapana korumaya öncelik veren', advice: 'Enflasyona karşı koruma düşünün' },
      'Kripto': { name: 'Spekülatif Yatırımcı', desc: 'Yüksek volatilite tolere eden', advice: 'Kripto oranını %10\'da tutun' }
    };
    return personalities[maxType[0]] || { name: 'Karışık', desc: 'Çeşitlendirilmiş', advice: 'Dağılım dengeli' };
  },
  seasonalAnalysis() {
    const month = new Date().getMonth();
    const seasons = [
      { name: 'Kış', risk: 'Yüksek', advice: 'Yılbaşı rallisi bekleyin' },
      { name: 'İlkbahar', risk: 'Orta', advice: 'Sell in May yaklaşıyor' },
      { name: 'Yaz', risk: 'Düşük', advice: 'Yaz durgunluğu fırsatı' },
      { name: 'Sonbahar', risk: 'Yüksek', advice: 'Eylül volatilitesine hazır olun' }
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
        recommendation: performance > 20 ? 'Kar realizasyonu' : performance < -10 ? 'Maliyet düşürme' : 'Pozisyon koru',
        riskLevel: personality.name.includes('Aktif') ? 'Yüksek' : 'Orta'
      },
      narrative: this.generateNarrative(data, personality, season, performance)
    };
  },
  generateNarrative(data, personality, season, performance) {
    let text = `Portföyünüz ${personality.name} profiline uygun. ${personality.desc}. `;
    text += `${season.name} döneminde piyasa riski ${season.risk}. ${season.advice}. `;
    if (performance > 15) text += `%${performance.toFixed(1)} getiri ile harika performans.`;
    else if (performance > 0) text += `%${performance.toFixed(1)} pozitif getiri.`;
    else text += `%${performance.toFixed(1)} gerileme, sabırlı olun.`;
    return text;
  }
};

const MOBILE_OPTIMIZER = {
  isMobile: () => window.innerWidth <= 640 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
  init() {
    this.addSwipeSupport();
    this.optimizeModal();
    this.addTouchFeedback();
  },
  addSwipeSupport() {
    let touchStartX = 0;
    const typesContainer = qs('#types');
    if (!typesContainer) return;
    typesContainer.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
    typesContainer.addEventListener('touchend', e => {
      const diff = touchStartX - e.changedTouches[0].screenX;
      if (Math.abs(diff) > 50) {
        const types = ['ALL', ...new Set(DATA.map(x => x.tur))];
        const currentIndex = types.indexOf(ACTIVE);
        if (diff > 0 && currentIndex < types.length - 1) { ACTIVE = types[currentIndex + 1]; renderAll(); }
        else if (diff < 0 && currentIndex > 0) { ACTIVE = types[currentIndex - 1]; renderAll(); }
      }
    }, {passive: true});
  },
  optimizeModal() {
    const modal = qs('#modal');
    if (!modal) return;
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        document.body.style.overflow = m.target.classList.contains('active') ? 'hidden' : '';
        document.body.style.position = m.target.classList.contains('active') ? 'fixed' : '';
      });
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  },
  addTouchFeedback() {
    document.addEventListener('touchstart', (e) => {
      const el = e.target.closest('.detail-item, .type-card, .btn');
      if (el) el.style.transform = 'scale(0.98)';
    }, {passive: true});
    document.addEventListener('touchend', (e) => {
      const el = e.target.closest('.detail-item, .type-card, .btn');
      if (el) setTimeout(() => el.style.transform = '', 100);
    }, {passive: true});
  }
};

(function injectStyles(){
  if (qs('#dynamic-styles')) return;
  const css = `
    :root { --mobile-gutter: 12px; --pos: #22c55e; --neg: #ef4444; --accent: #3b82f6; --text: #e5e7eb; --line: rgba(255,255,255,.08); }
    .toolbar{display:grid; gap:8px; padding:8px 16px; margin:10px 0}
    .toolbar .card{padding:12px; display:flex; gap:16px; align-items:center; flex-wrap:wrap}
    .toolbar-group{display:flex; gap:8px; align-items:center}
    .toolbar select{background:rgba(17,24,39,.85); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 10px; font-size:12px;}
    .last-update{font-size:11px; opacity:0.8; color:var(--accent); margin-left:auto; padding:4px 10px; background:rgba(59,130,246,.1); border-radius:6px}
    .modal{position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:200}
    .modal.active{display:flex}
    .modal-backdrop{position:absolute; inset:0; backdrop-filter:blur(8px); background:rgba(8,14,26,.6)}
    .modal-card{position:relative; width:min(720px, 92vw); max-height:90vh; overflow-y:auto; border-radius:14px; padding:14px; z-index:1; background:linear-gradient(145deg, rgba(17,24,39,.95), rgba(14,20,34,.85)); border:1px solid var(--line);}
    .modal-header{display:flex; justify-content:space-between; align-items:center; margin-bottom:10px}
    .modal-title{font-weight:800; font-size:16px}
    .modal-close{cursor:pointer; border:0; background:transparent; color:#cfe2ff; font-size:20px}
    .modal-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
    .stat{border:1px solid var(--line); border-radius:12px; padding:10px; background:rgba(17,24,39,.9)}
    .alert-form{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:10px}
    .alert-form label{font-size:11px; opacity:.7; display:block; margin-bottom:4px}
    .alert-form input{width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); background:rgba(17,24,39,.8); color:var(--text)}
    .modal-actions{display:flex; gap:8px; justify-content:flex-end; margin-top:10px}
    .btn{padding:8px 10px; border-radius:9px; border:1px solid var(--line); background:rgba(17,24,39,.85); color:var(--text); cursor:pointer; transition:all 0.2s}
    .btn.primary{border-color:rgba(59,130,246,.6); box-shadow:0 0 12px rgba(59,130,246,.25)}
    .weight-badge{font-size:11px; opacity:.85; color:#cfe2ff}
    .hold-badge{font-size:10px; background:rgba(245,158,11,.15); color:#f59e0b; padding:2px 8px; border-radius:4px; margin-left:6px}
    .percent-badge{font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px}
    .percent-badge.pos{background:rgba(34,197,94,.2); color:var(--pos)}
    .percent-badge.neg{background:rgba(239,68,68,.2); color:var(--neg)}
    .alert-pulse{animation:alertPulse 1.4s ease-in-out infinite}
    @keyframes alertPulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.35)}70%{box-shadow:0 0 0 12px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
    .kz-table{width:100%; border-collapse:collapse; margin-top:10px; font-size:11px}
    .kz-table th, .kz-table td{padding:6px 4px; text-align:center; border:1px solid var(--line)}
    .kz-table th{background:rgba(59,130,246,.15); font-weight:600; font-size:10px}
    .kz-table .pos{color:var(--pos)} .kz-table .neg{color:var(--neg)}
    .monthly-chart-container{position:relative; width:100%; height:140px; margin-top:10px}
    .monthly-chart{width:100%; height:100%}
    .chart-tooltip{position:absolute; background:rgba(0,0,0,.95); border:1px solid var(--accent); padding:8px 12px; border-radius:8px; font-size:12px; pointer-events:none; opacity:0; transition:opacity .2s; z-index:100; white-space:nowrap}
    .chart-tooltip.visible{opacity:1}
    .chart-legend{display:flex; gap:16px; justify-content:center; margin-top:8px; font-size:11px}
    .ai-panel{margin:16px 0; border:1px solid var(--accent); animation:slideDown 0.3s ease}
    .ai-header{display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid var(--line)}
    .ai-content{padding:16px}
    .ai-summary-grid{display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:16px}
    @keyframes slideDown{from{opacity:0; transform:translateY(-20px)}to{opacity:1; transform:translateY(0)}}
    
    @media (max-width: 640px) {
      .toolbar .card{flex-direction:column; align-items:stretch}
      .toolbar-group{width:100%; justify-content:space-between}
      .last-update{margin-left:0; margin-top:8px; width:100%; text-align:center}
      #summary{display:grid; grid-template-columns:repeat(3, 1fr); gap:8px}
      #types{display:flex; overflow-x:auto; gap:8px; scrollbar-width:none}
      #types::-webkit-scrollbar{display:none}
      #types .card{flex:0 0 auto; min-width:90px}
      #periods{display:grid; grid-template-columns:repeat(2, 1fr); gap:8px}
      #detail-list{display:flex; flex-direction:column; gap:10px}
      .detail-item{display:grid; grid-template-columns:1fr auto; gap:8px; padding:12px; border-radius:12px; background:rgba(17,24,39,.95); border:1px solid var(--line); min-height:80px}
      .detail-info{min-width:0; display:flex; flex-direction:column; justify-content:center}
      .detail-info>div:first-child{font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:6px}
      .detail-values{display:flex; flex-direction:column; align-items:flex-end; justify-content:center; gap:4px; min-width:85px}
      .detail-val{font-size:15px; font-weight:700}
      .modal-grid{grid-template-columns:1fr}
      .alert-form{grid-template-columns:1fr}
      .ai-summary-grid{grid-template-columns:1fr}
    }
  `;
  const style = document.createElement('style'); style.id='dynamic-styles'; style.textContent=css; document.head.appendChild(style);
})();

function ensureUI(){
  if (!qs('.toolbar')){
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
          </select>
        </div>
        <div class="toolbar-group">
          <label>Oto Yenile</label>
          <input id="autoref" type="checkbox">
          <select id="arate"><option value="60000" selected>1 dk</option><option value="300000">5 dk</option></select>
        </div>
        <div class="toolbar-group">
          <button class="btn primary" id="ai-analyze-btn">🤖 AI Analiz</button>
          <span class="last-update" id="last-update">-</span>
        </div>
      </div>`;
    const periodsSection = qs('#periods');
    if (periodsSection && periodsSection.parentNode) {
      periodsSection.parentNode.insertBefore(toolbar, periodsSection.nextSibling);
    }
    qs('#sort-select').onchange = (e)=>{ SORT_KEY = e.target.value; renderAll(); };
    qs('#autoref').onchange = (e)=>{ AUTO_REFRESH.enabled = e.target.checked; AUTO_REFRESH.enabled ? startAutoRefresh() : stopAutoRefresh(); };
    qs('#arate').onchange = (e)=>{ AUTO_REFRESH.ms = +e.target.value; if (AUTO_REFRESH.enabled) startAutoRefresh(); };
    qs('#ai-analyze-btn').onclick = () => renderAIAnalysis(DATA);
  }
  if (!qs('#modal')){
    const modal = document.createElement('div');
    modal.id = 'modal'; modal.className = 'modal';
    modal.innerHTML = `<div class="modal-backdrop"></div><div class="modal-card"><div class="modal-header"><div class="modal-title">Detay</div><button class="modal-close">×</button></div><div class="modal-body"></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e)=>{ if (e.target.classList.contains('modal-backdrop') || e.target.classList.contains('modal-close')) closeModal(); });
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
  const currentMonth = new Date().getMonth();
  const chartData = months.map((m, i) => {
    const monthIndex = (currentMonth - 11 + i + 12) % 12;
    const progress = i / 11;
    const baseValue = data.maliyet || 0;
    const targetValue = data.guncel || 0;
    const value = baseValue + (targetValue - baseValue) * progress;
    return { month: months[monthIndex], value, kz: value - baseValue };
  });
  const values = chartData.map(d => d.value);
  const minValue = Math.min(...values) * 0.98;
  const maxValue = Math.max(...values) * 1.02;
  const valueRange = maxValue - minValue || 1;
  const getX = (i) => pad.left + (i / 11) * chartW;
  const getY = (val) => pad.top + chartH - ((val - minValue) / valueRange) * chartH;
  
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  chartData.forEach((d, i) => i === 0 ? ctx.moveTo(getX(i), getY(d.value)) : ctx.lineTo(getX(i), getY(d.value)));
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
  chartData.forEach((d, i) => i === 0 ? ctx.moveTo(getX(i), getY(d.value)) : ctx.lineTo(getX(i), getY(d.value)));
  ctx.stroke();
  
  chartData.forEach((d, i) => {
    ctx.beginPath();
    ctx.arc(getX(i), getY(d.value), 5, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1220';
    ctx.fill();
    ctx.strokeStyle = 'rgba(59,130,246,1)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.month, getX(i), h - 10);
  });
}

function openModal(item){
  const modal = qs('#modal');
  const body = modal.querySelector('.modal-body');
  const portSum = sum(DATA, 'guncelDeger');
  const kz = item.guncelDeger - item.toplamYatirim;
  const weight = portSum ? ((item.guncelDeger/portSum)*100).toFixed(1) : 0;
  const alerts = ALERTS[item.urun] || {};
  const holdText = formatHoldTime(calculateHoldDays(item.tarih));
  const adet = item.adet || 1;
  const birimMaliyet = item.toplamYatirim / adet;
  const birimGuncel = item.guncelDeger / adet;

  body.innerHTML = `
    <div class="modal-grid">
      <div class="stat">
        <div class="small">Ürün</div>
        <div class="big" style="font-size:16px">${item.urun}</div>
        <div class="small" style="margin-top:6px">Tür: ${item.tur} · Ağırlık: <b>${weight}%</b> <span class="hold-badge">⏱ ${holdText}</span></div>
      </div>
      <div class="stat">
        <div class="small">Değerler</div>
        <div class="big">Güncel: ${formatTRY(item.guncelDeger)}</div>
        <div class="big">Maliyet: ${formatTRY(item.toplamYatirim)}</div>
        <div class="big ${kz>=0?'pos':'neg'}">K/Z: ${formatTRY(kz)}</div>
      </div>
      <div class="stat" style="grid-column:1/-1">
        <div class="small">📊 Birim Bilgileri</div>
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; margin-top:8px; font-size:12px">
          <div style="text-align:center; padding:8px; background:rgba(59,130,246,.1); border-radius:8px"><div style="opacity:.7; font-size:10px">Adet</div><div style="font-weight:700">${adet.toLocaleString('tr-TR')}</div></div>
          <div style="text-align:center; padding:8px; background:rgba(59,130,246,.1); border-radius:8px"><div style="opacity:.7; font-size:10px">Ort.Maliyet</div><div style="font-weight:700">${formatTRY(birimMaliyet)}</div></div>
          <div style="text-align:center; padding:8px; background:rgba(34,197,94,.1); border-radius:8px"><div style="opacity:.7; font-size:10px">Güncel Fiyat</div><div style="font-weight:700; color:var(--pos)">${formatTRY(birimGuncel)}</div></div>
          <div style="text-align:center; padding:8px; background:${kz>=0?'rgba(34,197,94,.1)':'rgba(239,68,68,.1)'}; border-radius:8px"><div style="opacity:.7; font-size:10px">Birim K/Z</div><div style="font-weight:700; color:${kz>=0?'var(--pos)':'var(--neg)'}">${formatTRY(birimGuncel-birimMaliyet)}</div></div>
        </div>
      </div>
      <div class="stat" style="grid-column:1/-1">
        <div class="small">📈 Dönemsel K/Z</div>
        <table class="kz-table"><thead><tr><th>Dönem</th><th>Değişim</th><th>K/Z</th><th>Getiri</th></tr></thead><tbody>${generateKzRows(item)}</tbody></table>
      </div>
      <div class="stat" style="grid-column:1/-1">
        <div class="small">📊 Aylık Performans</div>
        <div class="monthly-chart-container"><canvas class="monthly-chart" id="month-chart"></canvas><div class="chart-tooltip" id="chart-tooltip"></div></div>
      </div>
      <div class="stat" style="grid-column:1/-1">
        <div class="small">Uyarılar</div>
        <div class="alert-form">
          <div><label>Güncel ≥</label><input id="al-guncel" type="number" value="${alerts.guncel ?? ''}"></div>
          <div><label>K/Z ≥</label><input id="al-kz" type="number" value="${alerts.kz ?? ''}"></div>
          <div><label>Günlük % ≥</label><input id="al-dp" type="number" step="0.1" value="${alerts.dailyPerc ?? ''}"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="al-remove">Sil</button>
          <button class="btn primary" id="al-save">Kaydet</button>
        </div>
      </div>
    </div>`;
  
  setTimeout(() => drawMonthlyChart(qs('#month-chart'), {maliyet: item.toplamYatirim, guncel: item.guncelDeger}, qs('#chart-tooltip')), 100);
  
  body.querySelector('#al-save').onclick = ()=>{
    ALERTS[item.urun] = {
      guncel: toNumber(qs('#al-guncel', body)?.value) || null,
      kz: toNumber(qs('#al-kz', body)?.value) || null,
      dailyPerc: parseFloat(qs('#al-dp', body)?.value) || null
    };
    lsSet('alerts', ALERTS);
    showToast('Kaydedildi');
  };
  body.querySelector('#al-remove').onclick = ()=>{ delete ALERTS[item.urun]; lsSet('alerts', ALERTS); showToast('Silindi'); };
  modal.classList.add('active');
}

function generateKzRows(item) {
  const periods = [['Günlük','gunluk'],['Haftalık','haftalik'],['Aylık','aylik'],['3 Aylık','ucAylik'],['6 Aylık','altiAylik'],['1 Yıllık','birYillik']];
  let rows = '';
  periods.forEach(([label, key]) => {
    const change = item[key] || 0;
    const kz = item.guncelDeger - item.toplamYatirim;
    const getiri = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100) : 0;
    rows += `<tr><td><strong>${label}</strong></td><td class="${change>=0?'pos':'neg'}">${change>=0?'+':''}${formatTRY(change)}</td><td class="${kz>=0?'pos':'neg'}">${formatTRY(kz)}</td><td class="${getiri>=0?'pos':'neg'}">${getiri>=0?'+':''}${getiri.toFixed(1)}%</td></tr>`;
  });
  return rows;
}

function closeModal(){ qs('#modal')?.classList.remove('active'); }

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
}

function renderSummary(d){
  const t = sum(d, 'toplamYatirim'), g = sum(d,'guncelDeger'), kz = g - t; 
  const p = t?((kz/t)*100).toFixed(1):0;
  qs('#summary').innerHTML = `
    <div class="card"><div class="small">Maliyet</div><div class="big">${formatTRY(t)}</div></div>
    <div class="card"><div class="small">Güncel</div><div class="big">${formatTRY(g)}</div></div>
    <div class="card ${kz>=0?'pos':'neg'}"><div class="small">K/Z</div><div class="big">${kz>=0?'+':''}${p}%</div><div class="small" style="font-size:11px;margin-top:4px;">${formatTRY(kz)}</div></div>`;
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
  }[SORT_KEY];
  if (cmp) out.sort(cmp);
  return out;
}

function renderDetails(d){
  const list = qs('#detail-list');
  const portSum = sum(DATA, 'guncelDeger');
  const applied = applySortAndFilter(d);
  const isMobile = window.innerWidth <= 640;
  
  qs('#detail-title').textContent = ACTIVE==='ALL' ? '📦 TÜM ÜRÜNLER' : `📦 ${ACTIVE.toUpperCase()}`;
  
  let h='';
  applied.forEach((item, idx)=>{
    const kz = item.guncelDeger - item.toplamYatirim; 
    const weight = portSum?((item.guncelDeger/portSum)*100).toFixed(1):0;
    const percent = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100).toFixed(1) : 0;
    const adet = item.adet || 1;
    const birimFiyat = item.guncelDeger / adet;
    const holdText = formatHoldTime(calculateHoldDays(item.tarih));
    
    if (isMobile) {
      h += `
        <div class="detail-item" data-idx="${idx}" data-urun="${item.urun}">
          <div class="detail-info">
            <div title="${item.urun}">${item.urun.length > 18 ? item.urun.substring(0, 18) + '...' : item.urun}<span class="weight-badge">%${weight}</span></div>
            <div><span>💰 ${formatTRY(item.toplamYatirim)}</span><span>📦 ${adet.toLocaleString('tr-TR')}</span></div>
            <div>${formatTRY(birimFiyat)} ${holdText !== 'Bilinmiyor' ? `• ⏱ ${holdText}` : ''}</div>
          </div>
          <div class="detail-values">
            <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
            <div class="detail-perc ${kz>=0?'pos':'neg'}"><span>${kz>=0?'+':''}${formatTRY(kz)}</span><span class="percent-badge ${kz>=0?'pos':'neg'}">%${percent}</span></div>
          </div>
        </div>`;
    } else {
      h += `
        <div class="detail-item" data-idx="${idx}" data-urun="${item.urun}">
          <div class="detail-info">
            <div>${item.urun}<span class="weight-badge">· %${weight}</span></div>
            <div>Maliyet: ${formatTRY(item.toplamYatirim)} · Adet: ${adet.toLocaleString('tr-TR')}</div>
            <div style="font-size:10px; opacity:0.7; margin-top:2px">Birim: ${formatTRY(birimFiyat)} ${holdText !== 'Bilinmiyor' ? `• ⏱ ${holdText}` : ''}</div>
          </div>
          <div class="detail-values">
            <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
            <div class="detail-perc ${kz>=0?'pos':'neg'}">${formatTRY(kz)}<span class="percent-badge ${kz>=0?'pos':'neg'}">${percent}%</span></div>
          </div>
        </div>`;
    }
  });
  
  list.innerHTML = h;
  qsa('.detail-item', list).forEach(el=> el.onclick = ()=>{
    const item = applied.find(x=>x.urun===el.dataset.urun);
    if (item) openModal(item);
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
          <div style="font-size:11px; opacity:0.7">${new Date().toLocaleTimeString('tr-TR')}</div>
        </div>
      </div>
      <button class="btn" onclick="this.closest('.ai-panel').remove()" style="font-size:18px; padding:4px 8px">×</button>
    </div>
    <div class="ai-content">
      <div style="background:linear-gradient(135deg, rgba(59,130,246,.2), rgba(147,51,234,.2)); padding:16px; border-radius:12px; margin-bottom:16px">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <div style="font-size:12px; opacity:0.8">Profil</div>
          <div style="font-size:11px; background:rgba(255,255,255,.1); padding:4px 8px; border-radius:4px">${report.personality.name}</div>
        </div>
        <div style="font-size:13px; line-height:1.5">${report.personality.desc}</div>
        <div style="margin-top:8px; font-size:11px; color:var(--accent-2)">💡 ${report.personality.advice}</div>
      </div>
      <div style="background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.3); padding:12px; border-radius:8px; margin-bottom:16px; display:flex; align-items:center; gap:10px">
        <span style="font-size:20px">🗓️</span>
        <div>
          <div style="font-weight:600; font-size:12px; color:#fbbf24">${report.season.name}</div>
          <div style="font-size:11px; margin-top:2px">${report.season.advice}</div>
        </div>
      </div>
      <div style="background:rgba(17,24,39,.8); padding:16px; border-radius:12px; margin-bottom:16px; border-left:3px solid ${report.summary.performance > 0 ? '#22c55e' : '#ef4444'}">
        <div style="font-size:13px; line-height:1.6; font-style:italic">"${report.narrative}"</div>
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
          <div style="font-size:11px; font-weight:600; color:var(--accent-2)">${report.summary.recommendation}</div>
        </div>
      </div>
    </div>`;
  const toolbar = qs('.toolbar');
  if (toolbar && toolbar.parentNode) toolbar.parentNode.insertBefore(div, toolbar);
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
  requestAnimationFrame(()=> items.forEach(it=> it.style.display = it.textContent.toLowerCase().includes(q) ? '' : 'none'));
});

function checkAlerts(){
  qsa('.detail-item').forEach(el=> el.classList.remove('alert-pulse'));
  DATA.forEach(item=>{
    const a = ALERTS[item.urun]; if (!a) return;
    const kz = item.guncelDeger - item.toplamYatirim;
    const dailyPerc = (item.guncelDeger - (item.gunluk || 0)) ? ((item.gunluk || 0) / (item.guncelDeger - (item.gunluk || 0)))*100 : 0;
    let hit = (a.guncel && item.guncelDeger >= a.guncel) || (a.kz && kz >= a.kz) || (a.dailyPerc && dailyPerc >= a.dailyPerc);
    if (hit){
      const el = qsa('.detail-item').find(n=> n.dataset.urun===item.urun);
      if (el) el.classList.add('alert-pulse');
    }
  });
}

function startAutoRefresh(){ 
  stopAutoRefresh(); 
  AUTO_REFRESH.timer = setInterval(async()=>{
    try{ 
      const resp = await fetch(`${CSV_URL}&cache=${Date.now()}`); 
      const text = await resp.text(); 
      const parsed = Papa.parse(text.trim(), { header:true, skipEmptyLines:true });
      DATA = parsed.data.map(row=>{
        const o={};
        for(let k in row){
          const kl=k.toString().trim().toLowerCase().replace(/\s+/g,'');
          if(kl==='urun'||kl==='tur')o[kl]=cleanStr(row[k]);
          else if(kl==='tarih')o.tarih=row[k]?.toString().trim()||'';
          else o[kl]=toNumber(row[k]);
        }
        return o;
      }).filter(x=>x.urun&&(x.toplamyatirim>0||x.gunceldeger>0));
      AUTO_REFRESH.lastUpdate = new Date();
      CACHE={}; renderAll(); showToast('Yenilendi');
    }catch(e){console.warn('Yenileme hatası',e);}
  }, AUTO_REFRESH.ms); 
}

function stopAutoRefresh(){ if(AUTO_REFRESH.timer){clearInterval(AUTO_REFRESH.timer);AUTO_REFRESH.timer=null;} }

// Başlat
document.addEventListener('DOMContentLoaded', init);
