// ==========================================
// REAL-TIME INVENTORY MANAGEMENT FRONTEND
// ==========================================

// Configuration
const CONFIG = {
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyWBHL4aamfkpzUxZL9mxeBqkgbJNgSbap6iU2z6WpU7zzQfb2L4JDUBNDfwGWPZ4GbYA/exec', // Replace with your deployed URL
    HEARTBEAT_INTERVAL: 15000, // 15 seconds
    POLL_INTERVAL: 5000, // 5 seconds
    LOCK_TIMEOUT: 60000, // 1 minute
    USER_ID: localStorage.getItem('userId') || generateUserId(),
    USER_NAME: localStorage.getItem('userName') || prompt('Enter your name:') || 'User'
};

// Save user info
localStorage.setItem('userId', CONFIG.USER_ID);
localStorage.setItem('userName', CONFIG.USER_NAME);

// State Management
const STATE = {
    currentRoute: '',
    currentDate: '',
    activeUsers: [],
    lockedItems: new Set(),
    lastServerTimestamp: 0,
    isOnline: true,
    pendingChanges: [],
    syncStatus: 'idle'
};

// Inventory data structure
const INVENTORY = {
    sunflower: [
        { code: '4402', name: '200g Pack', units: ['Bag', 'Bundle'], conversion: { 'Bag': 1, 'Bundle': 5 } },
        { code: '4401', name: '100g Pack', units: ['Bag', 'Bundle'], conversion: { 'Bag': 1, 'Bundle': 5 } },
        { code: '1129', name: '25g Pack', units: ['Bag', 'Bundle'], conversion: { 'Bag': 1, 'Bundle': 6 } },
        { code: '1116', name: '800g Pack', units: ['Bag', 'Carton'], conversion: { 'Bag': 1, 'Carton': 12 } },
        { code: '1145', name: '130g Pack', units: ['Box', 'Carton'], conversion: { 'Box': 1, 'Carton': 6 } },
        { code: '1126', name: '10KG Bulk', units: ['Sack'], conversion: { 'Sack': 1 } }
    ],
    pumpkin: [
        { code: '8001', name: '15g Pack', units: ['Box', 'Carton'], conversion: { 'Box': 1, 'Carton': 6 } },
        { code: '8002', name: '110g Pack', units: ['Box', 'Carton'], conversion: { 'Box': 1, 'Carton': 6 } },
        { code: '1142', name: '10KG Bulk', units: ['Sack'], conversion: { 'Sack': 1 } }
    ],
    melon: [
        { code: '9001', name: '15g Pack', units: ['Box', 'Carton'], conversion: { 'Box': 1, 'Carton': 6 } },
        { code: '9002', name: '110g Pack', units: ['Box', 'Carton'], conversion: { 'Box': 1, 'Carton': 6 } }
    ],
    popcorn: [
        { code: '1701', name: 'Cheese', units: ['Bag', 'Carton'], conversion: { 'Bag': 1, 'Carton': 8 } },
        { code: '1702', name: 'Butter', units: ['Bag', 'Carton'], conversion: { 'Bag': 1, 'Carton': 8 } },
        { code: '1703', name: 'Lightly Salted', units: ['Bag', 'Carton'], conversion: { 'Bag': 1, 'Carton': 8 } }
    ]
};

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    startRealTimeSync();
    setupEventListeners();
    checkOnlineStatus();
});

function initializeApp() {
    // Set today's date
    const today = new Date();
    const dateInput = document.getElementById('verificationDate');
    if (dateInput) {
        dateInput.value = today.toISOString().split('T')[0];
        STATE.currentDate = dateInput.value;
    }
    
    renderCategories();
    loadFromLocalStorage();
    updateSyncStatus('Connecting...');
}

function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ==========================================
// REAL-TIME SYNCHRONIZATION
// ==========================================

