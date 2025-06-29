document.addEventListener('DOMContentLoaded', function() {
    // --- DOM Element References ---
    const themeToggle = document.getElementById('theme-toggle');
    const apiTypeSelect = document.getElementById('api-type');
    const baseUrlGroup = document.getElementById('base-url-group');
    const corsSectionGroup = document.getElementById('cors-section-group');
    const corsProxySelect = document.getElementById('cors-proxy');
    const customProxyGroup = document.getElementById('custom-proxy-group');
    const queryBtn = document.getElementById('query-batch');
    const loadingEl = document.getElementById('loading');
    const resultsContainer = document.getElementById('results');
    const sortContainer = document.getElementById('sort-container');
    const sortButton = document.getElementById('sort-button');
    const collapseButton = document.getElementById('collapse-button');
    const exportContainer = document.getElementById('export-container');
    const exportButton = document.getElementById('export-button');

    // --- State Management ---
    let currentSortOrder = 'input';
    let allCardsCollapsed = false;
    window.originalResults = [];
    window.queryResults = [];

    // --- Initial Setup ---
    loadThemePreference();
    updateUIVisibility();

    // --- Event Listeners ---
    themeToggle.addEventListener('click', toggleTheme);
    apiTypeSelect.addEventListener('change', updateUIVisibility);
    corsProxySelect.addEventListener('change', () => {
        customProxyGroup.style.display = corsProxySelect.value === 'custom' ? 'block' : 'none';
    });
    queryBtn.addEventListener('click', handleQuery);
    sortButton.addEventListener('click', handleSort);
    collapseButton.addEventListener('click', handleCollapse);
    exportButton.addEventListener('click', handleExport);

    // --- UI Functions ---
    function toggleTheme() {
        document.body.classList.toggle('dark-mode');
        const isDarkMode = document.body.classList.contains('dark-mode');
        themeToggle.querySelector('i').className = isDarkMode ? 'fas fa-sun' : 'fas fa-moon';
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    }

    function loadThemePreference() {
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggle.querySelector('i').className = 'fas fa-sun';
        }
    }

    function updateUIVisibility() {
        const type = apiTypeSelect.value;
        baseUrlGroup.style.display = (type === 'openai' || type === 'gemini') ? 'block' : 'none';
        corsSectionGroup.style.display = type === 'deepseek' ? 'block' : 'none';
    }

    function showLoading(isLoading) {
        loadingEl.style.display = isLoading ? 'block' : 'none';
        queryBtn.disabled = isLoading;
        queryBtn.innerHTML = isLoading ? '<span class="spinner" style="width:20px;height:20px;border-width:3px;border-top-color:white;border-bottom-color:white;margin:0;"></span>' : '<i class="fas fa-rocket"></i> 开始检测';
    }

    // --- Main Query Handler ---
    async function handleQuery() {
        const apiKeysText = document.getElementById('batch-api-keys').value.trim();
        const apiKeys = apiKeysText.split(/[\s,]+/).filter(key => key);

        if (apiKeys.length === 0) {
            showToast('请输入至少一个有效的API密钥', 'error');
            return;
        }

        showLoading(true);
        resultsContainer.innerHTML = '';
        sortContainer.style.display = 'none';
        exportContainer.style.display = 'none';

        const promises = apiKeys.map(apiKey => queryApiKey(apiKey));
        const results = await Promise.all(promises);

        // Process results to add a normalized balance for sorting
        const processedResults = results.map(r => {
            let totalBalanceInCNY = -1;
            if (r.success && r.data) {
                const { data } = r;
                if (data.total_balance !== undefined) { // Siliconflow
                    totalBalanceInCNY = parseFloat(data.total_balance) * 7.3;
                } else if (data.balance_infos) { // DeepSeek
                    totalBalanceInCNY = data.balance_infos.reduce((sum, info) => {
                        const amount = parseFloat(info.total_balance) || 0;
                        return sum + (info.currency === 'USD' ? amount * 7.3 : amount);
                    }, 0);
                } else { // OpenAI, Gemini
                    totalBalanceInCNY = 0;
                }
            }
            return { ...r, totalBalanceInCNY };
        });

        window.originalResults = [...processedResults];
        window.queryResults = [...processedResults];
        
        displayResults(processedResults);
        showLoading(false);
        
        if (results.length > 1) {
            sortContainer.style.display = 'flex';
        }
        if (results.length > 0) {
            exportContainer.style.display = 'block';
        }
    }

    // --- API Query Router ---
    async function queryApiKey(apiKey) {
        const type = apiTypeSelect.value;
        const baseUrl = document.getElementById('base-url').value.trim();
        
        try {
            switch (type) {
                case 'openai':
                    return await queryOpenAILike(apiKey, baseUrl, 'openai');
                case 'gemini':
                    return await queryOpenAILike(apiKey, baseUrl, 'gemini');
                case 'siliconflow':
                    return await querySiliconflow(apiKey);
                case 'deepseek':
                    return await queryDeepSeek(apiKey);
                default:
                    throw new Error('未知的API类型');
            }
        } catch (error) {
            return { success: false, apiKey, error: error.message };
        }
    }

    // --- Specific API Query Implementations ---
    async function queryOpenAILike(apiKey, baseUrl, type) {
        if (!baseUrl) throw new Error('请输入 Base URL');
        const url = type === 'gemini' ? `${baseUrl.replace(/\/$/, '')}/v1beta/models?key=${apiKey}` : `${baseUrl.replace(/\/$/, '')}/models`;
        const headers = type === 'gemini' ? {} : { 'Authorization': `Bearer ${apiKey}` };
        const response = await fetch(url, { headers });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`请求失败 (${response.status}): ${errorData.error?.message || response.statusText}`);
        }
        const data = await response.json();
        let models = [];
        if (type === 'openai' && data.data) models = data.data.map(m => m.id);
        else if (type === 'gemini' && data.models) models = data.models.map(m => m.name.replace('models/', ''));
        
        return { success: true, apiKey, data: { models: models.join(', ') || '未能获取模型列表' } };
    }

    async function querySiliconflow(apiKey) {
        // First, validate the key with a chat completion call
        const chatResponse = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: "Qwen/Qwen2.5-7B-Instruct", messages: [{ role: "user", content: "hi" }], max_tokens: 1 })
        });

        if (!chatResponse.ok) {
            const errorData = await chatResponse.json().catch(() => ({}));
            throw new Error(errorData.message || `验证失败 (${chatResponse.status})`);
        }

        // If validation is successful, fetch the balance
        const balanceResponse = await fetch('https://api.siliconflow.cn/v1/user/info', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!balanceResponse.ok) {
            throw new Error(`密钥有效，但余额查询失败 (${balanceResponse.status})`);
        }

        const balanceData = await balanceResponse.json();
        
        if (balanceData && balanceData.data && typeof balanceData.data.totalBalance !== 'undefined') {
            return { success: true, apiKey, data: { total_balance: balanceData.data.totalBalance, currency: 'USD' } };
        } else {
            throw new Error('密钥有效，但无法解析余额信息');
        }
    }

    async function queryDeepSeek(apiKey) {
        const corsProxy = document.getElementById('cors-proxy').value === 'custom'
            ? document.getElementById('custom-proxy-url').value.trim()
            : '';
        const baseUrl = 'https://api.deepseek.com/user/balance';
        const requestUrl = corsProxy ? `${corsProxy}${baseUrl}` : baseUrl;
        
        const response = await fetch(requestUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        
        if (!response.ok) {
            throw new Error(`请求失败 (${response.status})`);
        }
        const data = await response.json();
        return { success: true, apiKey, data: { balance_infos: data.balance_infos, is_available: data.is_available } };
    }

    // --- Result Display & DOM Manipulation ---
    function displayResults(results) {
        resultsContainer.innerHTML = '';
        results.forEach(result => {
            const card = createResultCard(result);
            resultsContainer.appendChild(card);
        });
    }

    function createResultCard(result) {
        const card = document.createElement('div');
        card.className = 'result-card';
        const { success, apiKey, data, error, totalBalanceInCNY } = result;
        let statusClass, statusText, statusIcon;

        if (success) {
            statusClass = 'status-success';
            statusText = '有效';
            statusIcon = 'fa-check-circle';
            
            // Use pre-calculated balance for status
            if (totalBalanceInCNY === 0 && (apiTypeSelect.value === 'siliconflow' || apiTypeSelect.value === 'deepseek')) {
                statusClass = 'status-warning';
                statusText = '余额为零';
                statusIcon = 'fa-exclamation-triangle';
            }
        } else {
            statusClass = 'status-fail';
            statusText = '无效';
            statusIcon = 'fa-times-circle';
        }

        card.innerHTML = `
            <div class="card-header">
                <span class="key-name">${maskApiKey(apiKey)}</span>
                <span class="status ${statusClass}"><i class="fas ${statusIcon}"></i> ${statusText}</span>
                <i class="fas fa-chevron-down toggle-icon"></i>
            </div>
            <div class="card-body">
                ${success ? createCardBodySuccess(data) : `<div class="error-message">${error}</div>`}
            </div>
        `;
        
        card.querySelector('.card-header').addEventListener('click', () => {
            card.classList.toggle('collapsed');
        });
        
        return card;
    }

    function createCardBodySuccess(data) {
        let content = '<div class="info-grid">';
        if (data.models) { // OpenAI, Gemini
            content += createInfoItem('可用模型', data.models);
        }
        if (data.total_balance !== undefined) { // Siliconflow
            content += createInfoItem('总余额', `${parseFloat(data.total_balance).toFixed(4)} ${data.currency}`);
        }
        if (data.balance_infos) { // DeepSeek
            data.balance_infos.forEach(info => {
                content += createInfoItem(`总余额 (${info.currency})`, parseFloat(info.total_balance).toFixed(4));
                content += createInfoItem(`赠送余额 (${info.currency})`, parseFloat(info.granted_balance).toFixed(4));
            });
        }
        content += '</div>';
        return content;
    }

    function createInfoItem(key, value) {
        return `<div class="info-item"><div class="key">${key}</div><div class="value">${value}</div></div>`;
    }

    function maskApiKey(key) {
        return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key;
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        // Simple styling, assuming a CSS class will handle colors etc.
        toast.style.cssText = `position:fixed; top:20px; left:50%; transform:translateX(-50%); background:${type === 'error' ? '#e74c3c' : '#3498db'}; color:white; padding:10px 20px; border-radius:5px; z-index:1000;`;
        document.body.appendChild(toast);
        setTimeout(() => document.body.removeChild(toast), 3000);
    }

    // --- Advanced Feature Handlers ---
    function handleSort() {
        currentSortOrder = currentSortOrder === 'input' ? 'balance' : 'input';
        sortButton.innerHTML = `<i class="fas ${currentSortOrder === 'balance' ? 'fa-sort-alpha-down' : 'fa-sort-amount-down'}"></i> 按${currentSortOrder === 'balance' ? '输入顺序' : '余额'}排序`;
        
        const sortedResults = [...window.queryResults].sort((a, b) => {
            if (currentSortOrder === 'input') {
                const indexA = window.originalResults.findIndex(res => res.apiKey === a.apiKey);
                const indexB = window.originalResults.findIndex(res => res.apiKey === b.apiKey);
                return indexA - indexB;
            } else {
                // Sort by the pre-calculated and normalized balance
                return b.totalBalanceInCNY - a.totalBalanceInCNY;
            }
        });
        
        // Update the current view with sorted results
        window.queryResults = sortedResults;
        displayResults(window.queryResults);
    }

    function handleCollapse() {
        allCardsCollapsed = !allCardsCollapsed;
        collapseButton.innerHTML = `<i class="fas ${allCardsCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}"></i> ${allCardsCollapsed ? '展开所有' : '折叠所有'}`;
        document.querySelectorAll('.result-card').forEach(card => card.classList.toggle('collapsed', allCardsCollapsed));
    }

    function handleExport() {
        const includeInvalid = document.getElementById('export-invalid').checked;
        let content = `API密钥检测结果 (${new Date().toLocaleString()})\n\n`;
        
        const resultsToExport = window.queryResults.filter(r => includeInvalid || r.success);
        
        resultsToExport.forEach(r => {
            content += `API密钥: ${r.apiKey}\n`;
            if (r.success) {
                content += `状态: 有效\n`;
                content += `数据: ${JSON.stringify(r.data, null, 2)}\n`;
            } else {
                content += `状态: 无效\n`;
                content += `错误: ${r.error}\n`;
            }
            content += '------------------------------------\n';
        });
        
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `api-check-results-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('导出成功!', 'info');
    }
});