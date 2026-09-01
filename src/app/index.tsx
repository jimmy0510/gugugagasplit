import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { COMMON_CURRENCIES } from '@/domain';
import { avatarPathFor, avatarUrls } from '@/data/avatars';
import { getDisplayName, getGroupOrder, setDisplayName, setGroupOrder } from '@/data/profile';
import { useGroupListRealtime } from '@/data/realtime';
import { getIdentity } from '@/data/supabase';
import { repository, useGroups } from '@/data/repository';
import { ensureSignedIn } from '@/data/supabase';
import {
  Banner,
  Body,
  Button,
  Caption,
  Card,
  Empty,
  Field,
  Heading,
  Label,
  Loading,
  Row,
  Screen,
  Segmented,
  Title,
} from '@/ui/components';
import { Avatar } from '@/ui/Avatar';
import { GroupBody } from '@/ui/GroupBody';
import { GroupStrip } from '@/ui/GroupStrip';
import { spacing } from '@/ui/theme';

/**
 * 首頁 = 群組切換列 + 那個群組的完整內容。
 *
 * 從前的「群組列表 → 點進群組」少了一層：常用情境是回到同一個群組再記一筆，
 * 中間那頁只是路過。列表縮成最上面一條可捲動的膠囊列，內容直接就位。
 */

/** 「＋」展開後的狀態：先給兩個選項，選了才展開表單 */
type Add = 'none' | 'pick' | 'create' | 'join';

export default function HomeScreen() {
  const router = useRouter();
  const { data: groups, error, loading, reload } = useGroups();

  // undefined = 還在讀取；'' = 讀完但還沒設定過名字
  const [name, setName] = useState<string | undefined>(undefined);
  const [emailBound, setEmailBound] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [add, setAdd] = useState<Add>('none');
  const [order, setOrder] = useState<string[]>([]);

  // 被加進新群組時，列表自己會更新
  useGroupListRealtime(userId);

  useEffect(() => {
    void getGroupOrder().then(setOrder);
  }, []);

  /**
   * 名字、頭像、Email 綁定狀態都在帳號設定頁改，改完按「上一步」回到這裡時
   * 首頁並沒有重新掛載，只在 mount 讀一次的話畫面會停在舊值——
   * 名字沒變、頭像沒換、綁完 email 那條警告還掛在上面。
   * 改成每次重新取得焦點都讀一次。
   */
  useFocusEffect(
    useCallback(() => {
      void getDisplayName().then((stored) => setName(stored ?? ''));
      void getIdentity().then(async (identity) => {
        setEmailBound(Boolean(identity?.email));
        setUserId(identity?.userId);
        if (!identity?.userId) return;
        const path = avatarPathFor(identity.userId);
        const map = await avatarUrls([path]);
        setAvatarUri(map[path] ?? null);
      });
    }, []),
  );

  /**
   * 開啟時要顯示哪個群組：最近一筆帳目所屬的那個。
   * 正在跑的那趟旅行就是最新有動靜的那個，直接落在那裡最省事。
   *
   * 只在「還沒選任何群組」時決定。曾經寫成「選的群組不在清單裡就退回第一個」，
   * 結果剛建立的群組每次都被彈回去——建立完 select() 立刻指向新群組，
   * 但 reload() 還沒回來，那一瞬間新群組確實不在清單裡。
   */
  useEffect(() => {
    if (!groups || groups.length === 0 || selectedId) return;

    void repository.newestActivityGroupId().then((newest) => {
      setSelectedId((current) => current ?? (groups.find((g) => g.id === newest) ?? groups[0]).id);
    });
  }, [groups, selectedId]);

  /**
   * 套用拖曳排出來的順序。順序表裡沒提到的群組（剛加入的）排在最後面，
   * 順序表裡有但已經離開的群組直接忽略——兩邊都不必特別去同步。
   */
  const ordered = useMemo(() => {
    if (!groups) return [];
    const rank = new Map(order.map((id, index) => [id, index]));
    return [...groups].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
    );
  }, [groups, order]);

  /**
   * 真正要顯示的群組。
   *
   * 選中的群組可能已經不在清單裡了——自己把它刪掉，或被別人移出群組。
   * 這裡用「算出來的」而不是去清掉 selectedId，因為剛建立群組時
   * select() 會先指向新群組、reload() 還沒回來，那一瞬間它本來就不在清單裡；
   * 載入中就先維持原選擇，載完了才退回第一個。
   */
  const activeId =
    selectedId && ordered.some((g) => g.id === selectedId)
      ? selectedId
      : loading
        ? selectedId
        : ordered[0]?.id;

  const select = (groupId: string) => {
    setSelectedId(groupId);
    setAdd('none');
  };

  const reorder = (groupIds: string[]) => {
    setOrder(groupIds);
    void setGroupOrder(groupIds);
  };

  if (name === undefined) return <Screen><Loading /></Screen>;
  if (name === '') return <NamePrompt onDone={setName} error={error} />;

  const hasGroups = Boolean(groups && groups.length > 0);

  return (
    <Screen
      // 切換列釘在最上面，取代原本那條寫著 gugugagasplit 的標題列——
      // 往下捲支出時它不會跟著走，隨時都能換群組。
      header={
        <GroupStrip
          groups={ordered}
          selectedId={activeId}
          onSelect={select}
          onReorder={reorder}
          onAdd={() => setAdd(add === 'none' ? 'pick' : 'none')}
          addOpen={add !== 'none'}
          avatar={<Avatar name={name} uri={avatarUri} size={32} />}
          onAvatarPress={() => router.push('/account')}
        />
      }>
      {emailBound === false ? (
        <Pressable onPress={() => router.push('/account')}>
          <Banner>
            還沒綁定 Email。你的身分只存在這台裝置上，清掉資料或換裝置就會永久失去所有群組。點這裡綁定。
          </Banner>
        </Pressable>
      ) : null}

      {error ? <Banner>{error}</Banner> : null}

      {/* 加群組的入口。沒有任何群組時直接攤開，不必先按「＋」 */}
      {add === 'create' ? (
        <CreateGroupForm
          memberName={name}
          onCancel={() => setAdd(hasGroups ? 'none' : 'pick')}
          onCreated={(groupId) => {
            reload();
            select(groupId);
          }}
        />
      ) : add === 'join' ? (
        <JoinGroupForm
          memberName={name}
          onCancel={() => setAdd(hasGroups ? 'none' : 'pick')}
          onJoined={(groupId) => {
            reload();
            select(groupId);
          }}
        />
      ) : add === 'pick' || !hasGroups ? (
        <View style={{ gap: spacing.sm }}>
          <Button label="建立新群組" onPress={() => setAdd('create')} />
          <Button label="用邀請碼加入" variant="secondary" onPress={() => setAdd('join')} />
        </View>
      ) : null}

      {loading && !groups ? (
        <Loading />
      ) : !hasGroups ? (
        <Empty title="還沒有任何群組" hint="建立一個，或用朋友給的邀請碼加入" />
      ) : activeId ? (
        <GroupBody groupId={activeId} />
      ) : (
        <Loading />
      )}
    </Screen>
  );
}

