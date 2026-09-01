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

  listGroups(): Promise<Group[]>;
  loadGroup(groupId: string): Promise<GroupSnapshot | null>;

  createGroup(input: {
    name: string;
    defaultCurrency: string;
    userId: string;
    memberName: string;
  }): Promise<{ groupId: string; memberId: string }>;

  addMember(input: { groupId: string; name: string; userId?: string }): Promise<string>;

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

  /** 這兩項一定需要連線，離線時會拋錯 */
  createInvite(groupId: string, userId: string): Promise<string>;
  joinByCode(code: string, memberName: string): Promise<string>;
}
