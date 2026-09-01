import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { repository, useGroup } from '@/data/repository';
import { getUserId } from '@/data/supabase';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Divider,
  Field,
  Heading,
  Loading,
  Row,
  Screen,
  Title,
} from '@/ui/components';
import { Avatar, AvatarUrlProvider } from '@/ui/Avatar';
import { spacing } from '@/ui/theme';

export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: snapshot, loading, reload } = useGroup(id);

  const [newName, setNewName] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (loading && !snapshot) return <Screen><Loading /></Screen>;
  if (!snapshot) return <Screen><Banner>找不到群組</Banner></Screen>;

  const myUserId = getUserId();

  return (
    <AvatarUrlProvider members={snapshot.members}>
    <Screen>
      <Stack.Screen options={{ title: `${snapshot.group.name} · 成員` }} />

      <Title>成員</Title>
      <Card>
        {snapshot.members.map((member, index) => (
          <View key={member.id} style={{ gap: spacing.xs }}>
            {index > 0 ? <Divider /> : null}
            <Row>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
                <Avatar name={member.name} avatarPath={member.avatarPath} />
                <Body>{member.name}</Body>
              </View>
              <Caption>
                {member.userId === myUserId ? '你' : member.userId ? '已加入' : '尚未使用 App'}
              </Caption>
            </Row>
          </View>
        ))}
      </Card>

      <Card>
        <Heading>新增一個人</Heading>
        <Caption>朋友不用註冊也能被記帳，之後他用邀請碼加入時再自己建立帳號。</Caption>
        <Field label="名字" value={newName} onChangeText={setNewName} placeholder="例如：阿華" maxLength={20} />
        <Button
          label="新增"
          busy={busy}
          disabled={newName.trim().length === 0}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await repository.addMember({ groupId: snapshot.group.id, name: newName.trim() });
              setNewName('');
              reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>

      <Card>
        <Heading>邀請朋友加入</Heading>
        <Caption>產生邀請碼需要連線。朋友在自己的 App 裡輸入這組碼就能加入。</Caption>
        {inviteCode ? (
          <View style={{ gap: spacing.sm }}>
            <Title>{inviteCode}</Title>
            <Button
              label={copied ? '已複製' : '複製邀請碼'}
              variant="secondary"
              onPress={async () => {
                await Clipboard.setStringAsync(inviteCode);
                setCopied(true);
              }}
            />
          </View>
        ) : (
          <Button
            label="產生邀請碼"
            busy={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                setInviteCode(await repository.createInvite(snapshot.group.id, myUserId));
                setCopied(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </Card>

      {error ? <Banner>{error}</Banner> : null}
    </Screen>
    </AvatarUrlProvider>
  );
}
