import { Stack, useLocalSearchParams } from 'expo-router';

import { useGroup } from '@/data/repository';
import { Empty, Screen } from '@/ui/components';
import { GroupBody } from '@/ui/GroupBody';

/**
 * 單一群組的獨立頁面。
 *
 * 首頁已經內建群組切換，這條路由留給邀請連結、舊書籤，以及從結算／成員
 * 返回時的落點。內容與首頁共用 GroupBody，不會有兩份會走鐘的版面。
 */
export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: snapshot } = useGroup(id);

  if (!id) return <Screen><Empty title="找不到這個群組" /></Screen>;

  return (
    <Screen>
      <Stack.Screen options={{ title: snapshot?.group.name ?? '群組' }} />
      <GroupBody groupId={id} />
    </Screen>
  );
}
