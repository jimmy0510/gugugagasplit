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
  /** upload 是收據照片，路徑固定所以重放安全 */
  op: 'upsert' | 'rpc' | 'upload';
  /** upsert 的表名、rpc 的函式名，或 upload 的 bucket */
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

export function countOutbox(): number {
  const row = db.select({ n: sql<number>`count(*)` }).from(outbox).get();
  return row?.n ?? 0;
}
