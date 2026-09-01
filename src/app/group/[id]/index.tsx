import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
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
  Screen,
  Title,
} from '@/ui/components';
import { Avatar, AvatarUrlProvider } from '@/ui/Avatar';
import { dayKey, formatAmounts, formatDate } from '@/ui/format';
import { spacing, useTheme } from '@/ui/theme';

export default function GroupScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: snapshot, error, loading } = useGroup(id);

  // 其他成員改了東西，畫面自己更新，不用手動重整
  useGroupRealtime(id);

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

    return { balances, inconsistentExpenseIds, me, nameOf, sorted };
  }, [snapshot]);

  if (loading && !snapshot) return <Screen><Loading /></Screen>;
  if (error) return <Screen><Banner>{error}</Banner></Screen>;
  if (!snapshot || !view) return <Screen><Empty title="找不到這個群組" /></Screen>;

  const myBalance = view.me ? view.balances[view.me.id] : undefined;
  const myCurrencies = currenciesOf(myBalance);

  return (
    <AvatarUrlProvider members={snapshot.members}>
    <Screen>
      <Stack.Screen options={{ title: snapshot.group.name }} />

      <Card>
        <Label>我的結餘</Label>
        {myCurrencies.length === 0 ? (
          <Heading>已結清</Heading>
        ) : (
          <View style={{ gap: spacing.xs }}>
            {myCurrencies.map((currency) => {
              const amount = myBalance![currency];
              return (
                <Row key={currency}>
                  <Label>{amount > 0 ? '應收' : '應付'}</Label>
                  <Mono size={22} weight="700" tone={amount > 0 ? 'positive' : 'negative'}>
                    {formatWithCurrency(Math.abs(amount), currency)}
                  </Mono>
                </Row>
              );
            })}
          </View>
        )}
        <Divider />
        <Row>
          <View style={{ flex: 1 }}>
            <Button label="結算" variant="secondary" onPress={() => router.push(`/group/${id}/balances`)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="成員" variant="secondary" onPress={() => router.push(`/group/${id}/members`)} />
          </View>
        </Row>
      </Card>

      {view.inconsistentExpenseIds.length > 0 ? (
        <Banner>
          {`有 ${view.inconsistentExpenseIds.length} 筆支出的資料還沒同步完整，暫時未計入結餘。連上網路後會自動補齊。`}
        </Banner>
      ) : null}

      <Button label="新增支出" onPress={() => router.push(`/expense/edit?groupId=${id}`)} />

      <Title>支出</Title>
      {view.sorted.length === 0 ? (
        <Empty title="還沒有任何支出" hint="按上面的按鈕記第一筆" />
      ) : (
        view.sorted.map((expense, index) => {
          const previous = view.sorted[index - 1];
          const showDate = !previous || dayKey(previous.paidAt) !== dayKey(expense.paidAt);
          const myShare = view.me
            ? expense.splits.find((s) => s.memberId === view.me!.id)?.amountMinor ?? 0
            : 0;
          const payerNames = expense.payers.map((p) => view.nameOf(p.memberId)).join('、');
          const firstPayer = snapshot.members.find((m) => m.id === expense.payers[0]?.memberId);

          return (
            <View key={expense.id} style={{ gap: spacing.sm }}>
              {showDate ? <Label>{formatDate(expense.paidAt)}</Label> : null}
              <Link href={`/expense/edit?groupId=${id}&id=${expense.id}`} asChild>
                <Pressable>
                  <Card>
                    <Row>
                      {firstPayer ? (
                        <Avatar name={firstPayer.name} avatarPath={firstPayer.avatarPath} size={34} />
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
        })
      )}

      <Caption>{`成員 ${snapshot.members.length} 人 · 結餘合計 ${formatAmounts(myBalance, { abs: true })}`}</Caption>
    </Screen>
    </AvatarUrlProvider>
  );
}
