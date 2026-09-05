/**
 * 取り込みオーケストレーション（Backlog API から直接取得）。
 *
 * キー入力でブラウザが公式 Backlog API を叩き（CORS 検証済み・proxy 不要）、課題・コメント・
 * アイコンを取得して共通の persistArchive で正規化〜IndexedDB 投入する。
 *
 * 機微データはブラウザのメモリと IndexedDB に入るだけで、サーバーにもリポジトリにも渡らない。
 * API キーも同様にメモリ上を通過するだけで永続化しない。
 *
 * 取り込み済みアーカイブの共有（別メンバーへの配布）は projectArchive.ts の
 * exportProject / importProject（1 ファイルの書き出し・読み込み）で行う。
 */

"use client";

import type {
  BacklogIssue,
  BacklogComment,
  BacklogProject,
  BacklogWiki,
  BacklogDocument,
  BacklogProjectMasters,
} from "@/types/backlog";
import type { IngestSelection } from "@/types/ingest";
import type { BacklogDump, DumpedUserIcon } from "@/types/dump";
import { BACKLOG_DUMP_FORMAT, BACKLOG_DUMP_VERSION } from "@/types/dump";
import { blobToBase64, base64ToBlob } from "./binary";
import {
  BacklogApiClient,
  normalizeSpaceUrl,
  type ApiClientHooks,
} from "@/lib/backlog-api/client";
import {
  saveAttachmentBlob,
  clearProjectAttachments,
} from "@/lib/storage/opfs";
import type {
  ProjectMeta,
  StoredUser,
  StoredUserIcon,
  StoredProjectIcon,
  StoredProjectMember,
  StoredIssue,
  StoredComment,
  StoredWiki,
  StoredDocument,
} from "@/types/entities";
import type { MasterEntry } from "@/lib/db/schema";
import {
  normalizeIssue,
  normalizeComment,
  normalizeAttachments,
  normalizeWiki,
  normalizeDocument,
  normalizeUser,
} from "./normalize";
import {
  putIssues,
  putComments,
  putAttachmentMeta,
  putUsers,
  putUserIcons,
  putProjectIcon,
  putProjectMembers,
  putMasters,
  putProjectMeta,
  putWikis,
  putDocuments,
  getProjectMeta,
  getIssuesByProject,
  getCommentsByProject,
  getWikisByProject,
  getDocumentsByProject,
} from "@/lib/db/repositories";
import { rebuildSearchIndex } from "@/lib/search/rebuild";

/** 取り込みの進捗を UI に伝えるイベント */
export interface IngestProgress {
  phase:
    | "fetching-issues"
    | "storing-issues"
    | "fetching-comments"
    | "storing-comments"
    | "fetching-wikis"
    | "fetching-documents"
    | "fetching-icons"
    | "fetching-attachments"
    | "building-index"
    | "done";
  /** 現在フェーズの処理済み数 */
  current: number;
  /** 現在フェーズの総数（不明なら未設定） */
  total?: number;
  message: string;
}

export type IngestProgressCallback = (progress: IngestProgress) => void;

// 取り込む種類の選択。定義は @/types/ingest（ダンプのスキーマからも参照するため types 側にある）。
// 従来この型を seed.ts から import していた箇所を壊さないよう re-export する。
export type { IngestSelection };

/**
 * 課題・コメント・Wiki・ドキュメントから全文検索インデックスを再構築する。
 * 実体は @/lib/search/rebuild の rebuildSearchIndex に委譲し、進捗を IngestProgress にマップする
 * （API 取り込みとファイルインポートで同じ再構築ロジックを共有するため）。
 */
async function ingestSearchIndex(
  projectId: number,
  issues: StoredIssue[],
  comments: StoredComment[],
  wikis: StoredWiki[],
  documents: StoredDocument[],
  onProgress?: IngestProgressCallback,
): Promise<number> {
  onProgress?.({
    phase: "building-index",
    current: 0,
    message: "検索インデックスを構築中…（取り込み時の一度だけ）",
  });
  return rebuildSearchIndex(
    projectId,
    { issues, comments, wikis, documents },
    (done, total) =>
      onProgress?.({
        phase: "building-index",
        current: done,
        total,
        message: "検索インデックスを構築中…（取り込み時の一度だけ）",
      }),
  );
}