function startRealTimeSync() {
    // Start heartbeat
    sendHeartbeat();
    setInterval(sendHeartbeat, CONFIG.HEARTBEAT_INTERVAL);
    
    // Start polling for updates
    pollForUpdates();
    setInterval(pollForUpdates, CONFIG.POLL_INTERVAL);
    
    // Get active users
    getActiveUsers();
    setInterval(getActiveUsers, CONFIG.HEARTBEAT_INTERVAL);
}

async function sendHeartbeat() {
    try {
        const response = await callGoogleScript({
            action: 'heartbeat',
            userId: CONFIG.USER_ID,
            userName: CONFIG.USER_NAME,
            route: STATE.currentRoute,
            module: 'inventory'
        });
        
        if (response.status === 'success') {
            STATE.isOnline = true;
            updateSyncStatus('Connected');
            updateActiveUsersDisplay(response.data.activeUsers);
        }
    } catch (error) {
        console.error('Heartbeat failed:', error);
        STATE.isOnline = false;
        updateSyncStatus('Offline');
    }
}

async function pollForUpdates() {
    if (!STATE.currentRoute || !STATE.isOnline) return;
    
    try {
        const response = await callGoogleScript({
            action: 'getRealTimeData',
            route: STATE.currentRoute,
            date: STATE.currentDate,
            timestamp: STATE.lastServerTimestamp
        });
        
        if (response.status === 'success') {
            processUpdates(response.data);
        }
    } catch (error) {
        console.error('Polling failed:', error);
    }
}

async function getActiveUsers() {
    try {
        const response = await callGoogleScript({
            action: 'getActiveUsers'
        });
        
        if (response.status === 'success') {
            STATE.activeUsers = response.data.users;
            updateActiveUsersDisplay(response.data.count);
            updateLockedItems(response.data.users);
        }
    } catch (error) {
        console.error('Failed to get active users:', error);
    }
}

function processUpdates(data) {
    if (data.updates && data.updates.length > 0) {
        data.updates.forEach(update => {
            if (update.type === 'route_update' && update.route === STATE.currentRoute) {
                mergeInventoryData(update.data);
                STATE.lastServerTimestamp = update.timestamp;
                showNotification('Data updated by another user', 'info');
            }
        });
    }
    
    if (data.lockedItems) {
        updateLockedItemsDisplay(data.lockedItems);
    }
    
    STATE.lastServerTimestamp = data.serverTimestamp;
}

function mergeInventoryData(serverData) {
    // Only update fields that haven't been modified locally
    serverData.forEach(item => {
        const inputId = `${item.category.toLowerCase()}_${item.code}`;
        const localInput = document.getElementById(`${inputId}_physical`);
        
        if (localInput && !localInput.dataset.locallyModified) {
            // Update all fields for this item
            updateItemFields(inputId, item);
        }
    });
    
    updateSummary();
}

function updateItemFields(inputId, item) {
    const fields = ['physical', 'transfer', 'system', 'reimburse'];
    const units = ['physUnit', 'transUnit', 'sysUnit', 'reimbUnit'];
    
    fields.forEach((field, index) => {
        const input = document.getElementById(`${inputId}_${field}`);
        if (input) {
            input.value = item[field] || '';
            
            // Update unit selector if exists
            if (units[index]) {
                const unitSelect = document.getElementById(`${inputId}_${units[index]}`);
                if (unitSelect && item[units[index]]) {
                    unitSelect.value = item[units[index]];
                }
            }
        }
    });
    
    // Recalculate difference
    const category = item.category.toLowerCase();
    calculateDifference(category, item.code);
}

// ==========================================
// ITEM LOCKING
// ==========================================

async function lockItem(category, code) {
    try {
        const response = await callGoogleScript({
            action: 'lockItem',
            route: STATE.currentRoute,
            itemCode: code,
            userId: CONFIG.USER_ID
        });
        
        if (response.status === 'success') {
            STATE.lockedItems.add(`${STATE.currentRoute}_${code}`);
            updateItemLockDisplay(category, code, true);
        } else {
            showNotification('Item is being edited by another user', 'warning');
        }
    } catch (error) {
        console.error('Failed to lock item:', error);
    }
}

