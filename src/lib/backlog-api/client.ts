/**
 * ブラウザから直接叩く Backlog API v2 クライアント。
 *
 * CORS は検証済み（2026-06-26）: localhost オリジンから `apiKey` クエリ付き単純 GET で
 * レスポンス本体を読める = proxy 不要でブラウザ完結できる。カスタムヘッダを付けない
 * （= preflight を発生させない）ため、必ずクエリパラメータ方式で apiKey を渡す。
 *
 * 適応スロットリング: 各レスポンスの X-RateLimit-Remaining / -Reset を見て、残量が乏しければ
 * reset まで先回りで待つ。429 は指数バックオフでリトライ。PoC で実データ 1 プロジェクト
 * 全件（課題 4,511 + コメント 60,955）を 429 ゼロで完遂したロジックの移植。
 *
 * API キーはこのクライアントのインスタンスが保持するだけで、永続化しない（呼び出し側が
 * メモリ上の値を渡す）。URL クエリに載るため、ログ・例外メッセージにキーを含めないこと。
 */

import type {
  BacklogProject,
  BacklogIssue,
  BacklogComment,
  BacklogUser,
  BacklogWiki,
  BacklogDocument,
  BacklogStatus,
  BacklogIssueType,
  BacklogCategory,
  BacklogVersion,
  BacklogPriority,
  BacklogResolution,
  BacklogProjectMasters,
} from "@/types/backlog";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** API 呼び出し中に進捗・待機を呼び出し側へ伝えるためのコールバック */
export interface ApiClientHooks {
  /** レート枠が尽きて待機する直前に呼ばれる（残量 0 付近の throttle / 429 バックオフ） */
  onThrottle?: (info: {
    reason: "throttle" | "rate-limit";
    waitMs: number;
    remaining: number;
  }) => void;
}

export class BacklogApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BacklogApiError";
    this.status = status;
  }
}

export class BacklogApiClient {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly hooks: ApiClientHooks;

  /**
   * @param spaceUrl スペースの URL（例 "https://example.backlog.jp" または "example.backlog.jp"）
   * @param apiKey   管理者の API キー（メモリ上の値。永続化しない）
   */
  constructor(spaceUrl: string, apiKey: string, hooks: ApiClientHooks = {}) {
    this.base = normalizeSpaceUrl(spaceUrl);
    this.apiKey = apiKey;
    this.hooks = hooks;
  }

  /** 適応スロットリング + 429 バックオフつきの GET。path は "/projects" のように先頭スラッシュ込み */
  private async get<T>(path: string, retries = 5): Promise<T> {
    let attempt = 0;
    for (;;) {
      const sep = path.includes("?") ? "&" : "?";
      const url = `${this.base}/api/v2${path}${sep}apiKey=${encodeURIComponent(this.apiKey)}`;
      const res = await fetch(url, { method: "GET" });

      const remaining = Number(res.headers.get("x-ratelimit-remaining"));
      const reset = Number(res.headers.get("x-ratelimit-reset")); // UNIX 秒

      if (res.status === 429) {
        if (attempt >= retries) {
          throw new BacklogApiError(
            429,
            `レート制限の上限に達しました（${redactPath(path)}）`,
          );
        }
        const backoff = Math.min(60_000, 1000 * 2 ** attempt);
        const waitMs = Number.isFinite(reset)
          ? Math.max(backoff, reset * 1000 - Date.now() + 500)
          : backoff;
        this.hooks.onThrottle?.({ reason: "rate-limit", waitMs, remaining: 0 });
        await sleep(waitMs);
        attempt++;
        continue;
      }

      if (res.status === 401) {
        throw new BacklogApiError(
          401,
          "API キーが正しくありません（認証に失敗しました）",
        );
      }
      if (!res.ok) {
        // レスポンス本文にキーは含まれないが、URL を露出しないようパスのみ示す
        throw new BacklogApiError(
          res.status,
          `Backlog API エラー ${res.status}（${redactPath(path)}）`,
        );
      }

      const data = (await res.json()) as T;

      // 残量が乏しければ reset まで先回りで待つ（429 を避ける適応スロットリング）
      if (
        Number.isFinite(remaining) &&
        remaining <= 2 &&
        Number.isFinite(reset)
      ) {
        const waitMs = Math.max(0, reset * 1000 - Date.now() + 500);
        if (waitMs > 0) {
          this.hooks.onThrottle?.({ reason: "throttle", waitMs, remaining });
          await sleep(waitMs);
        }
      }
      return data;
    }
  }

