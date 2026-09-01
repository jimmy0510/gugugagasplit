import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Platform, View } from 'react-native';

import { peekInvite, type InvitePreview } from '@/data/invites';
import { getDisplayName, setDisplayName } from '@/data/profile';
import { repository } from '@/data/repository';
import { ensureSignedIn } from '@/data/supabase';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Field,
  Heading,
  Label,
  Loading,
  Row,
  Screen,
  Title,
} from '@/ui/components';
import { radius, spacing, useTheme } from '@/ui/theme';

/**
 * 從邀請連結加入群組。
 *
 * 流程刻意是「先看到要加入哪裡，再填名字，最後再確認一次」——
 * 讓人在按下不可逆的動作前，清楚知道自己要加入的是哪個群組。
 */
export default function JoinScreen() {
  const router = useRouter();
  const t = useTheme();
  const { code } = useLocalSearchParams<{ code: string }>();

  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSignedIn();
        const found = await peekInvite(code);
        if (!cancelled) setPreview(found);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPreview(null);
        }
      }
    })();
    // 預設帶入這台裝置上已經用過的名字，省得重打
    void getDisplayName().then((stored) => {
      if (!cancelled && stored) setName(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = name.trim();
      await setDisplayName(trimmed);
      const groupId = await repository.joinByCode(code, trimmed);
      setConfirming(false);
      router.replace(`/group/${groupId}`);
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (preview === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '加入群組' }} />
        <Loading label="讀取邀請中" />
      </Screen>
    );
  }

  if (preview === null) {
    return (
      <Screen>
        <Stack.Screen options={{ title: '加入群組' }} />
        <Title>這個邀請不能用了</Title>
        <Card>
          <Body dim>
            連結可能已經過期、被撤銷，或是網址打錯了。跟邀請你的人要一組新的連結吧。
          </Body>
          {error ? <Banner>{error}</Banner> : null}
        </Card>
        <Button label="回到我的群組" variant="secondary" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: '加入群組' }} />

      <Title>你被邀請加入</Title>

      <Card>
        <Heading>{preview.groupName}</Heading>
        <Caption>{`目前 ${preview.memberCount} 人`}</Caption>
      </Card>

      <Card>
        <Field
          label="你的名字"
          hint="這是群組裡其他人看到的名字，之後可以改。"
          value={name}
          onChangeText={setName}
          placeholder="例如：小明"
          maxLength={20}
        />
        <Button
          label="加入"
          onPress={() => {
            if (!name.trim()) {
              setError('請先輸入名字。');
              return;
            }
            setError(null);
            setConfirming(true);
          }}
        />
      </Card>

      {error ? <Banner>{error}</Banner> : null}

      {Platform.OS !== 'web' ? null : (
        <Caption>
          {`如果你手機上已經裝了 gugugagasplit App，建議改在 App 裡用邀請碼 ${code} 加入——在這裡加入會建立另一個獨立的身分，App 看不到。`}
        </Caption>
      )}

      <Modal visible={confirming} transparent animationType="fade" onRequestClose={() => setConfirming(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing.xl,
          }}>
          <View
            style={{
              width: '100%',
              maxWidth: 380,
              backgroundColor: t.surface,
              borderRadius: radius.lg,
              padding: spacing.xl,
            }}>
            <Heading>{`確認加入「${preview.groupName}」？`}</Heading>
            <View style={{ marginTop: spacing.sm }}>
              <Body dim>{`你會以「${name.trim()}」的身分加入，群組裡的人都看得到這個名字。`}</Body>
            </View>
            <View style={{ marginTop: spacing.lg }}>
              <Row>
                <View style={{ flex: 1 }}>
                  <Button label="取消" variant="secondary" onPress={() => setConfirming(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="確認加入" busy={busy} onPress={() => void join()} />
                </View>
              </Row>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
