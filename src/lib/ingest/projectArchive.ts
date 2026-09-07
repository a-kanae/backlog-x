/**
 * プロジェクト単位のアーカイブ書き出し / 読み込み。
 *
 * 取り込み済みの IndexedDB データ（課題・コメント・添付メタ・ユーザー・アイコン・マスタ・
 * 検索インデックス）を 1 つの JSON ファイルにまとめてダウンロードし、別メンバーがインポート
 * して同じアーカイブを再構築できるようにする。検索インデックスも含めるので、インポート後の
 * 再構築（kuromoji 分かち書き）は不要 = 取り込んだ人の成果をそのまま配れる。
 *
 * これは architecture.md の利用モデル「管理者が取り込み、複数人で共有」の手動版にあたる
 * （Phase 2 で Firebase 配信に置き換わるが、その前段としてファイル共有で同じことができる）。
 *
 * アイコンの Blob は JSON に収めるため base64 文字列にして内包する。
 */

"use client";

import { zip, unzip, type Zippable, type Unzipped } from "fflate";
import type {
  StoredUser,
  StoredUserIcon,
  StoredProjectIcon,
  StoredProjectMember,
} from "@/types/entities";
import {
  listSavedAttachmentIds,
  getAttachmentBlob,
  saveAttachmentBlob,
  clearProjectAttachments,
} from "@/lib/storage/opfs";
import {
  type ProjectExport,
  type ExportedUserIcon,
  type ExportedProjectIcon,
  type IconsExport,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ICONS_FORMAT,
} from "@/types/export";
import {
  deleteProjectRecords,
  getProjectMeta,
  getIssuesByProject,
  getCommentsByProject,
  getAttachmentMetaByProject,
  getMastersByProject,
  getUsersByIds,
  getUserIconsByIds,
  getProjectIcon,
  getProjectMembersByProject,
  getSearchIndexByProject,
  getWikisByProject,
  getDocumentsByProject,
  putIssues,
  putComments,
  putAttachmentMeta,
  putMasters,
  putUsers,
  putUserIcons,
  putProjectIcon,
  putProjectMembers,
  putProjectMeta,
  putWikis,
  putDocuments,
} from "@/lib/db/repositories";
import { rebuildSearchIndex } from "@/lib/search/rebuild";
import { backlogToMarkdown } from "@/lib/backlog-notation/toMarkdown";
import { blobToBase64, base64ToBlob } from "./binary";

/**
 * JSON 文字列を gzip 圧縮して Blob（.json.gz の中身）にする。
 * ブラウザ標準の CompressionStream を使う（依存ゼロ）。JSON はテキストなのでよく縮む。
 */
export async function gzipJson(json: string): Promise<Blob> {
  const input = new Blob([json], { type: "application/json" });
  const stream = input.stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).blob();
  return new Blob([compressed], { type: "application/gzip" });
}

/**
 * gzip 圧縮されたファイル（.json.gz）を解凍して JSON 文字列に戻す。
 * DecompressionStream を使う。非 gzip（壊れたファイル等）は例外になる。
 */