/** 取り込み結果のサマリ */
export interface IngestResult {
  projectId: number;
  projectKey: string;
  issueCount: number;
  commentCount: number;
  attachmentCount: number;
  wikiCount: number;
  documentCount: number;
  iconCount: number;
  /** 取り込んだプロジェクトメンバー数（参加者 + roleType） */
  memberCount: number;
  /** 検索インデックスに索引したドキュメント数 */
  searchDocCount: number;
}

/**
 * 取得済みの生データをメモリ上で正規化し、選択された種類だけ IndexedDB へ投入して
 * 検索インデックスを再構築する。データの「取得元」（フォルダ / API）に依存しない共通の永続化処理。
 *
 * 部分取り込み（selection で一部の種類だけ ON）に対応する:
 * - 選択した種類だけを今回取得分で差し替え、未選択の種類は既存 DB データを保持する。
 * - 検索インデックスは projectId 単位で clear→put のため、部分だけ索引すると未選択 kind の
 *   検索が消える。今回取得分 + 既存 DB の未選択分をマージして全 kind で 1 回再構築する。
 * - projectId/projectKey/name は project（BacklogProject）から得る（課題 0 件でも成立）。
 */
async function persistArchive(
  project: BacklogProject,
  selection: IngestSelection,
  /** プロジェクト定義のマスタ（ダンプ v2 以降。無ければ課題からの逆算だけになる） */
  masters: BacklogProjectMasters | undefined,
  rawIssues: BacklogIssue[],
  rawComments: BacklogComment[],
  rawWikis: BacklogWiki[],
  rawDocuments: BacklogDocument[],
  icons: StoredUserIcon[],
  projectIcon: StoredProjectIcon | null,
  members: StoredProjectMember[],
  memberUsers: StoredUser[],
  spaceUrl: string | undefined,
  onProgress?: IngestProgressCallback,
): Promise<IngestResult> {
  const projectId = project.id;
  const projectKey = project.projectKey;
  const projectName = project.name;

  // ユーザー・マスタを収集（重複排除）。全種類横断で集めるため分岐の外で宣言。
  const userMap = new Map<number, StoredUser>();
  const masterMap = new Map<string, MasterEntry>();
  const addUser = (u: StoredUser | null) => {
    if (u) userMap.set(u.id, u);
  };
  // 同じマスタは後勝ちで上書きする（課題側の値の方が新しいことがある）。ただし displayOrder は
  // プロジェクト定義からしか得られないので、課題からの逆算（displayOrder 無し）で潰さない。
  const addMaster = (entry: MasterEntry) => {
    const prev = masterMap.get(entry.key);
    masterMap.set(entry.key, {
      ...entry,
      displayOrder: entry.displayOrder ?? prev?.displayOrder,
    });
  };

  // プロジェクトメンバーのユーザーも users ストアに含める。課題・コメントを 1 件も投稿して
  // いないメンバー（例: ビューアー権限）でも、userId で名前・メールを引けるようにするため。
  for (const u of memberUsers) addUser(u);

  // --- プロジェクト定義のマスタを先に入れる（課題からの逆算より前） ---
  // 課題に出現したマスタだけを集めると「定義されているが未使用のマスタ」が落ちる。例えば全課題が
  // 「完了」のプロジェクトでは状態が 1 件しか集まらず、取り込み先で状態を変更できず絞り込みにも
  // 出せない（TH7 で実際に発生）。定義側を基礎に置き、このあと課題から拾ったぶんを重ねる
  // （＝定義から消えたが課題では使われている古いマスタも落とさない）。
  // masters はダンプ v2 で追加。v1 ダンプ・取得失敗時は undefined で、従来どおり逆算のみになる。
  // displayOrder も一緒に保存する（Backlog の並びを再現するため。詳細は MasterEntry の定義）。
  if (masters) {
    for (const s of masters.statuses) {
      addMaster({
        key: `${projectId}:status:${s.id}`,
        projectId,
        kind: "status",
        master: { id: s.id, name: s.name, color: s.color },
        displayOrder: s.displayOrder,
      });
    }
    for (const t of masters.issueTypes) {
      addMaster({
        key: `${projectId}:issueType:${t.id}`,
        projectId,
        kind: "issueType",
        master: { id: t.id, name: t.name, color: t.color },
        displayOrder: t.displayOrder,
      });
    }
    for (const c of masters.categories) {
      addMaster({
        key: `${projectId}:category:${c.id}`,
        projectId,
        kind: "category",
        master: { id: c.id, name: c.name },
        displayOrder: c.displayOrder,
      });
    }
    // Backlog はバージョンとマイルストーンに同じマスタを使う（課題側は milestone[] と
    // versions[] に分かれて入る）ので、定義ぶんは両方の kind に登録する。
    for (const v of masters.versions) {
      addMaster({
        key: `${projectId}:milestone:${v.id}`,
        projectId,
        kind: "milestone",
        master: { id: v.id, name: v.name },
        displayOrder: v.displayOrder,
      });
      addMaster({
        key: `${projectId}:version:${v.id}`,
        projectId,
        kind: "version",
        master: { id: v.id, name: v.name },
        displayOrder: v.displayOrder,
      });
    }
    // 優先度・完了理由はスペース共通で displayOrder を持たないため、API が返した順を採番する。
    masters.priorities.forEach((p, i) => {
      addMaster({
        key: `${projectId}:priority:${p.id}`,
        projectId,
        kind: "priority",
        master: { id: p.id, name: p.name },
        displayOrder: i,
      });
    });
    masters.resolutions.forEach((r, i) => {
      addMaster({
        key: `${projectId}:resolution:${r.id}`,
        projectId,
        kind: "resolution",
        master: { id: r.id, name: r.name },
        displayOrder: i,
      });
    });
  }

  // --- 課題（添付メタは課題に内包。selection.issues で一括ガード） ---
  const issues: StoredIssue[] = selection.issues
    ? rawIssues.map((raw) => {
        const issue = normalizeIssue(raw);
        addUser(issue.createdUser);
        addUser(issue.updatedUser);
        addUser(issue.assignee);
        addMaster({
          key: `${projectId}:status:${issue.status.id}`,
          projectId,
          kind: "status",
          master: issue.status,
        });
        addMaster({
          key: `${projectId}:issueType:${issue.issueType.id}`,
          projectId,
          kind: "issueType",
          master: issue.issueType,
        });
        if (issue.priority) {
          addMaster({
            key: `${projectId}:priority:${issue.priority.id}`,
            projectId,
            kind: "priority",
            master: issue.priority,
          });
        }
        for (const cat of issue.category) {
          addMaster({
            key: `${projectId}:category:${cat.id}`,
            projectId,
            kind: "category",
            master: cat,
          });
        }
        for (const ms of issue.milestones) {
          addMaster({
            key: `${projectId}:milestone:${ms.id}`,
            projectId,
            kind: "milestone",
            master: ms,
          });
        }
        for (const ver of issue.versions) {
          addMaster({
            key: `${projectId}:version:${ver.id}`,
            projectId,
            kind: "version",
            master: ver,
          });
        }
        return issue;
      })
    : [];

  const attachments = selection.issues
    ? rawIssues.flatMap(normalizeAttachments)
    : [];

  // --- コメント（課題 ON かつコメント ON のときだけ） ---
  const storedComments: StoredComment[] =
    selection.issues && selection.comments
      ? rawComments.map((raw) => {
          const c = normalizeComment(raw);
          addUser(c.createdUser);
          return c;
        })
      : [];

  // --- Wiki ---
  const storedWikis: StoredWiki[] = selection.wikis
    ? rawWikis.map((raw) => {
        const w = normalizeWiki(raw);
        addUser(w.createdUser);
        addUser(w.updatedUser);
        return w;
      })
    : [];

  // --- ドキュメント ---
  // Backlog の /documents?projectIdOrKey= は**他プロジェクトのドキュメントを混ぜて返すことがある**
  // （TH7 で実測）。収集側（fetchDocumentsFromApi）でも弾いているが、ここでも projectId を検証する:
  // ①既に作られたダンプ（混入したまま保存されている）からの取り込みを無害化するため
  // ②他プロジェクトのデータが混ざると一覧に出ない“見えないゴミ”になり、件数だけズレるため。
  const projectDocuments = rawDocuments.filter(
    (d) => d.projectId === projectId,
  );
  const storedDocuments: StoredDocument[] = selection.documents
    ? projectDocuments.map((raw) => {
        const d = normalizeDocument(raw);
        addUser(d.createdUser);
        addUser(d.updatedUser);
        return d;
      })
    : [];

  // --- ユーザー・マスタは全種類ぶん集めてから 1 回 put（コメント/Wiki のみ取り込みでも投稿者を保存） ---
  await putUsers([...userMap.values()]);
  await putMasters([...masterMap.values()]);

  // --- 課題・添付メタを投入（selection.issues） ---
  if (selection.issues) {
    onProgress?.({
      phase: "storing-issues",
      current: 0,
      total: issues.length,
      message: "課題を保存中…",
    });
    await putAttachmentMeta(attachments);
    await putIssues(issues, (done, total) =>
      onProgress?.({
        phase: "storing-issues",
        current: done,
        total,
        message: "課題を保存中…",
      }),
    );

    if (selection.comments && storedComments.length > 0) {
      onProgress?.({
        phase: "storing-comments",
        current: 0,
        total: storedComments.length,
        message: "コメントを保存中…",
      });
      await putComments(storedComments, (done, total) =>
        onProgress?.({
          phase: "storing-comments",
          current: done,
          total,
          message: "コメントを保存中…",
        }),
      );
    }
  }

  // --- Wiki・ドキュメントを投入（あれば） ---
  if (selection.wikis && storedWikis.length > 0) {
    await putWikis(storedWikis);
  }
  if (selection.documents && storedDocuments.length > 0) {
    await putDocuments(storedDocuments);
  }

  // --- ユーザーアイコンを投入（あれば） ---
  if (icons.length > 0) {
    await putUserIcons(icons);
  }
  const iconCount = icons.length;

  // --- プロジェクトアイコンを投入（取得できていれば・projectId で 1 枚） ---
  if (projectIcon) {
    await putProjectIcon(projectIcon);
  }

  // --- プロジェクトメンバー（参加者 + roleType）を投入 ---
  // members が空のときは put しない（putProjectMembers はプロジェクト分をクリアするので、
  // メンバー取得に失敗/未取得のときに既存のメンバー情報を消してしまわないようにする）。
  if (members.length > 0) {
    await putProjectMembers(projectId, members);
  }

  // --- 全文検索インデックスを再構築・保存（kuromoji 分かち書きが走るので時間がかかる） ---
  // 取り込んだ kind は今回取得分、未取り込みの kind は既存 DB から読んでマージし、全 kind を
  // まとめて 1 回で索引する（projectId 単位の clear→put なので部分だけ索引すると他 kind が消える）。
  const indexIssues = selection.issues
    ? issues
    : await getIssuesByProject(projectId);
  const indexComments =
    selection.issues && selection.comments
      ? storedComments
      : await getCommentsByProject(projectId);
  const indexWikis = selection.wikis
    ? storedWikis
    : await getWikisByProject(projectId);
  const indexDocuments = selection.documents
    ? storedDocuments
    : await getDocumentsByProject(projectId);

  const searchDocCount = await ingestSearchIndex(
    projectId,
    indexIssues,
    indexComments,
    indexWikis,
    indexDocuments,
    onProgress,
  );

  // --- プロジェクトメタを保存（取り込まなかった種類の件数は既存値を保持） ---
  const existing = await getProjectMeta(projectId);
  const meta: ProjectMeta = {
    projectId,
    projectKey,
    name: projectName && projectName.trim() !== "" ? projectName : projectKey,
    issueCount: selection.issues ? issues.length : (existing?.issueCount ?? 0),
    commentCount:
      selection.issues && selection.comments
        ? storedComments.length
        : (existing?.commentCount ?? 0),
    attachmentCount: selection.issues
      ? attachments.length
      : (existing?.attachmentCount ?? 0),
    wikiCount: selection.wikis
      ? storedWikis.length
      : (existing?.wikiCount ?? 0),
    documentCount: selection.documents
      ? storedDocuments.length
      : (existing?.documentCount ?? 0),
    spaceUrl:
      spaceUrl && spaceUrl.trim() !== "" ? spaceUrl : existing?.spaceUrl,
    lastImportedAt: new Date().toISOString(),
  };
  await putProjectMeta(meta);

  onProgress?.({
    phase: "done",
    current: meta.issueCount,
    message: "取り込み完了",
  });

  return {
    projectId,
    projectKey,
    issueCount: meta.issueCount,
    commentCount: meta.commentCount,
    attachmentCount: meta.attachmentCount,
    wikiCount: meta.wikiCount ?? 0,
    documentCount: meta.documentCount ?? 0,
    iconCount,
    memberCount: members.length,
    searchDocCount,
  };
}

