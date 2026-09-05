/**
 * DataSource ファクトリ。Phase 2 で Firebase を足すときの切替を一箇所に集約する。
 */

"use client";

import type { DataSource } from "./types";
import { LocalDataSource } from "./local";

export type DataSourceMode = "local" | "firebase";

export function createDataSource(mode: DataSourceMode = "local"): DataSource {
  switch (mode) {
    case "local":
      return new LocalDataSource();
    // case 'firebase': return new FirebaseDataSource(...); // Phase 2
    default:
      return new LocalDataSource();
  }
}

export type { DataSource } from "./types";
