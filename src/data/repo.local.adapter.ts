import { migrate } from './db';
import * as local from './repo.local';
import type { Repository } from './repository-types';
import { start as startSync } from './sync/engine';

/**
 * 把 repo.local 的同步函式包成 Repository 介面（非同步）。
 *
 * 本地寫入本來就是同步的 SQLite 交易，包成 Promise 只是為了讓
 * UI 兩個平台共用同一組呼叫方式；不會因此變慢。
 */
const adapter: Repository = {
  async init() {
    migrate();
    startSync();
  },

  async listGroups() {
    return local.listGroups();
  },

  async loadGroup(groupId) {
    return local.loadGroup(groupId);
  },

  async createGroup(input) {
    return local.createGroup(input);
  },

  async addMember(input) {
    return local.addMember(input);
  },

  async saveExpense(input) {
    return local.saveExpense(input);
  },

  async deleteExpense(expenseId, groupId) {
    local.deleteExpense(expenseId, groupId);
  },

  async saveTransfer(input) {
    return local.saveTransfer(input);
  },

  async attachReceipt(input) {
    local.attachReceipt(input);
  },

  async removeReceipt(receiptId, groupId) {
    local.removeReceipt(receiptId, groupId);
  },

  createInvite: local.createInvite,
  joinByCode: local.joinByCode,
};

export default adapter;
