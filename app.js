// Portföy Terminali Pro Max - Temizlenmiş JS

// ==================== STATE ====================
const state = {
    portfolio: [],
    filteredPortfolio: [],
    selectedType: 'all',
    selectedPeriod: '1d',
    searchQuery: '',
    lastUpdate: null
};

// ==================== DOM ELEMENTS ====================
const elements = {
    loader: document.getElementById('loader'),
    assetList: document.getElementById('assetList'),
    totalValue: document.getElementById('totalValue'),
    dailyPnL: document.getElementById('dailyPnL'),
    totalPnL: document.getElementById('totalPnL'),
    searchInput: document.getElementById('searchInput'),
    portfolioSelect: document.getElementById('portfolioSelect'),
    periodSelect: document.getElementById('periodSelect'),
    lastUpdate: document.getElementById('lastUpdate'),
    modal: document.getElementById('detailModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    toast: document.getElementById('toast'),
    aiPanel: document.getElementById('aiPanel'),
    aiContent: document.getElementById('aiContent')
};

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    try {
        await loadPortfolioData();
        setupEventListeners();
        render();
        hideLoader();
        startAutoRefresh();
    } catch (error) {
        showToast('Yükleme hatası: ' + error.message, 'error');
    }
}

function hideLoader() {
    elements.loader.hidden = true;
}

// ==================== DATA ====================
async function loadPortfolioData() {
    // API çağrısı veya mock data
    const mockData = [
        { id: 1, symbol: 'BTC', name: 'Bitcoin', type: 'crypto', quantity: 0.5, avgPrice: 1200000, currentPrice: 1350000, dailyChange: 2.4 },
        { id: 2, symbol: 'ETH', name: 'Ethereum', type: 'crypto', quantity: 5, avgPrice: 45000, currentPrice: 42000, dailyChange: -1.2 },
        { id: 3, symbol: 'XU100', name: 'BIST 100', type: 'stock', quantity: 100, avgPrice: 8500, currentPrice: 9200, dailyChange: 0.8 },
        { id: 4, symbol: 'USD', name: 'Dolar', type: 'forex', quantity: 1000, avgPrice: 28.5, currentPrice: 32.2, dailyChange: 1.1 },
        { id: 5, symbol: 'GAUTRY', name: 'Gram Altın', type: 'commodity', quantity: 50, avgPrice: 1850, currentPrice: 1920, dailyChange: 0.5 }
    ];
    
    state.portfolio = mockData;
    state.filteredPortfolio = [...mockData];
    state.lastUpdate = new Date();
}

function startAutoRefresh() {
    setInterval(() => {
        updatePrices();
    }, 60000); // Her 60 saniye
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase();
        filterPortfolio();
    });
    
    elements.portfolioSelect.addEventListener('change', (e) => {
        state.selectedType = e.target.value;
        filterPortfolio();
    });
    
    elements.periodSelect.addEventListener('change', (e) => {
        state.selectedPeriod = e.target.value;
        render();
    });
    
    // Modal dışına tıklama
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal || e.target.classList.contains('modal-backdrop')) {
            closeModal();
        }
    });
    
    // ESC tuşu
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

// ==================== RENDER ====================
function render() {
    renderSummary();
    renderAssetList();
    updateLastUpdateTime();
}

function renderSummary() {
    const total = state.filteredPortfolio.reduce((acc, item) => {
        return acc + (item.currentPrice * item.quantity);
    }, 0);
    
    const dailyPnL = state.filteredPortfolio.reduce((acc, item) => {
        const value = item.currentPrice * item.quantity;
        return acc + (value * (item.dailyChange / 100));
    }, 0);
    
    const totalCost = state.filteredPortfolio.reduce((acc, item) => {
        return acc + (item.avgPrice * item.quantity);
    }, 0);
    
    const totalPnL = total - totalCost;
    
    elements.totalValue.textContent = formatCurrency(total);
    elements.dailyPnL.textContent = formatCurrency(dailyPnL);
    elements.dailyPnL.className = 'big ' + (dailyPnL >= 0 ? 'pos' : 'neg');
    elements.totalPnL.textContent = formatCurrency(totalPnL);
    elements.totalPnL.className = 'big ' + (totalPnL >= 0 ? 'pos' : 'neg');
}

