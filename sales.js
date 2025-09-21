// ==========================================
// REAL-TIME SALES & CASH RECONCILIATION MODULE
// ==========================================

// Configuration
const CONFIG = {
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyWBHL4aamfkpzUxZL9mxeBqkgbJNgSbap6iU2z6WpU7zzQfb2L4JDUBNDfwGWPZ4GbYA/exec', // Replace with your deployed URL
    HEARTBEAT_INTERVAL: 15000, // 15 seconds
    POLL_INTERVAL: 5000, // 5 seconds
    USER_ID: localStorage.getItem('userId') || generateUserId(),
    USER_NAME: localStorage.getItem('userName') || prompt('Enter your name:') || 'Sales User',
    AUTO_SAVE_INTERVAL: 30000 // 30 seconds
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
    syncStatus: 'idle',
    salesData: {}
};

// Product pricing data (SAR)
const PRODUCTS = {
    sunflower: [
        { code: '4402', name: '200g Pack', unit: 'Bag', price: 58 },
        { code: '4401', name: '100g Pack', unit: 'Bag', price: 34 },
        { code: '1129', name: '25g Pack', unit: 'Bag', price: 16 },
        { code: '1116', name: '800g Pack', unit: 'Bag', price: 17 },
        { code: '1145', name: '130g Pack', unit: 'Box', price: 54 },
        { code: '1126', name: '10KG Bulk', unit: 'Sack', price: 160 }
    ],
    pumpkin: [
        { code: '8001', name: '15g Pack', unit: 'Box', price: 16 },
        { code: '8002', name: '110g Pack', unit: 'Box', price: 54 },
        { code: '1142', name: '10KG Bulk', unit: 'Sack', price: 230 }
    ],
    melon: [
        { code: '9001', name: '15g Pack', unit: 'Box', price: 16 },
        { code: '9002', name: '110g Pack', unit: 'Box', price: 54 }
    ],
    popcorn: [
        { code: '1701', name: 'Cheese', unit: 'Bag', price: 5 },
        { code: '1702', name: 'Butter', unit: 'Bag', price: 5 },
        { code: '1703', name: 'Lightly Salted', unit: 'Bag', price: 5 }
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
    const dateInput = document.getElementById('salesDate');
    if (dateInput) {
        dateInput.value = today.toISOString().split('T')[0];
        STATE.currentDate = dateInput.value;
    }
    
    renderSalesTable();
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
            module: 'sales'
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
        }
    } catch (error) {
        console.error('Failed to get active users:', error);
    }
}

function processUpdates(data) {
    if (data.serverTimestamp) {
        STATE.lastServerTimestamp = data.serverTimestamp;
    }
    
    // Check if another user has updated sales data
    if (data.updates && data.updates.length > 0) {
        data.updates.forEach(update => {
            if (update.type === 'cash_update' && update.route === STATE.currentRoute) {
                showNotification('Cash reconciliation updated by another user', 'info');
                // Optionally reload the data
                if (!hasUnsavedChanges()) {
                    loadLatestData();
                }
            }
        });
    }
}

// ==========================================
// SALES TABLE RENDERING
// ==========================================

function renderSalesTable() {
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    Object.entries(PRODUCTS).forEach(([category, items]) => {
        items.forEach(item => {
            const row = tbody.insertRow();
            row.id = `row_${item.code}`;
            row.innerHTML = `
                <td>${category.charAt(0).toUpperCase() + category.slice(1)}</td>
                <td>${item.code}</td>
                <td>${item.name}</td>
                <td>${item.unit}</td>
                <td>${item.price}</td>
                <td>
                    <input type="number" class="qty-input" 
                           id="qty_${item.code}" 
                           placeholder="0" min="0" 
                           data-price="${item.price}"
                           onchange="handleQuantityChange('${item.code}')"
                           onfocus="lockSalesItem('${item.code}')"
                           onblur="unlockSalesItem('${item.code}')">
                </td>
                <td id="total_${item.code}" class="item-total">0.00</td>
            `;
        });
    });
}

// ==========================================
// SALES CALCULATIONS
// ==========================================

