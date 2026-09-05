"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  createDataSource,
  type DataSource,
  type DataSourceMode,
} from "./index";

const DataSourceContext = createContext<DataSource | null>(null);

interface DataSourceProviderProps {
  children: ReactNode;
  /** 既定は 'local'。Phase 2 で 'firebase' を環境に応じて渡す */
  mode?: DataSourceMode;
}

export function DataSourceProvider({
  children,
  mode = "local",
}: DataSourceProviderProps) {
  // インスタンスは 1 つだけ生成して配布する
  const ds = useMemo(() => createDataSource(mode), [mode]);
  return (
    <DataSourceContext.Provider value={ds}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource(): DataSource {
  const ds = useContext(DataSourceContext);
  if (!ds) {
    throw new Error(
      "useDataSource は DataSourceProvider の内側で使ってください",
    );
  }
  return ds;
}
