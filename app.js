// ==================== Supabase設定 ====================
const SUPABASE_URL = 'あなたのSupabaseプロジェクトURL';
const SUPABASE_ANON_KEY = 'あなたのSupabaseアノンキー';
const CLOUDFLARE_WORKER_URL = 'あなたのCloudflare WorkerのURL';

// Supabaseクライアント初期化
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 現在のユーザー状態
let currentUser = null;

// ==================== 認証関連 ====================
// UI更新関数
function updateAuthUI(user) {
    const signInBtn = document.getElementById('googleSignInBtn');
    const syncStatus = document.getElementById('syncStatus');
    
    if (user) {
        currentUser = user;
        if (signInBtn) signInBtn.innerHTML = '🔓 ログアウト';
        if (syncStatus) {
            syncStatus.innerHTML = '✅ ログイン中';
            syncStatus.classList.add('active');
        }
        // ユーザーデータを読み込み
        loadUserExpenses();
    } else {
        currentUser = null;
        if (signInBtn) signInBtn.innerHTML = '🔐 Googleでログイン';
        if (syncStatus) {
            syncStatus.innerHTML = '❌ ログアウト中';
            syncStatus.classList.remove('active');
        }
        // ローカルデータをクリア
        clearUserData();
    }
}

// 認証状態の監視
supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log('Auth event:', event);
    updateAuthUI(session?.user || null);
});

// ログイン/ログアウト処理
async function toggleAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
        // ログアウト
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
            console.error('ログアウトエラー:', error);
            showNotification('ログアウトに失敗しました', 'error');
        }
    } else {
        // ログイン
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.href
            }
        });
        if (error) {
            console.error('ログインエラー:', error);
            showNotification('ログインに失敗しました', 'error');
        }
    }
}

// ==================== データ操作 ====================
// 画像アップロード
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
        throw new Error('画像のアップロードに失敗しました');
    }
    
    return await response.json();
}

