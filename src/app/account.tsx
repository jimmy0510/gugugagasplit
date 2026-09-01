import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import {
  confirmEmailBinding,
  confirmRecovery,
  getIdentity,
  requestEmailBinding,
  requestRecovery,
  type Identity,
} from '@/data/supabase';
import { avatarPathFor, avatarUrls, pickAndUploadAvatar } from '@/data/avatars';
import { bump } from '@/data/changes';
import { getDisplayName, setDisplayName } from '@/data/profile';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Divider,
  Field,
  Heading,
  Label,
  Loading,
  Row,
  Screen,
  Title,
} from '@/ui/components';
import { Avatar } from '@/ui/Avatar';
import { spacing, useTheme } from '@/ui/theme';

type Stage = 'idle' | 'bindCode' | 'recoverCode';

export default function AccountScreen() {
  const router = useRouter();
  const t = useTheme();
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);
  const [name, setName] = useState('');

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  useEffect(() => {
    void getIdentity().then(async (id) => {
      setIdentity(id);
      if (!id) return;
      // 顯示已經設過的頭像。私有 bucket 要簽章網址，不能直接組路徑。
      const map = await avatarUrls([avatarPathFor(id.userId)]);
      const url = map[avatarPathFor(id.userId)];
      if (url) setAvatarUri(url);
    });
    void getDisplayName().then((n) => setName(n ?? ''));
  }, []);

  if (identity === undefined) return <Screen><Loading /></Screen>;

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const bound = Boolean(identity?.email);

  return (
    <Screen>
      {/* 這個畫面常常是從 Email 驗證連結直接進來的，那種情況沒有上一頁。
          右上角固定放一個「完成」，不依賴瀏覽歷史也離得開。 */}
      <Stack.Screen
        options={{
          title: '帳號',
          headerRight: () => (
            <Pressable
              onPress={() => router.replace('/')}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ paddingHorizontal: 4 }}>
              <Text style={{ color: t.signal, fontSize: 16, fontWeight: '600' }}>完成</Text>
            </Pressable>
          ),
        }}
      />

      <Title>帳號</Title>

      <Card>
        <Row>
          <Avatar name={name || '?'} uri={avatarUri} size={64} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Button
              label="換頭像"
              variant="secondary"
              busy={busy}
              onPress={() =>
                void run(async () => {
                  const path = await pickAndUploadAvatar(identity!.userId);
                  if (!path) return;
                  // 換頭像後路徑不變（固定是 {user_id}/avatar.jpg），
                  // 所以要重新換一組簽章網址才看得到新圖，否則會顯示舊的快取
                  const map = await avatarUrls([path]);
                  setAvatarUri(map[path] ?? null);
                  bump();
                  setDone('頭像更新了。同群組的朋友重新整理後就會看到。');
                })
              }
            />
            {avatarUri ? null : (
              <Caption>還沒設頭像，朋友會看到你名字的第一個字。</Caption>
            )}
          </View>
        </Row>
        <Divider />
        <Field
          label="顯示名稱"
          value={name}
          onChangeText={setName}
          placeholder="例如：小明"
          maxLength={20}
        />
        <Button
          label="儲存名稱"
          variant="secondary"
          disabled={name.trim().length === 0}
          onPress={() =>
            void run(async () => {
              await setDisplayName(name);
              bump();
              setDone('名稱已更新。已經加入的群組裡顯示的名字不會跟著改。');
            })
          }
        />
      </Card>

      <Card>
        <Row>
          <Heading>{bound ? '已綁定 Email' : '尚未綁定 Email'}</Heading>
          {bound ? <Caption tone="positive">安全</Caption> : <Caption tone="negative">有風險</Caption>}
        </Row>

        {bound ? (
          <>
            <Body>{identity!.email}</Body>
            <Caption>換手機或清掉瀏覽器資料時，可以用這個 email 把身分找回來。</Caption>
          </>
        ) : (
          <>
            <Body dim>
              你的身分目前只存在這台裝置上，沒有任何備份。
              {Platform.OS === 'web'
                ? ' 清除瀏覽器資料就會永久消失；iPhone 的 Safari 更會在超過 7 天沒開時自動清掉。'
                : ' 解除安裝 App 就會永久消失。'}
              一旦消失，你記過的帳與加入的群組都進不去，也沒有辦法救回來。
            </Body>
            <Divider />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="email"
            />
            {stage === 'bindCode' ? (
              <>
                <Field
                  label="信中的驗證碼"
                  hint="目前免費寄信方案只會寄出「確認連結」，直接點信裡的連結也可以完成綁定。"
                  value={code}
                  onChangeText={setCode}
                  placeholder="12345678"
                  keyboardType="number-pad"
                  inputMode="numeric"
                  maxLength={8}
                />
                <Button
                  label="完成綁定"
                  busy={busy}
                  disabled={code.trim().length < 6}
                  onPress={() =>
                    void run(
                      () => confirmEmailBinding(email, code),
                      async () => {
                        setStage('idle');
                        setCode('');
                        setIdentity(await getIdentity());
                        setDone('綁定完成。之後在別的裝置用這個 email 就能找回身分。');
                      },
                    )
                  }
                />
              </>
            ) : (
              <Button
                label="寄驗證碼綁定"
                busy={busy}
                disabled={!email.includes('@')}
                onPress={() =>
                  void run(
                    () => requestEmailBinding(email),
                    () => {
                      setStage('bindCode');
                      setDone('信寄出了，查一下信箱（含垃圾郵件匣）。點信裡的連結，或輸入驗證碼。');
                    },
                  )
                }
              />
            )}
          </>
        )}
      </Card>

      <Card>
        <Heading>換裝置 / 找回身分</Heading>
        <Caption>
          在新手機或新瀏覽器上，用之前綁過的 email 收驗證碼，就能把原本的身分與所有群組帶回來。
        </Caption>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="email"
        />
        {stage === 'recoverCode' ? (
          <>
            <Field
              label="信中的驗證碼"
              hint="目前免費寄信方案只會寄出「登入連結」，直接點信裡的連結也可以。"
              value={code}
              onChangeText={setCode}
              placeholder="12345678"
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={8}
            />
            <Button
              label="登入回原本的身分"
              busy={busy}
              disabled={code.trim().length < 6}
              onPress={() =>
                void run(
                  () => confirmRecovery(email, code).then(() => undefined),
                  async () => {
                    setStage('idle');
                    setCode('');
                    setIdentity(await getIdentity());
                    bump();
                    setDone('已經回到原本的身分。');
                    router.replace('/');
                  },
                )
              }
            />
          </>
        ) : (
          <Button
            label="寄驗證碼找回"
            variant="secondary"
            busy={busy}
            disabled={!email.includes('@')}
            onPress={() =>
              void run(
                () => requestRecovery(email),
                () => {
                  setStage('recoverCode');
                  setDone('驗證碼寄出了，查一下信箱（含垃圾郵件匣）。');
                },
              )
            }
          />
        )}
      </Card>

      {error ? <Banner>{error}</Banner> : null}
      {done ? <Banner>{done}</Banner> : null}

      <View style={{ gap: spacing.sm }}>
        <Label>技術細節</Label>
        <Caption>
          {`身分編號 ${identity?.userId.slice(0, 8) ?? '—'}…`}
        </Caption>
      </View>
    </Screen>
  );
}
