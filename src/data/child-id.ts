/**
 * 子表列的決定性 id。
 *
 * 刻意獨立成一個沒有任何相依的模組：這是純函式，不需要 expo-crypto，
 * 抽出來後 Node 環境的整合測試才能直接引用，不必把整個 Expo 執行環境拖進來。
 *
 * 為什麼要決定性：編輯支出時子表是「整組取代」。若每次都給新 id，
 * 兩台裝置各自編輯同一筆支出會各自長出一列，撞上伺服器的
 * unique(expense_id, member_id) 而讓同步佇列永久卡住。
 * 用決定性 id 之後兩邊算出同一顆主鍵，upsert 自然收斂成同一列。
 */
export function childId(expenseId: string, memberId: string, kind: 'payer' | 'split'): string {
  const a = expenseId.replace(/-/g, '');
  const b = memberId.replace(/-/g, '');
  const k = kind === 'payer' ? '1' : '2';
  const hex = (a.slice(0, 15) + k + b.slice(0, 16)).padEnd(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
