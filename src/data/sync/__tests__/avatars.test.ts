import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 頭像權限測試。
 *
 * 頭像的可見範圍是「有共同群組的人」，比收據（同一個群組）更寬鬆，
 * 規則也更容易寫錯。這裡驗證兩個方向都成立：
 *   - 同群組的人看得到彼此
 *   - 陌生人看不到，也不能覆蓋別人的頭像
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
const live = Boolean(url && key);
const maybe = live ? describe : describe.skip;

jest.setTimeout(60_000);

const uuid = () => globalThis.crypto.randomUUID();
const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);

async function newDevice(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`匿名登入失敗：${error?.message}`);
  return { client, userId: data.user.id };
}

maybe('頭像權限', () => {
  let alice: SupabaseClient;
  let aliceId: string;
  let bob: SupabaseClient;
  let bobId: string;
  let stranger: SupabaseClient;
  let groupId: string;

  beforeAll(async () => {
    const a = await newDevice();
    alice = a.client;
    aliceId = a.userId;

    const b = await newDevice();
    bob = b.client;
    bobId = b.userId;

    stranger = (await newDevice()).client;

    // alice 建群組，bob 用邀請碼加入 → 兩人有共同群組
    groupId = uuid();
    const created = await alice.rpc('create_group', {
      group_id: groupId,
      group_name: '頭像測試',
      currency: 'TWD',
      member_id: uuid(),
      member_name: 'Alice',
    });
    if (created.error) throw new Error(created.error.message);

    const code = `AV${uuid().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await alice.from('group_invites').insert({
      id: uuid(),
      group_id: groupId,
      code,
      created_by: aliceId,
    });
    const joined = await bob.rpc('join_group_by_code', { invite_code: code, member_name: 'Bob' });
    if (joined.error) throw new Error(joined.error.message);

    // alice 上傳頭像
    const up = await alice.storage
      .from('avatars')
      .upload(`${aliceId}/avatar.jpg`, fakeJpeg, { contentType: 'image/jpeg', upsert: true });
    if (up.error) throw new Error(up.error.message);
    await alice.from('profiles').update({ avatar_url: `${aliceId}/avatar.jpg` }).eq('id', aliceId);
  });

  afterAll(async () => {
    await alice?.from('groups').update({ deleted_at: new Date().toISOString() }).eq('id', groupId);
  });

  it('同群組的成員看得到彼此的 profile（頭像路徑）', async () => {
    const { data, error } = await bob.from('profiles').select('id, avatar_url').eq('id', aliceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].avatar_url).toBe(`${aliceId}/avatar.jpg`);
  });

  it('同群組的成員拿得到頭像的簽章網址，而且下載得到', async () => {
    const { data, error } = await bob.storage
      .from('avatars')
      .createSignedUrl(`${aliceId}/avatar.jpg`, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();

    const response = await fetch(data!.signedUrl);
    expect(response.status).toBe(200);
  });

  it('沒有共同群組的人看不到別人的 profile', async () => {
    const { data } = await stranger.from('profiles').select('id').eq('id', aliceId);
    expect(data).toEqual([]);
  });

  it('沒有共同群組的人拿不到頭像的簽章網址', async () => {
    const { data, error } = await stranger.storage
      .from('avatars')
      .createSignedUrl(`${aliceId}/avatar.jpg`, 60);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('不能覆蓋別人的頭像（即使是同群組的隊友）', async () => {
    const { error } = await bob.storage
      .from('avatars')
      .upload(`${aliceId}/avatar.jpg`, fakeJpeg, { contentType: 'image/jpeg', upsert: true });
    expect(error).not.toBeNull();
  });

  it('不能改別人的 profile', async () => {
    await bob.from('profiles').update({ avatar_url: 'hacked' }).eq('id', aliceId);
    const { data } = await alice.from('profiles').select('avatar_url').eq('id', aliceId).single();
    expect(data!.avatar_url).toBe(`${aliceId}/avatar.jpg`);
  });

  it('自己的頭像自己換得掉', async () => {
    const { error } = await bob.storage
      .from('avatars')
      .upload(`${bobId}/avatar.jpg`, fakeJpeg, { contentType: 'image/jpeg', upsert: true });
    expect(error).toBeNull();
  });
});

if (!live) {
  describe('頭像權限', () => {
    it('缺少 Supabase 環境變數，整份跳過', () => {
      expect(live).toBe(false);
    });
  });
}