async function unlockItem(category, code) {
    try {
        await callGoogleScript({
            action: 'unlockItem',
            route: STATE.currentRoute,
            itemCode: code,
            userId: CONFIG.USER_ID
        });
        
        STATE.lockedItems.delete(`${STATE.currentRoute}_${code}`);
        updateItemLockDisplay(category, code, false);
    } catch (error) {
        console.error('Failed to unlock item:', error);
    }
}

function updateItemLockDisplay(category, code, isLocked) {
    const row = document.querySelector(`#${category}_${code}_physical`)?.closest('tr');
    if (row) {
        if (isLocked) {
            row.classList.add('item-locked');
        } else {
            row.classList.remove('item-locked');
        }
    }
}

function updateLockedItemsDisplay(lockedItems) {
    // Clear all locked states
    document.querySelectorAll('.item-locked').forEach(el => {
        el.classList.remove('item-locked', 'locked-by-other');
    });
    
    // Update locked items
    lockedItems.forEach(lock => {
        const [route, code] = lock.itemKey.split('_');
        if (route === STATE.currentRoute) {
            const inputs = document.querySelectorAll(`[id*="_${code}_"]`);
            inputs.forEach(input => {
                const row = input.closest('tr');
                if (row) {
                    if (lock.userId === CONFIG.USER_ID) {
                        row.classList.add('item-locked');
                    } else {
                        row.classList.add('locked-by-other');
                        input.disabled = true;
                        input.title = `Locked by another user`;
                    }
                }
            });
        }
    });
}

// ==========================================
// DATA MANAGEMENT
// ==========================================

async function saveData() {
    if (!STATE.currentRoute) {
        showNotification('Please select a route first!', 'error');
        return;
    }
    
    updateSyncStatus('Saving...');
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;
    
    const data = collectInventoryData();
    
    try {
        const response = await callGoogleScript({
            action: 'saveInventoryData',
            route: STATE.currentRoute,
            date: STATE.currentDate,
            items: data,
            timestamp: new Date().toISOString()
        });
        
        if (response.status === 'success') {
            showNotification('Data saved successfully!', 'success');
            clearLocalModifications();
            STATE.pendingChanges = [];
            updateSyncStatus('Saved');
        } else {
            throw new Error(response.data || 'Save failed');
        }
    } catch (error) {
        console.error('Save error:', error);
        showNotification('Failed to save. Data saved locally.', 'error');
        savePendingChanges(data);
        updateSyncStatus('Offline - Changes pending');
    } finally {
        saveBtn.disabled = false;
    }
}

async function loadInventoryData() {
    if (!STATE.currentRoute || !STATE.currentDate) return;
    
    updateSyncStatus('Loading...');
    
    try {
        const response = await callGoogleScript({
            action: 'getInventoryData',
            route: STATE.currentRoute,
            date: STATE.currentDate
        });
        
        if (response.status === 'success' && response.data.items) {
            response.data.items.forEach(item => {
                const inputId = `${item.category.toLowerCase()}_${item.code}`;
                updateItemFields(inputId, item);
            });
            
            updateSummary();
            updateSyncStatus('Loaded');
        }
    } catch (error) {
        console.error('Load error:', error);
        showNotification('Failed to load data', 'error');
        updateSyncStatus('Error');
    }
}

