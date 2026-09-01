import { migrate } from './db';
import { deleteGroup, removeMember } from './invites';
import * as local from './repo.local';
import type { Repository } from './repository-types';
import { kick, start as startSync } from './sync/engine';
import { repairLegacyDeletes } from './sync/outbox';

/**
 * 把 repo.local 的同步函式包成 Repository 介面（非同步）。
 *
 * 本地寫入本來就是同步的 SQLite 交易，包成 Promise 只是為了讓
 * UI 兩個平台共用同一組呼叫方式；不會因此變慢。
 */
const adapter: Repository = {
  async init() {
    migrate();
    // 舊版把軟刪除排成殘缺的 upsert，那種操作會永遠失敗並堵住整個佇列。
    // 必須在啟動同步「之前」改寫掉，否則第一輪推送又會卡在同一筆。
    repairLegacyDeletes();
    startSync();
  },

  // 原生端讀的是本地 SQLite，所以要先讓同步引擎把變更拉進來
  async refresh() {
    kick();
  },

  async listGroups() {
    return local.listGroups();
  },

  async newestActivityGroupId() {
    return local.newestActivityGroupId();
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

  async updateGroup(groupId, patch) {
    local.updateGroup(groupId, patch);
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
  removeMember,
  deleteGroup,
};

export default adapter;