function renderAssetList() {
    elements.assetList.innerHTML = '';
    
    if (state.filteredPortfolio.length === 0) {
        elements.assetList.innerHTML = '<div class="detail-item" style="justify-content:center;color:var(--muted)">Sonuç bulunamadı</div>';
        return;
    }
    
    state.filteredPortfolio.forEach(asset => {
        const item = createAssetElement(asset);
        elements.assetList.appendChild(item);
    });
}

function createAssetElement(asset) {
    const div = document.createElement('div');
    div.className = 'detail-item';
    
    const currentValue = asset.currentPrice * asset.quantity;
    const costValue = asset.avgPrice * asset.quantity;
    const totalChange = ((asset.currentPrice - asset.avgPrice) / asset.avgPrice) * 100;
    
    div.innerHTML = `
        <div class="detail-info">
            <div>${asset.symbol} <span class="weight-badge">${asset.type}</span></div>
            <div>${asset.name} • ${asset.quantity} adet</div>
        </div>
        <div class="detail-values">
            <div class="detail-val">${formatCurrency(currentValue)}</div>
            <div class="detail-perc ${asset.dailyChange >= 0 ? 'pos' : 'neg'}">
                ${asset.dailyChange >= 0 ? '+' : ''}${asset.dailyChange.toFixed(2)}%
            </div>
            <div class="percent-badge ${totalChange >= 0 ? 'pos' : 'neg'}">
                ${totalChange >= 0 ? '+' : ''}${totalChange.toFixed(1)}%
            </div>
        </div>
    `;
    
    div.addEventListener('click', () => openModal(asset));
    
    return div;
}

// ==================== FILTER ====================
function filterPortfolio() {
    state.filteredPortfolio = state.portfolio.filter(item => {
        const matchesType = state.selectedType === 'all' || item.type === state.selectedType;
        const matchesSearch = item.symbol.toLowerCase().includes(state.searchQuery) || 
                             item.name.toLowerCase().includes(state.searchQuery);
        return matchesType && matchesSearch;
    });
    
    render();
}

