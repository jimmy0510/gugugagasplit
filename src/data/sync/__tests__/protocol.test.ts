import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { childId } from '../../child-id';

/**
 * 同步協定的整合測試——直接打真正的 Supabase。
 *
 * 為什麼需要這一份：outbox.ts / pull.ts 的正確性有一半不在我們的程式裡，
 * 而在「伺服器會不會照我們假設的方式反應」。這些假設沒被驗證過就上線，
 * 出錯的方式會是最難查的那種——資料悄悄重複、悄悄消失、或佇列永久卡住。
 *
 * 這裡不測 UI、不測 SQLite，只測那些假設：
 *   1. upsert 冪等：同一列重送 N 次不會變成 N 列（斷線重試的基礎）
 *   2. 游標式增量拉取真的只回傳變更過的列
 *   3. 軟刪除會被拉取看見（硬刪除則被 RLS 擋下）
 *   4. 子表決定性 id 讓兩台裝置的編輯收斂到同一列，而不是撞 unique 卡死
 *   5. 後寫的贏（last-write-wins），且 updated_at 由伺服器決定
 *
 * 需要 EXPO_PUBLIC_SUPABASE_URL / KEY；沒設定就整份跳過，
 * 這樣 CI 或別人 clone 下來跑 npm test 不會因為缺環境變數而爆紅。
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
const live = Boolean(url && key);
const maybe = live ? describe : describe.skip;

jest.setTimeout(60_000);

/** 每台「裝置」是一個獨立的 client，各自有自己的匿名帳號 */
async function newDevice(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`匿名登入失敗：${error?.message}`);
  return { client, userId: data.user.id };
}

const uuid = () => globalThis.crypto.randomUUID();

