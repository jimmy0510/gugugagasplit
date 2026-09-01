import { Image } from 'expo-image';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { avatarUrls } from '@/data/avatars';
import type { Member } from '@/data/types';
import { useTheme } from './theme';

/**
 * 頭像。
 *
 * 沒有頭像時顯示名字首字加一個底色，而不是空白圓圈——
 * 群組裡多半只有幾個人，首字已經足夠辨識，也讓「還沒設頭像」
 * 看起來像是刻意的樣式而不是壞掉。
 *
 * 底色由名字決定，所以同一個人在任何畫面、任何裝置上顏色都一致。
 */

const FALLBACK_COLORS = [
  '#7C8FA3',
  '#8A9A7B',
  '#A38B7C',
  '#8B8397',
  '#7C9AA3',
  '#A39A7C',
] as const;

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

/** 取名字的第一個字。中文取首字，英文取首字母大寫 */
function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first = [...trimmed][0];
  return /[a-z]/.test(first) ? first.toUpperCase() : first;
}

/**
 * 簽章網址的快取。
 *
 * bucket 是私有的，每個頭像都要跟伺服器換一組有時效的網址。
 * 成員清單一次要畫好幾個頭像，若每個元件各自去換會產生一堆請求，
 * 所以由 provider 一次批次換好，元件只管讀。
 */
const AvatarUrlContext = createContext<Record<string, string>>({});

export function AvatarUrlProvider({
  members,
  children,
}: {
  members: Member[];
  children: ReactNode;
}) {
  const paths = useMemo(
    () => members.map((m) => m.avatarPath).filter((p): p is string => Boolean(p)),
    [members],
  );
  const key = paths.slice().sort().join('|');
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (paths.length === 0) {
      setUrls({});
      return;
    }
    let cancelled = false;
    void avatarUrls(paths).then((map) => {
      if (!cancelled) setUrls(map);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <AvatarUrlContext.Provider value={urls}>{children}</AvatarUrlContext.Provider>;
}

export function Avatar({
  name,
  avatarPath,
  size = 36,
  /** 直接給網址（帳號頁預覽剛選好、還沒上傳的圖時用） */
  uri,
}: {
  name: string;
  avatarPath?: string | null;
  size?: number;
  uri?: string | null;
}) {
  const t = useTheme();
  const urls = useContext(AvatarUrlContext);
  const [failed, setFailed] = useState(false);

  const source = uri ?? (avatarPath ? urls[avatarPath] : undefined);

  if (source && !failed) {
    return (
      <Image
        source={{ uri: source }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.surfaceAlt }}
        contentFit="cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colorFor(name),
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: '#FFFFFF', fontSize: size * 0.42, fontWeight: '600' }}>
        {initialOf(name)}
      </Text>
    </View>
  );
}
