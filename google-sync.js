// ==================== Google Drive同期システム ====================
if (window.__GAPI_INITIALIZED__) {      // すでに初期化済みなら
  console.log('gapi already init – skip'); 
  return;                               // 以降の処理を中断
}
window.__GAPI_INITIALIZED__ = true;

class GoogleDriveSync {
    constructor() {
        // 179874464431-2gkjdolnfd9tbooegigp5upmkme4rbfh.apps.googleusercontent.com
        this.CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
        this.API_KEY = 'YOUR_API_KEY';
        this.DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];
        this.SCOPES = 'https://www.googleapis.com/auth/drive.file';
        
        this.isInitialized = false;
        this.isSignedIn = false;
        this.syncInProgress = false;
        this.lastSyncTime = null;
        
        // データファイル名
        this.DATA_FILE_NAME = 'receipt_expenses_data.json';
        this.SYNC_INTERVAL = 30000; // 30秒ごとに自動同期
    }

    // 初期化
    async init() {
        try {
            await this.loadGoogleAPI();
            this.setupEventListeners();
            this.startAutoSync();
            console.log('Google Drive同期システム初期化完了');
        } catch (error) {
            console.error('初期化エラー:', error);
        }
    }

    // Google API読み込み
    loadGoogleAPI() {
    return new Promise((resolve, reject) => {
        // 既にgapiが読み込まれているか確認
        if (typeof gapi !== 'undefined') {
            console.log('gapi already loaded');
            gapi.load('client:auth2', async () => {
                try {
                    await gapi.client.init({
                        apiKey: this.API_KEY,
                        clientId: this.CLIENT_ID,
                        discoveryDocs: this.DISCOVERY_DOCS,
                        scope: this.SCOPES
                    });
                    
                    this.auth = gapi.auth2.getAuthInstance();
                    this.auth.isSignedIn.listen((isSignedIn) => {
                        this.handleSignInStatus(isSignedIn);
                    });
                    
                    this.handleSignInStatus(this.auth.isSignedIn.get());
                    this.isInitialized = true;
                    resolve();
                } catch (error) {
                    console.error('gapi.client.init error:', error);
                    reject(error);
                }
            });
            return;
        }
        
        // gapiが読み込まれていない場合
        const script = document.createElement('script');
        script.src = 'https://apis.google.com/js/api.js';
        script.async = true;
        script.defer = true;
        
        script.onload = () => {
            gapi.load('client:auth2', async () => {
                try {
                    await gapi.client.init({
                        apiKey: this.API_KEY,
                        clientId: this.CLIENT_ID,
                        discoveryDocs: this.DISCOVERY_DOCS,
                        scope: this.SCOPES
                    });
                    
                    this.auth = gapi.auth2.getAuthInstance();
                    this.auth.isSignedIn.listen((isSignedIn) => {
                        this.handleSignInStatus(isSignedIn);
                    });
                    
                    this.handleSignInStatus(this.auth.isSignedIn.get());
                    this.isInitialized = true;
                    resolve();
                } catch (error) {
                    console.error('gapi.client.init error:', error);
                    reject(error);
                }
            });
        };
        
        script.onerror = (error) => {
            console.error('Failed to load Google API:', error);
            reject(error);
        };
        
        document.head.appendChild(script);
    });
}


    // サインイン状態の処理
    handleSignInStatus(isSignedIn) {
        this.isSignedIn = isSignedIn;
        this.updateUI();
        
        if (isSignedIn) {
            // サインイン済み：データを同期
            this.syncData();
        }
    }

    // UIの更新
    updateUI() {
        const signInBtn = document.getElementById('googleSignInBtn');
        const syncStatus = document.getElementById('syncStatus');
        const lastSync = document.getElementById('lastSyncTime');
        
        if (!signInBtn || !syncStatus) return;

        if (this.isSignedIn) {
            signInBtn.innerHTML = '🔓 Googleアカウント切断';
            signInBtn.classList.remove('btn-primary');
            signInBtn.classList.add('btn-secondary');
            syncStatus.innerHTML = '✅ 同期: ON';
            syncStatus.classList.add('active');
            
            if (this.lastSyncTime && lastSync) {
                const time = new Date(this.lastSyncTime).toLocaleTimeString('ja-JP');
                lastSync.innerHTML = `最終同期: ${time}`;
            }
        } else {
            signInBtn.innerHTML = '🔐 Googleドライブと連携';
            signInBtn.classList.add('btn-primary');
            signInBtn.classList.remove('btn-secondary');
            syncStatus.innerHTML = '❌ 同期: OFF';
            syncStatus.classList.remove('active');
        }
    }

    // サインイン/サインアウト
    async toggleSignIn() {
        if (!this.isInitialized) {
            this.showNotification('初期化中です...', 'info');
            return;
        }

        if (this.isSignedIn) {
            await this.auth.signOut();
            this.showNotification('Googleアカウントから切断しました', 'info');
        } else {
            await this.auth.signIn();
            this.showNotification('Googleドライブと連携しました', 'success');
        }
    }

    // データ同期（双方向）
    async syncData() {
        if (!this.isSignedIn || this.syncInProgress) return;

        this.syncInProgress = true;
        this.showSyncIndicator(true);

        try {
            // 1. Google Driveから最新データ取得
            const cloudData = await this.loadFromDrive();
            
            // 2. ローカルデータ取得
            const localData = this.getLocalData();
            
            // 3. データマージ
            const mergedData = this.mergeData(localData, cloudData);
            
            // 4. Google Driveに保存
            await this.saveToDrive(mergedData);
            
            // 5. ローカルに保存
            this.saveLocalData(mergedData);
            
            // 6. UIを更新
            if (window.expenseManager) {
                window.expenseManager.expenses = mergedData.expenses;
                window.expenseManager.renderExpenses();
                window.expenseManager.updateStats();
            }
            
            this.lastSyncTime = new Date().toISOString();
            this.updateUI();
            this.showNotification('✅ データを同期しました', 'success');
            
        } catch (error) {
            console.error('同期エラー:', error);
            this.showNotification('同期エラーが発生しました', 'error');
        } finally {
            this.syncInProgress = false;
            this.showSyncIndicator(false);
        }
    }

    // Google Driveからデータ読み込み
    async loadFromDrive() {
        try {
            // ファイル検索
            const response = await gapi.client.drive.files.list({
                q: `name='${this.DATA_FILE_NAME}' and trashed=false`,
                fields: 'files(id, name, modifiedTime)',
                spaces: 'drive'
            });

            const files = response.result.files;
            
            if (files && files.length > 0) {
                // ファイルが存在する場合、内容を取得
                const fileId = files[0].id;
                const contentResponse = await gapi.client.drive.files.get({
                    fileId: fileId,
                    alt: 'media'
                });
                
                return JSON.parse(contentResponse.body);
            } else {
                // ファイルが存在しない場合
                return {
                    expenses: [],
                    lastModified: null,
                    version: '1.0'
                };
            }
        } catch (error) {
            console.error('Drive読み込みエラー:', error);
            return { expenses: [], lastModified: null, version: '1.0' };
        }
    }

    // Google Driveにデータ保存
    async saveToDrive(data) {
        try {
            const fileContent = {
                expenses: data.expenses,
                lastModified: new Date().toISOString(),
                version: '1.0',
                deviceInfo: {
                    userAgent: navigator.userAgent,
                    platform: navigator.platform,
                    isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
                }
            };

            const file = new Blob([JSON.stringify(fileContent, null, 2)], {
                type: 'application/json'
            });

            // 既存ファイル検索
            const searchResponse = await gapi.client.drive.files.list({
                q: `name='${this.DATA_FILE_NAME}' and trashed=false`,
                fields: 'files(id)',
                spaces: 'drive'
            });

            const files = searchResponse.result.files;

            if (files && files.length > 0) {
                // 既存ファイルを更新
                await gapi.client.request({
                    path: `/upload/drive/v3/files/${files[0].id}`,
                    method: 'PATCH',
                    params: { uploadType: 'media' },
                    body: file
                });
            } else {
                // 新規ファイル作成
                await gapi.client.request({
                    path: '/upload/drive/v3/files',
                    method: 'POST',
                    params: { uploadType: 'multipart' },
                    headers: {
                        'Content-Type': 'multipart/related; boundary=foo_bar_baz'
                    },
                    body: this.createMultipartBody(file, this.DATA_FILE_NAME)
                });
            }
        } catch (error) {
            console.error('Drive保存エラー:', error);
            throw error;
        }
    }

    // マルチパートボディ作成
    createMultipartBody(file, fileName) {
        const boundary = 'foo_bar_baz';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";

        const metadata = {
            name: fileName,
            mimeType: 'application/json'
        };

        const multipartRequestBody =
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            file +
            close_delim;

        return multipartRequestBody;
    }

    // データマージ（重複排除）
    mergeData(localData, cloudData) {
        const mergedExpenses = [];
        const expenseMap = new Map();

        // ローカルデータを追加
        localData.expenses.forEach(expense => {
            expenseMap.set(expense.id, expense);
        });

        // クラウドデータを追加（新しいものだけ）
        cloudData.expenses.forEach(expense => {
            if (!expenseMap.has(expense.id)) {
                expenseMap.set(expense.id, expense);
            } else {
                // タイムスタンプ比較して新しい方を採用
                const localExpense = expenseMap.get(expense.id);
                if (expense.updatedAt > localExpense.updatedAt) {
                    expenseMap.set(expense.id, expense);
                }
            }
        });

        // Mapから配列に変換
        expenseMap.forEach(expense => {
            mergedExpenses.push(expense);
        });

        // 日付でソート（新しい順）
        mergedExpenses.sort((a, b) => {
            return new Date(b.date) - new Date(a.date);
        });

        return {
            expenses: mergedExpenses,
            lastModified: new Date().toISOString()
        };
    }

    // ローカルデータ取得
    getLocalData() {
        const expenses = JSON.parse(localStorage.getItem('expenses') || '[]');
        return {
            expenses: expenses,
            lastModified: localStorage.getItem('lastModified')
        };
    }

    // ローカルデータ保存
    saveLocalData(data) {
        localStorage.setItem('expenses', JSON.stringify(data.expenses));
        localStorage.setItem('lastModified', data.lastModified);
    }

    // 自動同期開始
    startAutoSync() {
        // 30秒ごとに同期
        setInterval(() => {
            if (this.isSignedIn && !this.syncInProgress) {
                this.syncData();
            }
        }, this.SYNC_INTERVAL);

        // オンライン復帰時に同期
        window.addEventListener('online', () => {
            if (this.isSignedIn) {
                this.syncData();
            }
        });

        // ページ表示時に同期
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isSignedIn) {
                this.syncData();
            }
        });
    }

    // イベントリスナー設定
    setupEventListeners() {
        // 手動同期ボタン
        const syncBtn = document.getElementById('manualSyncBtn');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.syncData());
        }

        // サインインボタン
        const signInBtn = document.getElementById('googleSignInBtn');
        if (signInBtn) {
            signInBtn.addEventListener('click', () => this.toggleSignIn());
        }
    }

    // 同期インジケーター表示
    showSyncIndicator(show) {
        const indicator = document.getElementById('syncIndicator');
        if (!indicator) return;

        if (show) {
            indicator.classList.add('active');
            indicator.innerHTML = '🔄 同期中...';
        } else {
            indicator.classList.remove('active');
            indicator.innerHTML = '';
        }
    }

    // 通知表示
    showNotification(message, type) {
        if (window.expenseManager && window.expenseManager.showNotification) {
            window.expenseManager.showNotification(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }
}