// 経費をSupabaseに保存
async function saveExpenseToSupabase(expenseData, imageFile) {
    if (!currentUser) {
        showNotification('ログインしてください', 'error');
        return false;
    }
    
    try {
        showProgress();
        
        let imageUrl = null;
        if (imageFile) {
            const uploadResult = await uploadImage(imageFile);
            imageUrl = uploadResult.url;
        }
        
        const expense = {
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
            .insert([expense])
            .select();
        
        if (error) throw error;
        
        hideProgress();
        showNotification('経費をクラウドに保存しました', 'success');
        return true;
        
    } catch (error) {
        hideProgress();
        console.error('保存エラー:', error);
        showNotification('保存に失敗しました: ' + error.message, 'error');
        return false;
    }
}

// ユーザーの経費データを読み込み
async function loadUserExpenses() {
    if (!currentUser) return;
    
    try {
        const { data, error } = await supabaseClient
            .from('expenses')
            .select('*')
            .eq('status', 'active')
            .order('date', { ascending: false });
        
        if (error) throw error;
        
        // 既存のExpenseManagerに統合
        if (window.expenseManager) {
            window.expenseManager.expenses = data || [];
            window.expenseManager.renderExpenses();
            window.expenseManager.updateStats();
        }
        
    } catch (error) {
        console.error('データ読み込みエラー:', error);
        showNotification('データの読み込みに失敗しました', 'error');
    }
}

// ローカルデータをクリア
function clearUserData() {
    if (window.expenseManager) {
        window.expenseManager.expenses = [];
        window.expenseManager.renderExpenses();
        window.expenseManager.updateStats();
    }
}
// ==================== 経費精算アプリ メインロジック ====================

class ExpenseManager {
    constructor() {
        this.expenses = JSON.parse(localStorage.getItem('expenses')) || [];
        this.currentImage = null;
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

    // ==================== イベントリスナー設定 ====================
    setupEventListeners() {
        // レシート入力
        const receiptInput = document.getElementById('receiptInput');
        if (receiptInput) {
            receiptInput.addEventListener('change', (e) => this.handleImageUpload(e));
        }

        // 金額入力時の自動税計算
        const amountInput = document.getElementById('amount');
        if (amountInput) {
            amountInput.addEventListener('input', () => this.calculateTax());
        }

        // 保存ボタン
        const saveBtn = document.getElementById('saveExpense');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveExpense());
        }

        // エクスポートボタン
        const exportBtn = document.getElementById('exportCSV');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportToCSV());
        }

        // レポート生成
        const reportBtn = document.getElementById('generateReport');
        if (reportBtn) {
            reportBtn.addEventListener('click', () => this.generateMonthlyReport());
        }

        // クイック追加ボタン
        const quickAddBtn = document.getElementById('quickAddBtn');
        if (quickAddBtn) {
            quickAddBtn.addEventListener('click', () => {
                document.getElementById('receiptInput').click();
            });
        }

        // 検索ボックス
        const searchBox = document.getElementById('searchBox');
        if (searchBox) {
            searchBox.addEventListener('input', () => this.filterExpenses());
        }

        // フィルター
        document.getElementById('filterMonth')?.addEventListener('change', () => this.filterExpenses());
        document.getElementById('filterCategory')?.addEventListener('change', () => this.filterExpenses());
    }

    // ==================== ドラッグ&ドロップ設定 ====================
    setupDragAndDrop() {
        const captureArea = document.getElementById('captureArea');
        if (!captureArea) return;

        captureArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            captureArea.classList.add('dragover');
        });

        captureArea.addEventListener('dragleave', () => {
            captureArea.classList.remove('dragover');
        });

        captureArea.addEventListener('drop', (e) => {
            e.preventDefault();
            captureArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('image/')) {
                this.processImage(files[0]);
            }
        });
    }

    // ==================== 画像処理 ====================
    handleImageUpload(event) {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            this.processImage(file);
        }
    }

    processImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.currentImage = e.target.result;
            this.displayImagePreview(e.target.result);
            this.performOCR(e.target.result);
        };
        reader.readAsDataURL(file);
    }

    displayImagePreview(imageSrc) {
        const previewDiv = document.getElementById('imagePreview');
        const previewImg = document.getElementById('previewImg');
        
        if (previewDiv && previewImg) {
            previewImg.src = imageSrc;
            previewDiv.classList.remove('hidden');
        }
    }

    // ==================== OCR処理 ====================
    async performOCR(imageSrc) {
        const statusDiv = document.getElementById('ocrStatus');
        const resultDiv = document.getElementById('ocrResult');
        
        if (statusDiv) {
            statusDiv.textContent = '🔄 AI解析中...';
        }

        this.showProgress();

        try {
            // Tesseract.jsでOCR実行
            const result = await Tesseract.recognize(
                imageSrc,
                'jpn', // 日本語
                {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            const progress = Math.round(m.progress * 100);
                            if (statusDiv) {
                                statusDiv.textContent = `🔄 解析中... ${progress}%`;
                            }
                        }
                    }
                }
            );

            const text = result.data.text;
            this.extractDataFromText(text);
            
            if (statusDiv) {
                statusDiv.textContent = '✅ 解析完了';
            }
            
            if (resultDiv) {
                resultDiv.classList.remove('hidden');
            }

        } catch (error) {
            console.error('OCR Error:', error);
            if (statusDiv) {
                statusDiv.textContent = '❌ 解析エラー';
            }
            this.showNotification('画像の解析に失敗しました', 'error');
        } finally {
            this.hideProgress();
        }
    }

    // ==================== テキストからデータ抽出 ====================
    extractDataFromText(text) {
        console.log('OCR結果:', text);

        // 店舗名の抽出（簡易版）
        const storePatterns = [
            /株式会社[\s\S]*?(?=\s|$)/,
            /[\S]*店/,
            /[\S]*マート/,
            /[\S]*ストア/
        ];
        
        let storeName = '';
        for (const pattern of storePatterns) {
            const match = text.match(pattern);
            if (match) {
                storeName = match[0];
                break;
            }
        }

        // 金額の抽出
        const amountPatterns = [
            /合計[\s]*[:：]?[\s]*([\d,]+)円?/,
            /計[\s]*[:：]?[\s]*([\d,]+)円?/,
            /¥([\d,]+)/,
            /￥([\d,]+)/,
            /([\d,]+)円/
        ];

        let amount = '';
        for (const pattern of amountPatterns) {
            const match = text.match(pattern);
            if (match) {
                amount = match[1].replace(/,/g, '');
                break;
            }
        }

        // 日付の抽出
        const datePatterns = [
            /(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/,
            /(\d{2})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/,
            /令和(\d{1,2})年(\d{1,2})月(\d{1,2})日/
        ];

        let date = new Date().toISOString().split('T')[0];
        for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
                let year = match[1];
                if (year.length === 2) {
                    year = '20' + year;
                }
                const month = match[2].padStart(2, '0');
                const day = match[3].padStart(2, '0');
                date = `${year}-${month}-${day}`;
                break;
            }
        }

        // フォームに自動入力
        if (storeName) {
            document.getElementById('storeName').value = storeName;
        }
        if (amount) {
            document.getElementById('amount').value = amount;
            this.calculateTax();
        }
        document.getElementById('expenseDate').value = date;

        // カテゴリーの推測
        this.suggestCategory(text);
    }

    // ==================== カテゴリー推測 ====================
    suggestCategory(text) {
        const categoryKeywords = {
            '交通費': ['電車', '鉄道', 'JR', 'バス', 'タクシー', '交通'],
            '会議費': ['カフェ', 'コーヒー', 'スターバックス', 'ドトール', '喫茶'],
            '接待交際費': ['レストラン', '居酒屋', '寿司', '焼肉'],
            '消耗品費': ['文具', 'ペン', 'ノート', '事務'],
            '通信費': ['携帯', 'ソフトバンク', 'ドコモ', 'au', '通信'],
            '図書研究費': ['書店', '本屋', 'ブック', 'アマゾン']
        };

        for (const [category, keywords] of Object.entries(categoryKeywords)) {
            for (const keyword of keywords) {
                if (text.includes(keyword)) {
                    document.getElementById('category').value = category;
                    return;
                }
            }
        }
    }

    // ==================== 税計算 ====================
    calculateTax() {
        const amountInput = document.getElementById('amount');
        const amount = parseFloat(amountInput.value) || 0;

        // 10%の消費税計算
        const taxRate10 = 0.1;
        const taxExcluded10 = Math.floor(amount / (1 + taxRate10));
        const tax10 = amount - taxExcluded10;

        // 8%の消費税計算（軽減税率）
        const taxRate8 = 0.08;
        const taxExcluded8 = Math.floor(amount / (1 + taxRate8));
        const tax8 = amount - taxExcluded8;

        // 表示更新
        document.getElementById('taxExcluded').textContent = `¥${taxExcluded10.toLocaleString()}`;
        document.getElementById('taxAmount').textContent = `¥${tax10.toLocaleString()}`;
        document.getElementById('taxAmount8').textContent = `¥${tax8.toLocaleString()}`;
    }

    // ==================== 経費保存 ====================
    async saveExpense() {
    const category = document.getElementById('category').value;
    const amount = document.getElementById('amount').value;
    const date = document.getElementById('expenseDate').value;

    // バリデーション
    if (!category || !amount || !date) {
        this.showNotification('必須項目を入力してください', 'error');
        return;
    }

    const expenseData = {
        storeName: document.getElementById('storeName').value,
        category: category,
        amount: parseFloat(amount),
        date: date,
        paymentMethod: document.getElementById('paymentMethod').value,
        project: document.getElementById('project').value,
        memo: document.getElementById('memo').value,
        invoiceNumber: document.getElementById('invoiceNumber').value,
        taxExcluded: Math.floor(amount / 1.1),
        tax: amount - Math.floor(amount / 1.1)
    };

    const imageFile = document.getElementById('receiptInput').files[0] || null;

    // Supabaseに保存を試行
    const cloudSaved = await saveExpenseToSupabase(expenseData, imageFile);
    
    if (!cloudSaved) {
        // クラウド保存に失敗した場合はローカルに保存
        const expense = {
            id: Date.now(),
            ...expenseData,
            image: this.currentImage,
            createdAt: new Date().toISOString()
        };
        
        this.expenses.push(expense);
        this.saveToLocalStorage();
        this.showNotification('ローカルに保存しました', 'warning');
    }
    
    this.renderExpenses();
    this.updateStats();
    this.clearForm();
}

    // ==================== LocalStorage保存 ====================
    saveToLocalStorage() {
        localStorage.setItem('expenses', JSON.stringify(this.expenses));
    }

    // ==================== フォームクリア ====================
    clearForm() {
        document.getElementById('storeName').value = '';
        document.getElementById('category').value = '';
        document.getElementById('amount').value = '';
        document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('paymentMethod').value = '現金';
        document.getElementById('project').value = '';
        document.getElementById('memo').value = '';
        document.getElementById('invoiceNumber').value = '';
        document.getElementById('receiptInput').value = '';
        document.getElementById('imagePreview').classList.add('hidden');
        document.getElementById('ocrResult').classList.add('hidden');
        this.currentImage = null;
    }

    // ==================== 経費一覧表示 ====================
    renderExpenses(filteredExpenses = null) {
        const expenseList = document.getElementById('expenseList');
        const expenses = filteredExpenses || this.expenses;

        if (expenses.length === 0) {
            expenseList.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">📋</span>
                    <p>まだ経費が登録されていません</p>
                    <p class="empty-hint">レシートを撮影して始めましょう</p>
                </div>
            `;
            return;
        }

        // 日付でソート（新しい順）
        const sortedExpenses = [...expenses].sort((a, b) => 
            new Date(b.date) - new Date(a.date)
        );

        expenseList.innerHTML = sortedExpenses.map(expense => `
            <div class="expense-item" data-id="${expense.id}">
                <div class="expense-main">
                    <div class="expense-header">
                        <span class="expense-category">${this.getCategoryIcon(expense.category)} ${expense.category}</span>
                        <span class="expense-amount">¥${expense.amount.toLocaleString()}</span>
                    </div>
                    <div class="expense-details">
                        <span>📅 ${this.formatDate(expense.date)}</span>
                        ${expense.storeName ? `<span>🏪 ${expense.storeName}</span>` : ''}
                        ${expense.project ? `<span>📁 ${expense.project}</span>` : ''}
                        ${expense.memo ? `<span>📝 ${expense.memo}</span>` : ''}
                    </div>
                </div>
                <div class="expense-actions">
                    <button class="action-btn" onclick="expenseManager.viewExpense(${expense.id})">👁️</button>
                    <button class="action-btn" onclick="expenseManager.editExpense(${expense.id})">✏️</button>
                    <button class="action-btn" onclick="expenseManager.deleteExpense(${expense.id})">🗑️</button>
                </div>
            </div>
        `).join('');
    }

    // ==================== カテゴリーアイコン取得 ====================
    getCategoryIcon(category) {
        const icons = {
            '交通費': '🚃',
            '会議費': '☕',
            '接待交際費': '🍽️',
            '消耗品費': '📎',
            '通信費': '📱',
            '図書研究費': '📚',
            '旅費交通費': '✈️',
            'その他': '📝'
        };
        return icons[category] || '📝';
    }

    // ==================== 日付フォーマット ====================
    formatDate(dateStr) {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const weekDay = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
        return `${year}/${month}/${day}(${weekDay})`;
    }

    // ==================== 経費削除 ====================
    deleteExpense(id) {
        if (confirm('この経費を削除しますか？')) {
            this.expenses = this.expenses.filter(e => e.id !== id);
            this.saveToLocalStorage();
            this.renderExpenses();
            this.updateStats();
            this.showNotification('経費を削除しました', 'success');
        }
    }

    // ==================== 経費詳細表示 ====================
    viewExpense(id) {
        const expense = this.expenses.find(e => e.id === id);
        if (!expense) return;

        // 詳細モーダル表示（簡易版）
        alert(`
経費詳細
-----------------
店舗: ${expense.storeName || '-'}
カテゴリー: ${expense.category}
金額: ¥${expense.amount.toLocaleString()}
日付: ${this.formatDate(expense.date)}
支払方法: ${expense.paymentMethod}
プロジェクト: ${expense.project || '-'}
備考: ${expense.memo || '-'}
インボイス番号: ${expense.invoiceNumber || '-'}
税抜金額: ¥${expense.taxExcluded.toLocaleString()}
消費税: ¥${expense.tax.toLocaleString()}
        `);
    }

    // ==================== 経費編集 ====================
    editExpense(id) {
        const expense = this.expenses.find(e => e.id === id);
        if (!expense) return;

        // フォームに値をセット
        document.getElementById('storeName').value = expense.storeName || '';
        document.getElementById('category').value = expense.category;
        document.getElementById('amount').value = expense.amount;
        document.getElementById('expenseDate').value = expense.date;
        document.getElementById('paymentMethod').value = expense.paymentMethod;
        document.getElementById('project').value = expense.project || '';
        document.getElementById('memo').value = expense.memo || '';
        document.getElementById('invoiceNumber').value = expense.invoiceNumber || '';

        // 削除して再保存（簡易版）
        this.expenses = this.expenses.filter(e => e.id !== id);
        this.saveToLocalStorage();

        // フォームまでスクロール
        document.querySelector('.expense-form').scrollIntoView({ behavior: 'smooth' });
    }

    // ==================== 統計更新 ====================
    updateStats() {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // 今月の経費をフィルタ
        const monthlyExpenses = this.expenses.filter(e => {
            const date = new Date(e.date);
            return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
        });

        // 今月の合計
        const monthlyTotal = monthlyExpenses.reduce((sum, e) => sum + e.amount, 0);
        document.getElementById('monthlyTotal').textContent = `¥${monthlyTotal.toLocaleString()}`;

        // 総件数
        document.getElementById('totalExpenses').textContent = this.expenses.length;

        // 総額
        const totalAmount = this.expenses.reduce((sum, e) => sum + e.amount, 0);
        document.getElementById('totalAmount').textContent = `¥${totalAmount.toLocaleString()}`;

        // 日平均
        const days = new Set(this.expenses.map(e => e.date)).size || 1;
        const avgDaily = Math.floor(totalAmount / days);
        document.getElementById('avgDaily').textContent = `¥${avgDaily.toLocaleString()}`;

        // 最多カテゴリー
        const categoryCount = {};
        this.expenses.forEach(e => {
            categoryCount[e.category] = (categoryCount[e.category] || 0) + 1;
        });
        const topCategory = Object.keys(categoryCount).reduce((a, b) => 
            categoryCount[a] > categoryCount[b] ? a : b, '-'
        );
        document.getElementById('topCategory').textContent = topCategory;

        // カテゴリー別チャート更新
        this.updateCategoryChart();
    }

    // ==================== カテゴリー別チャート ====================
    updateCategoryChart() {
        const categoryTotals = {};
        let maxAmount = 0;

        this.expenses.forEach(e => {
            categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
            maxAmount = Math.max(maxAmount, categoryTotals[e.category]);
        });

        const chartContainer = document.getElementById('categoryChart');
        if (!chartContainer) return;

        chartContainer.innerHTML = Object.entries(categoryTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([category, amount]) => `
                <div class="chart-bar">
                    <span class="chart-label">${this.getCategoryIcon(category)} ${category}</span>
                    <div class="chart-progress">
                        <div class="chart-fill" style="width: ${(amount / maxAmount) * 100}%"></div>
                    </div>
                    <span class="chart-value">¥${amount.toLocaleString()}</span>
                </div>
            `).join('');
    }

    // ==================== フィルター設定 ====================
    setupFilters() {
        // 月フィルターの設定
        const filterMonth = document.getElementById('filterMonth');
        if (filterMonth) {
            const months = new Set();
            this.expenses.forEach(e => {
                const date = new Date(e.date);
                const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
                months.add(monthKey);
            });

            const sortedMonths = Array.from(months).sort().reverse();
            filterMonth.innerHTML = '<option value="">全期間</option>' +
                sortedMonths.map(month => {
                    const [year, m] = month.split('-');
                    return `<option value="${month}">${year}年${parseInt(m)}月</option>`;
                }).join('');
        }

        // カテゴリーフィルターの設定
        const filterCategory = document.getElementById('filterCategory');
        if (filterCategory) {
            const categories = new Set(this.expenses.map(e => e.category));
            filterCategory.innerHTML = '<option value="">全カテゴリー</option>' +
                Array.from(categories).map(cat => 
                    `<option value="${cat}">${cat}</option>`
                ).join('');
        }
    }

    // ==================== フィルター実行 ====================
    filterExpenses() {
        const month = document.getElementById('filterMonth').value;
        const category = document.getElementById('filterCategory').value;
        const searchText = document.getElementById('searchBox').value.toLowerCase();

        let filtered = this.expenses;

        // 月でフィルター
        if (month) {
            filtered = filtered.filter(e => {
                const date = new Date(e.date);
                const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
                return monthKey === month;
            });
        }

        // カテゴリーでフィルター
        if (category) {
            filtered = filtered.filter(e => e.category === category);
        }

        // テキスト検索
        if (searchText) {
            filtered = filtered.filter(e => 
                e.storeName?.toLowerCase().includes(searchText) ||
                e.category.toLowerCase().includes(searchText) ||
                e.memo?.toLowerCase().includes(searchText) ||
                e.project?.toLowerCase().includes(searchText)
            );
        }

        this.renderExpenses(filtered);
    }

    // ==================== CSV出力 ====================
    exportToCSV() {
        if (this.expenses.length === 0) {
            this.showNotification('エクスポートする経費がありません', 'error');
            return;
        }

        const headers = ['日付', '店舗名', 'カテゴリー', '金額', '税抜金額', '消費税', '支払方法', 'プロジェクト', '備考', 'インボイス番号'];
        const rows = this.expenses.map(e => [
            e.date,
            e.storeName || '',
            e.category,
            e.amount,
            e.taxExcluded,
            e.tax,
            e.paymentMethod,
            e.project || '',
            e.memo || '',
            e.invoiceNumber || ''
        ]);

        // BOM付きUTF-8で出力（Excelで文字化けしない）
        const bom = '\uFEFF';
        const csvContent = bom + headers.join(',') + '\n' + 
            rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `経費精算_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);

        this.showNotification('CSVファイルをダウンロードしました', 'success');
    }

    // ==================== 月次レポート生成 ====================
    generateMonthlyReport() {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const monthlyExpenses = this.expenses.filter(e => {
            const date = new Date(e.date);
            return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
        });

        if (monthlyExpenses.length === 0) {
            this.showNotification('今月の経費がありません', 'error');
            return;
        }

        // カテゴリー別集計
        const categoryTotals = {};
        monthlyExpenses.forEach(e => {
            categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
        });

        // レポート内容生成
        const reportContent = `
            <h3>${currentYear}年${currentMonth + 1}月 経費レポート</h3>
            <div style="margin: 20px 0;">
                <p><strong>期間:</strong> ${currentYear}年${currentMonth + 1}月1日 - ${currentMonth + 1}月${new Date(currentYear, currentMonth + 1, 0).getDate()}日</p>
                <p><strong>総経費件数:</strong> ${monthlyExpenses.length}件</p>
                <p><strong>総経費金額:</strong> ¥${monthlyExpenses.reduce((sum, e) => sum + e.amount, 0).toLocaleString()}</p>
            </div>
            
            <h4>カテゴリー別内訳</h4>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f3f4f6;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">カテゴリー</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">金額</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">割合</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(categoryTotals)
                        .sort((a, b) => b[1] - a[1])
                        .map(([category, amount]) => {
                            const total = monthlyExpenses.reduce((sum, e) => sum + e.amount, 0);
                            const percentage = ((amount / total) * 100).toFixed(1);
                            return `
                                <tr>
                                    <td style="padding: 10px; border: 1px solid #ddd;">${this.getCategoryIcon(category)} ${category}</td>
                                    <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">¥${amount.toLocaleString()}</td>
                                    <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${percentage}%</td>
                                </tr>
                            `;
                        }).join('')}
                </tbody>
            </table>
            
            <h4 style="margin-top: 20px;">詳細一覧</h4>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="background: #f3f4f6;">
                        <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">日付</th>
                        <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">店舗</th>
                        <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">カテゴリー</th>
                        <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">金額</th>
                    </tr>
                </thead>
                <tbody>
                    ${monthlyExpenses
                        .sort((a, b) => new Date(a.date) - new Date(b.date))
                        .map(e => `
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd;">${this.formatDate(e.date)}</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${e.storeName || '-'}</td>
                                <td style="padding: 8px; border: 1px solid #ddd;">${e.category}</td>
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">¥${e.amount.toLocaleString()}</td>
                            </tr>
                        `).join('')}
                </tbody>
            </table>
        `;

        // モーダル表示
        document.getElementById('reportContent').innerHTML = reportContent;
        document.getElementById('reportModal').classList.add('show');
    }

    // ==================== 通知表示 ====================
    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        if (!notification) return;

        notification.textContent = message;
        notification.className = `notification ${type} show`;

        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    // ==================== プログレスバー ====================
    showProgress() {
        const progressBar = document.getElementById('progressBar');
        if (progressBar) {
            progressBar.classList.remove('hidden');
        }
    }

    hideProgress() {
        const progressBar = document.getElementById('progressBar');
        if (progressBar) {
            progressBar.classList.add('hidden');
        }
    }
}