  /** 認証確認（キーの有効性チェック）。失敗時は BacklogApiError を投げる */
  async getMyself(): Promise<BacklogUser> {
    return this.get<BacklogUser>("/users/myself");
  }

  /**
   * 自分が参加しているプロジェクト一覧。取り込み対象の選択に使う。
   * archived パラメータは省略する（指定しないと archived 済みも含めて全件返る。
   * `archived=all` のような値は Backlog が Boolean として弾くので渡さない）。
   */
  async getProjects(): Promise<BacklogProject[]> {
    return this.get<BacklogProject[]>("/projects");
  }

  /**
   * 指定プロジェクトの参加メンバー一覧を取得する（read 枠・1 リクエスト）。
   * 各メンバーに roleType（1=管理者〜6=ゲストビューア）が付くので、「誰がこのプロジェクトに
   * 参加していて何の権限か」がこれ一つで分かる。取り込み時にメンバー + roleType を保存する。
   */
  async getProjectUsers(projectId: number): Promise<BacklogUser[]> {
    return this.get<BacklogUser[]>(`/projects/${projectId}/users`);
  }

  /**
   * プロジェクトに定義されたマスタ（状態・種別・カテゴリー・バージョン/マイルストーン）と、
   * スペース共通のマスタ（優先度・完了理由）をまとめて取得する（read 枠・6 リクエスト）。
   *
   * **なぜ定義から取るのか**: 課題に出現したマスタだけを集めると、**定義されているが 1 件も
   * 使われていないマスタが欠ける**。例えば全課題が「完了」のプロジェクトでは状態が「完了」
   * 1 件だけになり、取り込み先で他の状態に変更できず、絞り込みにも出せない（TH7 で実際に発生）。
   *
   * 個々の取得失敗は空配列にフォールバックする（権限や機能の有無で 4xx になっても
   * 取り込み全体は止めない。欠けたぶんは従来どおり課題からの逆算で補われる）。
   */
  async getProjectMasters(projectId: number): Promise<BacklogProjectMasters> {
    const safe = async <T>(path: string): Promise<T[]> => {
      try {
        return await this.get<T[]>(path);
      } catch {
        return [];
      }
    };
    const [
      statuses,
      issueTypes,
      categories,
      versions,
      priorities,
      resolutions,
    ] = await Promise.all([
      safe<BacklogStatus>(`/projects/${projectId}/statuses`),
      safe<BacklogIssueType>(`/projects/${projectId}/issueTypes`),
      safe<BacklogCategory>(`/projects/${projectId}/categories`),
      safe<BacklogVersion>(`/projects/${projectId}/versions`),
      // 優先度・完了理由はスペース共通（プロジェクト配下のエンドポイントは無い）
      safe<BacklogPriority>("/priorities"),
      safe<BacklogResolution>("/resolutions"),
    ]);
    return {
      statuses,
      issueTypes,
      categories,
      versions,
      priorities,
      resolutions,
    };
  }

  /**
   * 指定プロジェクトの全課題を created 昇順で取得（100 件ページング）。
   * onPage で取得ページごとに進捗を返す。
   */
  async getAllIssues(
    projectId: number,
    onPage?: (fetched: number) => void,
  ): Promise<BacklogIssue[]> {
    const all: BacklogIssue[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.get<BacklogIssue[]>(
        `/issues?projectId[]=${projectId}&count=100&offset=${offset}&sort=created&order=asc`,
      );
      all.push(...page);
      onPage?.(all.length);
      if (page.length < 100) break;
      offset += 100;
    }
    return all;
  }

  /**
   * 1 課題の全コメントを created 昇順で取得（minId ページング。100 超コメントの課題に対応）。
   */
  async getIssueComments(issueId: number): Promise<BacklogComment[]> {
    const comments: BacklogComment[] = [];
    let minId = 0;
    for (;;) {
      const batch = await this.get<BacklogComment[]>(
        `/issues/${issueId}/comments?count=100&order=asc&minId=${minId}`,
      );
      comments.push(...batch);
      if (batch.length < 100) break;
      minId = batch[batch.length - 1].id;
    }
    return comments;
  }