/**
 * 指定プロジェクトの全 Wiki を取得する。一覧は本文 content が空なので、各 Wiki の詳細
 * （/wikis/:id）を取得して本文を埋める（read 枠）。一覧は search 枠で 1 リクエスト。
 */
async function fetchWikisFromApi(
  client: BacklogApiClient,
  projectId: number,
  onProgress?: IngestProgressCallback,
): Promise<BacklogWiki[]> {
  onProgress?.({
    phase: "fetching-wikis",
    current: 0,
    message: "Wiki を取得中…",
  });
  const list = await client.getAllWikis(projectId);
  const detailed: BacklogWiki[] = [];
  let done = 0;
  for (const w of list) {
    try {
      detailed.push(await client.getWikiDetail(w.id));
    } catch {
      // 個別 Wiki の取得失敗はスキップ（一覧の本文空のままでは索引価値が無いので落とす）
    }
    done++;
    onProgress?.({
      phase: "fetching-wikis",
      current: done,
      total: list.length,
      message: `Wiki を取得中… ${done}/${list.length}`,
    });
  }
  return detailed;
}

/**
 * 指定プロジェクトの全ドキュメントを取得する。一覧レスポンスに本文 plain が含まれるため
 * 詳細取得は不要（1 リクエスト）。エンドポイントは /documents?projectIdOrKey=。
 * ドキュメント機能を使っていないプロジェクトでは 4xx になりうるので、失敗は空配列にフォールバック。
 *
 * ⚠️ **`projectIdOrKey` を渡しても他プロジェクトのドキュメントが混ざって返ることがある**
 * （TH7 の取得で実測。projectId=1073816752 を指定したのに別プロジェクト 1073870442 の
 * ドキュメントが 1 件含まれていた）。他プロジェクトのデータを取り込む＝アーカイブの汚染で、
 * ダンプを配布したときの情報漏れにもなるため、**受け取った側で projectId を検証して捨てる**。
 */
