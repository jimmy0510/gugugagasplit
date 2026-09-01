import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { newId } from './ids';
import { supabase } from './supabase';

/**
 * 收據照片。
 *
 * 流程刻意是「先落地、再上傳」：拍完立刻壓縮存進本地檔案系統，
 * 畫面馬上看得到；上傳成功之後才刪掉本地暫存。這樣離線拍照不會失敗，
 * 也不會出現「照片好像存了但其實丟了」的狀況。
 *
 * 壓縮到 1600px / JPEG q0.7（約 300KB）：Supabase 免費方案只有 1GB，
 * 手機原始照片動輒 4MB，不壓縮的話幾百張就滿了。
 */

const BUCKET = 'receipts';
const MAX_EDGE = 1600;
const QUALITY = 0.7;

export interface PickedReceipt {
  /** 本地檔案路徑（原生）或 blob/data URI（Web） */
  localUri: string;
  receiptId: string;
  /** 上傳目的地：{group_id}/{receipt_id}.jpg，與 Storage 的 RLS 規約一致 */
  storagePath: string;
}

function receiptsDir(): Directory {
  const dir = new Directory(Paths.document, 'receipts');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** 壓縮到合理大小。Web 上 expo-image-manipulator 也能跑，但失敗就直接用原圖 */
async function compress(uri: string): Promise<string> {
  try {
    const context = ImageManipulator.ImageManipulator.manipulate(uri).resize({ width: MAX_EDGE });
    const image = await context.renderAsync();
    const result = await image.saveAsync({
      compress: QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return result.uri;
  } catch {
    return uri;
  }
}

async function fromPickerResult(
  result: ImagePicker.ImagePickerResult,
  groupId: string,
): Promise<PickedReceipt | null> {
  if (result.canceled || result.assets.length === 0) return null;

  const compressed = await compress(result.assets[0].uri);
  const receiptId = newId();
  const storagePath = `${groupId}/${receiptId}.jpg`;

  // Web 沒有可寫的檔案系統，直接沿用瀏覽器給的 blob URI
  if (Platform.OS === 'web') {
    return { localUri: compressed, receiptId, storagePath };
  }

  // 原生端搬進 App 自己的目錄——相機給的路徑在暫存區，隨時可能被系統清掉
  const target = new File(receiptsDir(), `${receiptId}.jpg`);
  new File(compressed).copy(target);

  return { localUri: target.uri, receiptId, storagePath };
}

export async function takePhoto(groupId: string): Promise<PickedReceipt | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('需要相機權限才能拍收據');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  return fromPickerResult(result, groupId);
}

export async function pickFromLibrary(groupId: string): Promise<PickedReceipt | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  return fromPickerResult(result, groupId);
}

/**
 * 上傳到 Supabase Storage。成功才刪本地暫存——這個順序不能反過來，
 * 否則上傳失敗時照片就真的沒了。
 */
export async function uploadReceipt(receipt: PickedReceipt): Promise<void> {
  const body =
    Platform.OS === 'web'
      ? await (await fetch(receipt.localUri)).arrayBuffer()
      : await new File(receipt.localUri).arrayBuffer();

  const { error } = await supabase.storage.from(BUCKET).upload(receipt.storagePath, body, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw new Error(`上傳收據失敗：${error.message}`);

  if (Platform.OS !== 'web') {
    const local = new File(receipt.localUri);
    if (local.exists) local.delete();
  }
}

/** 取得可顯示的網址。bucket 是私有的，要用簽章網址 */
export async function receiptUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) throw new Error(`取得收據網址失敗：${error?.message ?? '未知錯誤'}`);
  return data.signedUrl;
}
