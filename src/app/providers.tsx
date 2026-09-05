"use client";

import type { ReactNode } from "react";
import { DataSourceProvider } from "@/lib/datasource/context";

/**
 * アプリ全体のクライアント側プロバイダ。
 * Phase 1 はローカルのみモードなので DataSource は 'local'。
 */
export function Providers({ children }: { children: ReactNode }) {
  return <DataSourceProvider mode="local">{children}</DataSourceProvider>;
}