// ==================== グローバル関数 ====================
function closeModal() {
    document.getElementById('reportModal').classList.remove('show');
}

function printReport() {
    window.print();
}

function downloadPDF() {
    // 簡易版：印刷ダイアログを表示
    window.print();
    // 実際のPDF生成にはjsPDFなどのライブラリが必要
}

// ==================== アプリケーション初期化 ====================
// グローバル変数として宣言（letやconstを使わない）
var expenseManager;

// DOMContentLoadedで初期化
// 既存のDOMContentLoadedイベントリスナーを修正
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing app...');
    
    // ExpenseManagerを初期化
    try {
        expenseManager = new ExpenseManager();
        window.expenseManager = expenseManager;
        console.log('ExpenseManager initialized successfully');
    } catch (error) {
        console.error('Failed to initialize ExpenseManager:', error);
    }
    
    // Supabase認証ボタンの設定
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', toggleAuth);
    }
});


// モバイル検出と最適化
class MobileOptimizer {
    constructor() {
        this.isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        this.init();
    }

    init() {
        if (this.isMobile) {
            this.optimizeForMobile();
            this.addMobileGestures();
            this.setupMobileCamera();
        }
    }

    optimizeForMobile() {
        // ビューポート最適化
        document.body.classList.add('mobile-device');
        
        // タップフィードバック追加
        document.addEventListener('touchstart', (e) => {
            if (e.target.classList.contains('btn') || e.target.classList.contains('capture-button')) {
                e.target.style.transform = 'scale(0.95)';
            }
        });

        document.addEventListener('touchend', (e) => {
            if (e.target.classList.contains('btn') || e.target.classList.contains('capture-button')) {
                e.target.style.transform = 'scale(1)';
            }
        });
    }

