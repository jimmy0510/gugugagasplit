# gugugagasplit

朋友之間的分帳 App。Expo SDK 57（React Native）+ Supabase。

寫任何程式前先看對應版本的文件：https://docs.expo.dev/versions/v57.0.0/

---

## 資料庫是正式環境，裡面有真人的資料

**這個專案只有一個 Supabase 專案，開發、測試、正式使用共用同一個資料庫。**
使用者手機上的群組與帳目就在裡面。

### 絕對不要做的事

```sql
delete from public.groups;        -- 不行
delete from auth.users;           -- 不行
truncate ...;                     -- 不行
```

沒有 where 條件、或條件涵蓋範圍不明確的刪除，一律不做。

這不是假設性的風險——開發過程中真的發生過：為了「清理測試資料」下了
`delete from public.groups; delete from auth.users;`，把使用者真正建立的
群組與帳號一起刪光，救不回來（免費方案沒有時間點還原）。

### 清理測試資料的正確做法

只刪自己這次建立的那幾筆，用明確的 id：

```sql
delete from public.groups where id = '<這次建立的那個 id>';
```

整合測試已經是這樣做的——只軟刪除自己建的群組（`.eq('id', groupId)`），
而且 RLS 根本不允許它們硬刪除。**問題從來不在測試，而在手動下的 SQL。**

## 資料庫層的兩道防護（migration 0008）

規則寫在文件裡會被忘記，所以也寫進資料庫：

**1. 變更前存檔** — 任何列被 update 或 delete 之前，變更前的樣子會存進
`public.row_archive`，保留 14 天，每天 03:17 由 pg_cron 修剪。
存檔開了 RLS 但沒有任何 policy，只有 service_role 讀得到。

還原方式：

```sql
insert into public.expenses
select * from jsonb_populate_recordset(null::public.expenses, (
  select jsonb_agg(row_data) from public.row_archive
  where table_name = 'expenses' and op = 'DELETE'
    and archived_at > now() - interval '1 hour'
))
on conflict (id) do nothing;
```

**2. 大量刪除保險** — 單一 delete 影響超過 25 列會直接中止交易。
真的需要時，在同一個交易裡解除：

```sql
begin;
set local app.allow_bulk_delete = 'on';
delete from ...;
commit;
```

`set local` 只在該交易有效，不會意外留著。

## 建置 APK 要先問過

改完程式先部署網頁版（`npx expo export --platform web` + `npx eas-cli deploy --prod`），
讓使用者看過、意見提完，**得到同意才送 EAS 建置**。每次建置約 20 分鐘，
免費方案每月只有 30 次額度。網頁版可以隨意重新部署。

建置時要加 `EAS_SKIP_AUTO_FINGERPRINT=1`，否則算指紋會卡住。

**EAS Build 只上傳 git 追蹤中的檔案。** 追蹤中但尚未提交的「修改」會一起帶上去，
但**全新的未追蹤檔案不會**，被 `.gitignore` 擋掉的也不會。所以新增檔案之後
一定要先 `git add`（或提交）再建置，否則建置機器上根本沒有那個檔——
新模組會在打包時報 module not found，設定檔則是到編譯階段才炸。

刻意不進版本控制、但建置又需要的檔案（例如 `google-services.json`，
這個 repo 是公開的），存成 EAS 的檔案型環境變數：

```bash
npx eas-cli env:set --name GOOGLE_SERVICES_JSON --type file   --value ./google-services.json --visibility secret   --environment preview --environment production
```

再由 `app.config.js` 讀 `process.env.GOOGLE_SERVICES_JSON`（建置時 EAS 會把檔案
還原到機器上並把路徑放進那個變數），本機沒有變數就退回專案裡那份。

**從 v1.6.0 起有 OTA（`expo-updates`）。** 純 JS／畫面的改動可以
`eas update --channel preview` 推出去，使用者開兩次 App 就會換新，不必重裝。
改到原生層的東西（app 圖示、啟動畫面、權限、新增原生套件、升 SDK）仍然要重建，
那種時候要把 `app.json` 的 `version` 往上跳，舊安裝檔才不會收到跟它不相容的更新。

## 專案結構

- `src/domain/` — 純 TypeScript，不 import React Native 或 Supabase。
  所有跟錢有關的計算，可用 Jest 秒測，Android 與網頁共用同一套。
- `src/data/` — Repository 介面 + 兩種實作。Android 走本地 SQLite +
  送出佇列（離線可寫），Web 走 Supabase 直連。平台副檔名
  （`impl.ts` / `impl.native.ts`）讓 Metro 在 web build 時看不到 SQLite——
  用 `require()` 延遲載入沒有用，打包器仍會把它拉進去。
- `src/ui/` — 元件庫，低彩度極簡風格。
- `supabase/migrations/` — schema、RLS、RPC。

## 測試

```bash
npm test           # 領域邏輯單元測試，不碰網路
npm run test:sync  # 整合測試，會打真正的 Supabase
```

整合測試用 Node 環境（`jest.integration.config.js`），不能用 jest-expo
preset——那會架起 React Native 模擬環境，把 fetch 換掉，連不出去。
也不能用 babel-preset-expo，它會在每個檔案注入 ESM 模組。

## 幾個踩過的坑

- **金額一律整數最小單位**，永不使用浮點數。分配用最大餘數法。
- **記帳不做匯率換算**：各幣別獨立記帳，所以「每個幣別的淨額加總 = 0」
  無條件成立。匯率只在清算時由使用者自己決定。
- **軟刪除不能用 upsert**：upsert 是 `INSERT ... ON CONFLICT DO UPDATE`，
  Postgres 會先檢查 INSERT 那半段的 NOT NULL，即使該列早就存在也會被擋下。
  要用 `update`。
- **`Alert.alert` 在 react-native-web 上完全沒作用**，別把它當成唯一的確認方式。
- **Android 的觸控會被父容器邊界裁切**，元件可能「看得到但點不到」。
  版面容器避免用 `gap`，改用明確外距。
- **`updated_at` 一律由資料庫 trigger 寫入**，不採信用戶端時間——
  增量同步的游標建立在它上面，手機時鐘不準會讓資料悄悄消失。
- **停用的按鈕要看起來就是停用的**，否則使用者會以為按鈕壞了。
  能給明確錯誤訊息時，寧可讓他按下去然後說明缺什麼。
- **原生端寫完資料要自己通知畫面**：畫面讀的是本地 SQLite，靠 `bump()` 才會重讀。
  同步拉取（`pullAll`）與任何「直接打伺服器」的操作（RPC、移除成員、刪除群組）
  都必須自己 `bump()` 或先把結果寫進本地，否則畫面會慢一整拍——
  看起來像「按了沒反應，做別的事之後才更新」。
- **有原生標題列的畫面不要再讓一次安全區**：標題列已經把狀態列的高度讓開了，
  `SafeAreaView` 讀的是整個視窗的內縮值，不知道上面有人讓過，會多出一整條空白。
- **不要旋轉文字符號當載入動畫**：文字的旋轉軸是排版方框中心，字的墨跡卻不在
  方框正中央（有側距、又坐在基線上），轉起來會偏心晃動。用圖示字型或自己畫。
