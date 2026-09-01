import { bump } from './changes';
import { removeMember } from './invites';
import * as remote from './repo.remote';
import type { Repository } from './repository-types';

/**
 * Web 端實作（也是沒有平台專屬檔案時的預設）。
 *
 * 為什麼要用平台副檔名而不是在程式裡判斷 Platform.OS：
 * Metro 會靜態打包所有 require 到的模組，就算執行時不會走到那個分支
 * 也一樣會被打包。expo-sqlite 的 web 版需要 WASM worker，
 * 一旦進了 web bundle 就會解析失敗。用 impl.ts / impl.native.ts
 * 讓打包器在 web build 時「根本看不到」本地資料庫那條路。
 */
const impl: Repository = {
  init: async () => {},
  // Web 直接讀伺服器，讓畫面重新查詢就是最新的
  refresh: async () => bump(),
  listGroups: remote.listGroups,
  loadGroup: remote.loadGroup,
  createGroup: remote.createGroup,
  addMember: remote.addMember,
  saveExpense: remote.saveExpense,
  deleteExpense: async (expenseId) => remote.deleteExpense(expenseId),
  saveTransfer: remote.saveTransfer,
  attachReceipt: remote.attachReceipt,
  removeReceipt: async (receiptId) => remote.removeReceipt(receiptId),
  createInvite: remote.createInvite,
  joinByCode: remote.joinByCode,
  removeMember,
};

export default impl;
