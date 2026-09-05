"use client";

/**
 * 検索インデックス構築を Web Worker で実行するメイン側ラッパー。
 *
 * indexer.ts の buildIndexChunks と同じ入出力（docs, onProgress → IndexChunk[]）を提供するが、
 * 重い分かち書き + 構築は Worker で行うのでメインスレッドの UI が固まらない。
 * Worker は 1 回の構築ごとに使い捨て（完了/失敗で terminate）。
 */

import type { SearchDoc } from "./types";
import type { IndexChunk } from "./indexer";
import type { BuildRequest, WorkerOutMessage } from "./index.worker";

export function buildIndexChunksInWorker(
  docs: SearchDoc[],
  onProgress?: (done: number, total: number) => void,
): Promise<IndexChunk[]> {
  return new Promise<IndexChunk[]>((resolve, reject) => {
    const worker = new Worker(new URL("./index.worker.ts", import.meta.url));

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        onProgress?.(msg.done, msg.total);
      } else if (msg.type === "done") {
        worker.terminate();
        resolve(msg.chunks);
      } else if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      reject(
        new Error(
          e.message || "検索インデックス構築 Worker でエラーが発生しました",
        ),
      );
    };

    const req: BuildRequest = { type: "build", docs };
    worker.postMessage(req);
  });
}
