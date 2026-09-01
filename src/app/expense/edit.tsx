import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  allocate,
  COMMON_CURRENCIES,
  computeSplits,
  formatMoney,
  formatWithCurrency,
  parseMoney,
  PERCENT_SCALE,
  roundHalfAwayFromZero,
  type SplitInput,
  type SplitResult,
  type SplitType,
} from '@/domain';
import { pickFromLibrary, takePhoto } from '@/data/receipts';
import { repository, useGroup } from '@/data/repository';
import { newId } from '@/data/ids';
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
  Mono,
  Row,
  Screen,
  Segmented,
} from '@/ui/components';
import { ReceiptStrip } from '@/ui/ReceiptStrip';
import { spacing, useTheme } from '@/ui/theme';

const SPLIT_LABELS: { value: SplitType; label: string }[] = [
  { value: 'equal', label: '平均分' },
  { value: 'shares', label: '依權重' },
  { value: 'percent', label: '依百分比' },
  { value: 'exact', label: '指定金額' },
];

export default function ExpenseEditScreen() {
  const router = useRouter();
  const { groupId, id } = useLocalSearchParams<{ groupId: string; id?: string }>();
  const { data: snapshot, loading } = useGroup(groupId);

  if (loading && !snapshot) return <Screen><Loading /></Screen>;
  if (!snapshot) return <Screen><Banner>找不到群組</Banner></Screen>;

  return <ExpenseForm snapshot={snapshot} expenseId={id} onDone={() => router.back()} />;
}