async function fetchDocumentsFromApi(
  client: BacklogApiClient,
  projectId: number,
  onProgress?: IngestProgressCallback,
): Promise<BacklogDocument[]> {
  onProgress?.({
    phase: "fetching-documents",
    current: 0,
    message: "ドキュメントを取得中…",
  });
  try {
    const all = await client.getAllDocuments(projectId);
    const docs = all.filter((d) => d.projectId === projectId);
    onProgress?.({
      phase: "fetching-documents",
      current: docs.length,
      total: docs.length,
      message: `ドキュメントを取得中… ${docs.length} 件`,
    });
    return docs;
  } catch {
    // ドキュメント未使用プロジェクト等で失敗しても取り込み全体は続行する
    return [];
  }
}

/**
 * プロジェクトの参加メンバー + 権限（roleType）を API 取得する（read 枠・1 リクエスト）。
 * `GET /projects/:id/users` の各メンバーから、保存用の StoredProjectMember（projectId + userId +
 * roleType）と、名前・メールを引くための StoredUser を作って返す。
 *
 * メンバー取得は取り込みの本筋（課題・コメント）ではないので、失敗しても全体を止めない
 * （権限機能を使っていないスペース・一部プロジェクトで 4xx になっても空で返して続行）。
 */
async function fetchMembersFromApi(
  client: BacklogApiClient,
  projectId: number,
): Promise<{ members: StoredProjectMember[]; memberUsers: StoredUser[] }> {
  try {
    const users = await client.getProjectUsers(projectId);
    const members: StoredProjectMember[] = users.map((u) => ({
      projectId,
      userId: u.id,
      roleType: u.roleType,
    }));
    const memberUsers = users.map(normalizeUser);
    return { members, memberUsers };
  } catch {
    return { members: [], memberUsers: [] };
  }
}

