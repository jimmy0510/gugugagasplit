/**
 * app.json 之外再加一層動態設定。
 *
 * 只為了一件事：google-services.json 不進版本控制（這個 repo 是公開的，
 * 那個檔案帶著 Firebase 專案的識別資訊），但 EAS Build 只上傳 git 追蹤中的檔案，
 * 所以建置機器上根本沒有那個檔。
 *
 * 解法是把它存成 EAS 的檔案型環境變數（GOOGLE_SERVICES_JSON），建置時
 * EAS 會把檔案還原到機器上，並把「還原後的路徑」放進這個環境變數。
 * 本機開發時環境變數不存在，就退回專案根目錄那份。
 *
 * 有 app.config.js 時 Expo 會先讀 app.json 再把它交給這個函式，
 * 所以底下只需要覆寫要動的那一個欄位。
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
  },
});