function collectInventoryData() {
    const data = [];
    
    Object.keys(INVENTORY).forEach(category => {
        INVENTORY[category].forEach(item => {
            const physical = document.getElementById(`${category}_${item.code}_physical`)?.value || '0';
            const physUnit = document.getElementById(`${category}_${item.code}_physUnit`)?.value;
            const transfer = document.getElementById(`${category}_${item.code}_transfer`)?.value || '0';
            const transUnit = document.getElementById(`${category}_${item.code}_transUnit`)?.value;
            const system = document.getElementById(`${category}_${item.code}_system`)?.value || '0';
            const sysUnit = document.getElementById(`${category}_${item.code}_sysUnit`)?.value;
            const reimburse = document.getElementById(`${category}_${item.code}_reimburse`)?.value || '0';
            const reimbUnit = document.getElementById(`${category}_${item.code}_reimbUnit`)?.value;
            const difference = document.getElementById(`${category}_${item.code}_diff`)?.textContent || '0';
            
            // Only include items with data
            if (physical !== '0' || system !== '0' || transfer !== '0') {
                data.push({
                    category: category.toUpperCase(),
                    code: item.code,
                    name: item.name,
                    physical, physUnit, transfer, transUnit,
                    system, sysUnit, difference, reimburse, reimbUnit
                });
            }
        });
    });
    
    return data;
}

// ==========================================
// UI FUNCTIONS
// ==========================================

function renderCategories() {
    const container = document.getElementById('categoriesContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    Object.entries(INVENTORY).forEach(([category, items]) => {
        const categoryCard = createCategoryCard(category, items);
        container.appendChild(categoryCard);
    });
}

function createCategoryCard(category, items) {
    const card = document.createElement('div');
    card.className = 'category-card';
    card.id = `${category}Card`;
    
    const icons = {
        sunflower: '🌻',
        pumpkin: '🎃',
        melon: '🍈',
        popcorn: '🍿'
    };
    
    card.innerHTML = `
        <div class="category-header" onclick="toggleCategory('${category}Card')">
            <div class="category-title">
                <span>${icons[category]}</span>
                <span>${category.toUpperCase()}</span>
            </div>
            <span class="collapse-icon">▼</span>
        </div>
        <div class="category-content">
            <table class="stock-table">
                <thead>
                    <tr>
                        <th>Item Details</th>
                        <th class="input-col">Physical Stock</th>
                        <th class="input-col">Stock Transfer</th>
                        <th class="system-col">System Stock</th>
                        <th class="calc-col">Difference</th>
                        <th class="input-col">Pieces Reimbursed</th>
                    </tr>
                </thead>
                <tbody id="${category}Items"></tbody>
            </table>
        </div>
    `;
    
    // Render items
    const tbody = card.querySelector(`#${category}Items`);
    items.forEach(item => {
        tbody.appendChild(createItemRow(category, item));
    });
    
    return card;
}

function createItemRow(category, item) {
    const row = document.createElement('tr');
    
    const unitOptions = item.units.map(unit => 
        `<option value="${unit}">${unit}</option>`
    ).join('');
    
    row.innerHTML = `
        <td>
            <div class="item-code">${item.code}</div>
            <div class="item-name">${item.name}</div>
        </td>
        <td>
            <div class="input-group">
                <input type="number" class="stock-input physical" 
                       id="${category}_${item.code}_physical" 
                       placeholder="0" min="0" 
                       onfocus="lockItem('${category}', '${item.code}')"
                       onblur="unlockItem('${category}', '${item.code}')"
                       onchange="handleInputChange('${category}', '${item.code}', 'physical')"
                       onkeyup="handleEnterKey(event, '${category}', '${item.code}', 'physical')">
                <select class="unit-select" id="${category}_${item.code}_physUnit" 
                        onchange="calculateDifference('${category}', '${item.code}')">
                    ${unitOptions}
                </select>
            </div>
        </td>
        <td>
            <div class="input-group">
                <input type="number" class="stock-input" 
                       id="${category}_${item.code}_transfer" 
                       placeholder="0" min="0" 
                       onchange="handleInputChange('${category}', '${item.code}', 'transfer')"
                       onkeyup="handleEnterKey(event, '${category}', '${item.code}', 'transfer')">
                <select class="unit-select" id="${category}_${item.code}_transUnit" 
                        onchange="saveToLocalStorage()">
                    ${unitOptions}
                </select>
            </div>
        </td>
        <td>
            <div class="input-group">
                <input type="number" class="stock-input system" 
                       id="${category}_${item.code}_system" 
                       placeholder="0" min="0" 
                       onchange="handleInputChange('${category}', '${item.code}', 'system')"
                       onkeyup="handleEnterKey(event, '${category}', '${item.code}', 'system')">
                <select class="unit-select" id="${category}_${item.code}_sysUnit" 
                        onchange="calculateDifference('${category}', '${item.code}')">
                    ${unitOptions}
                </select>
            </div>
        </td>
        <td>
            <div class="difference match" id="${category}_${item.code}_diff">0</div>
        </td>
        <td>
            <div class="input-group">
                <input type="number" class="stock-input reimbursed" 
                       id="${category}_${item.code}_reimburse" 
                       placeholder="0" min="0"
                       onchange="saveToLocalStorage()"
                       onkeyup="handleEnterKey(event, '${category}', '${item.code}', 'reimburse')">
                <select class="unit-select" id="${category}_${item.code}_reimbUnit"
                        onchange="saveToLocalStorage()">
                    <option value="Pieces">Pieces</option>
                </select>
            </div>
        </td>
    `;
    
    return row;
}

