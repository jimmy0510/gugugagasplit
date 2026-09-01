import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { childId } from '../../child-id';

/**
 * 移除成員的權限與條件。
 *
 * 這個操作同時有「誰能做」和「什麼情況下能做」兩層限制，兩層都必須在
 * 伺服器端擋住——尤其是「已結清才能移除」：餘額不為零的人被踢掉，
 * 那筆債就變成沒有人負責的孤兒，付錢的人再也收不回來，
 * 而「每個幣別的淨額加總為 0」這條整個 App 賴以成立的不變式也會被打破。
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
const live = Boolean(url && key);
const maybe = live ? describe : describe.skip;

jest.setTimeout(60_000);

const uuid = () => globalThis.crypto.randomUUID();

async function newDevice(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`匿名登入失敗：${error?.message}`);
  return { client, userId: data.user.id };
}

maybe('移除成員', () => {
  let owner: SupabaseClient;
  let ownerUserId: string;
  let ownerMemberId: string;
  let groupId: string;
  let ghostId: string;

  beforeAll(async () => {
    const device = await newDevice();
    owner = device.client;
    ownerUserId = device.userId;

    groupId = uuid();
    ownerMemberId = uuid();
    const { error } = await owner.rpc('create_group', {
      group_id: groupId,
      group_name: '移除成員測試',
      currency: 'TWD',
      member_id: ownerMemberId,
      member_name: '群主',
    });
    if (error) throw new Error(error.message);

    ghostId = uuid();
    await owner.from('group_members').insert({ id: ghostId, group_id: groupId, name: '幽靈' });
  });

  afterAll(async () => {
    // 只軟刪除自己這次建立的那一個群組
    await owner?.from('groups').update({ deleted_at: new Date().toISOString() }).eq('id', groupId);
  });

  /** 建一筆由 payer 出錢、由 splitter 分攤的支出 */
  async function addExpense(payer: string, splitter: string, amount: number) {
    const expenseId = uuid();
    await owner.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '測試支出',
      currency: 'TWD',
      amount_minor: amount,
      split_type: 'equal',
      created_by: ownerUserId,
      deleted_at: null,
    });
    await owner.from('expense_payers').upsert({
      id: childId(expenseId, payer, 'payer'),
      expense_id: expenseId,
      group_id: groupId,
      member_id: payer,
      amount_minor: amount,
      deleted_at: null,
    });
    await owner.from('expense_splits').upsert({
      id: childId(expenseId, splitter, 'split'),
      expense_id: expenseId,
      group_id: groupId,
      member_id: splitter,
      amount_minor: amount,
      deleted_at: null,
    });
    return expenseId;
  }

  it('沒有帳目的成員可以被移除', async () => {
    const spareId = uuid();
    await owner.from('group_members').insert({ id: spareId, group_id: groupId, name: '路人' });

    const { error } = await owner.rpc('remove_member', { target_member: spareId });
    expect(error).toBeNull();

    const { data } = await owner
      .from('group_members')
      .select('deleted_at')
      .eq('id', spareId)
      .single();
    expect(data!.deleted_at).not.toBeNull();
  });

  it('還沒結清的成員不能被移除', async () => {
    // 群主幫幽靈墊了 500，幽靈欠 500
    await addExpense(ownerMemberId, ghostId, 500);

    const { error } = await owner.rpc('remove_member', { target_member: ghostId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/還沒結清/);

    const { data } = await owner
      .from('group_members')
      .select('deleted_at')
      .eq('id', ghostId)
      .single();
    expect(data!.deleted_at).toBeNull();
  });

  it('結清之後就可以移除', async () => {
    // 幽靈把 500 還給群主，餘額歸零
    await owner.from('transfers').insert({
      id: uuid(),
      group_id: groupId,
      from_member_id: ghostId,
      to_member_id: ownerMemberId,
      currency: 'TWD',
      amount_minor: 500,
      created_by: ownerUserId,
    });

    const { data: balances } = await owner.rpc('member_net_balances', { target_member: ghostId });
    const nonZero = (balances ?? []).filter((b: { net: number }) => Number(b.net) !== 0);
    expect(nonZero).toEqual([]);

    const { error } = await owner.rpc('remove_member', { target_member: ghostId });
    expect(error).toBeNull();
  });

  it('不是建立者的人不能移除任何人', async () => {
    const someoneId = uuid();
    await owner.from('group_members').insert({ id: someoneId, group_id: groupId, name: '被盯上的' });

    // 讓另一個帳號用邀請碼正式加入這個群組
    const code = `RM${uuid().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await owner.from('group_invites').insert({
      id: uuid(),
      group_id: groupId,
      code,
      created_by: ownerUserId,
    });
    const intruder = await newDevice();
    const joined = await intruder.client.rpc('join_group_by_code', {
      invite_code: code,
      member_name: '一般成員',
    });
    expect(joined.error).toBeNull();

    const { error } = await intruder.client.rpc('remove_member', { target_member: someoneId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/只有群組建立者/);

    const { data } = await owner
      .from('group_members')
      .select('deleted_at')
      .eq('id', someoneId)
      .single();
    expect(data!.deleted_at).toBeNull();
  });

  it('不能移除群組建立者自己', async () => {
    const { error } = await owner.rpc('remove_member', { target_member: ownerMemberId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/不能移除群組建立者/);
  });

  it('完全不相干的人連呼叫都不該成功', async () => {
    const stranger = await newDevice();
    const { error } = await stranger.client.rpc('remove_member', { target_member: ownerMemberId });
    expect(error).not.toBeNull();
  });
});

if (!live) {
  describe('移除成員', () => {
    it('缺少 Supabase 環境變數，整份跳過', () => {
      expect(live).toBe(false);
    });
  });
}
