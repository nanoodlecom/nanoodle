# Zenn article #2 (JA) — ComfyUI search cluster

**STATUS: DRAFT — needs native review before posting.** Machine-assisted
Japanese; a native speaker must review tone, particles and technical terms
before publishing. Target: Zenn (zenn.dev), `type: tech`, published via the
Zenn GitHub-repo flow. Plan ref: `plan-q3-distribution.md` Phase 2,
language wave 1 (JA #2 — "ComfyUIはローカルGPU必須。nanoodleはブラウザだけ").
Voice: disclosed maker (作者). Costs disclosed honestly, no "無料" framing
in CTA lines.

Zenn frontmatter (keep `published: false` until native review passes):

```yaml
---
title: "ComfyUIはローカルGPU必須。ブラウザだけで動くノードエディタを作った話"
emoji: "🍜"
type: "tech"
topics: ["comfyui", "ai", "生成ai", "ワークフロー", "個人開発"]
published: false
---
```

---

こんにちは。nanoodle（ヌードル）というオープンソースのノードエディタを
個人開発している Mikkel です（作者本人による紹介記事です）。

ComfyUI でノードをつないで画像生成パイプラインを組むのは楽しいのですが、
人に勧めるときにいつも同じ壁に当たります。

- ローカル GPU（それなりの VRAM）が必要
- Python 環境の構築、モデルのダウンロード（数 GB〜数十 GB）
- カスタムノードの依存関係が壊れがち

「ノードでつなぐ」体験だけを、インストールゼロでブラウザに持ってこられ
ないか？ というのが nanoodle の出発点です。

日本語 UI はこちら: https://nanoodle.com/ja/
ソースコード（MIT）: https://github.com/nanoodlecom/nanoodle

## ComfyUI と何が違うのか（正直な比較）

|  | ComfyUI | nanoodle |
|---|---|---|
| 実行場所 | ローカル GPU | ブラウザ（推論は API 経由） |
| セットアップ | Python + モデル DL | URL を開くだけ |
| アカウント | 不要 | 不要（編集・閲覧はキーも不要） |
| コスト | 電気代 + GPU | 実行ごとの API 従量課金（後述） |
| モデルの自由度 | ローカルモデル + カスタムノード多数 | API プロバイダのカタログにあるもの |
| 出力の共有 | ワークフロー JSON | URL 1 本、または単一 HTML ファイル |

ComfyUI の強み（ローカル実行、膨大なカスタムノード資産、モデルの完全な
自由度）はそのままでは代替できません。nanoodle が勝てるのは
「インストールゼロ」「GPU 不要」「成果物を単一 HTML アプリとして配れる」
の 3 点です。用途が合う方だけどうぞ、というスタンスです。

## 費用の話を先にします（BYOK）

nanoodle 自体はサーバも課金もありません。モデルの実行は
[NanoGPT](https://nano-gpt.com) の **自分の API キー** を使う従量課金
（Bring Your Own Key）です。

- 実行前にグラフ上に「~$0.0X to run」という **実行前コスト見積もり** が
  表示されるので、いくらかかるかは押す前にわかります
- 料金はモデルごとに異なり、NanoGPT 側の価格表がそのまま適用されます。
  nanoodle は上乗せしません
- 編集・グラフの共有・エクスポートにはキーも費用も不要です

「クラウドだから手軽、その代わり実行は従量課金」という、ComfyUI と
ちょうど逆のトレードオフです。

## 使ってみる（ウォークスルー）

### 1. 開く

https://nanoodle.com/ja/ を開くとエディタがそのまま起動します。
ビルドもインストールもなく、プロダクト全体が静的な HTML 1 ページです。

### 2. ノードを置いてつなぐ

テキスト・画像・動画・音声のモデルノードに加えて、Join（テキスト結合）、
Resize、Choice、Comment などのユーティリティノードがあります。
たとえば:

1. テキストノードにプロンプトを書く
2. 画像生成ノードへワイヤーをつなぐ
3. その出力をさらに動画生成ノードへつなぐ

という多段パイプラインが、ComfyUI と同じ感覚で組めます。

### 3. 実行する

NanoGPT のキーを設定して Run。推論はプロバイダの API で行われ、結果は
ブラウザに返ってきます。グラフや生成物がどこかのサーバに保存されることは
ありません（そもそも nanoodle にはサーバがありません）。

### 4. 共有・エクスポート

ここが一番気に入っている部分です。

- **URL 共有**: グラフは URL の **フラグメント（# 以降）** に符号化され
  ます。フラグメントはサーバに送信されないので、共有リンクの中身を
  こちらが見ることは技術的にできません
- **単一 HTML エクスポート**: グラフを、ランタイム同梱の自己完結な
  .html ファイル 1 個のアプリとして書き出せます。配布先はどこでも
  よく、ローカルファイルとして開いても動きます

## プライバシーについて

- アカウント登録なし、アナリティクス一切なし（計測コードが存在しません）
- CSP（Content-Security-Policy）でサードパーティのオリジンを許可して
  いないため、「トラッキングしていない」はポリシーではなく **ヘッダで
  検証可能** です。DevTools のネットワークタブが証明になります
- 通信先は API プロバイダ（nano-gpt.com）のみ。キーはブラウザ内に保持
  されます

## まとめ

- ComfyUI のノード体験を、GPU もインストールもなしで試したい
- 組んだワークフローを URL 1 本や HTML 1 ファイルで人に渡したい

という方には合うと思います。逆に、ローカルモデルを完全にコントロール
したい方には ComfyUI が引き続き最適です。

フィードバックは GitHub（https://github.com/nanoodlecom/nanoodle）の
Issue か、この記事のコメントへどうぞ。

---

**Post-publish checklist (EN, not part of the article):**
- Qiita crosspost per plan (canonical link back to Zenn).
- Log in `growth/shares.md`.
- Do NOT crosspost to Misskey (region-blocked venue, standing veto).