export async function gunzipToJson(file: Blob): Promise<string> {
  const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * 課題・コメント・Wiki・ドキュメントに登場するユーザー id を集める
 * （users/userIcons はグローバルストアのため、エクスポートに含めるユーザーを絞る）。
 */
function collectUserIds(
  issues: {
    createdUser: StoredUser;
    updatedUser: StoredUser | null;
    assignee: StoredUser | null;
  }[],
  comments: { createdUser: StoredUser }[],
  wikis: { createdUser: StoredUser; updatedUser: StoredUser | null }[],
  documents: { createdUser: StoredUser; updatedUser: StoredUser | null }[],
  projectMembers: StoredProjectMember[],
): number[] {
  const ids = new Set<number>();
  for (const issue of issues) {
    ids.add(issue.createdUser.id);
    if (issue.updatedUser) ids.add(issue.updatedUser.id);
    if (issue.assignee) ids.add(issue.assignee.id);
  }
  for (const c of comments) ids.add(c.createdUser.id);
  for (const w of wikis) {
    ids.add(w.createdUser.id);
    if (w.updatedUser) ids.add(w.updatedUser.id);
  }
  for (const d of documents) {
    ids.add(d.createdUser.id);
    if (d.updatedUser) ids.add(d.updatedUser.id);
  }
  // プロジェクトメンバーの userId も含める（一度も投稿していない現メンバーの
  // 名前・メール・アイコンをエクスポートに載せるため。取り込み側が users マスタと突き合わせる）。
  for (const m of projectMembers) ids.add(m.userId);
  return [...ids];
}

/**
 * プロジェクト 1 件分のアーカイブを ProjectExport オブジェクトに書き出す。
 * 呼び出し側で JSON 文字列化 → Blob → ダウンロードする。
 */
export async function exportProject(projectId: number): Promise<ProjectExport> {
  const projectMeta = await getProjectMeta(projectId);
  if (!projectMeta) {
    throw new Error("プロジェクトが見つかりませんでした");
  }

  const [
    issues,
    comments,
    attachmentMeta,
    masters,
    searchIndexBlobs,
    wikis,
    documents,
    storedProjectIcon,
    projectMembers,
  ] = await Promise.all([
    getIssuesByProject(projectId),
    getCommentsByProject(projectId),
    getAttachmentMetaByProject(projectId),
    getMastersByProject(projectId),
    getSearchIndexByProject(projectId),
    getWikisByProject(projectId),
    getDocumentsByProject(projectId),
    getProjectIcon(projectId),
    getProjectMembersByProject(projectId),
  ]);

  const userIds = collectUserIds(
    issues,
    comments,
    wikis,
    documents,
    projectMembers,
  );
  const [users, icons] = await Promise.all([
    getUsersByIds(userIds),
    getUserIconsByIds(userIds),
  ]);

  const userIcons: ExportedUserIcon[] = await Promise.all(
    icons.map(async (icon) => ({
      userId: icon.userId,
      base64: await blobToBase64(icon.blob),
      contentType: icon.contentType,
    })),
  );

  // プロジェクトアイコン（あれば base64 内包。未取り込みなら省略）
  const projectIcon: ExportedProjectIcon | undefined = storedProjectIcon
    ? {
        base64: await blobToBase64(storedProjectIcon.blob),
        contentType: storedProjectIcon.contentType,
      }
    : undefined;

  // マスタを Backlog の表示順に並べ替えてから書き出す。
  // 取り込み側はファイル内の登場順で displayOrder を採番するので、ここで正しい順に
  // しておけば Backlog の並びがそのまま届く（例: 状態は 未対応 → 処理中 → 処理済み →
  // カスタム状態 → 完了。IndexedDB の読み出し順は id 順なので、そのままでは崩れる）。
  // displayOrder を持たないマスタ（プロジェクト定義から消えたが課題では使われている等）は
  // kind ごとの末尾に置く。
  const sortedMasters = [...masters].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const ao = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.master.id - b.master.id;
  });

  const searchIndex = searchIndexBlobs.map((b) => ({
    key: b.key,
    projectId: b.projectId,
    chunkKey: b.chunkKey,
    data: b.data,
  }));

  // --- 本文を Backlog 記法 → Markdown（中立スキーム）に変換 ---
  // IndexedDB は Backlog 記法のまま保持し、エクスポート出力だけ Markdown 化する
  // （Backlog のホストに依存しない可搬な参照にするため）。課題リンクは issue:${issueKey}、
  // メンションは mention:${name} の中立スキームで出力し、取り込み側が解決する。
  // Document.plain は元々標準 Markdown なので変換しない。
  const mentionNames = users.map((u) => u.name).filter(Boolean);
  const mdOpts = {
    projectKey: projectMeta.projectKey,
    mentionNames,
    linkScheme: "neutral" as const,
    // 本文に貼られたこのスペースの課題 URL（`/view/KEY-123#comment-…`）を課題リンクに変換する
    // ために渡す（v9）。渡さないと Backlog のホストを指す外部リンクとして残り、Backlog を
    // 解約した時点で参照が死ぬ。ホスト一致で判定するので別スペースの URL は変換されない。
    spaceUrl: projectMeta.spaceUrl,
  };
  const toMd = (text: string | null): string | null =>
    text == null ? text : backlogToMarkdown(text, mdOpts);

  const issuesMd = issues.map((it) => ({
    ...it,
    description: toMd(it.description) ?? "",
  }));
  const commentsMd = comments.map((c) => ({
    ...c,
    content: toMd(c.content),
  }));
  const wikisMd = wikis.map((w) => ({
    ...w,
    content: toMd(w.content) ?? "",
  }));

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    projectMeta,
    issues: issuesMd,
    comments: commentsMd,
    attachmentMeta,
    masters: sortedMasters,
    users,
    userIcons,
    searchIndex,
    wikis: wikisMd,
    documents,
    projectIcon,
    projectMembers,
  };
}