function handleQuantityChange(itemCode) {
    const qtyInput = document.getElementById(`qty_${itemCode}`);
    const qty = parseFloat(qtyInput.value) || 0;
    const price = parseFloat(qtyInput.dataset.price) || 0;
    const itemTotal = qty * price;
    
    // Update item total
    document.getElementById(`total_${itemCode}`).textContent = itemTotal.toFixed(2);
    
    // Mark as modified
    qtyInput.dataset.modified = 'true';
    
    // Calculate total sales
    calculateSalesTotal();
    
    // Auto-save after delay
    scheduleAutoSave();
}

function calculateSalesTotal() {
    let total = 0;
    
    document.querySelectorAll('.qty-input').forEach(input => {
        const qty = parseFloat(input.value) || 0;
        const price = parseFloat(input.dataset.price) || 0;
        total += qty * price;
    });
    
    document.getElementById('totalSalesDisplay').textContent = `SAR ${total.toFixed(2)}`;
    document.getElementById('totalSalesValue').value = total.toFixed(2);
    document.getElementById('summaryTotalSales').textContent = `SAR ${total.toFixed(2)}`;
    
    calculateCashBalance();
    saveToLocalStorage();
}

function calculateCashBalance() {
    const totalSales = parseFloat(document.getElementById('totalSalesValue').value) || 0;
    const creditSales = parseFloat(document.getElementById('creditSales').value) || 0;
    const creditRepayment = parseFloat(document.getElementById('creditRepayment').value) || 0;
    const bankPOS = parseFloat(document.getElementById('bankPOS').value) || 0;
    const bankTransfer = parseFloat(document.getElementById('bankTransfer').value) || 0;
    const cheque = parseFloat(document.getElementById('cheque').value) || 0;
    
    const expectedCash = totalSales - creditSales + creditRepayment - bankPOS - bankTransfer - cheque;
    
    document.getElementById('expectedCashBalance').value = expectedCash.toFixed(2);
    
    // Update summary
    document.getElementById('summaryCreditSales').textContent = `SAR ${creditSales.toFixed(2)}`;
    const bankDeposits = bankPOS + bankTransfer + cheque;
    document.getElementById('summaryBankDeposits').textContent = `SAR ${bankDeposits.toFixed(2)}`;
    
    calculateDifference();
    saveToLocalStorage();
}

function calculateCashNotes() {
    const denominations = [500, 100, 50, 20, 10, 5];
    let total = 0;
    
    denominations.forEach(denom => {
        const count = parseInt(document.getElementById(`note${denom}`).value) || 0;
        const value = count * denom;
        document.getElementById(`val${denom}`).textContent = value;
        total += value;
    });
    
    document.getElementById('cashNotes').value = total.toFixed(2);
    calculateActualCash();
}

function calculateActualCash() {
    const notes = parseFloat(document.getElementById('cashNotes').value) || 0;
    const coins = parseFloat(document.getElementById('coinsTotal').value) || 0;
    const actualTotal = notes + coins;
    
    document.getElementById('actualCashTotal').value = actualTotal.toFixed(2);
    document.getElementById('summaryCashCollected').textContent = `SAR ${actualTotal.toFixed(2)}`;
    
    calculateDifference();
    saveToLocalStorage();
}

function calculateDifference() {
    const expected = parseFloat(document.getElementById('expectedCashBalance').value) || 0;
    const actual = parseFloat(document.getElementById('actualCashTotal').value) || 0;
    const difference = actual - expected;
    
    const indicator = document.getElementById('differenceIndicator');
    const diffDisplay = document.getElementById('cashDifference');
    const statusDisplay = document.getElementById('differenceStatus');
    
    if (diffDisplay) {
        diffDisplay.textContent = `SAR ${difference.toFixed(2)}`;
    }
    
    if (indicator && statusDisplay) {
        indicator.className = 'difference-indicator';
        
        if (Math.abs(difference) < 0.01) {
            indicator.classList.add('balanced');
            statusDisplay.textContent = 'Cash Balanced ✓';
        } else if (difference < 0) {
            indicator.classList.add('shortage');
            statusDisplay.textContent = `Cash Short by SAR ${Math.abs(difference).toFixed(2)}`;
        } else {
            indicator.classList.add('excess');
            statusDisplay.textContent = `Cash Over by SAR ${difference.toFixed(2)}`;
        }
    }
}

// ==========================================
// INVENTORY INTEGRATION
// ==========================================

