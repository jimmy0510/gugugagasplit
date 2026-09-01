import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, useColorScheme } from 'react-native';

import { repository } from '@/data/repository';
import { ensureSignedIn } from '@/data/supabase';
import { Body, Card, Loading, Screen, Title } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/**
 * 啟動流程：
 *   1. repository.init()  —— 原生端跑 SQLite migration 並啟動同步引擎
 *   2. ensureSignedIn()   —— 沒有 session 就匿名註冊一個
 *
 * 這兩步都完成前不渲染任何畫面，避免子畫面讀到還沒建好的資料表。
 * 匿名登入需要網路，失敗時明講原因而不是卡在轉圈圈。
 */

/**
 * 沒有返回歷史時用的返回鍵。
 *
 * 從 Email 驗證連結點進來、或 iOS 上把網頁加到主畫面後開啟，
 * 都是「全新的一頁」——沒有上一頁，所以 expo-router 不會畫返回箭頭，
 * 而獨立視窗模式也沒有瀏覽器的返回鍵，使用者會直接被困在那個畫面。
 * 這個按鈕不依賴歷史，一律導回群組列表。
 */
function HomeButton() {
  const t = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.replace('/')}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={{ paddingHorizontal: 4 }}>
      <Text style={{ color: t.signal, fontSize: 16, fontWeight: '600' }}>群組</Text>
    </Pressable>
  );
}

interface Boot {
  ready: boolean;
  userId?: string;
  error?: string;
}

export default function RootLayout() {
  const t = useTheme();
  const scheme = useColorScheme();
  const [boot, setBoot] = useState<Boot>({ ready: false });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await repository.init();
        const userId = await ensureSignedIn();
        if (!cancelled) setBoot({ ready: true, userId });
      } catch (err) {
        if (!cancelled) {
          setBoot({
            ready: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (boot.error) {
    return (
      <Screen>
        <Title>啟動失敗</Title>
        <Card>
          <Body>{boot.error}</Body>
          <Body dim>第一次開啟需要網路連線來建立帳號。確認網路後重開 App 再試一次。</Body>
        </Card>
      </Screen>
    );
  }

  if (!boot.ready) {
    return (
      <Screen>
        <Loading label="準備中…" />
      </Screen>
    );
  }

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={({ navigation, route }) => ({
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: t.bg },
          // 群組列表本身不需要；其餘畫面若沒有上一頁就補一個回首頁的鍵
          headerLeft:
            route.name === 'index' || navigation.canGoBack() ? undefined : () => <HomeButton />,
        })}>
        <Stack.Screen name="index" options={{ title: 'gugugagasplit' }} />
        <Stack.Screen name="account" options={{ title: '帳號' }} />
        <Stack.Screen name="join/[code]" options={{ title: '加入群組' }} />
        <Stack.Screen name="group/[id]/index" options={{ title: '群組' }} />
        <Stack.Screen name="group/[id]/balances" options={{ title: '結算' }} />
        <Stack.Screen name="group/[id]/members" options={{ title: '成員' }} />
        <Stack.Screen name="expense/edit" options={{ title: '支出', presentation: 'modal' }} />
        <Stack.Screen name="transfer/new" options={{ title: '記錄還款', presentation: 'modal' }} />
      </Stack>
    </>
  );
}
