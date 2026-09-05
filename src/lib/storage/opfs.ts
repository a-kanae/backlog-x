/**
 * OPFS（Origin Private File System）で添付ファイルのバイナリを保存・取得する薄いヘルパ。
 *
 * 添付バイナリは大容量（実測で 993MB / 3,523 件）のため、IndexedDB ではなく OPFS に置く。
 * OPFS は origin 専用の隠しファイルシステムで、外部参照ゼロ・オフライン・大容量バイナリ向け。
 * メタ（名前・サイズ・登録者）は従来どおり IndexedDB の attachmentMeta に持ち、ここでは
 * 実体バイナリだけを扱う（メタ = IndexedDB、実体 = OPFS の役割分担）。
 *
 * パス構成: attachments/<projectId>/<attachmentId>
 */

const ROOT_DIR = "attachments";

/** OPFS が使えるか（古いブラウザ/特殊環境のガード） */
export function isOpfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage !== "undefined" &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/** attachments/<projectId> のディレクトリハンドルを得る（create=true で無ければ作る） */
async function getProjectDir(
  projectId: number,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  if (!isOpfsSupported()) return null;
  const root = await navigator.storage.getDirectory();
  try {
    const attachmentsDir = await root.getDirectoryHandle(ROOT_DIR, { create });
    return await attachmentsDir.getDirectoryHandle(String(projectId), {
      create,
    });
  } catch {
    return null; // 無くて create=false のとき等
  }
}

/** 添付バイナリを OPFS に保存する（attachments/<projectId>/<attachmentId>） */
export async function saveAttachmentBlob(
  projectId: number,
  attachmentId: number,
  blob: Blob,
): Promise<void> {
  const dir = await getProjectDir(projectId, true);
  if (!dir)
    throw new Error("この環境では添付ファイルの保存（OPFS）が使えません");
  const fileHandle = await dir.getFileHandle(String(attachmentId), {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** 保存済み添付バイナリを取得する（無ければ null） */
export async function getAttachmentBlob(
  projectId: number,
  attachmentId: number,
): Promise<Blob | null> {
  const dir = await getProjectDir(projectId, false);
  if (!dir) return null;
  try {
    const fileHandle = await dir.getFileHandle(String(attachmentId));
    const file = await fileHandle.getFile();
    return file;
  } catch {
    return null; // 未保存
  }
}

/** 添付バイナリが OPFS に存在するか */
export async function hasAttachmentBlob(
  projectId: number,
  attachmentId: number,
): Promise<boolean> {
  const dir = await getProjectDir(projectId, false);
  if (!dir) return false;
  try {
    await dir.getFileHandle(String(attachmentId));
    return true;
  } catch {
    return false;
  }
}

/** プロジェクトの保存済み添付 id 一覧（エクスポート時に OPFS から拾うのに使う） */
export async function listSavedAttachmentIds(
  projectId: number,
): Promise<number[]> {
  const dir = await getProjectDir(projectId, false);
  if (!dir) return [];
  const ids: number[] = [];
  // FileSystemDirectoryHandle は AsyncIterable（keys()）。型定義に無い環境向けに narrowing する。
  for await (const name of dir.keys()) {
    const id = Number(name);
    if (Number.isFinite(id)) ids.push(id);
  }
  return ids;
}

/** プロジェクトの添付バイナリをすべて削除（再取り込み前のクリア用） */
export async function clearProjectAttachments(
  projectId: number,
): Promise<void> {
  if (!isOpfsSupported()) return;
  const root = await navigator.storage.getDirectory();
  try {
    const attachmentsDir = await root.getDirectoryHandle(ROOT_DIR);
    await attachmentsDir.removeEntry(String(projectId), { recursive: true });
  } catch {
    // 無ければ何もしない
  }
}