function ExpenseForm({
  snapshot,
  expenseId,
  onDone,
}: {
  snapshot: NonNullable<ReturnType<typeof useGroup>['data']>;
  expenseId?: string;
  onDone: () => void;
}) {
  const existing = expenseId ? snapshot.expenses.find((e) => e.id === expenseId) : undefined;
  const me = snapshot.members.find((m) => m.userId === getUserId());

  const [title, setTitle] = useState(existing?.title ?? '');
  const [currency, setCurrency] = useState(existing?.currency ?? snapshot.group.defaultCurrency);
  const [amountText, setAmountText] = useState(
    existing ? formatMoney(existing.amountMinor, existing.currency).replace(/,/g, '') : '',
  );
  const [payerId, setPayerId] = useState(
    existing?.payers[0]?.memberId ?? me?.id ?? snapshot.members[0]?.id ?? '',
  );
  const [splitType, setSplitType] = useState<SplitType>(existing?.splitType ?? 'equal');
  const [participants, setParticipants] = useState<string[]>(
    existing ? existing.splits.map((s) => s.memberId) : snapshot.members.map((m) => m.id),
  );
  const [values, setValues] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const split of existing?.splits ?? []) {
      if (split.shareValue == null) continue;
      map[split.memberId] =
        existing?.splitType === 'percent'
          ? (split.shareValue / 100).toString()
          : existing?.splitType === 'exact'
            ? formatMoney(split.shareValue, existing.currency).replace(/,/g, '')
            : String(split.shareValue);
    }
    return map;
  });
  // 指定金額 + 服務費：KTV、餐廳那種「各自點的再外加一成」的帳。
  // 只是輸入時的換算，不另外存進資料庫——存下去的就是加完之後的金額，
  // 所以重新打開這筆時看到的是最終數字，勾選框回到未勾選。
  const [serviceOn, setServiceOn] = useState(false);
  const [serviceText, setServiceText] = useState('10');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);

  // 收據要掛在一筆「已經存在」的支出上。新增流程中支出還沒存，
  // 所以先在這裡固定一顆 id，拍照時把支出草稿存下去再掛收據。
  // 用 useRef 是為了讓 id 在重新渲染之間保持不變。
  const idRef = useRef(existing?.id ?? newId());
  const expenseIdRef = idRef.current;
  const savedRef = useRef(Boolean(existing));

  const receipts = snapshot.receipts.filter((r) => r.expenseId === expenseIdRef);

  const persist = async () => {
    await repository.saveExpense({
      id: expenseIdRef,
      groupId: snapshot.group.id,
      title: title.trim(),
      currency,
      amountMinor: Number.isFinite(amountMinor) ? amountMinor : 0,
      splitType,
      paidAt: existing?.paidAt ?? new Date().toISOString(),
      payers: [{ memberId: payerId, amountMinor: Number.isFinite(amountMinor) ? amountMinor : 0 }],
      splitInputs: effectiveInputs,
      userId: getUserId(),
    });
  };

  const addReceipt = async (source: 'camera' | 'library') => {
    setReceiptBusy(true);
    setSaveError(null);
    try {
      const picked = source === 'camera'
        ? await takePhoto(snapshot.group.id)
        : await pickFromLibrary(snapshot.group.id);
      if (!picked) return;

      // 收據要掛在一筆真的存在的支出上，所以先把支出存起來
      if (!savedRef.current) {
        await persist();
        savedRef.current = true;
      }

      await repository.attachReceipt({
        expenseId: expenseIdRef,
        groupId: snapshot.group.id,
        receiptId: picked.receiptId,
        storagePath: picked.storagePath,
        localUri: picked.localUri,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setReceiptBusy(false);
    }
  };

  const amountMinor = useMemo(() => {
    try {
      return amountText.trim() ? parseMoney(amountText, currency) : 0;
    } catch {
      return NaN;
    }
  }, [amountText, currency]);

  const splitInputs = useMemo<SplitInput[]>(() => {
    return participants.map((memberId) => {
      const raw = values[memberId] ?? '';
      switch (splitType) {
        case 'equal':
          return { memberId };
        case 'shares':
          return { memberId, value: raw.trim() === '' ? 1 : Math.round(Number(raw)) };
        case 'percent': {
          const pct = Number(raw);
          return { memberId, value: Number.isFinite(pct) ? Math.round(pct * 100) : NaN };
        }
        case 'exact': {
          try {
            return { memberId, value: raw.trim() ? parseMoney(raw, currency) : 0 };
          } catch {
            return { memberId, value: NaN };
          }
        }
      }
    });
  }, [participants, values, splitType, currency]);

  const serviceRate = useMemo(() => {
    const percent = Number(serviceText.trim());
    return Number.isFinite(percent) && percent >= 0 ? percent / 100 : 0;
  }, [serviceText]);

  /**
   * 指定金額若加了服務費，就把每個人填的金額按比例放大到含服務費的總額。
   *
   * 用 allocate 而不是逐筆乘 1.1：逐筆乘完各自四捨五入，加起來會跟總額差個一兩分，
   * 然後畫面就會說「還差 0.02」，很煩。allocate 保證加總剛好等於放大後的總額。
   */
  const effectiveInputs = useMemo<SplitInput[]>(() => {
    if (splitType !== 'exact' || !serviceOn) return splitInputs;

    const entered = splitInputs.map((input) => input.value ?? 0);
    if (entered.some((value) => !Number.isFinite(value) || value < 0)) return splitInputs;

    const sum = entered.reduce((a, b) => a + b, 0);
    if (sum <= 0) return splitInputs;

    const withService = allocate(roundHalfAwayFromZero(sum * (1 + serviceRate)), entered);
    return splitInputs.map((input, index) => ({ ...input, value: withService[index] }));
  }, [splitInputs, splitType, serviceOn, serviceRate]);

  /** 指定金額還差多少才湊到總額。正數 = 還不夠，負數 = 超出 */
  const exactDiff = useMemo(() => {
    if (splitType !== 'exact' || !Number.isFinite(amountMinor)) return null;
    const sum = effectiveInputs.reduce((total, input) => total + (input.value ?? 0), 0);
    return Number.isFinite(sum) ? amountMinor - sum : null;
  }, [splitType, amountMinor, effectiveInputs]);

  /** 即時預覽：直接呼叫 domain 層，看到的就是實際會存下去的數字 */
  const preview = useMemo<{ splits?: SplitResult[]; error?: string }>(() => {
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return { error: '請輸入金額' };
    if (participants.length === 0) return { error: '至少要選一個分攤的人' };
    try {
      return { splits: computeSplits(amountMinor, splitType, effectiveInputs) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [amountMinor, splitType, effectiveInputs, participants.length]);

  const percentSum = useMemo(
    () => splitInputs.reduce((sum, i) => sum + (Number.isFinite(i.value) ? (i.value ?? 0) : 0), 0),
    [splitInputs],
  );

  const nameOf = (memberId: string) =>
    snapshot.members.find((m) => m.id === memberId)?.name ?? '？';

  const toggleParticipant = (memberId: string) => {
    setParticipants((prev) =>
      prev.includes(memberId) ? prev.filter((p) => p !== memberId) : [...prev, memberId],
    );
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? '編輯支出' : '新增支出' }} />

      <Card>
        {/* 金額擺第一個：記帳時金額是必填也是主角，項目是可以跳過的 */}
        <Field
          label="金額"
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0.00"
          keyboardType="decimal-pad"
          inputMode="decimal"
        />
        <Field
          label="項目（選填）"
          value={title}
          onChangeText={setTitle}
          placeholder="例如：晚餐"
          maxLength={60}
        />
        <Label>幣別</Label>
        <Segmented
          options={COMMON_CURRENCIES.slice(0, 6).map((c) => ({ value: c, label: c }))}
          value={currency}
          onChange={setCurrency}
        />
        {currency !== snapshot.group.defaultCurrency ? (
          <Caption>
            {`這筆用 ${currency} 記，不會換算成 ${snapshot.group.defaultCurrency}。結算時再決定匯率。`}
          </Caption>
        ) : null}
      </Card>

      <Card>
        <Heading>誰付的</Heading>
        <Segmented
          options={snapshot.members.map((m) => ({ value: m.id, label: m.name }))}
          value={payerId}
          onChange={setPayerId}
        />
      </Card>

      <Card>
        <Heading>怎麼分</Heading>
        <Segmented options={SPLIT_LABELS} value={splitType} onChange={setSplitType} />

        {splitType === 'exact' ? (
          <Row>
            <Pressable
              onPress={() => setServiceOn((on) => !on)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
              <Check on={serviceOn} />
              <Body>加收服務費</Body>
            </Pressable>
            {serviceOn ? (
              <View style={{ width: 92 }}>
                <Field
                  label=""
                  value={serviceText}
                  onChangeText={setServiceText}
                  placeholder="10"
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  style={{ paddingVertical: spacing.sm, textAlign: 'right' }}
                />
              </View>
            ) : null}
            {serviceOn ? <Body dim>%</Body> : null}
          </Row>
        ) : null}

        {serviceOn && splitType === 'exact' ? (
          <Caption>各自填自己點的金額，這裡按比例加上服務費，湊到上面的總額。</Caption>
        ) : null}

        <Divider />

        {snapshot.members.map((member) => {
          const included = participants.includes(member.id);
          const share = preview.splits?.find((s) => s.memberId === member.id);

          return (
            <View key={member.id} style={{ gap: spacing.xs }}>
              <Row>
                <Pressable
                  onPress={() => toggleParticipant(member.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                  <Check on={included} />
                  <Body>{member.name}</Body>
                </Pressable>

                {included && splitType !== 'equal' ? (
                  <View style={{ width: 110 }}>
                    <Field
                      label=""
                      value={values[member.id] ?? ''}
                      onChangeText={(text) => setValues((prev) => ({ ...prev, [member.id]: text }))}
                      placeholder={splitType === 'shares' ? '1' : splitType === 'percent' ? '%' : '金額'}
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      style={{ paddingVertical: spacing.sm, textAlign: 'right' }}
                    />
                  </View>
                ) : null}

                {included && share ? (
                  <View style={{ minWidth: 92, alignItems: 'flex-end' }}>
                    <Mono>{formatWithCurrency(share.amountMinor, currency)}</Mono>
                  </View>
                ) : null}
              </Row>
            </View>
          );
        })}

        {splitType === 'percent' ? (
          <Caption tone={percentSum === PERCENT_SCALE ? 'positive' : 'negative'}>
            {`目前總和 ${(percentSum / 100).toFixed(2)}%（必須剛好 100%）`}
          </Caption>
        ) : null}

        {splitType === 'exact' && exactDiff !== null ? (
          <Row>
            {/* 「總和 2000 與總額 10000 不符」要人自己心算差多少，直接講差額 */}
            <Caption tone={exactDiff === 0 ? 'positive' : 'negative'}>
              {exactDiff === 0
                ? '指定金額剛好等於總額'
                : exactDiff > 0
                  ? `還差 ${formatWithCurrency(exactDiff, currency)}`
                  : `超出 ${formatWithCurrency(-exactDiff, currency)}`}
            </Caption>
            <Caption>逗號是加總，20,20＝40</Caption>
          </Row>
        ) : preview.error ? (
          <Banner>{preview.error}</Banner>
        ) : (
          <Caption tone="positive">
            {`分攤加總 ${formatWithCurrency(
              preview.splits!.reduce((sum, s) => sum + s.amountMinor, 0),
              currency,
            )}，與金額相符`}
          </Caption>
        )}
      </Card>

      <Card>
        <ReceiptStrip
          receipts={receipts}
          busy={receiptBusy}
          onAdd={addReceipt}
          onRemove={(receiptId) => void repository.removeReceipt(receiptId, snapshot.group.id)}
        />
        {!savedRef.current ? <Caption>加收據時會先把這筆支出存起來。</Caption> : null}
      </Card>

      {saveError ? <Banner>{saveError}</Banner> : null}

      <Button
        label={existing ? '儲存變更' : '新增支出'}
        busy={busy}
        disabled={!!preview.error || !payerId}
        onPress={async () => {
          setBusy(true);
          setSaveError(null);
          try {
            await persist();
            savedRef.current = true;
            onDone();
          } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      />

      {existing ? (
        <Button
          label="刪除這筆支出"
          variant="danger"
          busy={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await repository.deleteExpense(expenseIdRef, snapshot.group.id);
              onDone();
            } catch (err) {
              setSaveError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      <Caption>{`付款人目前只支援一位。多人共同付款的資料結構已經備好，之後補上介面。`}</Caption>
      <Body dim>{nameOf(payerId)} 付了全額</Body>
    </Screen>
  );
}

/** 圓形勾選框。參與者與服務費共用，兩邊的視覺才不會各長各的 */
function Check({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: on ? 0 : 1.5,
        borderColor: t.lineStrong,
        backgroundColor: on ? t.signal : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {on ? <Body style={{ color: t.signalText, fontSize: 12, fontWeight: '700' }}>✓</Body> : null}
    </View>
  );
}
