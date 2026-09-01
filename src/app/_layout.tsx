import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, useColorScheme } from 'react-native';

import { configureNotifications, groupIdFromNotification, registerPushToken } from '@/data/push';
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
 * 這個按鈕不依賴歷史，一律導回群組列表。畫成跟系統返回鍵一樣的左箭頭——
 * 對使用者來說它就是「離開這一頁」，沒必要因為實作上是導向首頁就長得不一樣。
 */
function HomeButton() {
  const t = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.replace('/')}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={{ paddingHorizontal: 4 }}>
      <Text style={{ color: t.text, fontSize: 24, lineHeight: 26 }}>←</Text>
    </Pressable>
  );
}

interface Boot {
  ready: boolean;
  userId?: string;
  error?: string;
}

// 前景收到通知也要跳出來、Android 的通知頻道也要先建好。
// 放在模組層而不是 effect 裡：處理器必須在任何通知抵達之前就位。
configureNotifications();

export default function RootLayout() {
  const t = useTheme();
  const router = useRouter();
  const scheme = useColorScheme();
  const [boot, setBoot] = useState<Boot>({ ready: false });

  /**
   * 點通知進來的那一則。
   *
   * 用 useLastNotificationResponse 而不是監聽事件：App 完全沒在跑的時候
   * 點通知啟動，事件在畫面掛載前就發生了，監聽器會錯過；這個 hook 會把
   * 「啟動的原因」補給你。
   */
  const tapped = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const groupId = groupIdFromNotification(tapped ?? null);
    if (groupId) router.push(`/group/${groupId}`);
  }, [tapped, router]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await repository.init();
        const userId = await ensureSignedIn();
        if (!cancelled) setBoot({ ready: true, userId });
        // 不 await：拿推播位址要跟系統要權限，可能停在對話框上等使用者，
        // 沒理由讓整個 App 陪它一起等
        void registerPushToken(userId);
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
      <Screen safeTop>
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
      <Screen safeTop>
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
        {/* 首頁自己畫表頭（群組切換列），不要再疊一條原生標題列 */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
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