function handleInputChange(category, code, field) {
    const input = document.getElementById(`${category}_${code}_${field}`);
    if (input) {
        input.dataset.locallyModified = 'true';
    }
    
    calculateDifference(category, code);
    saveToLocalStorage();
    
    // Mark as pending sync
    if (STATE.isOnline) {
        scheduleAutoSave();
    }
}

function scheduleAutoSave() {
    clearTimeout(window.autoSaveTimer);
    window.autoSaveTimer = setTimeout(() => {
        if (STATE.pendingChanges.length > 0) {
            saveData();
        }
    }, 30000); // Auto-save after 30 seconds of inactivity
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

async function callGoogleScript(data) {
    const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        mode: 'cors'
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

function updateSyncStatus(status) {
    const indicator = document.getElementById('syncIndicator');
    const statusText = document.getElementById('syncStatus');
    
    if (indicator && statusText) {
        statusText.textContent = status;
        
        indicator.classList.remove('synced', 'error');
        if (status === 'Connected' || status === 'Saved' || status === 'Loaded') {
            indicator.classList.add('synced');
        } else if (status.includes('Error') || status === 'Offline') {
            indicator.classList.add('error');
        }
    }
    
    STATE.syncStatus = status;
}

function updateActiveUsersDisplay(count) {
    const userIndicator = document.getElementById('userIndicator');
    if (userIndicator) {
        userIndicator.classList.remove('hidden');
        userIndicator.classList.add('has-users');
        userIndicator.innerHTML = `
            <strong>${count}</strong> ${count === 1 ? 'user' : 'users'} active
            <br><small>${CONFIG.USER_NAME} (You)</small>
        `;
    }
}

function showNotification(message, type = 'info') {
    const statusDiv = document.getElementById('statusMessage');
    if (statusDiv) {
        statusDiv.className = `status-message status-${type}`;
        statusDiv.textContent = message;
        statusDiv.classList.remove('hidden');
        
        setTimeout(() => {
            statusDiv.classList.add('hidden');
        }, 4000);
    }
}

function checkOnlineStatus() {
    window.addEventListener('online', () => {
        STATE.isOnline = true;
        updateSyncStatus('Reconnecting...');
        syncPendingChanges();
    });
    
    window.addEventListener('offline', () => {
        STATE.isOnline = false;
        updateSyncStatus('Offline');
    });
}

async function syncPendingChanges() {
    if (STATE.pendingChanges.length > 0 && STATE.isOnline) {
        for (const change of STATE.pendingChanges) {
            await saveData();
        }
    }
}

function savePendingChanges(data) {
    STATE.pendingChanges.push({
        timestamp: Date.now(),
        data: data
    });
    
    localStorage.setItem('pendingChanges', JSON.stringify(STATE.pendingChanges));
}

function clearLocalModifications() {
    document.querySelectorAll('[data-locally-modified]').forEach(el => {
        delete el.dataset.locallyModified;
    });
}

// Export functions for global access
window.selectRoute = selectRoute;
window.toggleCategory = toggleCategory;
window.calculateDifference = calculateDifference;
window.lockItem = lockItem;
window.unlockItem = unlockItem;
window.handleInputChange = handleInputChange;
window.handleEnterKey = handleEnterKey;
window.saveData = saveData;
window.exportReport = exportReport;
window.clearData = clearData;
window.autoCalculate = autoCalculate;
window.loadPreviousData = loadPreviousData;
window.fetchSalesData = fetchSalesData;

// Implement the exported functions
function selectRoute(route) {
    STATE.currentRoute = route;
    document.getElementById('selectedRoute').textContent = route;
    
    document.querySelectorAll('.route-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent === route || (btn.textContent === 'Wholesale' && route === 'Al-Hasa Wholesale')) {
            btn.classList.add('active');
        }
    });
    
    // Load data for this route
    loadInventoryData();
    saveToLocalStorage();
}

