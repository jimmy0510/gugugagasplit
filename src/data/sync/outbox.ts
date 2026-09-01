import { asc, eq, sql } from 'drizzle-orm';

import { db } from '../db';
import { outbox } from '../schema.local';
import { uploadReceipt } from '../receipts';
import { supabase } from '../supabase';

/**
 * 送出佇列（outbox）。
 *
 * 規約：所有會動到伺服器的本地寫入，都必須「在同一個 SQLite 交易裡」
 * 同時寫本地鏡像表 + enqueue 一筆 outbox。這樣不管網路何時斷，
 * 本地畫面永遠先反應，資料遲早會到伺服器，順序也有保障。
 *
 * 冪等性：upsert 靠用戶端產生的 UUID 主鍵，重放不會造成重複；
 * rpc（create_group / join_group_by_code）在伺服器端自行處理重送；
 * upload 用固定的 storage 路徑加 upsert，重放只是覆蓋同一個檔案。
 */

export interface EnqueueInput {
  /**
   * upsert  整列覆蓋（新增或編輯）
   * update  只改指定欄位（軟刪除用）
   * rpc     呼叫函式
   * upload  收據照片，路徑固定所以重放安全
   */
  op: 'upsert' | 'update' | 'rpc' | 'upload';
  /** upsert/update 的表名、rpc 的函式名，或 upload 的 bucket */
  target: string;
  payload: Record<string, unknown>;
}

/** 在呼叫端的交易裡使用（例如 repo.local 寫入本地列之後） */
export function enqueue(input: EnqueueInput): void {
  db.insert(outbox)
    .values({
      op: input.op,
      target: input.target,
      payload: JSON.stringify(input.payload),
      createdAt: new Date().toISOString(),
    })
    .run();
}

const MAX_BATCH = 50;

export interface PushResult {
  pushed: number;
  /** 還留在佇列裡的筆數（失敗或尚未處理） */
  remaining: number;
  /** 這一輪是否卡在第一筆就失敗（呼叫端據此決定退避） */
  blocked: boolean;
}

/**
 * 把佇列依序推到 Supabase。
 *
 * 嚴格照 seq 順序，一筆失敗就停（不跳過）：後面的操作常依賴前面的
 * （先建支出、才有 payers/splits），亂序重放會製造外鍵孤兒。
 * 失敗的那筆記下錯誤與次數，等下一輪重試；呼叫端用指數退避排程。
 */
export async function pushOutbox(): Promise<PushResult> {
  let pushed = 0;

  for (;;) {
    const batch = db.select().from(outbox).orderBy(asc(outbox.seq)).limit(MAX_BATCH).all();
    if (batch.length === 0) {
      return { pushed, remaining: 0, blocked: false };
    }

    for (const item of batch) {
      const payload = JSON.parse(item.payload) as Record<string, unknown>;

      const error = await runOp(item.op, item.target, payload);

      if (error) {
        db.update(outbox)
          .set({
            attempts: sql`${outbox.attempts} + 1`,
            lastError: `${error.code ?? ''} ${error.message}`.trim().slice(0, 500),
          })
          .where(eq(outbox.seq, item.seq))
          .run();

        const remaining = countOutbox();
        return { pushed, remaining, blocked: true };
      }

      db.delete(outbox).where(eq(outbox.seq, item.seq)).run();
      pushed += 1;
    }
  }
}

/** 回傳 null 代表成功。收據上傳丟例外，統一包成同樣的形狀 */
async function runOp(
  op: string,
  target: string,
  payload: Record<string, unknown>,
): Promise<{ code?: string; message: string } | null> {
  if (op === 'upsert') {
    return (await supabase.from(target).upsert(payload)).error;
  }
  if (op === 'update') {
    // 軟刪除只帶 deleted_at，不能用 upsert：upsert 是
    // INSERT ... ON CONFLICT DO UPDATE，Postgres 會先檢查 INSERT 那半段的
    // NOT NULL 條件，即使該列早就存在也一樣會被擋下
    // （expenses 的 title/currency/amount_minor 等都是 NOT NULL）。
    const { id, values } = payload as { id: string; values: Record<string, unknown> };
    return (await supabase.from(target).update(values).eq('id', id)).error;
  }
  if (op === 'rpc') {
    return (await supabase.rpc(target, payload)).error;
  }
  try {
    await uploadReceipt({
      localUri: payload.localUri as string,
      receiptId: payload.receiptId as string,
      storagePath: payload.storagePath as string,
    });
    return null;
  } catch (err) {
    return { message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 修復舊版排進佇列、格式錯誤的刪除操作。
 *
 * v1.1.1 以前的軟刪除用 upsert 送出殘缺的列（只有 id/group_id/deleted_at），
 * 伺服器一定回 NOT NULL 錯誤。因為推送是「一筆失敗就停」，
 * 那筆會永遠卡在佇列最前面，把後面所有操作一起堵死。
 *
 * 光是更新 App 不會讓它自己好——佇列裡存的還是舊格式。
 * 所以開機時把它們改寫成新的 update 形式，使用者原本的刪除意圖也保住了，
 * 不是直接丟掉。
 */
export function repairLegacyDeletes(): number {
  const rows = db.select().from(outbox).all();
  let repaired = 0;

  for (const row of rows) {
    if (row.op !== 'upsert') continue;
    if (row.target !== 'expenses' && row.target !== 'receipts') continue;

    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    if (!payload.deleted_at || !payload.id) continue;

    // 只挑「殘缺列」——完整的列（例如子表的軟刪除）本來就送得出去
    const partial =
      row.target === 'expenses' ? payload.title === undefined : payload.storage_path === undefined;
    if (!partial) continue;

    db.update(outbox)
      .set({
        op: 'update',
        payload: JSON.stringify({ id: payload.id, values: { deleted_at: payload.deleted_at } }),
        attempts: 0,
        lastError: null,
      })
      .where(eq(outbox.seq, row.seq))
      .run();
    repaired += 1;
  }

  return repaired;
}

export function countOutbox(): number {
  const row = db.select({ n: sql<number>`count(*)` }).from(outbox).get();
  return row?.n ?? 0;
}
