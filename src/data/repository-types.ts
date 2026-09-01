import type { Group, GroupSnapshot, SaveExpenseInput, SaveTransferInput } from './types';

/**
 * UI 唯一認識的資料介面。
 *
 * Android 由本地 SQLite + 送出佇列實作（離線可寫），
 * Web 由 Supabase 直連實作（需要連線）。
 * 兩者形狀相同，所以畫面層完全不必知道自己跑在哪。
 */
export interface Repository {
  /** App 啟動時呼叫：原生端跑 migration 並啟動同步引擎 */
  init(): Promise<void>;

  /**
   * 伺服器端資料變了，把畫面上的資料弄成最新的。
   *
   * 兩個平台的作法不同：Web 直接重新查詢；Android 要先讓同步引擎
   * 把變更拉進本地 SQLite，畫面才看得到。所以由各自的實作決定。
   */
  refresh(): Promise<void>;

  listGroups(): Promise<Group[]>;

  /**
   * 最近一筆帳目（支出或還款）屬於哪個群組。沒有任何帳目就回傳 null。
   *
   * 首頁用它決定一開啟要顯示哪一個群組——正在跑的那趟旅行永遠是
   * 最新有動靜的那個，直接落在那裡比記住「上次看的」更貼近實際需要。
   */
  newestActivityGroupId(): Promise<string | null>;
  loadGroup(groupId: string): Promise<GroupSnapshot | null>;

  createGroup(input: {
    name: string;
    defaultCurrency: string;
    userId: string;
    memberName: string;
  }): Promise<{ groupId: string; memberId: string }>;

  addMember(input: { groupId: string; name: string; userId?: string }): Promise<string>;

  /**
   * 改群組本身的欄位（名稱、主幣別）。只傳要改的那些。
   *
   * 換主幣別只影響「新增支出的預設幣別」與「結餘排序依據」，
   * 不會動到任何既有帳目——每筆支出永遠留在它自己記帳時的幣別裡。
   */
  updateGroup(groupId: string, patch: { name?: string; defaultCurrency?: string }): Promise<void>;

  saveExpense(input: SaveExpenseInput): Promise<string>;
  deleteExpense(expenseId: string, groupId: string): Promise<void>;
  saveTransfer(input: SaveTransferInput): Promise<string>;

  /** 把已經拍好／選好並壓縮完的收據掛到某筆支出上 */
  attachReceipt(input: {
    expenseId: string;
    groupId: string;
    receiptId: string;
    storagePath: string;
    localUri: string;
  }): Promise<void>;
  removeReceipt(receiptId: string, groupId: string): Promise<void>;

  /** 這三項一定需要連線，離線時會拋錯 */
  createInvite(groupId: string, userId: string): Promise<string>;
  joinByCode(code: string, memberName: string): Promise<string>;
  /**
   * 移除成員。只有群組建立者能做，而且對方必須已結清——
   * 兩個條件都由伺服器端的 RPC 把關，不是靠畫面擋。
   */
  removeMember(memberId: string): Promise<void>;

  /** 刪除整個群組。軟刪除，只有建立者做得到（伺服器端會擋） */
  deleteGroup(groupId: string): Promise<void>;
}
