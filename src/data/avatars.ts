import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * 頭像。
 *
 * 掛在使用者身上（不是群組成員），所以換一次到處生效。
 * 路徑固定是 avatars/{user_id}/avatar.jpg——固定路徑代表換頭像
 * 就是覆蓋同一個檔案，不會在 Storage 裡累積一堆孤兒檔案。
 *
 * 壓成 512px 見方的正方形：頭像永遠以圓形小圖顯示，
 * 存原始解析度只是浪費那 1GB 免費額度。
 */

const BUCKET = 'avatars';
const SIZE = 512;
const QUALITY = 0.8;

export const avatarPathFor = (userId: string) => `${userId}/avatar.jpg`;

async function compressSquare(uri: string): Promise<string> {
  const context = ImageManipulator.ImageManipulator.manipulate(uri).resize({ width: SIZE });
  const image = await context.renderAsync();
  const result = await image.saveAsync({
    compress: QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

/**
 * 選一張圖當頭像並上傳。回傳 storage 路徑；使用者取消時回傳 null。
 *
 * 這裡用 ImagePicker 內建的裁切（allowsEditing）讓使用者自己決定要露出哪一塊，
 * 比我們自作主張從中間裁掉好——大頭照的重點常常不在正中央。
 */
export async function pickAndUploadAvatar(userId: string): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const compressed = await compressSquare(result.assets[0].uri);
  const path = avatarPathFor(userId);

  const body =
    Platform.OS === 'web'
      ? await (await fetch(compressed)).arrayBuffer()
      : await (await fetch(compressed)).arrayBuffer();

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (uploadError) throw new Error(`上傳頭像失敗：${uploadError.message}`);

  // profiles.avatar_url 存的是 storage 路徑而非完整網址——
  // bucket 是私有的，網址每次都要重新簽章，存下來只會過期。
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ avatar_url: path })
    .eq('id', userId);
  if (profileError) throw new Error(`儲存頭像失敗：${profileError.message}`);

  return path;
}

export async function removeAvatar(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
  if (error) throw new Error(`移除頭像失敗：${error.message}`);
}

/**
 * 一次換取多個頭像的簽章網址。
 *
 * 刻意做成批次：成員清單一次要顯示好幾個頭像，逐一往返會很慢。
 * 失敗的那些直接略過（回傳的 map 裡就沒有），畫面會退回顯示名字首字，
 * 頭像載不出來不該讓整個畫面壞掉。
 */
export async function avatarUrls(
  paths: string[],
  expiresInSeconds = 3600,
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(unique, expiresInSeconds);
  if (error || !data) return {};

  const map: Record<string, string> = {};
  for (const item of data) {
    if (item.signedUrl && item.path) map[item.path] = item.signedUrl;
  }
  return map;
}
