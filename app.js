// ==================== Supabase + Cloudflare R2 設定 ====================
// ⚠️ 以下の値を必ず実際の値に置き換えてください！
const SUPABASE_URL = 'https://syfisvqcoealxjmmiijm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5ZmlzdnFjb2VhbHhqbW1paWptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0ODc4ODMsImV4cCI6MjA3NTA2Mzg4M30.J4sUJREbL5PIyV9riZ2vvvgSi0WpYER1xT752yjThxw';
const CLOUDFLARE_WORKER_URL = 'https://receipt-upload-api.photo-firefly-conva.workers.dev/';

// Supabaseクライアント初期化
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 現在のユーザー状態
let currentUser = null;

// ==================== 認証関連 ====================
function updateAuthUI(user) {
    const signInBtn = document.getElementById('googleSignInBtn');
    const syncStatus = document.getElementById('syncStatus');
    
    if (user) {
        currentUser = user;
        if (signInBtn) signInBtn.innerHTML = '🔓 ログアウト';
        if (syncStatus) {
            syncStatus.innerHTML = `✅ ${user.email || 'ログイン中'}`;
            syncStatus.classList.add('active');
        }
        loadUserExpenses();
    } else {
        currentUser = null;
        if (signInBtn) signInBtn.innerHTML = '🔐 Googleでログイン';
        if (syncStatus) {
            syncStatus.innerHTML = '❌ ログアウト中';
            syncStatus.classList.remove('active');
        }
        clearUserData();
    }
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log('Auth event:', event);
    updateAuthUI(session?.user || null);
});

async function toggleAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) console.error('ログアウトエラー:', error);
    } else {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.href
            }
        });
        if (error) console.error('ログインエラー:', error);
    }
}