function NamePrompt({ onDone, error }: { onDone: (name: string) => void; error?: string | null }) {
  const [value, setValue] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  return (
    <Screen>
      <Title>你叫什麼名字？</Title>
      <Body dim>這是朋友在群組裡看到的名字，之後可以改。</Body>
      {/* 讀取群組時的錯誤在這個階段本來看不到，會讓問題變成「按鈕沒反應」 */}
      {error ? <Banner>{error}</Banner> : null}
      <Card>
        <Field
          label="名字"
          value={value}
          onChangeText={setValue}
          placeholder="例如：小明"
          autoFocus
          maxLength={20}
        />
        {hint ? <Caption tone="negative">{hint}</Caption> : null}
        <Button
          label="開始使用"
          // 刻意不用 disabled：停用的按鈕按下去毫無反應，
          // 使用者只會覺得「按鈕壞了」而不知道是少填了名字。
          // 改成讓他按，然後明確說出缺什麼。
          onPress={() => {
            const trimmed = value.trim();
            if (!trimmed) {
              setHint('請先輸入名字。');
              return;
            }
            // 先讓畫面前進，名字在背景寫入。名字只是本地快取，
            // 不該讓一個儲存操作擋住整個 App 的入口。
            onDone(trimmed);
            void setDisplayName(trimmed);
          }}
        />
      </Card>
    </Screen>
  );
}

function CreateGroupForm({
  memberName,
  onCancel,
  onCreated,
}: {
  memberName: string;
  onCancel: () => void;
  onCreated: (groupId: string) => void;
}) {
  const [groupName, setGroupName] = useState('');
  const [currency, setCurrency] = useState('TWD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <Heading>建立新群組</Heading>
      <Field
        label="群組名稱"
        value={groupName}
        onChangeText={setGroupName}
        placeholder="例如：日本旅遊"
        autoFocus
        maxLength={40}
      />
      <Label>主幣別（記帳時仍可逐筆改）</Label>
      <Segmented
        options={COMMON_CURRENCIES.slice(0, 6).map((c) => ({ value: c, label: c }))}
        value={currency}
        onChange={setCurrency}
      />
      {error ? <Banner>{error}</Banner> : null}
      <Row>
        <View style={{ flex: 1 }}>
          <Button label="取消" variant="secondary" onPress={onCancel} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            label="建立"
            busy={busy}
            disabled={groupName.trim().length === 0}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                const userId = await ensureSignedIn();
                const { groupId } = await repository.createGroup({
                  name: groupName.trim(),
                  defaultCurrency: currency,
                  userId,
                  memberName,
                });
                onCreated(groupId);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      </Row>
    </Card>
  );
}

function JoinGroupForm({
  memberName,
  onCancel,
  onJoined,
}: {
  memberName: string;
  onCancel: () => void;
  onJoined: (groupId: string) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <Heading>用邀請碼加入</Heading>
      <Field
        label="邀請碼"
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        placeholder="例如：K7M2PQXR"
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        maxLength={32}
      />
      <Caption>加入群組需要連線。</Caption>
      {error ? <Banner>{error}</Banner> : null}
      <Row>
        <View style={{ flex: 1 }}>
          <Button label="取消" variant="secondary" onPress={onCancel} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            label="加入"
            busy={busy}
            disabled={code.trim().length < 6}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await ensureSignedIn();
                const groupId = await repository.joinByCode(code, memberName);
                onJoined(groupId);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      </Row>
    </Card>
  );
}