// ==================== MODAL ====================
function openModal(asset) {
    elements.modalTitle.textContent = `${asset.symbol} - ${asset.name}`;
    
    const currentValue = asset.currentPrice * asset.quantity;
    const costValue = asset.avgPrice * asset.quantity;
    const totalChange = ((asset.currentPrice - asset.avgPrice) / asset.avgPrice) * 100;
    const dailyChangeValue = (currentValue * (asset.dailyChange / 100));
    
    elements.modalBody.innerHTML = `
        <div class="modal-grid">
            <div class="stat">
                <div class="small">Mevcut Fiyat</div>
                <div class="big">${formatCurrency(asset.currentPrice)}</div>
            </div>
            <div class="stat">
                <div class="small">Ortalama Maliyet</div>
                <div class="big">${formatCurrency(asset.avgPrice)}</div>
            </div>
            <div class="stat">
                <div class="small">Günlük Değişim</div>
                <div class="big ${asset.dailyChange >= 0 ? 'pos' : 'neg'}">
                    ${asset.dailyChange >= 0 ? '+' : ''}${asset.dailyChange.toFixed(2)}%
                    (${formatCurrency(dailyChangeValue)})
                </div>
            </div>
            <div class="stat">
                <div class="small">Toplam Değer</div>
                <div class="big">${formatCurrency(currentValue)}</div>
            </div>
            <div class="stat">
                <div class="small">Maliyet</div>
                <div class="big">${formatCurrency(costValue)}</div>
            </div>
            <div class="stat">
                <div class="small">Toplam K/Z</div>
                <div class="big ${totalChange >= 0 ? 'pos' : 'neg'}">
                    ${totalChange >= 0 ? '+' : ''}${totalChange.toFixed(2)}%
                    (${formatCurrency(currentValue - costValue)})
                </div>
            </div>
        </div>
        
        <div style="margin-top:16px;padding:12px;background:rgba(59,130,246,.1);border-radius:8px;">
            <div style="font-size:12px;opacity:.7;margin-bottom:8px;">🤖 AI Yorumu</div>
            <div style="font-size:13px;line-height:1.5;">
                ${generateAIComment(asset)}
            </div>
        </div>
    `;
    
    elements.modal.hidden = false;
    elements.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    elements.modal.hidden = true;
    elements.modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ==================== AI FEATURES ====================
function generateAIComment(asset) {
    const comments = [
        `${asset.name} için teknik göstergeler ${asset.dailyChange > 0 ? 'pozitif' : 'negatif'} seyrediyor.`,
        `Fiyat hareketleri ${asset.dailyChange > 2 ? 'aşırı alım' : asset.dailyChange < -2 ? 'aşırı satım' : 'nötr'} bölgede.`,
        `Portföy ağırlığı göz önüne alındığında ${asset.dailyChange > 0 ? 'kar realizasyonu' : 'maliyet düşürme'} düşünülebilir.`
    ];
    return comments.join(' ');
}

function toggleAI() {
    const isVisible = elements.aiPanel.style.display !== 'none';
    elements.aiPanel.style.display = isVisible ? 'none' : 'block';
    
    if (!isVisible) {
        generateAIReport();
    }
}

function generateAIReport() {
    const totalValue = state.portfolio.reduce((acc, item) => acc + (item.currentPrice * item.quantity), 0);
    const riskLevel = totalValue > 1000000 ? 'Yüksek' : totalValue > 500000 ? 'Orta' : 'Düşük';
    
    elements.aiContent.innerHTML = `
        <div class="ai-summary-grid">
            <div class="ai-metric">
                <div class="small">Risk Seviyesi</div>
                <div class="big">${riskLevel}</div>
            </div>
            <div class="ai-metric">
                <div class="small">Çeşitlendirme</div>
                <div class="big">İyi</div>
            </div>
            <div class="ai-metric">
                <div class="small">Piyasa Uyumu</div>
                <div class="big">Bullish</div>
            </div>
        </div>
        <div class="ai-insights">
            <div class="insight-item">📊 Portföyünüz %60 kripto, %30 hisse ve %10 emtia ağırlığında.</div>
            <div class="insight-item">⚠️ Kripto ağırlığı yüksek, volatilite riskine dikkat edin.</div>
            <div class="insight-item">💡 Altın oranı portföyü dengelemek için ideal seviyede.</div>
        </div>
    `;
}

// ==================== UTILITIES ====================
function formatCurrency(value) {
    return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY',
        minimumFractionDigits: 2
    }).format(value);
}

function updateLastUpdateTime() {
    if (state.lastUpdate) {
        const time = state.lastUpdate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        elements.lastUpdate.textContent = `Son güncelleme: ${time}`;
    }
}

function updatePrices() {
    // Mock fiyat güncellemesi
    state.portfolio.forEach(asset => {
        const change = (Math.random() - 0.5) * 2; // -1% ile +1% arası
        asset.currentPrice = asset.currentPrice * (1 + (change / 100));
        asset.dailyChange = change;
    });
    
    state.lastUpdate = new Date();
    render();
    showToast('Fiyatlar güncellendi', 'success');
}

function showToast(message, type = 'info') {
    elements.toast.textContent = message;
    elements.toast.style.borderLeft = type === 'error' ? '4px solid var(--neg)' : 
                                      type === 'success' ? '4px solid var(--pos)' : 
                                      '4px solid var(--accent)';
    elements.toast.hidden = false;
    
    setTimeout(() => {
        elements.toast.hidden = true;
    }, 3000);
}

// ==================== EXPORT (Opsiyonel) ====================
function exportData() {
    const data = {
        portfolio: state.portfolio,
        summary: {
            totalValue: elements.totalValue.textContent,
            lastUpdate: new Date().toISOString()
        }
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Veriler dışa aktarıldı', 'success');
}
