import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, View } from 'react-native';

import { computeNetBalances, currenciesOf, formatWithCurrency } from '@/domain';
import { inviteLinkFor } from '@/data/invites';
import { useGroupRealtime } from '@/data/realtime';
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
  Label,
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

  // 其他成員改了東西，畫面自己更新，不用手動重整
  useGroupRealtime(id);

  const [newName, setNewName] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  if (loading && !snapshot) return <Screen><Loading /></Screen>;
  if (!snapshot) return <Screen><Banner>找不到群組</Banner></Screen>;

  const myUserId = getUserId();

  // 只有群組建立者能移除成員（伺服器端也會再擋一次）
  const me = snapshot.members.find((m) => m.userId === myUserId);
  const isOwner = me?.role === 'owner';

  // 誰結清了、誰還沒——畫面要先講清楚，不能讓人按了才知道不行
  const { balances } = computeNetBalances(
    snapshot.expenses.map((e) => ({
      id: e.id,
      currency: e.currency,
      payers: e.payers,
      splits: e.splits,
    })),
    snapshot.transfers,
    snapshot.members.map((m) => m.id),
  );

  return (
    <AvatarUrlProvider members={snapshot.members}>
    <Screen>
      <Stack.Screen options={{ title: `${snapshot.group.name} · 成員` }} />

      <Title>成員</Title>
      <Card>
        {snapshot.members.map((member, index) => {
          const owing = currenciesOf(balances[member.id]);
          const settled = owing.length === 0;
          const canRemove = isOwner && member.role !== 'owner';

          return (
            <View key={member.id} style={{ gap: spacing.xs }}>
              {index > 0 ? <Divider /> : null}
              <Row>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
                  <Avatar name={member.name} avatarPath={member.avatarPath} />
                  <View>
                    <Body>{member.name}</Body>
                    <Caption>
                      {member.role === 'owner'
                        ? '建立者'
                        : member.userId === myUserId
                          ? '你'
                          : member.userId
                            ? '已加入'
                            : '尚未使用 App'}
                    </Caption>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {settled ? (
                    <Caption>已結清</Caption>
                  ) : (
                    owing.map((c) => (
                      <Caption key={c} tone="negative">
                        {`${balances[member.id][c] > 0 ? '應收 ' : '應付 '}${formatWithCurrency(
                          Math.abs(balances[member.id][c]),
                          c,
                        )}`}
                      </Caption>
                    ))
                  )}
                </View>
              </Row>

              {canRemove ? (
                <View style={{ marginTop: spacing.xs }}>
                  {removing === member.id ? (
                    <View>
                      <Caption>{`確定把「${member.name}」移出群組？他過去的帳目會保留。`}</Caption>
                      <View style={{ marginTop: spacing.sm }}>
                        <Row>
                          <View style={{ flex: 1 }}>
                            <Button label="取消" variant="secondary" onPress={() => setRemoving(null)} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Button
                              label="移出群組"
                              variant="danger"
                              busy={busy}
                              onPress={async () => {
                                setBusy(true);
                                setError(null);
                                try {
                                  await repository.removeMember(member.id);
                                  setRemoving(null);
                                  reload();
                                } catch (err) {
                                  setError(err instanceof Error ? err.message : String(err));
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            />
                          </View>
                        </Row>
                      </View>
                    </View>
                  ) : settled ? (
                    <Button
                      label="移出群組"
                      variant="secondary"
                      onPress={() => setRemoving(member.id)}
                    />
                  ) : (
                    <Caption>帳還沒結清，結清後才能移出群組。</Caption>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
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
        {inviteCode ? (
          <View>
            <Label>邀請連結</Label>
            <View style={{ marginTop: spacing.sm }}>
              <Body style={{ fontSize: 14 }}>{inviteLinkFor(inviteCode)}</Body>
            </View>
            <View style={{ marginTop: spacing.md }}>
              <Button
                label="分享連結"
                onPress={async () => {
                  const link = inviteLinkFor(inviteCode);
                  const message = `加入「${snapshot.group.name}」一起分帳：
${link}`;
                  try {
                    if (Platform.OS === 'web') {
                      // 手機瀏覽器有原生分享；桌機沒有就退回複製
                      const nav = globalThis.navigator as Navigator & {
                        share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
                      };
                      if (nav?.share) {
                        await nav.share({ title: snapshot.group.name, text: message, url: link });
                      } else {
                        await Clipboard.setStringAsync(link);
                        setCopied(true);
                      }
                    } else {
                      await Share.share({ message });
                    }
                  } catch {
                    // 使用者按取消不算錯誤，不用提示
                  }
                }}
              />
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <Button
                label={copied ? '已複製連結' : '複製連結'}
                variant="secondary"
                onPress={async () => {
                  await Clipboard.setStringAsync(inviteLinkFor(inviteCode));
                  setCopied(true);
                }}
              />
            </View>
            <View style={{ marginTop: spacing.lg }}>
              <Label>或直接給邀請碼</Label>
              <View style={{ marginTop: spacing.xs }}>
                <Title>{inviteCode}</Title>
              </View>
              <View style={{ marginTop: spacing.xs }}>
                <Caption>已經裝了 App 的朋友，在 App 裡輸入這組碼加入比較好。</Caption>
              </View>
            </View>
          </View>
        ) : (
          <View>
            <Caption>
              產生一組邀請連結傳給朋友。他們點開後填名字、確認要加入的群組就完成了，
              不必先安裝任何東西。需要連線。
            </Caption>
            <View style={{ marginTop: spacing.md }}>
              <Button
                label="產生邀請連結"
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
            </View>
          </View>
        )}
      </Card>

      {error ? <Banner>{error}</Banner> : null}
    </Screen>
    </AvatarUrlProvider>
  );
}