// ==================== データ操作 ====================
async function uploadImage(file) {
    if (!currentUser) throw new Error('ログインが必要です');
    
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('認証セッションが無効です');
    
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(CLOUDFLARE_WORKER_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${session.access_token}`
        },
        body: formData
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`画像のアップロードに失敗しました: ${errorText}`);
    }
    
    return await response.json();
}

async function saveExpenseToSupabase(expenseData, imageFile) {
    if (!currentUser) {
        showNotification('ログインしてください', 'error');
        return null;
    }
    
    try {
        showProgress('クラウドに保存中...');
        
        let imageUrl = null;
        if (imageFile) {
            const uploadResult = await uploadImage(imageFile);
            if (!uploadResult.success) throw new Error(uploadResult.error);
            imageUrl = uploadResult.url;
        }
        
        const expenseToInsert = {
            user_id: currentUser.id,
            store_name: expenseData.storeName || null,
            category: expenseData.category,
            amount: expenseData.amount,
            date: expenseData.date,
            payment_method: expenseData.paymentMethod || '現金',
            project: expenseData.project || null,
            memo: expenseData.memo || null,
            invoice_number: expenseData.invoiceNumber || null,
            tax_excluded: expenseData.taxExcluded || null,
            tax: expenseData.tax || null,
            image_url: imageUrl,
            status: 'active'
        };
        
        const { data, error } = await supabaseClient
            .from('expenses')
            .insert([expenseToInsert])
            .select()
            .single();
        
        if (error) throw error;
        
        hideProgress();
        showNotification('経費をクラウドに保存しました', 'success');
        return data; // 保存したデータを返す
        
    } catch (error) {
        hideProgress();
        console.error('保存エラー:', error);
        showNotification('保存に失敗しました: ' + error.message, 'error');
        return null;
    }
}

async function loadUserExpenses() {
    if (!currentUser) return;
　showProgress('データを読み込み中...'); 
    
    try {
        const { data, error } = await supabaseClient
            .from('expenses')
            .select('*')
            .eq('status', 'active')
            .order('date', { ascending: false });
        
        if (error) throw error;
        
        if (window.expenseManager) {
            window.expenseManager.expenses = data || [];
            window.expenseManager.renderExpenses();
            window.expenseManager.updateStats();
            window.expenseManager.setupFilters(); // フィルターも更新
        }
        
    } catch (error) {
        console.error('データ読み込みエラー:', error);
    }finally {
        hideProgress(); // ← 追加
}
    }

function clearUserData() {
    if (window.expenseManager) {
        window.expenseManager.expenses = [];
        window.expenseManager.renderExpenses();
        window.expenseManager.updateStats();
    }
}

// グローバルスコープのヘルパー関数
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    if (!notification) return;
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    setTimeout(() => notification.classList.remove('show'), 3000);
}

function showProgress(text = '処理中...') {
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.querySelector('.progress-text').textContent = text;
        progressBar.classList.remove('hidden');
    }
}

function hideProgress() {
    const progressBar = document.getElementById('progressBar');
    if (progressBar) progressBar.classList.add('hidden');
}
// ▼▼▼ ここから追加 ▼▼▼
function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.style.display = 'none';
}

async function updateExpense() {
    if (!window.expenseManager) return;
    const id = document.getElementById('editExpenseId').value;
    
    const updatedData = {
        date: document.getElementById('editDate').value,
        store_name: document.getElementById('editStoreName').value,
        category: document.getElementById('editCategory').value,
        amount: parseFloat(document.getElementById('editAmount').value),
        memo: document.getElementById('editMemo').value,
         tax_rate: parseInt(document.querySelector('input[name="editTaxRate"]:checked').value)
    };

    await window.expenseManager.updateExpenseInCloud(id, updatedData);
    closeEditModal();
}

// ==================== 経費精算アプリ メインロジック ====================
class ExpenseManager {
    constructor() {
        this.expenses = []; // 初期データはクラウドから読み込むので空にする
        this.currentImageFile = null; // base64ではなくFileオブジェクトを保持
        this.isProcessing = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderExpenses();
        this.updateStats();
        this.setupFilters();
        this.setupDragAndDrop();
    }

    setupEventListeners() {
        document.getElementById('receiptInput')?.addEventListener('change', (e) => this.handleImageUpload(e));
        document.getElementById('amount')?.addEventListener('input', () => this.calculateTax());
        document.getElementById('saveExpense')?.addEventListener('click', () => this.saveExpense());
        document.getElementById('exportCSV')?.addEventListener('click', () => this.exportToCSV());
        document.getElementById('generateReport')?.addEventListener('click', () => this.generateMonthlyReport());
        document.getElementById('quickAddBtn')?.addEventListener('click', () => document.getElementById('receiptInput').click());
        document.getElementById('searchBox')?.addEventListener('input', () => this.filterExpenses());
        document.getElementById('filterMonth')?.addEventListener('change', () => this.filterExpenses());
        document.getElementById('filterCategory')?.addEventListener('change', () => this.filterExpenses());
        // 税率ラジオボタンの変更を監視
        document.querySelectorAll('input[name="taxRate"]').forEach(radio => {
            radio.addEventListener('change', () => this.calculateTax());
       });
        }

    setupDragAndDrop() {
        const captureArea = document.getElementById('captureArea');
        if (!captureArea) return;
        ['dragover', 'dragleave', 'drop'].forEach(eventName => captureArea.addEventListener(eventName, e => e.preventDefault()));
        captureArea.addEventListener('dragover', () => captureArea.classList.add('dragover'));
        captureArea.addEventListener('dragleave', () => captureArea.classList.remove('dragover'));
        captureArea.addEventListener('drop', (e) => {
            captureArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                this.processImage(file);
            }
        });
    }

    handleImageUpload(event) {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            this.processImage(file);
        }
    }

    async processImage(file) {
        this.currentImageFile = file; // Fileオブジェクトを保持
        const reader = new FileReader();
        reader.onload = async (e) => {
            const resizedImageSrc = await this.resizeImage(e.target.result, 1500);
            this.displayImagePreview(resizedImageSrc);
            // ★★★ 変更点 ★★★
            // リサイズ後の画像ではなく、元のFileオブジェクトを渡す
            this.performOCR(this.currentImageFile); 
        };
        reader.readAsDataURL(file);
    }
    
    async resizeImage(base64Str, maxWidth) {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = base64Str;
            img.onload = () => {
                if (img.width <= maxWidth) {
                    resolve(base64Str);
                    return;
                }
                const canvas = document.createElement('canvas');
                const scale = maxWidth / img.width;
                canvas.width = maxWidth;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg'));
            };
        });
    }

    displayImagePreview(imageSrc) {
        const previewDiv = document.getElementById('imagePreview');
        const previewImg = document.getElementById('previewImg');
        if (previewDiv && previewImg) {
            previewImg.src = imageSrc;
            previewDiv.classList.remove('hidden');
        }
    }

   // app.js (performOCRメソッドを置き換え)
    async performOCR(imageFile) { // 引数をリサイズ後のbase64ではなく、元のFileオブジェクトに変更
        const statusDiv = document.getElementById('ocrStatus');
        if (statusDiv) statusDiv.textContent = '🤖 Geminiで解析中...';
        showProgress('Geminiで解析中...');

        try {
            const formData = new FormData();
            formData.append('file', imageFile);
            
            // Cloudflare Workerに画像を送って解析を依頼
            const response = await fetch(CLOUDFLARE_WORKER_URL, {
                method: 'POST',
                body: formData,
                // Supabaseの認証トークンが必要な場合はヘッダーに追加
                // headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed: ${errorText}`);
            }

            const result = await response.json();

            if (result.success && result.data) {
                // フォームに自動入力
                document.getElementById('storeName').value = result.data.storeName || '';
                document.getElementById('amount').value = result.data.totalAmount || '';
                document.getElementById('expenseDate').value = result.data.transactionDate || '';
                this.calculateTax(); // 税額を再計算
                if (statusDiv) statusDiv.textContent = '✅ 解析完了';
                document.getElementById('ocrResult').classList.remove('hidden');
            } else {
                throw new Error(result.error || '解析データが正しくありません。');
            }

        } catch (error) {
            console.error('Gemini OCR Error:', error);
            if (statusDiv) statusDiv.textContent = '❌ 解析エラー';
            showNotification('画像の解析に失敗しました。', 'error');
        } finally {
            hideProgress();
        }
    }


    extractDataFromText(text) {
        console.log('OCR結果:', text);
        const patterns = {
            storeName: [/株式会社[\s\S]*?(?=\s|$)/, /[\S]*店/, /[\S]*マート/, /[\S]*ストア/],
            amount: [/合計[\s]*[:：]?[\s]*([\d,]+)円?/, /計[\s]*[:：]?[\s]*([\d,]+)円?/, /¥([\d,]+)/, /￥([\d,]+)/, /([\d,]+)円/],
            date: [/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/, /(\d{2})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/]
        };
        
        let storeName = '', amount = '', date = new Date().toISOString().split('T')[0];
        
        for (const p of patterns.storeName) { const m = text.match(p); if (m) { storeName = m[0]; break; } }
        for (const p of patterns.amount) { const m = text.match(p); if (m) { amount = m[1].replace(/,/g, ''); break; } }
        for (const p of patterns.date) {
            const m = text.match(p);
            if (m) {
                let y = m[1]; y = y.length === 2 ? '20' + y : y;
                date = `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; break;
            }
        }

        if (storeName) document.getElementById('storeName').value = storeName;
        if (amount) { document.getElementById('amount').value = amount; this.calculateTax(); }
        document.getElementById('expenseDate').value = date;
        this.suggestCategory(text);
    }
    
    suggestCategory(text) {
        const categoryKeywords = {
            '交通費': ['鉄道', 'JR', 'バス', 'タクシー'], '会議費': ['カフェ', 'コーヒー', 'スターバックス'],
            '接待交際費': ['レストラン', '居酒屋'], '消耗品費': ['文具', '事務'],
            '図書研究費': ['書店', 'ブック']
        };
        for (const [cat, keys] of Object.entries(categoryKeywords)) {
            if (keys.some(key => text.includes(key))) {
                document.getElementById('category').value = cat; return;
            }
        }
    }

    calculateTax() {
        const amountInput = document.getElementById('amount');
        const amount = parseFloat(amountInput.value) || 0;

        // 選択されている税率ラジオボタンの値を取得
        const selectedRate = document.querySelector('input[name="taxRate"]:checked').value;
        const taxRate = parseInt(selectedRate) / 100;

        // 税抜金額と消費税額を計算
        const taxExcluded = Math.round(amount / (1 + taxRate));
        const tax = amount - taxExcluded;

        // 表示を更新
        document.getElementById('taxExcluded').textContent = `¥${taxExcluded.toLocaleString()}`;
        
        // 税率に応じて表示する場所を切り替える
        if (selectedRate === '10') {
            document.getElementById('taxAmount').textContent = `¥${tax.toLocaleString()}`;
            document.getElementById('taxAmount8').textContent = `¥0`;
        } else { // 8%の場合
            document.getElementById('taxAmount').textContent = `¥0`;
            document.getElementById('taxAmount8').textContent = `¥${tax.toLocaleString()}`;
        }
    }

    async saveExpense() {
        const category = document.getElementById('category').value;
        const amount = document.getElementById('amount').value;
        const date = document.getElementById('expenseDate').value;
        if (!category || !amount || !date) {
            showNotification('必須項目を入力してください', 'error'); return;
        }

        const expenseData = {
            storeName: document.getElementById('storeName').value, category, amount: parseFloat(amount), date,
            paymentMethod: document.getElementById('paymentMethod').value,
            project: document.getElementById('project').value, memo: document.getElementById('memo').value,
            invoiceNumber: document.getElementById('invoiceNumber').value,
            taxExcluded: Math.floor(parseFloat(amount) / 1.1), tax: parseFloat(amount) - Math.floor(parseFloat(amount) / 1.1),
            tax_rate: parseInt(document.querySelector('input[name="taxRate"]:checked').value)
        };

        const savedData = await saveExpenseToSupabase(expenseData, this.currentImageFile);
        if (savedData) {
            this.expenses.unshift(savedData); // 配列の先頭に追加
            this.renderExpenses();
            this.updateStats();
            this.clearForm();
        }
    }

    clearForm() {
        document.getElementById('expense-form').reset();  
        document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('receiptInput').value = '';
        document.getElementById('imagePreview').classList.add('hidden');
        document.getElementById('ocrResult').classList.add('hidden');
        this.currentImageFile = null;
    }

    renderExpenses(filteredExpenses = null) {
        const expenseList = document.getElementById('expenseList');
        const expensesToRender = filteredExpenses || this.expenses;
        if (expensesToRender.length === 0) {
            expenseList.innerHTML = `<div class="empty-state">...</div>`; return;
        }
        expenseList.innerHTML = expensesToRender.map(expense => `
            <div class="expense-item" data-id="${expense.id}">
                <div class="expense-main">
                    <div class="expense-header">
                        <span class="expense-category">${this.getCategoryIcon(expense.category)} ${expense.category}</span>
                        <span class="expense-amount">¥${expense.amount.toLocaleString()}</span>
                    </div>
                    <div class="expense-details">
                        <span>📅 ${this.formatDate(expense.date)}</span>
                        ${expense.store_name ? `<span>🏪 ${expense.store_name}</span>` : ''}
                    </div>
                </div>
                <div class="expense-actions">
                    <button class="action-btn" onclick="expenseManager.editExpense(${expense.id})">✏️</button>
                    <button class="action-btn" onclick="expenseManager.deleteExpense(${expense.id})">🗑️</button>
                </div>
            </div>
        `).join('');
    }

    getCategoryIcon(category) {
        const icons = {'交通費': '🚃','会議費': '☕','接待交際費': '🍽️','消耗品費': '📎','通信費': '📱','図書研究費': '📚','旅費交通費': '✈️','その他': '📝'};
        return icons[category] || '📝';
    }

    formatDate(dateStr) {
        const d = new Date(dateStr);
        return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
    }

    async deleteExpense(id) {
        if (!confirm('この経費を削除しますか？')) return;
        if (!currentUser) { showNotification('ログインが必要です', 'error'); return; }
        showProgress('削除中...'); // ← 追加

        try {
            const { error } = await supabaseClient.from('expenses').delete().match({ id: id, user_id: currentUser.id });
            if (error) throw error;
            this.expenses = this.expenses.filter(e => e.id !== id);
            this.renderExpenses();
            this.updateStats();
            showNotification('経費を削除しました', 'success');
        } catch (error) {
            console.error('削除エラー:', error);
            showNotification('削除に失敗しました', 'error');
         } finally {
            hideProgress(); // ← 追加
    }
}
    
    editExpense(id) {
        const expense = this.expenses.find(e => e.id === id);
        if (!expense) return;

        // モーダルに既存のデータをセット
        document.getElementById('editExpenseId').value = expense.id;
        document.getElementById('editDate').value = expense.date;
        document.getElementById('editStoreName').value = expense.store_name || '';
        document.getElementById('editCategory').value = expense.category;
        document.getElementById('editAmount').value = expense.amount;
        document.getElementById('editMemo').value = expense.memo || '';
 // ▼▼▼ このブロックを追加 ▼▼▼
        // 保存されている税率をラジオボタンに反映
        const taxRate = expense.tax_rate || 10; // データがなければ10%をデフォルトに
        document.querySelector(`input[name="editTaxRate"][value="${taxRate}"]`).checked = true;
        // ▲▲▲ ここまで ▲▲▲
    
        // モーダルを表示
        const modal = document.getElementById('editModal');
        if (modal) modal.style.display = 'block';
    }
// ▼▼▼ ここから追加 ▼▼▼
    async updateExpenseInCloud(id, updatedData) {
        if (!currentUser) {
            showNotification('ログインが必要です', 'error');
            return;}
             showProgress('更新中...');
        

        try {
            const { data, error } = await supabaseClient
                .from('expenses')
                .update(updatedData)
                .match({ id: id, user_id: currentUser.id })
                .select()
                .single();

            if (error) throw error;

            // ローカルのデータも更新
            const index = this.expenses.findIndex(e => e.id === Number(id));
            if (index > -1) {
                this.expenses[index] = data;
            }

            this.renderExpenses();
            this.updateStats();
            showNotification('経費を更新しました', 'success');

        } catch (error) {
            console.error('更新エラー:', error);
            showNotification('更新に失敗しました', 'error');
        }
    }

    updateStats() {
        const now = new Date();
        const monthlyTotal = this.expenses
            .filter(e => new Date(e.date).getMonth() === now.getMonth() && new Date(e.date).getFullYear() === now.getFullYear())
            .reduce((sum, e) => sum + Number(e.amount), 0);
        document.getElementById('monthlyTotal').textContent = `¥${monthlyTotal.toLocaleString()}`;
        document.getElementById('totalExpenses').textContent = this.expenses.length;
        const totalAmount = this.expenses.reduce((sum, e) => sum + Number(e.amount), 0);
        document.getElementById('totalAmount').textContent = `¥${totalAmount.toLocaleString()}`;
        // 他の統計も同様に更新
    }

    setupFilters() {
        const filterMonth = document.getElementById('filterMonth');
        const months = new Set(this.expenses.map(e => e.date.substring(0, 7)));
        if (filterMonth) {
            filterMonth.innerHTML = '<option value="">全期間</option>' + 
                [...months].sort().reverse().map(m => `<option value="${m}">${m.replace('-', '年')}月</option>`).join('');
        }
        const filterCategory = document.getElementById('filterCategory');
        const categories = new Set(this.expenses.map(e => e.category));
        if (filterCategory) {
            filterCategory.innerHTML = '<option value="">全カテゴリー</option>' + 
                [...categories].map(c => `<option value="${c}">${c}</option>`).join('');
        }
    }

    filterExpenses() {
        const month = document.getElementById('filterMonth').value;
        const category = document.getElementById('filterCategory').value;
        const searchText = document.getElementById('searchBox').value.toLowerCase();
        let filtered = this.expenses;
        if (month) filtered = filtered.filter(e => e.date.startsWith(month));
        if (category) filtered = filtered.filter(e => e.category === category);
        if (searchText) {
            filtered = filtered.filter(e => 
                (e.store_name && e.store_name.toLowerCase().includes(searchText)) ||
                (e.memo && e.memo.toLowerCase().includes(searchText))
            );
        }
        this.renderExpenses(filtered);
    }

    exportToCSV() {
        if (this.expenses.length === 0) { showNotification('エクスポートするデータがありません', 'warning'); return; }
        const headers = ['日付', '店舗名', 'カテゴリー', '金額', '備考'];
        const rows = this.expenses.map(e => [e.date, e.store_name, e.category, e.amount, e.memo].join(','));
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
        const link = document.createElement('a');
        link.href = encodeURI(csvContent);
        link.download = `expenses_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    }
    
    generateMonthlyReport() {
        // レポート機能はUIとロジックが複雑になるため、今回は簡易的なアラートに留める
        showNotification('月次レポート機能は現在開発中です', 'info');
    }
}

// ==================== アプリケーション初期化 ====================
let expenseManager;
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing app...');
    try {
        expenseManager = new ExpenseManager();
        window.expenseManager = expenseManager;
        console.log('ExpenseManager initialized successfully');
    } catch (error) {
        console.error('Failed to initialize ExpenseManager:', error);
    }
    
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', toggleAuth);
    }
});