/**
 * 課題・コメント・Wiki・ドキュメントの投稿者／担当者、および extraUserIds（プロジェクト
 * メンバー等）から登場ユーザー id を集めて、アイコンを API 取得する。
 * icon は専用枠（read 枠とは別）。取得失敗（未設定・404）は静かにスキップ。
 *
 * extraUserIds は「一度も投稿していない現メンバー」のアイコンも取り込むために渡す。投稿者は
 * createdUser 等から拾えるが、未投稿メンバーはどの raw にも現れないため別途 userId を足す
 * （エクスポートで users マスタと突き合わせられるように）。
 */
async function fetchIconsFromApi(
  client: BacklogApiClient,
  rawIssues: BacklogIssue[],
  rawComments: BacklogComment[],
  rawWikis: BacklogWiki[],
  rawDocuments: BacklogDocument[],
  extraUserIds: number[],
  onProgress?: IngestProgressCallback,
): Promise<StoredUserIcon[]> {
  const userIds = new Set<number>();
  for (const issue of rawIssues) {
    if (issue.createdUser) userIds.add(issue.createdUser.id);
    if (issue.updatedUser) userIds.add(issue.updatedUser.id);
    if (issue.assignee) userIds.add(issue.assignee.id);
  }
  for (const c of rawComments) {
    if (c.createdUser) userIds.add(c.createdUser.id);
  }
  for (const w of rawWikis) {
    if (w.createdUser) userIds.add(w.createdUser.id);
    if (w.updatedUser) userIds.add(w.updatedUser.id);
  }
  for (const d of rawDocuments) {
    if (d.createdUser) userIds.add(d.createdUser.id);
    if (d.updatedUser) userIds.add(d.updatedUser.id);
  }
  for (const id of extraUserIds) userIds.add(id);

  const ids = [...userIds];
  const icons: StoredUserIcon[] = [];
  let done = 0;
  for (const userId of ids) {
    const result = await client.getUserIcon(userId);
    if (result) {
      icons.push({
        userId,
        blob: result.blob,
        contentType: result.contentType,
      });
    }
    done++;
    onProgress?.({
      phase: "fetching-icons",
      current: done,
      total: ids.length,
      message: `アイコンを取得中… ${done}/${ids.length}`,
    });
  }
  return icons;
}

