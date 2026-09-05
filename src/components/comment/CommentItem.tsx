import type {
  AttachmentMeta,
  StoredComment,
  StoredUser,
} from "@/types/entities";
import { UserLabel } from "@/components/ui/UserLabel";
import { BacklogText } from "@/components/ui/BacklogText";
import { formatDateTime } from "@/lib/format";
import { ChangeLog } from "./ChangeLog";

/**
 * 1 件のコメント。投稿者名義・日時はアーカイブのまま改変しない。
 * 本文（content）と変更ログ（changeLog）を併せて表示する。
 *
 * id="comment-<id>" を持たせ、検索結果からのジャンプ先アンカーにする。
 * highlighted=true のとき一時的に強調表示する（ジャンプ直後）。
 */
export function CommentItem({
  comment,
  highlighted = false,
  projectId,
  projectKey,
  users = [],
  attachments = [],
}: {
  comment: StoredComment;
  highlighted?: boolean;
  projectId: number;
  projectKey?: string;
  users?: StoredUser[];
  /** 本文の #image(name) を解決するための添付メタ（この課題のもの） */
  attachments?: AttachmentMeta[];
}) {
  const hasContent = comment.content != null && comment.content.trim() !== "";

  return (
    <article
      id={`comment-${comment.id}`}
      className={`flex scroll-mt-20 flex-col gap-2 border-b border-zinc-100 px-2 py-4 last:border-b-0 dark:border-zinc-700/60 ${
        highlighted
          ? "rounded-md bg-amber-50 ring-2 ring-amber-300 dark:bg-amber-950/40 dark:ring-amber-700"
          : ""
      }`}
    >
      <header className="flex items-center gap-2">
        <UserLabel user={comment.createdUser} size={22} />
        <span className="text-xs text-zinc-400 tabular-nums">
          {formatDateTime(comment.created)}
        </span>
      </header>
      {hasContent && (
        <BacklogText
          text={comment.content ?? ""}
          projectId={projectId}
          projectKey={projectKey}
          users={users}
          attachments={attachments}
        />
      )}
      <ChangeLog entries={comment.changeLog} />
    </article>
  );
}
