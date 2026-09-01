import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { COMMON_CURRENCIES } from '@/domain';
import { getDisplayName, setDisplayName } from '@/data/profile';
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
import { spacing } from '@/ui/theme';

type Mode = 'list' | 'create' | 'join';

export default function GroupListScreen() {
  const router = useRouter();
  const { data: groups, error, loading, reload } = useGroups();

  // undefined = 還在讀取；'' = 讀完但還沒設定過名字
  const [name, setName] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<Mode>('list');
  const [emailBound, setEmailBound] = useState<boolean | null>(null);

  useEffect(() => {
    void getDisplayName().then((stored) => setName(stored ?? ''));
    void getIdentity().then((identity) => setEmailBound(Boolean(identity?.email)));
  }, []);

  if (name === undefined) return <Screen><Loading /></Screen>;
  if (name === '') return <NamePrompt onDone={setName} error={error} />;

  return (
    <Screen>
      <Title>我的群組</Title>
      <Pressable onPress={() => router.push('/account')}>
        <Row>
          <Label>目前身分</Label>
          <Body>{name} ›</Body>
        </Row>
      </Pressable>

      {emailBound === false ? (
        <Pressable onPress={() => router.push('/account')}>
          <Banner>
            還沒綁定 Email。你的身分只存在這台裝置上，清掉資料或換裝置就會永久失去所有群組。點這裡綁定。
          </Banner>
        </Pressable>
      ) : null}

      {error ? <Banner>{error}</Banner> : null}

      {loading && !groups ? (
        <Loading />
      ) : groups && groups.length > 0 ? (
        groups.map((group) => (
          <Link key={group.id} href={`/group/${group.id}`} asChild>
            <Pressable>
              <Card>
                <Row>
                  <Heading>{group.name}</Heading>
                  <Label>{group.defaultCurrency}</Label>
                </Row>
              </Card>
            </Pressable>
          </Link>
        ))
      ) : (
        <Empty title="還沒有任何群組" hint="建立一個，或用朋友給的邀請碼加入" />
      )}

      {mode === 'list' ? (
        <View style={{ gap: spacing.sm }}>
          <Button label="建立新群組" onPress={() => setMode('create')} />
          <Button label="用邀請碼加入" variant="secondary" onPress={() => setMode('join')} />
        </View>
      ) : mode === 'create' ? (
        <CreateGroupForm
          memberName={name}
          onCancel={() => setMode('list')}
          onCreated={(groupId) => {
            setMode('list');
            reload();
            router.push(`/group/${groupId}`);
          }}
        />
      ) : (
        <JoinGroupForm
          memberName={name}
          onCancel={() => setMode('list')}
          onJoined={(groupId) => {
            setMode('list');
            reload();
            router.push(`/group/${groupId}`);
          }}
        />
      )}

      <View style={{ height: spacing.lg }} />
      <Pressable onPress={() => router.push('/account')}>
        <Label>帳號設定</Label>
      </Pressable>
    </Screen>
  );
}

function NamePrompt({ onDone, error }: { onDone: (name: string) => void; error?: string | null }) {
  const [value, setValue] = useState('');

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
        <Button
          label="開始使用"
          disabled={value.trim().length === 0}
          onPress={() => {
            const trimmed = value.trim();
            if (!trimmed) return;
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
      <Label>預設幣別（記帳時仍可逐筆改）</Label>
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
