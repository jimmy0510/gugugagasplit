import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  computeDirectDebts,
  computeNetBalances,
  currenciesOf,
  formatWithCurrency,
  simplifyDebts,
  type Settlement,
} from '@/domain';
import { useGroupRealtime } from '@/data/realtime';
import { useGroup } from '@/data/repository';
import {
  Banner,
  Button,
  Caption,
  Card,
  Empty,
  Heading,
  Label,
  Loading,
  Mono,
  Row,
  Screen,
  Segmented,
  Title,
} from '@/ui/components';
import { spacing, useTheme } from '@/ui/theme';

type Mode = 'simplified' | 'direct';

export default function BalancesScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: snapshot, loading } = useGroup(id);

  // 其他成員改了東西，畫面自己更新，不用手動重整
  useGroupRealtime(id);
  const [mode, setMode] = useState<Mode>('simplified');

  const view = useMemo(() => {
    if (!snapshot) return null;

    const expenses = snapshot.expenses.map((e) => ({
      id: e.id,
      currency: e.currency,
      payers: e.payers,
      splits: e.splits,
    }));

    const { balances } = computeNetBalances(expenses, snapshot.transfers, snapshot.members.map((m) => m.id));
    const settlements: Settlement[] =
      mode === 'simplified' ? simplifyDebts(balances) : computeDirectDebts(expenses, snapshot.transfers);

    const nameOf = (memberId: string) =>
      snapshot.members.find((m) => m.id === memberId)?.name ?? '（已移除）';

    return { balances, settlements, nameOf };
  }, [snapshot, mode]);

  if (loading && !snapshot) return <Screen><Loading /></Screen>;
  if (!snapshot || !view) return <Screen><Empty title="找不到這個群組" /></Screen>;

  return (
    <Screen>
      <Stack.Screen options={{ title: `${snapshot.group.name} · 結算` }} />

      <Title>怎麼還</Title>
      <Segmented
        options={[
          { value: 'simplified', label: '最少轉帳' },
          { value: 'direct', label: '直接債務' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <Caption>
        {mode === 'simplified'
          ? '把債務串起來簡化，轉帳筆數最少，但可能要付錢給沒跟你同桌的人。'
          : '照每筆支出實際的欠款關係，不做跨筆簡化。'}
      </Caption>

      {view.settlements.length === 0 ? (
        <Empty title="全部結清了" hint="沒有待處理的款項" />
      ) : (
        view.settlements.map((settlement, index) => (
          <Card key={`${settlement.fromMemberId}-${settlement.toMemberId}-${settlement.currency}-${index}`}>
            <Row>
              <View style={{ flex: 1 }}>
                <Heading>{`${view.nameOf(settlement.fromMemberId)} → ${view.nameOf(settlement.toMemberId)}`}</Heading>
                <Label>{settlement.currency}</Label>
              </View>
              <Mono size={16} weight="700">
                {formatWithCurrency(settlement.amountMinor, settlement.currency)}
              </Mono>
            </Row>
            <Button
              label="記錄這筆還款"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/transfer/new',
                  params: {
                    groupId: id,
                    from: settlement.fromMemberId,
                    to: settlement.toMemberId,
                    currency: settlement.currency,
                    amount: String(settlement.amountMinor),
                  },
                })
              }
            />
          </Card>
        ))
      )}

      {Object.keys(view.balances).some((memberId) => currenciesOf(view.balances[memberId]).length > 1) ? (
        <Banner>
          有人同時欠不同幣別的錢。系統不會自動換匯——記錄還款時可以選「用其他幣別支付」，由你們自己講好匯率。
        </Banner>
      ) : null}
    </Screen>
  );
}