async function fetchInventoryData() {
    if (!STATE.currentRoute) {
        showNotification('Please select a route first!', 'error');
        return;
    }
    
    const salesDate = STATE.currentDate;
    if (!salesDate) {
        showNotification('Please select a date!', 'error');
        return;
    }
    
    // Calculate previous day
    const currentDate = new Date(salesDate);
    const previousDate = new Date(currentDate);
    previousDate.setDate(previousDate.getDate() - 1);
    const prevDateStr = previousDate.toISOString().split('T')[0];
    
    showNotification('Fetching inventory data to calculate sales...', 'info');
    updateSyncStatus('Calculating...');
    
    try {
        const response = await callGoogleScript({
            action: 'calculateSalesFromInventory',
            route: STATE.currentRoute,
            currentDate: salesDate,
            previousDate: prevDateStr
        });
        
        if (response.status === 'success' && response.data) {
            populateSalesData(response.data);
            showNotification('Sales calculated from inventory differences!', 'success');
            updateSyncStatus('Connected');
        } else {
            showNotification('No inventory data found for calculation', 'warning');
        }
    } catch (error) {
        console.error('Error fetching inventory data:', error);
        showNotification('Unable to fetch inventory data', 'error');
        updateSyncStatus('Error');
    }
}

function populateSalesData(salesData) {
    // Clear existing quantities
    document.querySelectorAll('.qty-input').forEach(input => {
        input.value = '';
        delete input.dataset.modified;
    });
    
    // Populate calculated sales quantities
    salesData.forEach(item => {
        const qtyInput = document.getElementById(`qty_${item.code}`);
        if (qtyInput) {
            qtyInput.value = item.salesQty;
            handleQuantityChange(item.code);
        }
    });
    
    // Recalculate totals
    calculateSalesTotal();
}

// ==========================================
// DATA PERSISTENCE
// ==========================================