    setupMobileCamera() {
        // カメラボタンをより大きく、押しやすく
        const captureButton = document.querySelector('.capture-button');
        if (captureButton && this.isMobile) {
            captureButton.innerHTML = `
                <span class="camera-icon" style="font-size: 3rem;">📷</span>
                <span style="font-size: 1.2rem;">タップして撮影</span>
            `;
            captureButton.style.padding = '2rem';
        }
    }

    addMobileGestures() {
        // スワイプで削除
        let startX = 0;
        let currentX = 0;
        let targetElement = null;

        document.addEventListener('touchstart', (e) => {
            if (e.target.closest('.expense-item')) {
                startX = e.touches[0].clientX;
                targetElement = e.target.closest('.expense-item');
            }
        });

        document.addEventListener('touchmove', (e) => {
            if (!targetElement) return;
            currentX = e.touches[0].clientX;
            const diff = currentX - startX;
            
            if (diff < -50) {
                targetElement.style.transform = `translateX(${diff}px)`;
                targetElement.style.background = '#fee';
            }
        });

        document.addEventListener('touchend', (e) => {
            if (!targetElement) return;
            const diff = currentX - startX;
            
            if (diff < -100) {
                const id = targetElement.dataset.id;
                if (confirm('削除しますか？')) {
                    expenseManager.deleteExpense(parseInt(id));
                }
            }
            
            targetElement.style.transform = '';
            targetElement.style.background = '';
            targetElement = null;
        });
    }
}

// アプリ起動時に実行
document.addEventListener('DOMContentLoaded', () => {
    new MobileOptimizer();
});

// PWAインストール促進
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    // インストールボタン表示
    const installButton = document.createElement('button');
    installButton.className = 'install-button';
    installButton.innerHTML = '📱 アプリとしてインストール';
    installButton.onclick = async () => {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            console.log('PWAがインストールされました');
        }
        deferredPrompt = null;
        installButton.remove();
    };
    
    document.body.appendChild(installButton);

});



