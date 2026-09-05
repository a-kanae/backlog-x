"use client";

/**
 * 日本語の分かち書き（kuromoji 形態素解析）。
 *
 * 取り込み時のインデックス構築と、検索時のクエリ分かち書きで「同じ encode」を共有する
 * （命中精度の前提）。kuromoji のロードは重い（辞書 ~13MB + 初期化）ので Promise シングルトン
 * で 1 回だけ行う。辞書は public/dict に配置し dicPath='/dict' で読む。
 *
 * kuromoji は CommonJS なので動的 import して SSR バンドルから外す（'use client' 専用）。
 */

import type { Tokenizer, IpadicFeatures } from "kuromoji";

/** 検索に寄与しない品詞（助詞・助動詞・記号など）は索引に入れない */
const SKIP_POS = /助詞|助動詞|記号|フィラー|接続詞/;

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | undefined;

/** kuromoji tokenizer を 1 回だけ構築して返す（Promise シングルトン） */
export function getTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  if (typeof window === "undefined") {
    throw new Error(
      "kuromoji はブラウザ専用です（サーバー側では使用できません）",
    );
  }
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      const kuromoji = (await import("kuromoji")).default;
      return new Promise<Tokenizer<IpadicFeatures>>((resolve, reject) => {
        kuromoji.builder({ dicPath: "/dict" }).build((err, tokenizer) => {
          if (err) reject(err);
          else resolve(tokenizer);
        });
      });
    })();
  }
  return tokenizerPromise;
}

/**
 * 文字列を検索語の配列に分かち書きする。
 * - 助詞・記号など SKIP_POS は除外
 * - 活用語は basic_form（原形）に寄せる（「変更し」→「変更する」で揺れを吸収）
 * - lowercase で英語の大小を正規化、空白・記号のみの語は捨てる
 */
/**
 * 検索語として意味のあるトークンか。
 * 英数字・ひらがな・カタカナ・漢字を 1 文字も含まない語（"."、"-"、"|" など記号のみ）は捨てる。
 * これをしないと "email.example.com" が ["email",".","example",".","com"] となり、"." が
 * 多くの文書に出現するため無関係な文書まで AND マッチしてしまう。
 */
const MEANINGFUL = /[0-9a-z぀-ゟ゠-ヿ一-鿿０-９Ａ-Ｚａ-ｚ]/;

export function tokenize(
  tokenizer: Tokenizer<IpadicFeatures>,
  text: string,
): string[] {
  if (!text) return [];
  return tokenizer
    .tokenize(text)
    .filter((tk) => !SKIP_POS.test(tk.pos))
    .map((tk) =>
      tk.basic_form && tk.basic_form !== "*" ? tk.basic_form : tk.surface_form,
    )
    .map((w) => w.toLowerCase())
    .filter((w) => MEANINGFUL.test(w));
}

/** 空白（半角/全角）1 文字以上にマッチ。フレーズの区切り判定に使う */
const WHITESPACE = /[\s　]+/;

/**
 * クエリを「スペース区切りのフレーズ」ごとにグループ化して分かち書きする。
 *
 * 検索クエリでは、ユーザーがスペース無しで続けて打った語（例 "うちわ発注"）と、
 * スペースで区切って打った複数語（例 "うちわ 発注"）とでは期待する一致の仕方が異なる。
 * - スペース無し（1 フレーズ内）: 語順・活用の揺れは許容しつつ、フレーズとして近接した
 *   一致を期待する（「うちわ発注」なら本文中で「うちわ」と「発注」が隣接〜至近にあってほしい）。
 * - スペース区切り（複数フレーズ）: 各フレーズが本文のどこにあってもよい単純な AND を期待する
 *   （「うちわ 発注」なら両方が本文に含まれていればよく、位置関係は問わない）。
 *
 * tokenize() はスペースを記号として除外しフラットな配列にしてしまうため、この情報を
 * 失う前にスペースで一次分割してから、各フレーズを個別に tokenize する。
 */
export function tokenizeByPhrase(
  tokenizer: Tokenizer<IpadicFeatures>,
  text: string,
): string[][] {
  const phrases = text.split(WHITESPACE).filter((p) => p !== "");
  return phrases
    .map((phrase) => tokenize(tokenizer, phrase))
    .filter((tokens) => tokens.length > 0);
}