maybe('同步協定（對真實 Supabase）', () => {
  let phone: SupabaseClient;
  let userId: string;
  let groupId: string;
  let meId: string;
  let ghostId: string;

  beforeAll(async () => {
    const device = await newDevice();
    phone = device.client;
    userId = device.userId;

    groupId = uuid();
    meId = uuid();
    const { error } = await phone.rpc('create_group', {
      group_id: groupId,
      group_name: '同步測試',
      currency: 'TWD',
      member_id: meId,
      member_name: '手機',
    });
    if (error) throw new Error(`建立群組失敗：${error.message}`);

    ghostId = uuid();
    await phone.from('group_members').insert({ id: ghostId, group_id: groupId, name: '幽靈' });
  });

  afterAll(async () => {
    // 軟刪除擋不住我們自己清資料，但硬刪除被 RLS 擋，改成標記歸檔即可
    await phone?.from('groups').update({ deleted_at: new Date().toISOString() }).eq('id', groupId);
  });

  it('建立群組的 RPC 是冪等的（離線佇列重送不會出錯）', async () => {
    const again = await phone.rpc('create_group', {
      group_id: groupId,
      group_name: '同步測試',
      currency: 'TWD',
      member_id: meId,
      member_name: '手機',
    });
    expect(again.error).toBeNull();
    expect(again.data).toBe(groupId);

    const { data } = await phone.from('groups').select('id').eq('id', groupId);
    expect(data).toHaveLength(1);
  });

  it('同一筆支出重送三次仍然只有一列（upsert 冪等）', async () => {
    const expenseId = uuid();
    const row = {
      id: expenseId,
      group_id: groupId,
      title: '重送測試',
      currency: 'TWD',
      amount_minor: 300,
      split_type: 'equal',
      created_by: userId,
      deleted_at: null,
    };

    for (let i = 0; i < 3; i += 1) {
      const { error } = await phone.from('expenses').upsert(row);
      expect(error).toBeNull();
    }

    const { data } = await phone.from('expenses').select('id').eq('id', expenseId);
    expect(data).toHaveLength(1);
  });

  it('子表用決定性 id，兩台裝置各自編輯同一筆支出會收斂成同一列', async () => {
    const expenseId = uuid();
    await phone.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '共同編輯',
      currency: 'TWD',
      amount_minor: 100,
      split_type: 'equal',
      created_by: userId,
      deleted_at: null,
    });

    // 兩台裝置都算出同一顆 id，所以是 update 而不是插入第二列
    const splitId = childId(expenseId, meId, 'split');
    expect(childId(expenseId, meId, 'split')).toBe(splitId);

    await phone.from('expense_splits').upsert({
      id: splitId,
      expense_id: expenseId,
      group_id: groupId,
      member_id: meId,
      amount_minor: 100,
      deleted_at: null,
    });
    await phone.from('expense_splits').upsert({
      id: splitId,
      expense_id: expenseId,
      group_id: groupId,
      member_id: meId,
      amount_minor: 60,
      deleted_at: null,
    });

    const { data } = await phone.from('expense_splits').select('id, amount_minor').eq('expense_id', expenseId);
    expect(data).toHaveLength(1);
    expect(Number(data![0].amount_minor)).toBe(60);
  });

  it('updated_at 由伺服器寫入，不採信用戶端傳來的時間', async () => {
    const expenseId = uuid();
    const bogus = '1999-01-01T00:00:00.000Z';

    await phone.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '時鐘錯亂的裝置',
      currency: 'TWD',
      amount_minor: 50,
      split_type: 'equal',
      created_by: userId,
      updated_at: bogus,
      deleted_at: null,
    });

    const { data } = await phone.from('expenses').select('updated_at').eq('id', expenseId).single();
    expect(new Date(data!.updated_at).getFullYear()).toBeGreaterThan(2020);
  });

  it('游標式增量拉取只回傳游標之後變更的列', async () => {
    // 游標一律取自「伺服器回傳的 updated_at」，不能用本機時間——
    // 手機與資料庫的時鐘本來就不會一致，用本機時間當游標會漏資料。
    // 這裡跟 pull.ts 的作法一致。
    const { data: seed } = await phone
      .from('expenses')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1);
    const cursor = seed![0].updated_at as string;

    const expenseId = uuid();
    await phone.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '游標之後',
      currency: 'TWD',
      amount_minor: 70,
      split_type: 'equal',
      created_by: userId,
      deleted_at: null,
    });

    const { data: fresh } = await phone
      .from('expenses')
      .select('id, updated_at')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true });

    expect(fresh!.map((r) => r.id)).toContain(expenseId);

    // 把游標推進到這次拉到的最後一筆之後，再拉就不該有新東西
    const advanced = fresh![fresh!.length - 1].updated_at as string;
    const { data: none } = await phone.from('expenses').select('id').gt('updated_at', advanced);
    expect(none).toEqual([]);
  });

  it('軟刪除拉得到（離線裝置才知道要刪本地那一列），硬刪除被 RLS 擋下', async () => {
    const expenseId = uuid();
    await phone.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '要被刪的',
      currency: 'TWD',
      amount_minor: 20,
      split_type: 'equal',
      created_by: userId,
      deleted_at: null,
    });

    // 硬刪除：RLS 沒開 DELETE policy，資料應該還在
    await phone.from('expenses').delete().eq('id', expenseId);
    const { data: stillThere } = await phone.from('expenses').select('id').eq('id', expenseId);
    expect(stillThere).toHaveLength(1);

    // 軟刪除：拉取時看得到 deleted_at，用戶端才能同步移除本地列
    const cursor = new Date(Date.now() - 2000).toISOString();
    await phone.from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', expenseId);

    const { data: pulled } = await phone
      .from('expenses')
      .select('id, deleted_at')
      .gt('updated_at', cursor);

    const row = pulled!.find((r) => r.id === expenseId);
    expect(row).toBeDefined();
    expect(row!.deleted_at).not.toBeNull();
  });

  it('軟刪除必須用 update 而不是殘缺的 upsert', async () => {
    // 這是實機上抓到的真 bug：刪除支出在離線佇列裡排成
    // upsert({id, group_id, deleted_at})，送出去一定失敗，
    // 而且因為推送是「一筆失敗就停」，會把後面所有操作一起堵死。
    //
    // 原因：upsert 是 INSERT ... ON CONFLICT DO UPDATE，
    // Postgres 會先檢查 INSERT 那半段的 NOT NULL 條件，
    // 即使該列早就存在也一樣被擋下。
    const expenseId = uuid();
    await phone.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '要刪的',
      currency: 'TWD',
      amount_minor: 100,
      split_type: 'equal',
      created_by: userId,
      deleted_at: null,
    });

    const partial = await phone
      .from('expenses')
      .upsert({ id: expenseId, group_id: groupId, deleted_at: new Date().toISOString() });
    expect(partial.error).not.toBeNull();
    expect(partial.error!.message).toMatch(/not-null|null value/i);

    const proper = await phone
      .from('expenses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', expenseId);
    expect(proper.error).toBeNull();

    const { data } = await phone.from('expenses').select('deleted_at').eq('id', expenseId).single();
    expect(data!.deleted_at).not.toBeNull();
  });

  it('收據的軟刪除同樣不能用殘缺的 upsert', async () => {
    const expenseId = uuid();
    const receiptId = uuid();
    await phone.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '有收據的',
      currency: 'TWD',
      amount_minor: 50,
      split_type: 'equal',
      created_by: userId,
      deleted_at: null,
    });
    await phone.from('receipts').upsert({
      id: receiptId,
      expense_id: expenseId,
      group_id: groupId,
      storage_path: `${groupId}/${receiptId}.jpg`,
      deleted_at: null,
    });

    const partial = await phone
      .from('receipts')
      .upsert({ id: receiptId, group_id: groupId, deleted_at: new Date().toISOString() });
    expect(partial.error).not.toBeNull();

    const proper = await phone
      .from('receipts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', receiptId);
    expect(proper.error).toBeNull();
  });

  it('兩台裝置改同一列時，後寫的贏', async () => {
    const expenseId = uuid();
    await phone.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '第一台寫的',
      currency: 'TWD',
      amount_minor: 10,
      split_type: 'equal',
      created_by: userId,
      deleted_at: null,
    });

    await phone.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '第二台寫的',
      currency: 'TWD',
      amount_minor: 999,
      split_type: 'equal',
      created_by: userId,
      deleted_at: null,
    });

    const { data } = await phone.from('expenses').select('title, amount_minor').eq('id', expenseId).single();
    expect(data!.title).toBe('第二台寫的');
    expect(Number(data!.amount_minor)).toBe(999);
  });

  it('別的裝置（別的帳號）看不到這個群組的任何東西', async () => {
    const stranger = await newDevice();

    const { data: groups } = await stranger.client.from('groups').select('id').eq('id', groupId);
    expect(groups).toEqual([]);

    const { data: expenses } = await stranger.client.from('expenses').select('id').eq('group_id', groupId);
    expect(expenses).toEqual([]);

    // 也不能硬塞資料進別人的群組
    const { error } = await stranger.client.from('expenses').insert({
      id: uuid(),
      group_id: groupId,
      title: '入侵',
      currency: 'TWD',
      amount_minor: 1,
      split_type: 'equal',
      created_by: stranger.userId,
    });
    expect(error).not.toBeNull();
  });

  it('幽靈成員可以被記帳（沒有帳號也算一份）', async () => {
    const expenseId = uuid();
    await phone.from('expenses').upsert({
      id: expenseId,
      group_id: groupId,
      title: '幽靈也要分攤',
      currency: 'TWD',
      amount_minor: 100,
      split_type: 'equal',
      created_by: userId,
      deleted_at: null,
    });

    const { error } = await phone.from('expense_splits').upsert([
      {
        id: childId(expenseId, meId, 'split'),
        expense_id: expenseId,
        group_id: groupId,
        member_id: meId,
        amount_minor: 50,
        deleted_at: null,
      },
      {
        id: childId(expenseId, ghostId, 'split'),
        expense_id: expenseId,
        group_id: groupId,
        member_id: ghostId,
        amount_minor: 50,
        deleted_at: null,
      },
    ]);

    expect(error).toBeNull();
  });
});

if (!live) {
  describe('同步協定', () => {
    it('缺少 Supabase 環境變數，整份跳過', () => {
      expect(live).toBe(false);
    });
  });
}
