import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * 一覧などへ戻るリンク。左向き矢印アイコン + ラベル。
 * 以前はテキストの「←」を使っていたが、見た目を整えるため lucide のアイコンに統一。
 */
export function BackLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-700 hover:underline dark:hover:text-zinc-300"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      {children}
    </Link>
  );
}
