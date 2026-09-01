import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { receiptUrl } from '@/data/receipts';
import type { Receipt } from '@/data/types';
import { Body, Button, Caption, Label, Row } from './components';
import { radius, spacing, useTheme } from './theme';

/**
 * 收據縮圖列。
 *
 * 尚未上傳完成的收據直接顯示本地檔案（localPath），已上傳的則跟
 * Storage 要一組簽章網址——bucket 是私有的，不能直接用公開網址。
 */
export function ReceiptStrip({
  receipts,
  onAdd,
  onRemove,
  busy,
}: {
  receipts: Receipt[];
  onAdd: (source: 'camera' | 'library') => void;
  onRemove: (receiptId: string) => void;
  busy?: boolean;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <Row>
        <Label>收據</Label>
        {receipts.length > 0 ? <Caption>{`${receipts.length} 張`}</Caption> : null}
      </Row>

      {receipts.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {receipts.map((receipt) => (
            <ReceiptThumb key={receipt.id} receipt={receipt} onRemove={() => onRemove(receipt.id)} />
          ))}
        </ScrollView>
      ) : null}

      <Row>
        <View style={{ flex: 1 }}>
          <Button label="拍收據" variant="secondary" busy={busy} onPress={() => onAdd('camera')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="從相簿選" variant="secondary" busy={busy} onPress={() => onAdd('library')} />
        </View>
      </Row>
    </View>
  );
}

function ReceiptThumb({ receipt, onRemove }: { receipt: Receipt; onRemove: () => void }) {
  const t = useTheme();
  const [uri, setUri] = useState<string | null>(receipt.localPath);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (receipt.localPath) {
      setUri(receipt.localPath);
      return;
    }
    let cancelled = false;
    receiptUrl(receipt.storagePath)
      .then((signed) => {
        if (!cancelled) setUri(signed);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [receipt.localPath, receipt.storagePath]);

  const confirmRemove = () => {
    Alert.alert('移除這張收據？', '照片會從這筆支出移除。', [
      { text: '取消', style: 'cancel' },
      { text: '移除', style: 'destructive', onPress: onRemove },
    ]);
  };

  return (
    <Pressable onLongPress={confirmRemove} style={{ width: 96, gap: spacing.xs }}>
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: radius.md,
          backgroundColor: t.surfaceAlt,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {uri && !failed ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Body dim style={{ fontSize: 12 }}>
            {failed ? '載入失敗' : '載入中'}
          </Body>
        )}
      </View>
      {receipt.localPath ? <Caption>待上傳</Caption> : null}
    </Pressable>
  );
}
