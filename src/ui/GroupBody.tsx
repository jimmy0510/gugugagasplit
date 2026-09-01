import { Link, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { computeNetBalances, currenciesOf, formatWithCurrency } from '@/domain';
import { useGroupRealtime } from '@/data/realtime';
import { useGroup } from '@/data/repository';
import { getUserId } from '@/data/supabase';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Divider,
  Empty,
  Heading,
  Label,
  Loading,
  Mono,
  Row,
  Title,
  spaced,
} from '@/ui/components';
import { Avatar, AvatarUrlProvider } from '@/ui/Avatar';
import { dayKey, formatAmounts, formatDate } from '@/ui/format';
import { spacing } from '@/ui/theme';

/**
 * 一個群組的完整內容：結餘、支出列表、進入結算／群組設定的入口。
 *
 * 首頁與 /group/[id] 兩條路徑都渲染這個元件——首頁在上方多一條群組切換列，
 * /group/[id] 則是邀請連結與舊書籤的落點。內容只有一份，兩邊不會走鐘。
 *
 * 刻意不含 <Screen>：由呼叫端決定外框，這裡只負責內容本身。
 */
export function GroupBody({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { data: snapshot, error, loading } = useGroup(groupId);

  // 其他成員改了東西，畫面自己更新，不用手動重整
  useGroupRealtime(groupId);

  const view = useMemo(() => {
    if (!snapshot) return null;

    const { balances, inconsistentExpenseIds } = computeNetBalances(
      snapshot.expenses.map((e) => ({
        id: e.id,
        currency: e.currency,
        payers: e.payers,
        splits: e.splits,
      })),
      snapshot.transfers,
      snapshot.members.map((m) => m.id),
    );

    const me = snapshot.members.find((m) => m.userId === getUserId());
    const nameOf = (memberId: string) =>
      snapshot.members.find((m) => m.id === memberId)?.name ?? '（已移除）';

    const sorted = [...snapshot.expenses].sort((a, b) => b.paidAt.localeCompare(a.paidAt));

    /**
     * 依「欠最多 → 應收最多」排序，以群組主幣別為準。
     *
     * 多幣別下沒有絕對的排序——我們刻意不換匯，所以 ¥3000 和 NT$300
     * 誰比較多沒有客觀答案。主幣別給了一個明確的答案：先比主幣別的餘額
     * （沒有該幣別帳目的人算 0，落在中間），再用其他幣別中最負的那一筆
     * 當同分時的次要依據。
     */
    const main = snapshot.group.defaultCurrency;
    const rankOf = (memberId: string) => {
      const row = balances[memberId] ?? {};
      const others = Object.entries(row)
        .filter(([currency]) => currency !== main)
        .map(([, amount]) => amount);
      return [row[main] ?? 0, others.length > 0 ? Math.min(...others) : 0];
    };
    const rankedMembers = [...snapshot.members].sort((a, b) => {
      const [aMain, aOther] = rankOf(a.id);
      const [bMain, bOther] = rankOf(b.id);
      return aMain - bMain || aOther - bOther || a.name.localeCompare(b.name);
    });

    return { balances, inconsistentExpenseIds, me, nameOf, sorted, rankedMembers };
  }, [snapshot]);

  if (loading && !snapshot) return <Loading />;
  if (error) return <Banner>{error}</Banner>;
  if (!snapshot || !view) return <Empty title="找不到這個群組" />;

  const myBalance = view.me ? view.balances[view.me.id] : undefined;

  return (
    <AvatarUrlProvider members={snapshot.members}>
      {spaced(
        [
          <Card key="balances">
            <Label>每個人的結餘</Label>
            <View style={{ gap: spacing.md }}>
              {view.rankedMembers.map((member) => {
                const row = view.balances[member.id] ?? {};
                const owing = currenciesOf(row);
                const isMe = member.id === view.me?.id;

                return (
                  <Row key={member.id}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.md,
                        flex: 1,
                      }}>
                      <Avatar name={member.name} avatarPath={member.avatarPath} size={32} />
                      <Body style={isMe ? { fontWeight: '700' } : undefined}>
                        {isMe ? `${member.name}（你）` : member.name}
                      </Body>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {owing.length === 0 ? (
                        <Caption>已結清</Caption>
                      ) : (
                        owing.map((currency) => (
                          <Mono
                            key={currency}
                            size={16}
                            weight="700"
                            tone={row[currency] > 0 ? 'positive' : 'negative'}>
                            {`${row[currency] > 0 ? '+' : '−'}${formatWithCurrency(
                              Math.abs(row[currency]),
                              currency,
                            )}`}
                          </Mono>
                        ))
                      )}
                    </View>
                  </Row>
                );
              })}
            </View>
            <Divider />
            <Row>
              <View style={{ flex: 1 }}>
                <Button
                  label="結算"
                  variant="secondary"
                  onPress={() => router.push(`/group/${groupId}/balances`)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="群組"
                  variant="secondary"
                  onPress={() => router.push(`/group/${groupId}/members`)}
                />
              </View>
            </Row>
          </Card>,

          view.inconsistentExpenseIds.length > 0 ? (
            <Banner key="inconsistent">
              {`有 ${view.inconsistentExpenseIds.length} 筆支出的資料還沒同步完整，暫時未計入結餘。連上網路後會自動補齊。`}
            </Banner>
          ) : null,

          <Button
            key="add"
            label="新增支出"
            onPress={() => router.push(`/expense/edit?groupId=${groupId}`)}
          />,

          <Title key="expenses-title">支出</Title>,

          view.sorted.length === 0 ? (
            <Empty key="empty" title="還沒有任何支出" hint="按上面的按鈕記第一筆" />
          ) : (
            <View key="expenses">
              {spaced(
                view.sorted.map((expense, index) => {
                  const previous = view.sorted[index - 1];
                  const showDate = !previous || dayKey(previous.paidAt) !== dayKey(expense.paidAt);
                  const myShare = view.me
                    ? (expense.splits.find((s) => s.memberId === view.me!.id)?.amountMinor ?? 0)
                    : 0;
                  const payerNames = expense.payers.map((p) => view.nameOf(p.memberId)).join('、');
                  const firstPayer = snapshot.members.find(
                    (m) => m.id === expense.payers[0]?.memberId,
                  );

                  return (
                    <View key={expense.id} style={{ gap: spacing.sm }}>
                      {showDate ? <Label>{formatDate(expense.paidAt)}</Label> : null}
                      <Link href={`/expense/edit?groupId=${groupId}&id=${expense.id}`} asChild>
                        <Pressable>
                          <Card>
                            <Row>
                              {firstPayer ? (
                                <Avatar
                                  name={firstPayer.name}
                                  avatarPath={firstPayer.avatarPath}
                                  size={34}
                                />
                              ) : null}
                              <View style={{ flex: 1 }}>
                                {/* 項目是選填的。沒填就整個不渲染，
                                    而不是留一個空的標題列撐出多餘的高度。 */}
                                {expense.title.trim() ? <Heading>{expense.title}</Heading> : null}
                                <Caption>{`${payerNames} 付`}</Caption>
                              </View>
                              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                                <Mono size={15} weight="700">
                                  {formatWithCurrency(expense.amountMinor, expense.currency)}
                                </Mono>
                                {myShare > 0 ? (
                                  <Caption>{`我分攤 ${formatWithCurrency(myShare, expense.currency)}`}</Caption>
                                ) : (
                                  <Caption>我沒有分攤</Caption>
                                )}
                              </View>
                            </Row>
                          </Card>
                        </Pressable>
                      </Link>
                    </View>
                  );
                }),
                spacing.lg,
              )}
            </View>
          ),

          <Caption key="summary">
            {`成員 ${snapshot.members.length} 人 · 我的結餘 ${formatAmounts(myBalance, { abs: true })}`}
          </Caption>,
        ],
        spacing.lg,
      )}
    </AvatarUrlProvider>
  );
}
