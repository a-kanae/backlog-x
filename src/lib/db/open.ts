/**
 * IndexedDB を開く。シングルトン Promise で多重 open を防ぐ。
 * IndexedDB はブラウザ専用なので、SSR で呼ばれたら明示エラー（実呼び出しは必ず client 内）。
 */

"use client";

import { openDB, type IDBPDatabase } from "idb";
import { DB_NAME, DB_VERSION, type BacklogXDB } from "./schema";

let dbPromise: Promise<IDBPDatabase<BacklogXDB>> | undefined;

export function getDB(): Promise<IDBPDatabase<BacklogXDB>> {
  if (typeof window === "undefined") {
    throw new Error(
      "IndexedDB はブラウザ専用です（サーバー側では使用できません）",
    );
  }
  if (!dbPromise) {
    dbPromise = openDB<BacklogXDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const issues = db.createObjectStore("issues", { keyPath: "id" });
          issues.createIndex("by-project", "projectId");
          issues.createIndex("by-project-keyId", ["projectId", "keyId"]);
          issues.createIndex("by-project-parent", [
            "projectId",
            "parentIssueId",
          ]);
          issues.createIndex("by-project-updated", ["projectId", "updated"]);

          const comments = db.createObjectStore("comments", { keyPath: "id" });
          comments.createIndex("by-issue", "issueId");
          comments.createIndex("by-project", "projectId");

          const attachmentMeta = db.createObjectStore("attachmentMeta", {
            keyPath: "id",
          });
          attachmentMeta.createIndex("by-issue", "issueId");
          attachmentMeta.createIndex("by-project", "projectId");

          db.createObjectStore("users", { keyPath: "id" });

          const masters = db.createObjectStore("masters", { keyPath: "key" });
          masters.createIndex("by-project-kind", ["projectId", "kind"]);

          db.createObjectStore("projectMeta", { keyPath: "projectId" });

          const searchIndex = db.createObjectStore("searchIndex", {
            keyPath: "key",
          });
          searchIndex.createIndex("by-project", "projectId");
        }
        if (oldVersion < 2) {
          // 登録日ソート用のインデックスを追加
          tx.objectStore("issues").createIndex("by-project-created", [
            "projectId",
            "created",
          ]);
        }
        if (oldVersion < 3) {
          // ユーザーアイコンを Blob でローカル保存するストア（外部 URL 参照の撤廃）
          db.createObjectStore("userIcons", { keyPath: "userId" });
        }
        if (oldVersion < 4) {
          // Wiki ストア（id は数値・グローバル一意）
          const wikis = db.createObjectStore("wikis", { keyPath: "id" });
          wikis.createIndex("by-project", "projectId");
          wikis.createIndex("by-project-name", ["projectId", "name"]);
          wikis.createIndex("by-project-updated", ["projectId", "updated"]);

          // ドキュメントストア（Backlog Document・id は 32 文字の文字列）
          const documents = db.createObjectStore("documents", {
            keyPath: "id",
          });
          documents.createIndex("by-project", "projectId");
          documents.createIndex("by-project-updated", ["projectId", "updated"]);
        }
        // v5: masters に milestone / version kind を追加しただけで、ストア・インデックスの
        // 構造変更は無い（値の kind が増えるのみ）。データは再取り込みで充填するため、
        // ここでの createObjectStore / createIndex は不要。
        if (oldVersion < 6) {
          // プロジェクトアイコンを Blob でローカル保存するストア（projectId で 1 枚）
          db.createObjectStore("projectIcons", { keyPath: "projectId" });
        }
        if (oldVersion < 7) {
          // プロジェクト参加者 + roleType のスナップショット。
          // key は `${projectId}:${userId}` の合成文字列で、値（StoredProjectMember）には
          // その文字列フィールドを持たせないため out-of-line key（put 時に key を明示）で作る。
          const projectMembers = db.createObjectStore("projectMembers");
          projectMembers.createIndex("by-project", "projectId");
        }
      },
    });
  }
  return dbPromise;
}
