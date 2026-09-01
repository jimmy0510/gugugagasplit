# gugugagasplit

朋友之間的分帳 App。記共同支出、算誰欠誰、用最少的轉帳把帳結清。

**網頁版（可直接使用）**：https://gugugagasplit.expo.app
**Android APK**：見 [Releases](../../releases)

---

## 功能

- **四種分帳方式**：平均分、依權重（情侶算 2、單身算 1）、依百分比、指定金額
- **債務簡化**：把 A 欠 B、B 欠 C 串起來，算出最少的轉帳筆數
- **多幣別**：日圓的債用日圓記、台幣的債用台幣記，**不自動換匯**；結算時由你們自己講好匯率
- **離線可用**（Android）：沒網路照樣記帳，連上線自動補送
- **收據照片**：拍照壓縮後上傳
- **幽靈成員**：朋友沒裝 App 也能被記帳

## 設計上幾個刻意的選擇

**金額一律用整數最小單位，永不使用浮點數。** 分帳最難堪的 bug 是「大家的餘額加起來不等於 0」，來源通常是四捨五入誤差累積。分配用最大餘數法，保證加總精確等於總額（100 元分 3 人 = 34/33/33）。

**記帳不做匯率換算。** 每個幣別各自獨立記帳，所以「每個幣別的淨額加總 = 0」在數學上無條件成立。匯率只在清算時出現，而且由使用者自己決定——系統不替人做匯率的主。

**TWD 當作 0 位小數。** ISO 4217 上是 2 位（分），但台灣實務不用分；NT$100 分 3 人應該是 34/33/33，不是 33.34/33.33/33.33。

**主鍵由用戶端產生、一律軟刪除。** 前者讓離線也能新增資料且重送天然冪等，後者讓離線裝置知道某筆被刪了。

## 架構

```
src/
  domain/     純 TypeScript，不 import 任何 React Native 或 Supabase。
              所有跟錢有關的計算都在這裡，可以用 Jest 秒測，
              且 Android 與網頁版共用同一套計算。
  data/       Repository 介面 + 兩種實作：
              Android 走本地 SQLite + 送出佇列（離線優先）
              Web 走 Supabase 直連（expo-sqlite 在瀏覽器需要
              WASM + COOP/COEP 標頭，靜態託管難處理）
  ui/         元件庫。低彩度極簡風格。
  app/        Expo Router 檔案式路由
supabase/     Postgres schema、RLS policies、RPC
```

## 開發

```bash
npm install
```

建立 `.env`：

```
EXPO_PUBLIC_SUPABASE_URL=https://<你的專案>.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=<publishable key>
```

```bash
npx expo start
```

測試分兩組——預設那組不碰網路：

```bash
npm test          # 領域邏輯單元測試（43 項）
npm run test:sync # 同步協定與 Storage 權限整合測試（15 項），會打真正的 Supabase
```

## 已知限制

- **付款人只支援一位**。資料結構與領域邏輯都支援多人共同付款，缺的只是介面。
- **沒有 iOS 原生版**。需要 Apple Developer 帳號（US$99/年）。iPhone 請用網頁版，Safari 開啟後「加到主畫面」。
- **網頁版沒有離線寫入能力**，且身分存在 localStorage——iOS Safari 的 ITP 會在超過 7 天沒開時清掉。請在帳號頁綁定 Email 以便救回。

## 授權

MIT