async function saveData() {
    if (!STATE.currentRoute) {
        showNotification('Please select a route!', 'error');
        return;
    }
    
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) saveBtn.disabled = true;
    
    updateSyncStatus('Saving...');
    
    const data = collectData();
    
    try {
        const response = await callGoogleScript({
            action: 'saveCashReconciliation',
            ...data
        });
        
        if (response.status === 'success') {
            showNotification('Data saved successfully!', 'success');
            updateSyncStatus('Saved');
            clearModifiedFlags();
            STATE.pendingChanges = [];
            
            // Save backup locally
            saveBackup(data);
        } else {
            throw new Error(response.data || 'Save failed');
        }
    } catch (error) {
        console.error('Save error:', error);
        showNotification('Failed to save. Data saved locally.', 'error');
        savePendingChanges(data);
        updateSyncStatus('Offline - Changes pending');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function collectData() {
    // Collect sales items
    const salesItems = [];
    
    Object.entries(PRODUCTS).forEach(([category, items]) => {
        items.forEach(item => {
            const qty = parseFloat(document.getElementById(`qty_${item.code}`)?.value) || 0;
            if (qty > 0) {
                salesItems.push({
                    category: category.toUpperCase(),
                    code: item.code,
                    name: item.name,
                    unit: item.unit,
                    price: item.price,
                    quantity: qty,
                    total: qty * item.price
                });
            }
        });
    });
    
    // Collect cash reconciliation data
    return {
        route: STATE.currentRoute,
        date: STATE.currentDate,
        salesItems: salesItems,
        totalSales: parseFloat(document.getElementById('totalSalesValue')?.value) || 0,
        creditSales: parseFloat(document.getElementById('creditSales')?.value) || 0,
        creditRepayment: parseFloat(document.getElementById('creditRepayment')?.value) || 0,
        bankPOS: parseFloat(document.getElementById('bankPOS')?.value) || 0,
        bankTransfer: parseFloat(document.getElementById('bankTransfer')?.value) || 0,
        cheque: parseFloat(document.getElementById('cheque')?.value) || 0,
        expectedCash: parseFloat(document.getElementById('expectedCashBalance')?.value) || 0,
        cashNotes: {
            total: parseFloat(document.getElementById('cashNotes')?.value) || 0,
            denominations: {
                500: parseInt(document.getElementById('note500')?.value) || 0,
                100: parseInt(document.getElementById('note100')?.value) || 0,
                50: parseInt(document.getElementById('note50')?.value) || 0,
                20: parseInt(document.getElementById('note20')?.value) || 0,
                10: parseInt(document.getElementById('note10')?.value) || 0,
                5: parseInt(document.getElementById('note5')?.value) || 0
            }
        },
        coins: parseFloat(document.getElementById('coinsTotal')?.value) || 0,
        actualCash: parseFloat(document.getElementById('actualCashTotal')?.value) || 0,
        difference: parseFloat(document.getElementById('actualCashTotal')?.value || 0) - 
                   parseFloat(document.getElementById('expectedCashBalance')?.value || 0),
        timestamp: new Date().toISOString()
    };
}

function saveToLocalStorage() {
    const data = collectData();
    localStorage.setItem('cashReconciliationData', JSON.stringify(data));
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('cashReconciliationData');
    if (!saved) return;
    
    try {
        const data = JSON.parse(saved);
        
        if (data.route) selectRoute(data.route);
        if (data.date) {
            document.getElementById('salesDate').value = data.date;
            STATE.currentDate = data.date;
        }
        
        // Load sales items
        if (data.salesItems) {
            data.salesItems.forEach(item => {
                const qtyInput = document.getElementById(`qty_${item.code}`);
                if (qtyInput) {
                    qtyInput.value = item.quantity;
                    handleQuantityChange(item.code);
                }
            });
        }
        
        // Load payment data
        ['creditSales', 'creditRepayment', 'bankPOS', 'bankTransfer', 'cheque', 'coinsTotal'].forEach(field => {
            const input = document.getElementById(field);
            if (input && data[field] !== undefined) {
                input.value = data[field];
            }
        });
        
        // Load denominations
        if (data.cashNotes && data.cashNotes.denominations) {
            Object.entries(data.cashNotes.denominations).forEach(([denom, count]) => {
                const input = document.getElementById(`note${denom}`);
                if (input) input.value = count;
            });
        }
        
        // Recalculate
        calculateSalesTotal();
        calculateCashNotes();
    } catch (error) {
        console.error('Error loading saved data:', error);
    }
}

async function loadLatestData() {
    if (!STATE.currentRoute || !STATE.currentDate) return;
    
    updateSyncStatus('Loading...');
    
    try {
        const response = await callGoogleScript({
            action: 'getCashReconciliationData',
            route: STATE.currentRoute,
            date: STATE.currentDate
        });
        
        if (response.status === 'success' && response.data) {
            // Populate the form with server data
            populateFormData(response.data);
            updateSyncStatus('Loaded');
        }
    } catch (error) {
        console.error('Load error:', error);
        updateSyncStatus('Error');
    }
}

// ==========================================
// ITEM LOCKING
// ==========================================

async function lockSalesItem(itemCode) {
    if (!STATE.currentRoute) return;
    
    try {
        const response = await callGoogleScript({
            action: 'lockItem',
            route: STATE.currentRoute,
            itemCode: `sales_${itemCode}`,
            userId: CONFIG.USER_ID
        });
        
        if (response.status === 'success') {
            const row = document.getElementById(`row_${itemCode}`);
            if (row) row.classList.add('item-locked');
        }
    } catch (error) {
        console.error('Failed to lock item:', error);
    }
}

async function unlockSalesItem(itemCode) {
    if (!STATE.currentRoute) return;
    
    try {
        await callGoogleScript({
            action: 'unlockItem',
            route: STATE.currentRoute,
            itemCode: `sales_${itemCode}`,
            userId: CONFIG.USER_ID
        });
        
        const row = document.getElementById(`row_${itemCode}`);
        if (row) row.classList.remove('item-locked');
    } catch (error) {
        console.error('Failed to unlock item:', error);
    }
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
    loadLatestData();
    saveToLocalStorage();
}

function exportReport() {
    const data = collectData();
    const date = STATE.currentDate;
    
    let csv = 'Daily Cash Reconciliation Report - ARS International\n';
    csv += `Date: ${date}\n`;
    csv += `Route: ${STATE.currentRoute || 'Not Selected'}\n\n`;
    
    csv += 'SALES ITEMS\n';
    csv += 'Category,Code,Item,Unit,Price,Quantity,Total\n';
    data.salesItems.forEach(item => {
        csv += `${item.category},${item.code},${item.name},${item.unit},${item.price},${item.quantity},${item.total}\n`;
    });
    
    csv += '\nCASH RECONCILIATION\n';
    csv += `Total Sales,${data.totalSales}\n`;
    csv += `Credit Sales,${data.creditSales}\n`;
    csv += `Credit Repayment,${data.creditRepayment}\n`;
    csv += `Bank POS,${data.bankPOS}\n`;
    csv += `Bank Transfer,${data.bankTransfer}\n`;
    csv += `Cheque,${data.cheque}\n`;
    csv += `Expected Cash,${data.expectedCash}\n`;
    csv += `Actual Cash,${data.actualCash}\n`;
    csv += `Difference,${data.difference}\n`;
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cash_reconciliation_${STATE.currentRoute}_${date}.csv`;
    a.click();
    
    showNotification('Report exported!', 'success');
}

function clearData() {
    if (!confirm('Clear all data?')) return;
    
    // Clear sales quantities
    document.querySelectorAll('.qty-input').forEach(input => {
        input.value = '';
        delete input.dataset.modified;
    });
    
    // Clear payment fields
    ['creditSales', 'creditRepayment', 'bankPOS', 'bankTransfer', 'cheque', 'coinsTotal'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
    
    // Clear denomination counts
    [500, 100, 50, 20, 10, 5].forEach(denom => {
        const input = document.getElementById(`note${denom}`);
        if (input) input.value = '';
    });
    
    // Recalculate
    calculateSalesTotal();
    showNotification('Data cleared!', 'success');
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
    if (!userIndicator) {
        const div = document.createElement('div');
        div.id = 'userIndicator';
        div.className = 'user-indicator';
        document.body.appendChild(div);
    }
    
    const indicator = document.getElementById('userIndicator');
    indicator.classList.remove('hidden');
    indicator.innerHTML = `
        <strong>${count}</strong> ${count === 1 ? 'user' : 'users'} active
        <br><small>${CONFIG.USER_NAME} (You)</small>
    `;
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

function hasUnsavedChanges() {
    return document.querySelectorAll('[data-modified="true"]').length > 0;
}

function clearModifiedFlags() {
    document.querySelectorAll('[data-modified]').forEach(el => {
        delete el.dataset.modified;
    });
}

function scheduleAutoSave() {
    clearTimeout(window.autoSaveTimer);
    window.autoSaveTimer = setTimeout(() => {
        if (hasUnsavedChanges() && STATE.isOnline) {
            saveData();
        }
    }, CONFIG.AUTO_SAVE_INTERVAL);
}

function saveBackup(data) {
    const backups = JSON.parse(localStorage.getItem('dataBackups') || '[]');
    backups.push({
        date: new Date().toISOString(),
        data: data
    });
    
    // Keep only last 10 backups
    if (backups.length > 10) {
        backups.shift();
    }
    
    localStorage.setItem('dataBackups', JSON.stringify(backups));
}

function savePendingChanges(data) {
    STATE.pendingChanges.push({
        timestamp: Date.now(),
        data: data
    });
    
    localStorage.setItem('pendingChanges', JSON.stringify(STATE.pendingChanges));
}

async function syncPendingChanges() {
    if (STATE.pendingChanges.length > 0 && STATE.isOnline) {
        for (const change of STATE.pendingChanges) {
            try {
                await callGoogleScript({
                    action: 'saveCashReconciliation',
                    ...change.data
                });
            } catch (error) {
                console.error('Failed to sync pending change:', error);
            }
        }
        STATE.pendingChanges = [];
        localStorage.removeItem('pendingChanges');
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

function setupEventListeners() {
    const dateInput = document.getElementById('salesDate');
    if (dateInput) {
        dateInput.addEventListener('change', (e) => {
            STATE.currentDate = e.target.value;
            loadLatestData();
        });
    }
    
    // Add listeners for cash inputs
    ['creditSales', 'creditRepayment', 'bankPOS', 'bankTransfer', 'cheque'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', () => {
                calculateCashBalance();
                scheduleAutoSave();
            });
        }
    });
    
    // Add listeners for denomination inputs
    [500, 100, 50, 20, 10, 5].forEach(denom => {
        const input = document.getElementById(`note${denom}`);
        if (input) {
            input.addEventListener('change', calculateCashNotes);
        }
    });
    
    const coinsInput = document.getElementById('coinsTotal');
    if (coinsInput) {
        coinsInput.addEventListener('change', calculateActualCash);
    }
}

// Export functions for global access
window.selectRoute = selectRoute;
window.fetchInventoryData = fetchInventoryData;
window.saveData = saveData;
window.exportReport = exportReport;
window.clearData = clearData;
window.calculateCashBalance = calculateCashBalance;
window.calculateCashNotes = calculateCashNotes;
window.calculateActualCash = calculateActualCash;