/** インポート結果のサマリ */
export interface ImportResult {
  projectId: number;
  projectKey: string;
  issueCount: number;
  commentCount: number;
  attachmentCount: number;
  wikiCount: number;
  documentCount: number;
  iconCount: number;
  memberCount: number;
  searchChunkCount: number;
}

/** インポート進捗の段階 */
export type ImportPhase =
  "parsing" | "storing-issues" | "storing-comments" | "storing-rest" | "done";

export interface ImportProgress {
  phase: ImportPhase;
  message: string;
}

/**
 * 書き出しファイル（パース済み JSON）を検証し、IndexedDB に投入する。
 * フォーマット不一致・バージョン非互換は例外。
 */
export async function importProject(
  parsed: unknown,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  onProgress?.({ phase: "parsing", message: "ファイルを検証中…" });
  const data = validateExport(parsed);

  const projectId = data.projectMeta.projectId;

  // 検索インデックスはインポート末尾で DB の全 kind から再構築する（rebuildSearchIndex が
  // clear→put する）。ここでの事前 clear は不要。

  onProgress?.({ phase: "storing-issues", message: "課題を保存中…" });
  // v3 で StoredIssue に milestones / versions を追加。旧ファイル（v2 以前）の課題には
  // これらが無いので空配列で補完する（フィルタの .some() が undefined で落ちないように）。
  const issues = data.issues.map((it) => ({
    ...it,
    milestones: it.milestones ?? [],
    versions: it.versions ?? [],
  }));
  await putIssues(issues);

  onProgress?.({ phase: "storing-comments", message: "コメントを保存中…" });
  await putComments(data.comments);

  onProgress?.({
    phase: "storing-rest",
    message: "ユーザー・アイコン・検索インデックスを保存中…",
  });
  await putAttachmentMeta(data.attachmentMeta);
  await putMasters(data.masters);
  await putUsers(data.users);

  const icons: StoredUserIcon[] = data.userIcons.map((ic) => ({
    userId: ic.userId,
    blob: base64ToBlob(ic.base64, ic.contentType),
    contentType: ic.contentType,
  }));
  await putUserIcons(icons);

  // プロジェクトアイコン（v4 で追加。旧 v3 以前のファイルには無いので任意）
  if (data.projectIcon) {
    const storedProjectIcon: StoredProjectIcon = {
      projectId,
      blob: base64ToBlob(data.projectIcon.base64, data.projectIcon.contentType),
      contentType: data.projectIcon.contentType,
    };
    await putProjectIcon(storedProjectIcon);
  }

  // プロジェクトメンバー（v5 で追加。旧 v4 以前のファイルには無いので任意）。
  // putProjectMembers はプロジェクト分をクリアしてから入れ直すので、空配列のときは呼ばない
  // （メンバー情報を持たない旧ファイルのインポートで、既存メンバーを消さないため）。
  if (data.projectMembers && data.projectMembers.length > 0) {
    await putProjectMembers(projectId, data.projectMembers);
  }

  // Wiki・ドキュメント（v2 で追加。v1 ファイルには無いので ?? [] で後方互換）
  const wikis = data.wikis ?? [];
  const documents = data.documents ?? [];
  if (wikis.length > 0) await putWikis(wikis);
  if (documents.length > 0) await putDocuments(documents);

  await putProjectMeta(data.projectMeta);

  // 検索インデックスは「ファイル内の searchIndex をそのまま使う」のではなく、投入後に
  // DB 内の全 kind（課題・コメント・Wiki・ドキュメント）から再構築する。
  // 理由: 古い v1 ファイル（Wiki/ドキュメントを含まない）をインポートしても、インポート先 DB に
  // 既存の Wiki/ドキュメントがあればそれらを検索に残す（ファイルの index で上書きして消さない）。
  // また同一プロジェクトを部分的に複数ファイルで足す場合も、常に DB の現状から正しく再構築できる。
  onProgress?.({
    phase: "storing-rest",
    message: "検索インデックスを再構築中…",
  });
  const [allIssues, allComments, allWikis, allDocuments] = await Promise.all([
    getIssuesByProject(projectId),
    getCommentsByProject(projectId),
    getWikisByProject(projectId),
    getDocumentsByProject(projectId),
  ]);
  const searchChunkCount = await rebuildSearchIndex(projectId, {
    issues: allIssues,
    comments: allComments,
    wikis: allWikis,
    documents: allDocuments,
  });

  onProgress?.({ phase: "done", message: "インポート完了" });

  return {
    projectId,
    projectKey: data.projectMeta.projectKey,
    issueCount: data.issues.length,
    commentCount: data.comments.length,
    attachmentCount: data.attachmentMeta.length,
    wikiCount: wikis.length,
    documentCount: documents.length,
    iconCount: icons.length,
    memberCount: data.projectMembers?.length ?? 0,
    searchChunkCount,
  };
}

