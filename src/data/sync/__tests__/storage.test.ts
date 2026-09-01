import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 收據 Storage 的權限測試。
 *
 * bucket 是私有的，權限規則寫在路徑上：receipts/{group_id}/{檔名}。
 * 這裡驗證那條規則真的擋得住人——不然收據就等於公開在網路上，
 * 而這種漏洞不會有任何錯誤訊息提醒你。
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

/** 最小的合法 JPEG，用來當測試檔案 */
const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xd9]);

maybe('收據 Storage 權限', () => {
  let phone: SupabaseClient;
  let groupId: string;
  let path: string;

  beforeAll(async () => {
    const device = await newDevice();
    phone = device.client;

    groupId = uuid();
    const { error } = await phone.rpc('create_group', {
      group_id: groupId,
      group_name: '收據測試',
      currency: 'TWD',
      member_id: uuid(),
      member_name: '手機',
    });
    if (error) throw new Error(`建立群組失敗：${error.message}`);

    path = `${groupId}/${uuid()}.jpg`;
  });

  afterAll(async () => {
    await phone?.from('groups').update({ deleted_at: new Date().toISOString() }).eq('id', groupId);
  });

  it('群組成員可以上傳到自己群組的路徑', async () => {
    const { error } = await phone.storage
      .from('receipts')
      .upload(path, fakeJpeg, { contentType: 'image/jpeg', upsert: true });
    expect(error).toBeNull();
  });

  it('重複上傳同一個路徑會覆蓋而不是失敗（離線佇列重放安全）', async () => {
    const { error } = await phone.storage
      .from('receipts')
      .upload(path, fakeJpeg, { contentType: 'image/jpeg', upsert: true });
    expect(error).toBeNull();
  });

  it('成員拿得到簽章網址，而且真的能下載', async () => {
    const { data, error } = await phone.storage.from('receipts').createSignedUrl(path, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();

    const response = await fetch(data!.signedUrl);
    expect(response.status).toBe(200);
  });

  it('沒有簽章的公開網址拿不到檔案（bucket 確實是私有的）', async () => {
    const { data } = phone.storage.from('receipts').getPublicUrl(path);
    const response = await fetch(data.publicUrl);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('別的帳號不能上傳到這個群組的路徑', async () => {
    const stranger = await newDevice();
    const { error } = await stranger.client.storage
      .from('receipts')
      .upload(`${groupId}/${uuid()}.jpg`, fakeJpeg, { contentType: 'image/jpeg' });
    expect(error).not.toBeNull();
  });

  it('別的帳號不能為這個群組的檔案要簽章網址', async () => {
    const stranger = await newDevice();
    const { data, error } = await stranger.client.storage.from('receipts').createSignedUrl(path, 60);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

if (!live) {
  describe('收據 Storage 權限', () => {
    it('缺少 Supabase 環境變數，整份跳過', () => {
      expect(live).toBe(false);
    });
  });
}