function toggleCategory(cardId) {
    const card = document.getElementById(cardId);
    if (card) {
        card.classList.toggle('collapsed');
    }
}

function calculateDifference(category, code) {
    const item = INVENTORY[category].find(i => i.code === code);
    if (!item) return;
    
    // Get values and units
    const physical = parseFloat(document.getElementById(`${category}_${code}_physical`)?.value) || 0;
    const physUnit = document.getElementById(`${category}_${code}_physUnit`)?.value;
    const system = parseFloat(document.getElementById(`${category}_${code}_system`)?.value) || 0;
    const sysUnit = document.getElementById(`${category}_${code}_sysUnit`)?.value;
    
    // Apply conversions
    const physConv = item.conversion[physUnit] || 1;
    const sysConv = item.conversion[sysUnit] || 1;
    
    const physicalBase = physical * physConv;
    const systemBase = system * sysConv;
    const difference = physicalBase - systemBase;
    
    // Update display
    const diffEl = document.getElementById(`${category}_${code}_diff`);
    if (diffEl) {
        diffEl.textContent = difference;
        diffEl.className = 'difference';
        
        if (difference < 0) {
            diffEl.classList.add('shortage');
        } else if (difference > 0) {
            diffEl.classList.add('excess');
        } else {
            diffEl.classList.add('match');
        }
    }
    
    updateSummary();
    saveToLocalStorage();
}

function updateSummary() {
    let matched = 0, shortage = 0, excess = 0, total = 0;
    
    Object.keys(INVENTORY).forEach(category => {
        INVENTORY[category].forEach(item => {
            const diffEl = document.getElementById(`${category}_${item.code}_diff`);
            if (diffEl) {
                const diff = parseFloat(diffEl.textContent) || 0;
                total++;
                if (diff === 0) matched++;
                else if (diff < 0) shortage++;
                else if (diff > 0) excess++;
            }
        });
    });
    
    document.getElementById('totalItems').textContent = total;
    document.getElementById('itemsMatched').textContent = matched;
    document.getElementById('itemsShortage').textContent = shortage;
    document.getElementById('itemsExcess').textContent = excess;
}

function saveToLocalStorage() {
    const data = {
        route: STATE.currentRoute,
        date: STATE.currentDate,
        items: collectInventoryData()
    };
    localStorage.setItem('inventoryData', JSON.stringify(data));
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('inventoryData');
    if (!saved) return;
    
    try {
        const data = JSON.parse(saved);
        
        if (data.route) {
            selectRoute(data.route);
        }
        
        if (data.date) {
            document.getElementById('verificationDate').value = data.date;
            STATE.currentDate = data.date;
        }
        
        if (data.items && Array.isArray(data.items)) {
            data.items.forEach(item => {
                const category = item.category.toLowerCase();
                const inputId = `${category}_${item.code}`;
                updateItemFields(inputId, item);
            });
        }
        
        updateSummary();
    } catch (error) {
        console.error('Error loading saved data:', error);
    }
}

