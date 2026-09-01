import { useCallback, useEffect, useState } from 'react';

import { useDataVersion } from './changes';
import impl from './impl';
import type { Repository } from './repository-types';
import type { Group, GroupSnapshot } from './types';

/**
 * 資料層的唯一入口。
 *
 * 實作由平台副檔名決定：Android 解析到 impl.native.ts（本地優先），
 * Web 解析到 impl.ts（Supabase 直連）。詳見 impl.ts 的說明。
 */
export const repository: Repository = impl;

export type { Repository };

/** 非同步載入 + 資料變更時自動重載的小工具 */
function useAsyncData<T>(load: () => Promise<T>, deps: unknown[]): {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const version = useDataVersion();
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({
    data: undefined,
    error: null,
    loading: true,
  });
  const [manual, setManual] = useState(0);

  const reload = useCallback(() => setManual((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));

    load()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          }));
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, manual, ...deps]);

  return { ...state, reload };
}

export function useGroups() {
  return useAsyncData<Group[]>(() => repository.listGroups(), []);
}

export function useGroup(groupId: string | undefined) {
  return useAsyncData<GroupSnapshot | null>(
    () => (groupId ? repository.loadGroup(groupId) : Promise.resolve(null)),
    [groupId],
  );
}