  /**
   * 指定プロジェクトの Wiki 一覧を取得する（search 枠）。
   * 一覧は content が空で返るため、本文は getWikiDetail で別途取得する。
   * projectId は数値 id でも projectKey でも可。
   */
  async getAllWikis(projectIdOrKey: number | string): Promise<BacklogWiki[]> {
    return this.get<BacklogWiki[]>(
      `/wikis?projectIdOrKey=${encodeURIComponent(projectIdOrKey)}`,
    );
  }

  /** 1 件の Wiki 詳細（本文 content 込み）を取得する（read 枠）。 */
  async getWikiDetail(wikiId: number): Promise<BacklogWiki> {
    return this.get<BacklogWiki>(`/wikis/${wikiId}`);
  }

  /**
   * 指定プロジェクトのドキュメント一覧を取得する。
   * 正しいエンドポイントは /documents?projectIdOrKey=（/projects/:id/documents は 404）。
   * 一覧レスポンスに本文 plain が含まれるため詳細取得は不要。
   */
  async getAllDocuments(
    projectIdOrKey: number | string,
  ): Promise<BacklogDocument[]> {
    return this.get<BacklogDocument[]>(
      `/documents?projectIdOrKey=${encodeURIComponent(projectIdOrKey)}`,
    );
  }

  /**
   * 課題の添付バイナリを取得する（/issues/:id/attachments/:id・read 枠）。
   * 削除済み添付は 404 になるため null を返す（現存添付のみ取得できる）。
   */
  async getIssueAttachment(
    issueId: number,
    attachmentId: number,
  ): Promise<Blob | null> {
    const url =
      `${this.base}/api/v2/issues/${issueId}/attachments/${attachmentId}` +
      `?apiKey=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new BacklogApiError(
        res.status,
        `添付の取得に失敗しました（${res.status}）`,
      );
    }
    return res.blob();
  }

  /**
   * ユーザーアイコン画像を取得する（icon 枠。read 枠とは別）。
   * 取得できなければ null（アイコン未設定・404・CORS 失敗等）。Blob で返す。
   *
   * 注意: `/users/:id/icon` は Nulab アカウント連携ユーザーだと `apps.nulab.com` へ 302 する
   * ことがある。redirect:'follow'（既定）でリダイレクトを追う方が取得できるアイコンは多い
   * （cross-origin の redirect:'manual' は実際にはリダイレクトしていなくても opaque になり
   * 取りこぼすため使わない）。リダイレクト先が CORS を返さない場合は fetch が例外になるが、
   * catch で静かに null（= イニシャル表示にフォールバック）にする。
   */
  async getUserIcon(
    userId: number,
  ): Promise<{ blob: Blob; contentType: string } | null> {
    const url = `${this.base}/api/v2/users/${userId}/icon?apiKey=${encodeURIComponent(this.apiKey)}`;
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size === 0) return null;
      return { blob, contentType: blob.type || "application/octet-stream" };
    } catch {
      return null;
    }
  }

  /**
   * プロジェクトアイコン画像を取得する（`/projects/:id/image`・icon 枠）。
   * 取得できなければ null（未設定・404・CORS 失敗等）。Blob で返す。
   *
   * ユーザーアイコンと違い、実測（2026-07-13）ではリダイレクトなしで直接 PNG（200）が返る。
   * icon 枠を消費する（X-RateLimit-Limit=60・read 枠とは別）。
   */
  async getProjectIcon(
    projectIdOrKey: number | string,
  ): Promise<{ blob: Blob; contentType: string } | null> {
    const url = `${this.base}/api/v2/projects/${encodeURIComponent(String(projectIdOrKey))}/image?apiKey=${encodeURIComponent(this.apiKey)}`;
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size === 0) return null;
      return { blob, contentType: blob.type || "application/octet-stream" };
    } catch {
      return null;
    }
  }
}

/** "example.backlog.jp" / "https://example.backlog.jp/" 等を "https://example.backlog.jp" に正規化 */
export function normalizeSpaceUrl(input: string): string {
  let s = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

/** エラーメッセージ用にパスから apiKey クエリを除去（万一付いていても伏せる） */
function redactPath(path: string): string {
  return path.replace(/apiKey=[^&]*/gi, "apiKey=***");
}
