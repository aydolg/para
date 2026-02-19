/*
  Portföy Terminali Pro Max · app.js (Güncellenmiş)
  Değişiklikler:
  1. Modal K/Z tablosundan "Dönem Sonu" sütunu kaldırıldı
  2. Ticker günlük değişimleri gösteriyor (CSV'den)
  3. Grafik: 12 aylık boş interpolasyon yerine 6 dönem performans barları (gerçek veri)
  4. Tüm tablo verileri CSV'den çekiliyor, hesaplama yok
*/

const PortfolioApp = (() => {
  'use strict';

  const CONFIG = {
    CSV_URL: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLPFVZn0j8Ygu914QDGRCGKsVy88gWjdk7DFi-jWiydmqYsdGUE4hEAb-R_IBzQmtFZwoMJFcN6rlD/pub?gid=1050165900&single=true&output=csv",
    PERIODS: [
      { key: 'gunluk', label: 'Günlük', icon: '📅' },
      { key: 'haftalik', label: 'Haftalık', icon: '📆' },
      { key: 'aylik', label: 'Aylık', icon: '🗓️' },
      { key: 'ucAylik', label: '3 Ay', icon: '📊' },
      { key: 'altiAylik', label: '6 Ay', icon: '📈' },
      { key: 'birYillik', label: '1 Yıl', icon: '🎯' }
    ]
  };

  const state = {
    data: [],
    activeFilter: "ALL",
    cache: {},
    alerts: {},
    sortKey: "default",
    autoRefresh: { enabled: false, ms: 60000, timer: null, lastUpdate: null }
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cleanStr = (s) => s ? s.toString().trim() : "";

  const toNumber = (v) => {
    if (!v) return 0;
    const n = parseFloat(v.toString().replace(/[^\d,\.-]/g, "").replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  };

  const formatTRY = (n) => {
    const num = Number(n);
    return isNaN(num) ? "0 ₺" : num.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
  };

  const sum = (arr, key) => arr.reduce((a, b) => a + (b[key] || 0), 0);

  const storage = {
    get: (key, def) => { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
    set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { } }
  };

  const getHoldTime = (tarihStr) => {
    if (!tarihStr) return null;
    const parts = tarihStr.trim().split('.');
    if (parts.length !== 3) return null;
    const [g, a, y] = parts.map(Number);
    if ([g, a, y].some(isNaN)) return null;
    
    const alim = new Date(y, a - 1, g);
    const bugun = new Date();
    const fark = Math.floor((new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate()) - 
                            new Date(alim.getFullYear(), alim.getMonth(), alim.getDate())) / (1000 * 60 * 60 * 24));
    if (fark < 0) return null;
    
    if (fark < 30) return `${fark} gün`;
    if (fark < 365) return `${Math.floor(fark / 30)} ay ${fark % 30} gün`;
    const yil = Math.floor(fark / 365);
    const ay = Math.floor((fark % 365) / 30);
    return `${yil} yıl ${ay} ay`;
  };

  // === AI ANALIZ (Birleştirilmiş) ===
  const Analyzer = {
    calculateRisk(data) {
      const vols = data.map(d => Math.abs(d.gunluk || 0) / (d.guncelDeger || 1) * 100);
      const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length || 0;
      const total = data.reduce((a, b) => a + b.guncelDeger, 0) || 1;
      const concentration = data.map(d => d.guncelDeger / total).reduce((a, w) => a + (w * w), 0);
      
      return {
        score: Math.min(100, (avgVol * 2 + concentration * 30)),
        level: avgVol > 5 ? 'Yüksek' : avgVol > 2 ? 'Orta' : 'Düşük',
        volatility: avgVol.toFixed(2),
        concentration: concentration.toFixed(2)
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
        
        return { urun: item.urun, trend, momentum, suggestion, kzPct };
      });
    },

    getPersonality(data) {
      const byType = {};
      data.forEach(d => byType[d.tur] = (byType[d.tur] || 0) + d.guncelDeger);
      const maxType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Karışık';
      
      const profiles = {
        'Hisse': { name: 'Aktif Yatırımcı', desc: 'Yüksek getiri potansiyeli arayan, risk toleransı yüksek', advice: 'Tek hisse riskine dikkat' },
        'Fon': { name: 'Dengeli Yatırımcı', desc: 'Profesyonel yönetime güvenen, orta risk', advice: 'Fon maliyetlerini kontrol edin' },
        'Tahvil': { name: 'Korumacı Yatırımcı', desc: 'Anapana korumaya öncelik veren, düşük risk', advice: 'Enflasyona karşı korunma düşünün' },
        'Kripto': { name: 'Spekülatif Yatırımcı', desc: 'Yüksek volatilite tolere eden, büyüme odaklı', advice: 'Kripto oranını %10\'da tutun' }
      };
      
      return profiles[maxType] || { name: 'Karışık', desc: 'Çeşitlendirilmiş portföy', advice: 'Dağılım dengeli görünüyor' };
    },

    generateReport(data) {
      const totalValue = sum(data, 'guncelDeger');
      const totalCost = sum(data, 'toplamYatirim');
      const totalKz = totalValue - totalCost;
      const risk = this.calculateRisk(data);
      const trends = this.analyzeTrends(data);
      const personality = this.getPersonality(data);
      const winners = data.filter(d => d.guncelDeger > d.toplamYatirim).length;
      
      const performance = totalCost ? (totalKz / totalCost) * 100 : 0;
      const seasonIdx = Math.floor(new Date().getMonth() / 3);
      const seasons = [
        { name: 'Kış', advice: 'Yılbaşı rallisi bekleyebilirsiniz' },
        { name: 'İlkbahar', advice: 'Sell in May yaklaşıyor, dikkatli olun' },
        { name: 'Yaz', advice: 'Yaz durgunluğu, alım fırsatı olabilir' },
        { name: 'Sonbahar', advice: 'Eylül volatilitesine hazırlıklı olun' }
      ];

      return {
        summary: {
          totalValue: formatTRY(totalValue),
          totalKz: formatTRY(totalKz),
          kzPercent: performance.toFixed(1),
          riskLevel: risk.level,
          diversification: risk.concentration > 0.3 ? 'Zayıf' : risk.concentration > 0.2 ? 'Orta' : 'İyi'
        },
        insights: [
          `Portföyünüzde ${winners} kazançlı, ${data.length - winners} zararlı pozisyon var.`,
          `Risk seviyesi: ${risk.level} (Volatilite: %${risk.volatility})`,
          `Çeşitlendirme: ${risk.concentration > 0.3 ? 'Tekilleşme riski yüksek' : 'Kabul edilebilir'}`,
          ...trends.filter(t => t.suggestion !== 'İzlemeye devam').map(t => `${t.urun}: ${t.suggestion}`)
        ],
        recommendations: this.getRecommendations(data, risk, trends, totalKz, totalCost),
        personality,
        season: seasons[seasonIdx],
        performance,
        narrative: this.generateNarrative(data, personality, seasons[seasonIdx], performance)
      };
    },

    getRecommendations(data, risk, trends, totalKz, totalCost) {
      const recs = [];
      if (risk.concentration > 0.3) recs.push('En büyük pozisyonu %15 altına düşürün');
      
      const bigLosers = trends.filter(t => t.kzPct < -20);
      if (bigLosers.length > 0) recs.push(`${bigLosers.length} üründe derin zarar var`);
      if (totalKz > totalCost * 0.3) recs.push('Kar realizasyonu fırsatı');
      
      return recs;
    },

    generateNarrative(data, personality, season, performance) {
      let text = `Portföyünüz ${personality.name} profiline uygun. ${personality.desc}. `;
      text += `Mevcut ${season.name} döneminde ${season.advice}. `;
      
      if (performance > 15) text += `%${performance.toFixed(1)} getiri ile harika performans. ${personality.advice}`;
      else if (performance > 0) text += `%${performance.toFixed(1)} pozitif getiri elde ettiniz. Sabırlı olun.`;
      else text += `%${performance.toFixed(1)} gerileme yaşanıyor. Panik yapmayın, uzun vade önemli.`;
      
      const types = [...new Set(data.map(d => d.tur))].length;
      if (types < 3) text += ` Sadece ${types} türde yatırım var, çeşitlendirme artırılabilir.`;
      
      return text;
    }
  };

  // === MOBIL OPTIMIZASYON ===
  const Mobile = {
    isMobile: () => window.innerWidth <= 640 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    
    init() {
      this.addSwipeSupport();
      this.addTouchFeedback();
    },

    addSwipeSupport() {
      let touchStartX = 0;
      const typesContainer = $('#types');
      if (!typesContainer) return;

      typesContainer.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });

      typesContainer.addEventListener('touchend', e => {
        const diff = touchStartX - e.changedTouches[0].screenX;
        if (Math.abs(diff) < 50) return;
        
        const typeList = ['ALL', ...new Set(state.data.map(x => x.tur))];
        const currentIdx = typeList.indexOf(state.activeFilter);
        
        if (diff > 0 && currentIdx < typeList.length - 1) {
          state.activeFilter = typeList[currentIdx + 1];
        } else if (diff < 0 && currentIdx > 0) {
          state.activeFilter = typeList[currentIdx - 1];
        }
        renderAll();
      }, { passive: true });
    },

    addTouchFeedback() {
      const addFeedback = (e) => {
        const el = e.target.closest('.detail-item, .type-card, .btn');
        if (el) {
          el.style.transition = 'transform 0.1s ease';
          el.style.transform = 'scale(0.98)';
        }
      };

      const removeFeedback = (e) => {
        const el = e.target.closest('.detail-item, .type-card, .btn');
        if (el) {
          el.style.transform = '';
          setTimeout(() => el.style.transition = '', 100);
        }
      };

      document.addEventListener('touchstart', addFeedback, { passive: true });
      document.addEventListener('touchend', removeFeedback, { passive: true });
      document.addEventListener('touchcancel', removeFeedback, { passive: true });
    }
  };

  // === UI RENDER ===
  const UI = {
    showToast(msg, duration = 2500) {
      const t = $('#toast');
      if (!t) return;
      t.textContent = msg;
      t.hidden = false;
      setTimeout(() => t.hidden = true, duration);
    },

    // 4️⃣ TICKER: Günlük değişimleri gösteriyor (CSV'den)
    updateTicker() {
      const ticker = $('#ticker-content');
      if (!ticker || !state.data.length) return;

      // Her ürün için günlük değişim (CSV'den gelen gunluk değeri)
      const items = state.data.map(item => {
        const change = item.gunluk || 0;
        const changePct = item.guncelDeger ? ((change / (item.guncelDeger - change)) * 100).toFixed(2) : 0;
        const isPositive = change >= 0;
        
        return `
          <div class="ticker-item">
            <span>${item.urun}</span>
            <span class="change ${isPositive ? 'pos' : 'neg'}">
              ${isPositive ? '▲' : '▼'} ${formatTRY(change)} (${isPositive ? '+' : ''}${changePct}%)
            </span>
          </div>
        `;
      }).join('');

      // Toplam portföy günlük değişimi
      const totalChange = sum(state.data, 'gunluk');
      const totalCurrent = sum(state.data, 'guncelDeger');
      const totalPrev = totalCurrent - totalChange;
      const totalChangePct = totalPrev ? ((totalChange / totalPrev) * 100).toFixed(2) : 0;
      const totalPositive = totalChange >= 0;

      const totalItem = `
        <div class="ticker-item highlight">
          <span>📊 PORTFÖY</span>
          <span class="change ${totalPositive ? 'pos' : 'neg'}">
            ${totalPositive ? '▲' : '▼'} ${formatTRY(totalChange)} (${totalPositive ? '+' : ''}${totalChangePct}%)
          </span>
        </div>
      `;

      // Sonsuz döngü için duplicate
      ticker.innerHTML = items + totalItem + items + totalItem;
    },

    renderSummary(data) {
      const t = sum(data, 'toplamYatirim'), g = sum(data, 'guncelDeger'), kz = g - t;
      const p = t ? ((kz / t) * 100).toFixed(1) : 0;
      
      $('#summary').innerHTML = `
        <div class="card"><div class="small">Maliyet</div><div class="big">${formatTRY(t)}</div></div>
        <div class="card"><div class="small">Güncel</div><div class="big">${formatTRY(g)}</div></div>
        <div class="card ${kz >= 0 ? 'pos' : 'neg'}">
          <div class="small">Toplam K/Z</div>
          <div class="big">${kz >= 0 ? '+' : ''}${p}%</div>
          <div class="small" style="font-size: 10px; margin-top: 4px;">${formatTRY(kz)}</div>
        </div>
      `;
    },

    renderTypes() {
      const types = [...new Set(state.data.map(x => x.tur))];
      let html = `<div class="card type-card ${state.activeFilter === 'ALL' ? 'active' : ''}" data-type="ALL"><div class="small">GENEL</div><div class="big">HEPSİ</div></div>`;
      
      types.forEach(type => {
        const subset = state.data.filter(x => x.tur === type);
        const kz = sum(subset, 'guncelDeger') - sum(subset, 'toplamYatirim');
        html += `<div class="card type-card ${state.activeFilter === type ? 'active' : ''}" data-type="${type}"><div class="small">${type.toUpperCase()}</div><div class="big ${kz >= 0 ? 'pos' : 'neg'}" style="font-size: 11px">${formatTRY(kz)}</div></div>`;
      });
      
      $('#types').innerHTML = html;
      $$('.type-card').forEach(el => el.onclick = () => { state.activeFilter = el.dataset.type; renderAll(); });
    },

    renderPeriods(data) {
      const current = sum(data, 'guncelDeger');
      
      $('#periods').innerHTML = CONFIG.PERIODS.map(({ key, label }) => {
        const change = sum(data, key);
        const prev = current - change;
        const pct = prev ? ((change / prev) * 100).toFixed(1) : 0;
        return `<div class="card ${change >= 0 ? 'pos' : 'neg'}"><div class="small">${label}</div><div class="big">${formatTRY(change)} <span style="font-size: 10px; opacity: 0.8;">(${change >= 0 ? '+' : ''}${pct}%)</span></div></div>`;
      }).join('');
    },

    renderDetails(data) {
      const list = $('#detail-list');
      const portSum = sum(state.data, 'guncelDeger');
      const isMobile = window.innerWidth <= 640;
      
      const sorted = [...data].sort((a, b) => {
        const cmp = {
          'kzDesc': (x, y) => (y.guncelDeger - y.toplamYatirim) - (x.guncelDeger - x.toplamYatirim),
          'kzAsc': (x, y) => (x.guncelDeger - x.toplamYatirim) - (y.guncelDeger - y.toplamYatirim),
          'maliyetDesc': (x, y) => y.toplamYatirim - x.toplamYatirim,
          'guncelDesc': (x, y) => y.guncelDeger - x.guncelDeger,
          'nameAZ': (x, y) => x.urun.localeCompare(y.urun, 'tr'),
          'nameZA': (x, y) => y.urun.localeCompare(x.urun, 'tr')
        }[state.sortKey];
        return cmp ? cmp(a, b) : 0;
      });

      $('#detail-title').textContent = state.activeFilter === 'ALL' ? '📦 TÜM ÜRÜNLER' : `📦 ${state.activeFilter.toUpperCase()}`;

      list.innerHTML = sorted.map(item => {
        const kz = item.guncelDeger - item.toplamYatirim;
        const weight = portSum ? ((item.guncelDeger / portSum) * 100).toFixed(1) : 0;
        const pct = item.toplamYatirim ? ((kz / item.toplamYatirim) * 100).toFixed(1) : 0;
        const adet = item.adet || 1;
        const unitPrice = item.guncelDeger / adet;
        const holdTime = getHoldTime(item.tarih);
        const dailyChange = item.gunluk || 0;

        if (isMobile) {
          return `
            <div class="detail-item" data-urun="${item.urun}">
              <div class="detail-info">
                <div title="${item.urun}">${item.urun.length > 18 ? item.urun.substring(0, 18) + '...' : item.urun} <span class="weight-badge">%${weight}</span></div>
                <div>
                  <span>💰 ${formatTRY(item.toplamYatirim)}</span>
                  <span>📦 ${adet.toLocaleString('tr-TR')}</span>
                  ${holdTime ? `<span>⏱ ${holdTime}</span>` : ''}
                </div>
                <div style="font-size: 10px; opacity: 0.6;">
                  Birim: ${formatTRY(unitPrice)} | 
                  <span class="${dailyChange >= 0 ? 'pos' : 'neg'}">Günlük: ${dailyChange >= 0 ? '+' : ''}${formatTRY(dailyChange)}</span>
                </div>
              </div>
              <div class="detail-values">
                <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
                <div class="detail-perc ${kz >= 0 ? 'pos' : 'neg'}">
                  <span>${kz >= 0 ? '+' : ''}${formatTRY(kz)}</span>
                  <span class="percent-badge ${kz >= 0 ? 'pos' : 'neg'}">%${pct}</span>
                </div>
              </div>
            </div>
          `;
        }
        
        return `
          <div class="detail-item" data-urun="${item.urun}">
            <div class="detail-info">
              <div>${item.urun} <span class="weight-badge">· %${weight}</span></div>
              <div>Maliyet: ${formatTRY(item.toplamYatirim)} · Adet: ${adet.toLocaleString('tr-TR')}</div>
              <div style="font-size: 10px; opacity: 0.7; margin-top: 2px;">
                Birim: ${formatTRY(unitPrice)} · <span class="${dailyChange >= 0 ? 'pos' : 'neg'}">Gün: ${dailyChange >= 0 ? '+' : ''}${formatTRY(dailyChange)}</span>
                ${holdTime ? ` · <span class="hold-badge">⏱ ${holdTime}</span>` : ''}
              </div>
            </div>
            <div class="detail-values">
              <div class="detail-val">${formatTRY(item.guncelDeger)}</div>
              <div class="detail-perc ${kz >= 0 ? 'pos' : 'neg'}">${formatTRY(kz)}<span class="percent-badge ${kz >= 0 ? 'pos' : 'neg'}">${pct}%</span></div>
            </div>
          </div>
        `;
      }).join('');

      $$('.detail-item', list).forEach(el => {
        el.onclick = () => {
          const item = sorted.find(x => x.urun === el.dataset.urun);
          if (item) Modal.open(item);
        };
      });
    },

    renderAIAnalysis() {
      const existing = $('.ai-panel');
      if (existing) existing.remove();

      const report = Analyzer.generateReport(state.data);
      
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
              <div style="font-size: 18px; font-weight: 700; color: ${report.summary.kzPercent >= 0 ? 'var(--pos)' : 'var(--neg)'};">%${report.summary.kzPercent}</div>
              <div style="font-size: 11px;">${report.summary.totalKz}</div>
            </div>
            <div class="ai-metric">
              <div style="font-size: 10px; opacity: 0.7;">Risk Seviyesi</div>
              <div style="font-size: 16px; font-weight: 700; color: ${report.summary.riskLevel === 'Yüksek' ? '#ef4444' : report.summary.riskLevel === 'Orta' ? '#f59e0b' : '#22c55e'};">${report.summary.riskLevel}</div>
            </div>
            <div class="ai-metric">
              <div style="font-size: 10px; opacity: 0.7;">Çeşitlendirme</div>
              <div style="font-size: 16px; font-weight: 700; color: ${report.summary.diversification === 'Zayıf' ? '#ef4444' : report.summary.diversification === 'Orta' ? '#f59e0b' : '#22c55e'};">${report.summary.diversification}</div>
            </div>
          </div>
          
          <div style="background: linear-gradient(135deg, rgba(59,130,246,.2), rgba(147,51,234,.2)); padding: 16px; border-radius: 12px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="font-size: 12px; opacity: 0.8;">Yatırımcı Profili</div>
              <div style="font-size: 11px; background: rgba(255,255,255,.1); padding: 4px 8px; border-radius: 4px;">${report.personality.name}</div>
            </div>
            <div style="font-size: 13px; line-height: 1.5;">${report.personality.desc}</div>
            <div style="margin-top: 8px; font-size: 11px; color: var(--accent-2);">💡 ${report.personality.advice}</div>
          </div>
          
          <div style="background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.3); padding: 12px; border-radius: 8px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 20px;">🗓️</span>
            <div>
              <div style="font-weight: 600; font-size: 12px; color: #fbbf24;">${report.season.name} Dönemi</div>
              <div style="font-size: 11px; margin-top: 2px;">${report.season.advice}</div>
            </div>
          </div>
          
          <div style="background: rgba(17,24,39,.8); padding: 16px; border-radius: 12px; margin-bottom: 16px; border-left: 3px solid ${report.performance > 0 ? '#22c55e' : '#ef4444'};">
            <div style="font-size: 13px; line-height: 1.6; font-style: italic;">"${report.narrative}"</div>
          </div>
          
          <div class="ai-insights">
            <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">📊 Değerlendirmeler</div>
            ${report.insights.map(i => `<div class="insight-item"><span style="color: var(--accent);">▸</span> ${i}</div>`).join('')}
          </div>
          
          ${report.recommendations.length ? `
            <div class="ai-recommendations">
              <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">💡 AI Önerileri</div>
              ${report.recommendations.map(r => `<div class="rec-item"><span>💡</span><span>${r}</span></div>`).join('')}
            </div>
          ` : ''}
        </div>
      `;

      const toolbar = $('.toolbar');
      if (toolbar?.parentNode) {
        toolbar.parentNode.insertBefore(div, toolbar.nextSibling);
      }
    },

    checkAlerts() {
      $$('.detail-item').forEach(el => el.classList.remove('alert-pulse'));
      
      state.data.forEach(item => {
        const alert = state.alerts[item.urun];
        if (!alert) return;

        const kz = item.guncelDeger - item.toplamYatirim;
        const prevValue = item.guncelDeger - (item.gunluk || 0);
        const dailyPct = prevValue ? ((item.gunluk || 0) / prevValue) * 100 : 0;

        const hit = (alert.guncel && item.guncelDeger >= alert.guncel) ||
                    (alert.kz && kz >= alert.kz) ||
                    (alert.dailyPerc && Math.abs(dailyPct) >= alert.dailyPerc);

        if (hit) {
          const el = Array.from($$('.detail-item')).find(n => n.dataset.urun === item.urun);
          if (el) el.classList.add('alert-pulse');
        }
      });
    },

    updateLastUpdate() {
      const el = $('#last-update');
      if (el && state.autoRefresh.lastUpdate) {
        el.textContent = `Son: ${new Date(state.autoRefresh.lastUpdate).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
      }
    }
  };

  // === MODAL (Güncellenmiş: 1️⃣ Dönem Sonu sütunu kaldırıldı, 3️⃣ Profesyonel grafik eklendi) ===
  const Modal = {
    open(item) {
      const modal = $('#modal');
      const body = $('.modal-body', modal);
      const portSum = sum(state.data, 'guncelDeger');
      const kz = item.guncelDeger - item.toplamYatirim;
      const weight = portSum ? ((item.guncelDeger / portSum) * 100).toFixed(1) : 0;
      const alerts = state.alerts[item.urun] || {};
      const holdTime = getHoldTime(item.tarih);
      const adet = item.adet || Math.floor(item.toplamYatirim / (item.alisFiyati || item.guncelDeger)) || 1;
      const unitCost = item.toplamYatirim / adet;
      const unitCurrent = item.guncelDeger / adet;

      // 1️⃣ Tablo: Sadece Dönem, Değişim, K/Z, Getiri (Dönem Sonu kaldırıldı)
      // 2️⃣ Veriler direkt CSV'den (item.gunluk, item.haftalik vs)
      const kzRows = CONFIG.PERIODS.map(({ key, label }) => {
        const change = item[key] || 0; // CSV'den gelen değer
        const periodKz = change; // K/Z = Değişim (basit hesaplama)
        const returnPct = item.toplamYatirim ? ((change / item.toplamYatirim) * 100) : 0;
        
        return `<tr>
          <td><strong>${label}</strong></td>
          <td class="${change >= 0 ? 'pos' : 'neg'}">${change >= 0 ? '+' : ''}${formatTRY(change)}</td>
          <td class="${periodKz >= 0 ? 'pos' : 'neg'}">${periodKz >= 0 ? '+' : ''}${formatTRY(periodKz)}</td>
          <td class="${returnPct >= 0 ? 'pos' : 'neg'}">${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%</td>
        </tr>`;
      }).join('');

      body.innerHTML = `
        <div class="modal-grid">
          <div class="stat">
            <div class="small">Ürün</div>
            <div style="font-size:14px; font-weight:700; word-break: break-word;">${item.urun}</div>
            <div class="small" style="margin-top:6px">${item.tur} · Ağırlık: <b>${weight}%</b>${holdTime ? `<span class="hold-badge">⏱ ${holdTime}</span>` : ''}</div>
          </div>
          <div class="stat">
            <div class="small">Değerler</div>
            <div class="big" style="font-size:13px">Güncel: ${formatTRY(item.guncelDeger)}</div>
            <div class="big" style="font-size:13px">Maliyet: ${formatTRY(item.toplamYatirim)}</div>
            <div class="big" style="font-size:13px; ${kz >= 0 ? 'color:var(--pos)' : 'color:var(--neg)'}">K/Z: ${formatTRY(kz)}</div>
          </div>
          <div class="stat" style="grid-column: 1 / -1">
            <div class="small">📊 Adet ve Birim Bilgileri</div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 6px;">
              <div style="text-align: center; padding: 8px; background: rgba(59,130,246,.1); border-radius: 6px;">
                <div style="font-size: 9px; opacity: 0.7">Adet</div>
                <div style="font-weight: 700; font-size: 13px">${adet.toLocaleString('tr-TR')}</div>
              </div>
              <div style="text-align: center; padding: 8px; background: rgba(59,130,246,.1); border-radius: 6px;">
                <div style="font-size: 9px; opacity: 0.7">Ort. Maliyet</div>
                <div style="font-weight: 700; font-size: 13px">${formatTRY(unitCost)}</div>
              </div>
              <div style="text-align: center; padding: 8px; background: rgba(34,197,94,.1); border-radius: 6px;">
                <div style="font-size: 9px; opacity: 0.7">Güncel Fiyat</div>
                <div style="font-weight: 700; font-size: 13px; color: var(--pos)">${formatTRY(unitCurrent)}</div>
              </div>
              <div style="text-align: center; padding: 8px; background: ${kz >= 0 ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)'}; border-radius: 6px;">
                <div style="font-size: 9px; opacity: 0.7">Birim K/Z</div>
                <div style="font-weight: 700; font-size: 13px; color: ${kz >= 0 ? 'var(--pos)' : 'var(--neg)'}">${formatTRY(unitCurrent - unitCost)}</div>
              </div>
            </div>
          </div>
          
          <div class="stat" style="grid-column: 1 / -1">
            <div class="small">📈 Dönemsel Performans (CSV Verileri)</div>
            <div class="kz-table-wrapper">
              <table class="kz-table">
                <thead>
                  <tr>
                    <th>Dönem</th>
                    <th>Değişim</th>
                    <th>K/Z</th>
                    <th>Getiri</th>
                  </tr>
                </thead>
                <tbody>${kzRows}</tbody>
              </table>
            </div>
          </div>
          
          <div class="stat" style="grid-column: 1 / -1">
            <div class="small">📊 Performans Görselleştirme (Gerçek Veriler)</div>
            <div class="performance-chart-container" style="height: 200px; margin-top: 10px; position: relative;">
              <canvas id="perf-chart"></canvas>
            </div>
            <div class="chart-legend" style="margin-top: 8px; font-size: 11px; display: flex; gap: 16px; justify-content: center;">
              <span><span style="display: inline-block; width: 8px; height: 8px; background: var(--pos); border-radius: 2px; margin-right: 4px;"></span>Pozitif</span>
              <span><span style="display: inline-block; width: 8px; height: 8px; background: var(--neg); border-radius: 2px; margin-right: 4px;"></span>Negatif</span>
            </div>
          </div>
          
          <div class="stat" style="grid-column: 1 / -1">
            <div class="small">🔔 Fiyat Uyarıları</div>
            <div class="alert-form">
              <div><label>Güncel Değer ≥</label><input id="al-guncel" type="number" placeholder="100000" value="${alerts.guncel || ''}"></div>
              <div><label>K/Z ≥</label><input id="al-kz" type="number" placeholder="5000" value="${alerts.kz || ''}"></div>
              <div><label>Günlük % ≥</label><input id="al-dp" type="number" step="0.1" placeholder="2.5" value="${alerts.dailyPerc || ''}"></div>
            </div>
            <div class="modal-actions">
              <button class="btn" id="al-remove">Sil</button>
              <button class="btn primary" id="al-save">Kaydet</button>
            </div>
          </div>
        </div>
      `;

      this.setupPerformanceChart(item);
      this.setupAlertButtons(item);
      
      modal.classList.add('active');
      modal.hidden = false;
    },

    // 3️⃣ Profesyonel performans grafiği (6 dönem için bar chart)
    setupPerformanceChart(item) {
      const canvas = $('#perf-chart');
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const container = canvas.parentElement;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;

      const w = canvas.width;
      const h = canvas.height;
      const pad = { top: 30, right: 20, bottom: 40, left: 60 };
      const cw = w - pad.left - pad.right;
      const ch = h - pad.top - pad.bottom;

      const values = CONFIG.PERIODS.map(({ key }) => item[key] || 0);
      const maxVal = Math.max(...values.map(Math.abs), 1);
      const barWidth = cw / values.length * 0.6;
      const barGap = cw / values.length * 0.4;

      ctx.clearRect(0, 0, w, h);

      // Grid çizgileri
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (ch / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
      }

      // Sıfır çizgisi
      const zeroY = pad.top + (ch / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(w - pad.right, zeroY);
      ctx.stroke();

      // Barlar
      values.forEach((val, i) => {
        const x = pad.left + (i * (barWidth + barGap)) + barGap / 2;
        const barHeight = (val / maxVal) * (ch / 2);
        const y = val >= 0 ? zeroY - barHeight : zeroY;
        
        // Gradient
        const grad = ctx.createLinearGradient(0, y, 0, val >= 0 ? y + barHeight : y + Math.abs(barHeight));
        if (val >= 0) {
          grad.addColorStop(0, '#22c55e');
          grad.addColorStop(1, 'rgba(34,197,94,0.3)');
        } else {
          grad.addColorStop(0, '#ef4444');
          grad.addColorStop(1, 'rgba(239,68,68,0.3)');
        }
        
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, Math.abs(barHeight));
        
        // Değer etiketi
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        const labelY = val >= 0 ? y - 5 : y + Math.abs(barHeight) + 15;
        ctx.fillText(formatTRY(val), x + barWidth / 2, labelY);
        
        // X ekseni etiketi
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '10px system-ui';
        ctx.fillText(CONFIG.PERIODS[i].label, x + barWidth / 2, h - 10);
      });

      // Y ekseni etiketleri
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '9px system-ui';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const val = maxVal * (1 - i / 2);
        const y = pad.top + (ch / 4) * i;
        ctx.fillText(formatTRY(val), pad.left - 5, y + 3);
      }
    },

    setupAlertButtons(item) {
      $('#al-save').onclick = () => {
        state.alerts[item.urun] = {
          guncel: toNumber($('#al-guncel')?.value) || null,
          kz: toNumber($('#al-kz')?.value) || null,
          dailyPerc: parseFloat($('#al-dp')?.value) || null
        };
        storage.set('alerts', state.alerts);
        UI.showToast('Uyarılar kaydedildi');
      };

      $('#al-remove').onclick = () => {
        delete state.alerts[item.urun];
        storage.set('alerts', state.alerts);
        UI.showToast('Uyarılar silindi');
        $('#al-guncel').value = '';
        $('#al-kz').value = '';
        $('#al-dp').value = '';
      };
    },

    close() {
      const modal = $('#modal');
      if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.hidden = true, 300);
      }
    }
  };

  // === TOOLBAR ===
  const Toolbar = {
    init() {
      const container = $('#toolbar-container');
      if (!container || $('.toolbar')) return;

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
        </div>
      `;

      container.appendChild(toolbar);

      $('#sort-select').onchange = e => { state.sortKey = e.target.value; renderAll(); };
      $('#autoref').onchange = e => {
        state.autoRefresh.enabled = e.target.checked;
        state.autoRefresh.enabled ? this.startAutoRefresh() : this.stopAutoRefresh();
      };
      $('#arate').onchange = e => {
        state.autoRefresh.ms = +e.target.value;
        if (state.autoRefresh.enabled) this.startAutoRefresh();
      };
      $('#ai-analyze-btn').onclick = () => UI.renderAIAnalysis();

      const modal = $('#modal');
      if (modal) {
        modal.addEventListener('click', e => {
          if (e.target.classList.contains('modal-backdrop') || e.target.classList.contains('modal-close')) {
            Modal.close();
          }
        });
        document.addEventListener('keydown', e => {
          if (e.key === 'Escape' && modal.classList.contains('active')) Modal.close();
        });
      }
    },

    startAutoRefresh() {
      this.stopAutoRefresh();
      state.autoRefresh.timer = setInterval(async () => {
        try {
          const resp = await fetch(`${CONFIG.CSV_URL}&t=${Date.now()}`);
          const text = await resp.text();
          const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
          
          state.data = parsed.data.map(r => ({
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

          state.cache = {};
          state.autoRefresh.lastUpdate = new Date();
          renderAll();
          UI.showToast('Veriler yenilendi');
        } catch (e) {
          console.error('Yenileme hatası', e);
        }
      }, state.autoRefresh.ms);
    },

    stopAutoRefresh() {
      if (state.autoRefresh.timer) {
        clearInterval(state.autoRefresh.timer);
        state.autoRefresh.timer = null;
      }
    }
  };

  // === ANA RENDER ===
  function renderAll() {
    const cacheKey = `filter:${state.activeFilter}`;
    let filtered = state.cache[cacheKey];
    
    if (!filtered) {
      filtered = state.activeFilter === 'ALL' ? state.data : state.data.filter(x => x.tur === state.activeFilter);
      state.cache[cacheKey] = filtered;
    }

    UI.renderSummary(filtered);
    UI.renderTypes();
    UI.renderPeriods(filtered);
    UI.renderDetails(filtered);
    UI.updateTicker();
    UI.checkAlerts();
    UI.updateLastUpdate();
  }

  // === BASLATMA ===
  async function init() {
    const loader = $('#loader');
    if (loader) loader.removeAttribute('hidden');

    try {
      const resp = await fetch(`${CONFIG.CSV_URL}&t=${Date.now()}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      
      const text = await resp.text();
      if (!text || text.includes('<!DOCTYPE')) throw new Error("Geçersiz yanıt");
      if (typeof Papa === 'undefined') throw new Error("Papa Parse yüklenmemiş");

      const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
      if (parsed.data.length === 0) throw new Error("CSV boş");

      state.data = parsed.data.map(r => ({
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

      if (state.data.length === 0) throw new Error("Geçerli veri bulunamadı");

      state.alerts = storage.get('alerts', {});
      state.autoRefresh.lastUpdate = new Date();

      Toolbar.init();
      if (loader) loader.setAttribute('hidden', '');
      
      renderAll();
      Mobile.init();
      UI.showToast(`${state.data.length} ürün yüklendi`);

    } catch (err) {
      console.error("Hata:", err);
      if (loader) {
        loader.innerHTML = `<div style="color:#ef4444; padding:20px; text-align:center;"><div style="font-size:18px; margin-bottom:10px;">⚠️ ${err.message}</div><button onclick="location.reload()" style="padding:10px 20px; background:#3b82f6; border:none; border-radius:6px; color:white; cursor:pointer;">Yenile</button></div>`;
      }
    }
  }

  // === EVENT LISTENERS ===
  document.addEventListener('DOMContentLoaded', () => {
    const searchInput = $('#search');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        const q = e.target.value.toLowerCase().trim();
        requestAnimationFrame(() => {
          $$('.detail-item').forEach(it => {
            it.style.display = !q || it.textContent.toLowerCase().includes(q) ? '' : 'none';
          });
        });
      });
    }

    init();
  });

  return { init, renderAll, state };
})();