function setupEventListeners() {
    const dateInput = document.getElementById('verificationDate');
    if (dateInput) {
        dateInput.addEventListener('change', (e) => {
            STATE.currentDate = e.target.value;
            loadInventoryData();
        });
    }
}

function handleEnterKey(event, category, code, field) {
    if (event.key === 'Enter') {
        const inputs = document.querySelectorAll('.stock-input');
        const currentInput = event.target;
        const currentIndex = Array.from(inputs).indexOf(currentInput);
        
        if (currentIndex < inputs.length - 1) {
            inputs[currentIndex + 1].focus();
        }
    }
}

function autoCalculate() {
    Object.keys(INVENTORY).forEach(category => {
        INVENTORY[category].forEach(item => {
            calculateDifference(category, item.code);
        });
    });
    showNotification('All differences calculated!', 'success');
}

function clearData() {
    if (!confirm('Are you sure you want to clear all data?')) return;
    
    document.querySelectorAll('.stock-input').forEach(input => {
        input.value = '';
        delete input.dataset.locallyModified;
    });
    
    document.querySelectorAll('.difference').forEach(diff => {
        diff.textContent = '0';
        diff.className = 'difference match';
    });
    
    updateSummary();
    saveToLocalStorage();
    showNotification('Data cleared!', 'success');
}

async function loadPreviousData() {
    if (!STATE.currentRoute) {
        showNotification('Please select a route first!', 'warning');
        return;
    }
    
    const yesterday = new Date(STATE.currentDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const prevDate = yesterday.toISOString().split('T')[0];
    
    try {
        const response = await callGoogleScript({
            action: 'getInventoryData',
            route: STATE.currentRoute,
            date: prevDate
        });
        
        if (response.status === 'success' && response.data.items.length > 0) {
            response.data.items.forEach(item => {
                const category = item.category.toLowerCase();
                // Load previous physical as today's system
                const sysInput = document.getElementById(`${category}_${item.code}_system`);
                const sysUnit = document.getElementById(`${category}_${item.code}_sysUnit`);
                
                if (sysInput && sysUnit) {
                    sysInput.value = item.physical;
                    sysUnit.value = item.physUnit;
                    calculateDifference(category, item.code);
                }
            });
            
            showNotification('Previous data loaded as template!', 'success');
        } else {
            showNotification('No previous data found', 'info');
        }
    } catch (error) {
        console.error('Failed to load previous data:', error);
        showNotification('Error loading previous data', 'error');
    }
}

async function fetchSalesData() {
    if (!STATE.currentRoute) {
        showNotification('Please select a route first!', 'warning');
        return;
    }
    
    showNotification('Fetching sales data...', 'info');
    
    // This would integrate with your sales module
    // For now, show a message
    showNotification('Use the Sales Module to calculate sales from inventory', 'info');
}

function exportReport() {
    const data = collectInventoryData();
    
    if (data.length === 0) {
        showNotification('No data to export!', 'warning');
        return;
    }
    
    let csv = 'Date,Route,Category,Code,Item,Physical,P.Unit,Transfer,T.Unit,System,S.Unit,Difference,Reimbursed,R.Unit\n';
    
    data.forEach(row => {
        csv += `${STATE.currentDate},${STATE.currentRoute},${row.category},${row.code},"${row.name}",`;
        csv += `${row.physical},${row.physUnit},${row.transfer},${row.transUnit},`;
        csv += `${row.system},${row.sysUnit},${row.difference},${row.reimburse},${row.reimbUnit}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory_${STATE.currentRoute}_${STATE.currentDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('Report exported successfully!', 'success');
}