/**
 * 取り込みの入力条件（取得元に依存しない値）。
 *
 * 実装（@/lib/ingest/seed）ではなく types 側に置く。ダンプのスキーマ（@/types/dump）が
 * selection を内包するため、types → lib への逆向き参照を作らないための切り出し。
 * 従来の import 経路を壊さないよう seed.ts からも re-export している。
 */

/**
 * 取り込む種類の選択。チェックボックスと 1:1 対応。
 * - issues:      課題（親）。OFF なら課題・添付メタ・添付バイナリは一切触らない（既存 DB 保持）。
 * - comments:    コメント。issues=false のとき意味を持たない（UI 側で false 固定）。
 * - attachments: 添付バイナリの DL（OPFS 保存）。issues=false のとき意味を持たない。
 *                添付「メタ」は課題に内包されるので issues=true なら常に put される。
 * - wikis:       Wiki。
 * - documents:   ドキュメント。
 */
export interface IngestSelection {
  issues: boolean;
  comments: boolean;
  attachments: boolean;
  wikis: boolean;
  documents: boolean;
}