/**
 * 各課題の現存添付バイナリを取得し、OPFS に保存する（read 枠）。
 * 課題本体の attachments[] が現存添付。削除済みは API で取れない（404 → スキップ）。
 * 大容量（実測で 993MB）になりうるので進捗を細かく返す。
 */
async function fetchAttachmentsFromApi(
  client: BacklogApiClient,
  projectId: number,
  rawIssues: BacklogIssue[],
  onProgress?: IngestProgressCallback,
): Promise<number> {
  // (issueId, attachmentId) のペアを平坦化
  const targets: { issueId: number; attachmentId: number }[] = [];
  for (const issue of rawIssues) {
    for (const att of issue.attachments) {
      targets.push({ issueId: issue.id, attachmentId: att.id });
    }
  }

  // 再取り込みで古い添付が残らないよう、保存前にプロジェクト分をクリア
  await clearProjectAttachments(projectId);

  let saved = 0;
  let done = 0;
  for (const { issueId, attachmentId } of targets) {
    try {
      const blob = await client.getIssueAttachment(issueId, attachmentId);
      if (blob) {
        await saveAttachmentBlob(projectId, attachmentId, blob);
        saved++;
      }
    } catch {
      // 個別の失敗（404 以外のエラー等）はスキップして続行
    }
    done++;
    onProgress?.({
      phase: "fetching-attachments",
      current: done,
      total: targets.length,
      message: `添付ファイルを取得中… ${done}/${targets.length}`,
    });
  }
  return saved;
}

/**
 * Backlog API から 1 プロジェクトの生データ（課題 + 全コメント + Wiki + ドキュメント +
 * メンバー + アイコン）を**収集**して Backlog ダンプにまとめる。**IndexedDB への投入はしない**
 * （＝この関数は「収集フェーズ」だけを担う。投入は ingestFromDump が担う）。
 *
 * CORS 検証済みのためブラウザから直接 API を叩く（proxy 不要）。
 *
 * 例外: 添付バイナリだけはここで OPFS に保存する（全件をメモリに載せると容量が持たないため。
 * ダンプに添付を入れるときは、保存済みの OPFS から exportAttachmentsZip で zip を作る）。
 *
 * @param spaceUrl  スペース URL（例 "https://example.backlog.jp"）
 * @param apiKey    管理者の API キー（メモリ上の値。永続化しない）
 * @param project   取り込む対象プロジェクト（id/projectKey/name を使う）
 * @param selection 取得する種類の選択（課題・コメント・添付・Wiki・ドキュメント）
 */