/**
 * パース済み JSON が ProjectExport の形をしているか検証する。
 * any/unknown を表に出さず、必要なフィールドの型を絞り込んでから返す。
 */
function validateExport(parsed: unknown): ProjectExport {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("ファイルの形式が正しくありません");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.format !== EXPORT_FORMAT) {
    throw new Error("backlog-x の書き出しファイルではありません");
  }
  if (typeof obj.version !== "number" || obj.version > EXPORT_VERSION) {
    throw new Error(
      `この書き出しファイルのバージョン（${String(obj.version)}）には対応していません。アプリを更新してください`,
    );
  }
  const meta = obj.projectMeta;
  if (
    typeof meta !== "object" ||
    meta === null ||
    typeof (meta as Record<string, unknown>).projectId !== "number"
  ) {
    throw new Error("プロジェクト情報が壊れています");
  }
  // 配列フィールドの存在を確認（中身の要素型は IndexedDB 投入時に put がそのまま受ける）
  for (const field of [
    "issues",
    "comments",
    "attachmentMeta",
    "masters",
    "users",
    "userIcons",
    "searchIndex",
  ]) {
    if (!Array.isArray(obj[field])) {
      throw new Error(`データ（${field}）が壊れています`);
    }
  }
  // ここまで通れば構造は ProjectExport とみなせる
  return parsed as ProjectExport;
}

// --- 添付バイナリの zip エクスポート / インポート ---

/** 添付 zip の中に入れる manifest（zip 内ファイル名は attachmentId・元のファイル名は別途保持） */
interface AttachmentManifest {
  projectId: number;
  /** attachmentId(文字列) → 元のファイル名 */
  names: Record<string, string>;
}

