/**
 * 全文検索の型定義。
 *
 * flexsearch に投入する検索ドキュメント（SearchDoc）と、検索結果（SearchHit）。
 * 実装は Step 4（tokenizer / indexer / searcher）で行うが、DataSource が参照するため型を先に定義する。
 */

import type { NamedColorMaster } from "@/types/entities";

/** 検索ドキュメントの種別 */
export type SearchKind = "issue" | "comment" | "wiki" | "document";

/** flexsearch のインデックスに入れる 1 ドキュメント */
export interface SearchDoc {
  /** `i:${issueId}` / `c:${commentId}` / `w:${wikiId}` / `d:${documentId}` */
  id: string;
  projectId: number;
  kind: SearchKind;
  /** 課題/コメントの場合: 結果を課題にひもづける課題 ID（Wiki/ドキュメントは 0） */
  issueId: number;
  /** 課題の表示用連番（PROJ-1 の 1）。Wiki/ドキュメントは 0 */
  keyId: number;
  /** Wiki ヒットの遷移先 wiki.id（数値）。Wiki 以外は未設定 */
  wikiId?: number;
  /** ドキュメントヒットの遷移先 document.id（文字列）。ドキュメント以外は未設定 */
  documentId?: string;
  /** タイトル（課題 summary / Wiki 名 / ドキュメント title） */
  title: string;
  /** 分かち書き済みの本文（kuromoji の出力） */
  body: string;
}

/** 検索結果 1 件 */
export interface SearchHit {
  /** ドキュメントの一意 ID。React の key に使う */
  id: string;
  kind: SearchKind;
  issueId: number;
  keyId: number;
  /** Wiki ヒットの遷移先 wiki.id */
  wikiId?: number;
  /** ドキュメントヒットの遷移先 document.id */
  documentId?: string;
  /** タイトル（課題 summary / Wiki 名 / ドキュメント title） */
  summary: string;
  /** 一致箇所のスニペット */
  snippet: string;
  score?: number;
  /**
   * 並び替え用の更新日時（ISO 文字列）。課題/Wiki/ドキュメントはその本体の updated、
   * コメントはコメント自身の updated。取得できなければ null（末尾に回す）。
   * 本家 Backlog の検索（sort=UPDATED・降順）に合わせて新しい順に並べるために使う。
   */
  updated: string | null;
  /**
   * 課題ヒットの場合のみ、その課題のステータス。コメントヒットは元課題のステータスを
   * 持ちうるが表示上は使わない（課題とコメントが混在する結果でステータスの意味が
   * 課題と紐付きにくいため、課題ヒットに限定する）。Wiki/ドキュメントは undefined。
   */
  status?: NamedColorMaster;
}