export async function fetchRawFromApi(
  spaceUrl: string,
  apiKey: string,
  project: BacklogProject,
  selection: IngestSelection,
  onProgress?: IngestProgressCallback,
): Promise<BacklogDump> {
  const hooks: ApiClientHooks = {
    onThrottle: ({ waitMs }) =>
      onProgress?.({
        phase: "fetching-comments",
        current: 0,
        message: `レート制限のため ${Math.ceil(waitMs / 1000)} 秒待機中…`,
      }),
  };
  const client = new BacklogApiClient(spaceUrl, apiKey, hooks);

  // --- 課題を取得（search 枠・100 件ページング。selection.issues のときだけ） ---
  let rawIssues: BacklogIssue[] = [];
  if (selection.issues) {
    onProgress?.({
      phase: "fetching-issues",
      current: 0,
      message: "課題を取得中…",
    });
    rawIssues = await client.getAllIssues(project.id, (fetched) =>
      onProgress?.({
        phase: "fetching-issues",
        current: fetched,
        message: `課題を取得中… ${fetched} 件`,
      }),
    );
    if (rawIssues.length === 0) {
      throw new Error(
        `プロジェクト ${project.projectKey} に課題がありませんでした`,
      );
    }
  }

  // --- 各課題のコメントを取得（read 枠・minId ページング。課題 ON かつコメント ON のとき） ---
  const rawComments: BacklogComment[] = [];
  if (selection.issues && selection.comments) {
    onProgress?.({
      phase: "fetching-comments",
      current: 0,
      total: rawIssues.length,
      message: "コメントを取得中…",
    });
    let issueDone = 0;
    for (const issue of rawIssues) {
      const comments = await client.getIssueComments(issue.id);
      rawComments.push(...comments);
      issueDone++;
      onProgress?.({
        phase: "fetching-comments",
        current: issueDone,
        total: rawIssues.length,
        message: `コメントを取得中… ${issueDone}/${rawIssues.length} 課題（${rawComments.length} 件）`,
      });
    }
  }

  // --- Wiki を取得（一覧 search 枠 + 各詳細 read 枠で本文取得） ---
  const rawWikis = selection.wikis
    ? await fetchWikisFromApi(client, project.id, onProgress)
    : [];

  // --- ドキュメントを取得（/documents?projectIdOrKey=・本文 plain 同梱・失敗は空配列） ---
  const rawDocuments = selection.documents
    ? await fetchDocumentsFromApi(client, project.id, onProgress)
    : [];

  // --- プロジェクト定義のマスタを取得（read 枠・6 リクエスト。個別失敗は空配列） ---
  // 課題からの逆算では拾えない「定義済みだが未使用のマスタ」を取り込むため（TH7 で全課題が
  // 「完了」だったせいで状態が 1 件しか入らず、取り込み先で状態を変更できなくなった）。
  const masters = await client.getProjectMasters(project.id);

  // --- プロジェクトメンバー + 権限を取得（read 枠・1 リクエスト。失敗しても取り込みは続行） ---
  // 「誰がこのプロジェクトに参加していて何の権限か」を roleType 付きで保存する（エクスポート用）。
  // アイコン取得より先に取り、未投稿メンバーの userId もアイコン取得対象に含める。
  const { members, memberUsers } = await fetchMembersFromApi(
    client,
    project.id,
  );

  // --- アイコンを取得（icon 枠。失敗はスキップ。各 raw の登場ユーザー + メンバーが対象） ---
  // メンバー（memberUsers）の id も渡すことで、一度も投稿していない現メンバーのアイコンも取り込む。
  const icons = await fetchIconsFromApi(
    client,
    rawIssues,
    rawComments,
    rawWikis,
    rawDocuments,
    memberUsers.map((u) => u.id),
    onProgress,
  );

  // --- プロジェクトアイコンを取得（icon 枠・1 リクエスト。未設定/失敗は null＝取り込みは続行） ---
  const iconResult = await client.getProjectIcon(project.id);

  // --- 添付バイナリを取得（課題 ON かつ添付 ON・read 枠・OPFS 保存。大容量になりうる） ---
  if (selection.issues && selection.attachments) {
    await fetchAttachmentsFromApi(client, project.id, rawIssues, onProgress);
  }

  // --- 収集結果をダンプにまとめて返す（画像は JSON に入らないので base64 化） ---
  const userIcons: DumpedUserIcon[] = await Promise.all(
    icons.map(async (icon) => ({
      userId: icon.userId,
      base64: await blobToBase64(icon.blob),
      contentType: icon.contentType,
    })),
  );

  return {
    format: BACKLOG_DUMP_FORMAT,
    version: BACKLOG_DUMP_VERSION,
    dumpedAt: new Date().toISOString(),
    // 原本リンク用にスペース URL を正規化して持つ（取り込み時に projectMeta へ引き継ぐ）
    spaceUrl: normalizeSpaceUrl(spaceUrl),
    project,
    selection,
    masters,
    rawIssues,
    rawComments,
    rawWikis,
    rawDocuments,
    members,
    memberUsers,
    userIcons,
    projectIcon: iconResult
      ? {
          base64: await blobToBase64(iconResult.blob),
          contentType: iconResult.contentType,
        }
      : null,
  };
}

