import type { SplitInput, SplitType } from '../domain';

/** UI 與資料層之間的共用形狀。Android 與 Web 兩條路徑都回傳這些型別。 */

export interface Group {
  id: string;
  name: string;
  defaultCurrency: string;
  createdBy: string;
  archivedAt: string | null;
}

export interface Member {
  id: string;
  groupId: string;
  userId: string | null;
  name: string;
  role: string;
  /** storage 路徑，尚未設定頭像則為 null。幽靈成員永遠是 null */
  avatarPath: string | null;
}

export interface ExpensePayer {
  memberId: string;
  amountMinor: number;
}

export interface ExpenseSplit {
  memberId: string;
  amountMinor: number;
  shareValue: number | null;
}

export interface Expense {
  id: string;
  groupId: string;
  title: string;
  category: string | null;
  currency: string;
  amountMinor: number;
  splitType: SplitType;
  paidAt: string;
  createdBy: string;
  payers: ExpensePayer[];
  splits: ExpenseSplit[];
}

export interface Transfer {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  /** 被清掉的債的幣別與金額——餘額只看這兩個 */
  currency: string;
  amountMinor: number;
  /** 跨幣別清算的實付紀錄，純顯示 */
  paidCurrency: string | null;
  paidAmountMinor: number | null;
  paidRate: string | null;
  note: string | null;
  paidAt: string;
}

export interface Receipt {
  id: string;
  expenseId: string;
  groupId: string;
  storagePath: string;
  /** 還沒上傳完成前，本地檔案的路徑 */
  localPath: string | null;
}

/** 一個群組的完整資料。群組規模小，一次全載最單純。 */
export interface GroupSnapshot {
  group: Group;
  members: Member[];
  expenses: Expense[];
  transfers: Transfer[];
  receipts: Receipt[];
}

// ---------------------------------------------------------------- 寫入輸入

export interface SaveExpenseInput {
  /** 編輯既有支出時帶原 id，新增不帶 */
  id?: string;
  groupId: string;
  title: string;
  category?: string;
  currency: string;
  amountMinor: number;
  splitType: SplitType;
  paidAt: string;
  /** 誰出了多少（多人共同出錢時金額須自行分配好，總和等於 amountMinor） */
  payers: ExpensePayer[];
  /** 怎麼分，value 的意義依 splitType 而定（見 domain/split.ts） */
  splitInputs: SplitInput[];
  userId: string;
}

export interface SaveTransferInput {
  id?: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  /** 被清掉的債的幣別與金額 */
  currency: string;
  amountMinor: number;
  /** 跨幣別清算時的實付紀錄，純顯示 */
  paidCurrency?: string;
  paidAmountMinor?: number;
  paidRate?: number;
  note?: string;
  paidAt: string;
  userId: string;
}
