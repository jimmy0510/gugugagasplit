import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  COMMON_CURRENCIES,
  convertMinor,
  formatMoney,
  formatWithCurrency,
  parseMoney,
} from '@/domain';
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
  LinkButton,
  Loading,
  Row,
  Screen,
  Segmented,
} from '@/ui/components';
import { spacing } from '@/ui/theme';

/**
 * 記錄還款。
 *
 * 核心觀念：清掉的「債」用債本身的幣別記（currency/amountMinor），
 * 餘額只認這個。若實際上用別的幣別付（例如用台幣還日圓債），
 * 匯率由使用者自己填，實付金額只是紀錄，不影響任何餘額計算。
 */
export default function NewTransferScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    groupId: string;
    from?: string;
    to?: string;
    currency?: string;
    amount?: string;
  }>();
  const { data: snapshot, loading } = useGroup(params.groupId);

  const [fromId, setFromId] = useState(params.from ?? '');
  const [toId, setToId] = useState(params.to ?? '');
  const [currency] = useState(params.currency ?? 'TWD');
  const [amountText, setAmountText] = useState(
    params.amount ? formatMoney(Number(params.amount), params.currency ?? 'TWD').replace(/,/g, '') : '',
  );
  const [crossCurrency, setCrossCurrency] = useState(false);
  const [paidCurrency, setPaidCurrency] = useState('TWD');
  const [rateText, setRateText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountMinor = useMemo(() => {
    try {
      return amountText.trim() ? parseMoney(amountText, currency) : 0;
    } catch {
      return NaN;
    }
  }, [amountText, currency]);

  const rate = useMemo(() => {
    const value = Number(rateText);
    return Number.isFinite(value) && value > 0 ? value : NaN;
  }, [rateText]);

  const suggestedPaid = useMemo(() => {
    if (!crossCurrency || !Number.isFinite(amountMinor) || !Number.isFinite(rate)) return null;
    try {
      return convertMinor(amountMinor, currency, paidCurrency, rate);
    } catch {
      return null;
    }
  }, [crossCurrency, amountMinor, currency, paidCurrency, rate]);

  if (loading && !snapshot) return <Screen><Loading /></Screen>;
  if (!snapshot) return <Screen><Banner>找不到群組</Banner></Screen>;

  const memberOptions = snapshot.members.map((m) => ({ value: m.id, label: m.name }));
  const valid =
    fromId &&
    toId &&
    fromId !== toId &&
    Number.isFinite(amountMinor) &&
    amountMinor > 0 &&
    (!crossCurrency || (Number.isFinite(rate) && suggestedPaid !== null));

  return (
    <Screen>
      <Stack.Screen options={{ title: '記錄還款' }} />

      <Card>
        <Heading>誰付給誰</Heading>
        <Label>付款人</Label>
        <Segmented options={memberOptions} value={fromId} onChange={setFromId} />
        <Label>收款人</Label>
        <Segmented options={memberOptions} value={toId} onChange={setToId} />
        {fromId && fromId === toId ? <Banner>付款人與收款人不能是同一個人</Banner> : null}
      </Card>

      <Card>
        <Heading>{`清掉多少 ${currency} 的債`}</Heading>
        <Field
          label={`金額（${currency}）`}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder="0.00"
        />
        <Caption>這個數字決定餘額怎麼變動。</Caption>
      </Card>

      <Card>
        <Row>
          <Heading>{crossCurrency ? '不同幣別結清' : '還款方式'}</Heading>
          <LinkButton
            label={crossCurrency ? '取消' : '不同幣別結清'}
            onPress={() => setCrossCurrency((v) => !v)}
          />
        </Row>

        {crossCurrency ? (
          <View style={{ gap: spacing.md }}>
            <Divider />
            <Label>實際交付的幣別</Label>
            <Segmented
              options={COMMON_CURRENCIES.slice(0, 6).map((c) => ({ value: c, label: c }))}
              value={paidCurrency}
              onChange={setPaidCurrency}
            />
            <Field
              label={`匯率：1 ${currency} = ? ${paidCurrency}`}
              value={rateText}
              onChangeText={setRateText}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="例如 0.21"
              hint="由你們自己講好，系統不會自動抓匯率。"
            />
            {suggestedPaid !== null ? (
              <Caption tone="positive">
                {`實付約 ${formatWithCurrency(suggestedPaid, paidCurrency)}（僅作紀錄，餘額只動 ${currency}）`}
              </Caption>
            ) : null}
          </View>
        ) : (
          <Caption>{`預設就是用 ${currency} 付。要用別的幣別還這筆債時才需要設定。`}</Caption>
        )}
      </Card>

      <Field label="備註（選填）" value={note} onChangeText={setNote} placeholder="例如：現金" maxLength={100} />

      {error ? <Banner>{error}</Banner> : null}

      <Button
        label="記錄還款"
        busy={busy}
        disabled={!valid}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await repository.saveTransfer({
              groupId: snapshot.group.id,
              fromMemberId: fromId,
              toMemberId: toId,
              currency,
              amountMinor,
              paidCurrency: crossCurrency ? paidCurrency : undefined,
              paidAmountMinor: crossCurrency && suggestedPaid !== null ? suggestedPaid : undefined,
              paidRate: crossCurrency ? rate : undefined,
              note: note.trim() || undefined,
              paidAt: new Date().toISOString(),
              userId: getUserId(),
            });
            router.back();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}