/**
 * Backlog ダンプ（生レスポンス）を IndexedDB へ取り込む。**取り込みの本体**。
 *
 * API 経由（ingestFromApi）もダンプファイル経由（BacklogDumpImporter）も必ずこの関数を通る
 * ＝両経路がまったく同じ正規化・永続化処理（persistArchive）を共有する。ダンプで再現した挙動が
 * API 経由と一致することが構造的に保証されるので、ダンプは不具合調査のリグレッション素材になる。
 *
 * @param selection 取り込む種類。省略時はダンプ取得時の選択（dump.selection）をそのまま使う。
 *                  ダンプに含まれていない種類を ON にしても、その種類は空で取り込まれる
 *                  （＝既存 DB のデータを空で上書きしないよう UI 側で ON にしないこと）。
 */
export async function ingestFromDump(
  dump: BacklogDump,
  onProgress?: IngestProgressCallback,
  selection?: IngestSelection,
): Promise<IngestResult> {
  const icons: StoredUserIcon[] = dump.userIcons.map((ic) => ({
    userId: ic.userId,
    blob: base64ToBlob(ic.base64, ic.contentType),
    contentType: ic.contentType,
  }));
  const projectIcon: StoredProjectIcon | null = dump.projectIcon
    ? {
        projectId: dump.project.id,
        blob: base64ToBlob(
          dump.projectIcon.base64,
          dump.projectIcon.contentType,
        ),
        contentType: dump.projectIcon.contentType,
      }
    : null;

  return persistArchive(
    dump.project,
    selection ?? dump.selection,
    dump.masters,
    dump.rawIssues,
    dump.rawComments,
    dump.rawWikis,
    dump.rawDocuments,
    icons,
    projectIcon,
    dump.members,
    dump.memberUsers,
    dump.spaceUrl,
    onProgress,
  );
}

/**
 * Backlog API から 1 プロジェクトのフルアーカイブを取得して IndexedDB へ取り込む。
 * 「収集（fetchRawFromApi）→ 取り込み（ingestFromDump）」の合成にすぎない。
 *
 * @param onRawFetched 収集が終わった時点（**取り込みに入る前**）に呼ばれる。ここでダンプを
 *   ファイルに保存しておけば、取り込みが途中で失敗しても API を叩き直さずに再現・再試行できる。
 */
export async function ingestFromApi(
  spaceUrl: string,
  apiKey: string,
  project: BacklogProject,
  selection: IngestSelection,
  onProgress?: IngestProgressCallback,
  onRawFetched?: (dump: BacklogDump) => Promise<void> | void,
): Promise<IngestResult> {
  const dump = await fetchRawFromApi(
    spaceUrl,
    apiKey,
    project,
    selection,
    onProgress,
  );
  await onRawFetched?.(dump);
  return ingestFromDump(dump, onProgress);
}

/**
 * API キーを検証し、取り込み可能なプロジェクト一覧を返す。
 * キーが無効なら BacklogApiError（401）を投げる。
 */
export async function listProjectsFromApi(
  spaceUrl: string,
  apiKey: string,
): Promise<BacklogProject[]> {
  const client = new BacklogApiClient(spaceUrl, apiKey);
  await client.getMyself(); // 認証確認（無効キーはここで 401）
  return client.getProjects();
}