/** fflate の zip をコールバック→Promise 化 */
function zipAsync(data: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(data, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

/** fflate の unzip をコールバック→Promise 化 */
function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

/**
 * OPFS に保存済みの添付バイナリを 1 つの zip にまとめて Blob で返す。
 * zip 内: <attachmentId> のファイル群 + manifest.json（id→元ファイル名）。
 * 添付バイナリは元々ほぼ非圧縮形式（画像・zip 等）が多いので level:0（無圧縮・束ねるだけ）にして速度優先。
 * 保存済み添付が無ければ null。
 */
export async function exportAttachmentsZip(
  projectId: number,
): Promise<Blob | null> {
  const ids = await listSavedAttachmentIds(projectId);
  if (ids.length === 0) return null;

  // 元ファイル名のマップを attachmentMeta から作る
  const metas = await getAttachmentMetaByProject(projectId);
  const nameById = new Map(metas.map((m) => [m.id, m.name]));

  const entries: Zippable = {};
  const names: Record<string, string> = {};
  for (const id of ids) {
    const blob = await getAttachmentBlob(projectId, id);
    if (!blob) continue;
    entries[String(id)] = new Uint8Array(await blob.arrayBuffer());
    names[String(id)] = nameById.get(id) ?? String(id);
  }

  const manifest: AttachmentManifest = { projectId, names };
  entries["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));

  const zipped = await zipAsync(entries);
  // fflate の Uint8Array を ArrayBuffer にコピーして Blob 化（buffer 型の厳格化回避）
  const ab = new ArrayBuffer(zipped.length);
  new Uint8Array(ab).set(zipped);
  return new Blob([ab], { type: "application/zip" });
}

/**
 * 添付 zip 内の manifest.json から projectId を読む（テキスト無しで zip 単体インポートする場合に使う）。
 * 読めなければ null。
 */
export async function readZipProjectId(zipBlob: Blob): Promise<number | null> {
  try {
    const bytes = new Uint8Array(await zipBlob.arrayBuffer());
    const unzipped = await unzipAsync(bytes);
    const manifestBytes = unzipped["manifest.json"];
    if (!manifestBytes) return null;
    const text = new TextDecoder().decode(manifestBytes);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      const pid = (parsed as Record<string, unknown>).projectId;
      if (typeof pid === "number") return pid;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 添付 zip（exportAttachmentsZip の出力）を展開して OPFS に保存する。
 * manifest.json は元ファイル名の参照用なので OPFS には保存しない（id がファイル名）。
 * 戻り値は保存した添付数。
 */
export async function importAttachmentsZip(
  projectId: number,
  zipBlob: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const bytes = new Uint8Array(await zipBlob.arrayBuffer());
  const unzipped = await unzipAsync(bytes);

  // 再インポートで古い添付が残らないようクリア
  await clearProjectAttachments(projectId);

  const ids = Object.keys(unzipped).filter((name) => name !== "manifest.json");
  let done = 0;
  for (const id of ids) {
    // fflate の Uint8Array を新規 ArrayBuffer にコピーしてから Blob 化（buffer 型の厳格化回避）。
    // new ArrayBuffer(...) は必ず ArrayBuffer（SharedArrayBuffer でない）なので型も満たす。
    const data = unzipped[id];
    const ab = new ArrayBuffer(data.length);
    new Uint8Array(ab).set(data);
    await saveAttachmentBlob(projectId, Number(id), new Blob([ab]));
    done++;
    onProgress?.(done, ids.length);
  }
  return ids.length;
}

// --- アイコン単体ファイル（.json.gz）のインポート ---

/** gunzip 済み JSON 文字列が「アイコン単体ファイル」かを判定する（format フィールドで識別） */
export function isIconsExport(parsed: unknown): parsed is IconsExport {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as Record<string, unknown>).format === ICONS_FORMAT &&
    Array.isArray((parsed as Record<string, unknown>).icons)
  );
}

/**
 * アイコン単体ファイル（CLI scripts/fetch-icons.mjs の出力を gunzip + parse したもの）を
 * userIcons（IndexedDB）に追加保存する。projectId に依存せず userId で put するため、
 * 課題インポートの前後どちらでも・単独でも実行できる（後からアイコンだけ足せる）。
 * 戻り値は保存したアイコン数。
 */
export async function importIcons(data: IconsExport): Promise<number> {
  const icons: StoredUserIcon[] = data.icons.map((ic) => ({
    userId: ic.userId,
    blob: base64ToBlob(ic.base64, ic.contentType),
    contentType: ic.contentType,
  }));
  await putUserIcons(icons);
  return icons.length;
}

/**
 * プロジェクト 1 件分の取り込み済みデータをすべて削除する。
 *
 * IndexedDB のレコード（課題・コメント・添付メタ・Wiki・ドキュメント・マスタ・メンバー・
 * 検索インデックス・プロジェクトアイコン・メタ）と、OPFS に保存した添付バイナリの両方を
 * 消す。片方だけ消すと「一覧には出ないのにストレージを食い続ける」状態になるため、
 * 必ずここを通す。
 *
 * サンプルデータを試した人が元に戻せるようにするための機能でもある（ブラウザのサイト
 * データ削除を案内せずに済ませる）。取り込みの逆操作なので ingest 層に置く。
 *
 * @returns 共有マスタ（users / userIcons）も消えたか（= プロジェクトが 0 件になった）
 */
export async function deleteProject(
  projectId: number,
): Promise<{ clearedSharedMasters: boolean }> {
  // 添付バイナリを先に消す。DB を先に消すと、途中で失敗したときに「消し残った
  // OPFS のディレクトリを特定する手がかり（projectMeta）」が無くなる。
  await clearProjectAttachments(projectId);
  return deleteProjectRecords(projectId);
}
