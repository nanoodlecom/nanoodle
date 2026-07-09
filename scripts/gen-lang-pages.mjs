#!/usr/bin/env node
// Generator for the per-language crawlable landing pages (offline, no deps).
//
// nanoodle's UI is fully localized (es/fr/de/pt/ja) but 100% client-side at ONE
// URL, so search engines only ever index the English shell. This emits five tiny
// STATIC localized landing pages — es/index.html … ja/index.html — each with real
// localized marketing copy, a self-referential <canonical>, and the full reciprocal
// hreflang cluster. Cloudflare Pages serves es/index.html at /es/ automatically, so
// the generated files are committed as-is (no build step at deploy time).
//
// The editor itself stays at /. Each page's CTA opens /?lang=xx, which the editor's
// i18nDetect() honors. Copy is hand-authored natively per language (informal register
// matching the in-app translations: es=tú, fr=vous, de=du, pt=você, ja=polite);
// brand terms (nanoodle, nano-gpt, ComfyUI, noodle) stay untranslated on purpose.
//
// Run:  node scripts/gen-lang-pages.mjs           (writes into the repo root)
//       node scripts/gen-lang-pages.mjs <outDir>  (writes into <outDir>, used by the guard)
// The check-lang-pages.mjs guard regenerates into a temp dir and diffs, so the
// committed pages can never drift from this generator.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = "https://nanoodle.com";
const OG_IMAGE = SITE + "/og-card.png"; // language-neutral art (logo + neon noodles)

// The full alternate cluster, shared by every page. `/` is the en member AND
// x-default; the same set is mirrored into index.html's <head> for reciprocity.
// Order here is the emit order (kept stable so the committed files are deterministic).
export const CLUSTER = [
  { hreflang: "en", href: SITE + "/" },
  { hreflang: "es", href: SITE + "/es/" },
  { hreflang: "fr", href: SITE + "/fr/" },
  { hreflang: "de", href: SITE + "/de/" },
  { hreflang: "pt", href: SITE + "/pt/" },
  { hreflang: "ja", href: SITE + "/ja/" },
  { hreflang: "x-default", href: SITE + "/" },
];

// Native language names for the footer "other languages" row + internal linking.
export const NATIVE = { en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", ja: "日本語" };

// One copy table per language. Every string is hand-written in the target language.
export const PAGES = {
  es: {
    ogLocale: "es_ES",
    title: "nanoodle — un playground de IA por nodos en tu navegador",
    desc: "nanoodle es un playground de nodos estilo ComfyUI que funciona por completo en tu navegador. Sin servidor, sin cuenta de nanoodle y sin analíticas: usas tu propia clave de nano-gpt (pago por uso). Conecta modelos de texto, imagen, vídeo y audio en un flujo y conviértelo en una app para compartir o en un único archivo HTML exportado. La interfaz y las respuestas de los modelos están en tu idioma.",
    ogTitle: "nanoodle — como ComfyUI, pero mucho más simple",
    h1: "Flujos de IA en tu navegador, en español",
    tagline: "Como ComfyUI, pero mucho más simple. Sin servidor, sin cuenta de nanoodle, sin analíticas.",
    imgAlt: "Fideos de neón que se elevan desde un bol de ramen hacia cables de flujo brillantes, con el logotipo de nanoodle",
    p1: "nanoodle es un pequeño playground de nodos para IA. Conecta modelos de texto, imagen, vídeo y audio de nano-gpt en un flujo, ejecútalo directamente en tu navegador y mira cómo los resultados pasan de un nodo a otro. Sin instalar nada y sin cuenta de nanoodle: abres una URL, pruebas una muestra gratis y, para generar de verdad, usas tu clave de nano-gpt.",
    p2: "Todo se ejecuta en tu propio equipo con tu clave de nano-gpt, que nunca sale de tu navegador. No hay servidores que guarden tu trabajo ni analíticas que te rastreen. Convierte cualquier flujo en una app que compartes con un simple enlace, o expórtalo a un único archivo HTML que es tuyo para siempre. Toda la interfaz —y las respuestas de los modelos— habla tu idioma.",
    faqQ: "¿Es gratis?",
    faqA: "La app en sí es gratuita y abierta. Solo pagas a nano-gpt por las llamadas a los modelos que hagas, por uso y con tu propia clave, sin suscripción.",
    cta: "Abrir el editor",
    otherLabel: "Otros idiomas",
    legalLabel: "Aviso legal y privacidad",
  },
  fr: {
    ogLocale: "fr_FR",
    title: "nanoodle — un playground d’IA en nœuds dans votre navigateur",
    desc: "nanoodle est un playground de nœuds façon ComfyUI qui fonctionne entièrement dans votre navigateur. Sans serveur, sans compte nanoodle et sans analytique : vous utilisez votre propre clé nano-gpt (paiement à l’usage). Reliez des modèles de texte, d’image, de vidéo et d’audio en un workflow, puis transformez-le en app partageable ou en un seul fichier HTML exporté. L’interface et les réponses des modèles sont dans votre langue.",
    ogTitle: "nanoodle — comme ComfyUI, mais bien plus simple",
    h1: "Des workflows d’IA dans votre navigateur, en français",
    tagline: "Comme ComfyUI, mais bien plus simple. Sans serveur, sans compte nanoodle, sans analytique.",
    imgAlt: "Des nouilles néon s’élevant d’un bol de ramen vers des câbles de workflow lumineux, avec le logo nanoodle",
    p1: "nanoodle est un petit playground de nœuds pour l’IA. Reliez des modèles de texte, d’image, de vidéo et d’audio de nano-gpt en un workflow, exécutez-le directement dans votre navigateur et regardez les résultats circuler d’un nœud à l’autre. Rien à installer, pas de compte nanoodle : vous ouvrez une URL, essayez un échantillon gratuit, puis générez pour de vrai avec votre clé nano-gpt.",
    p2: "Tout s’exécute sur votre propre machine avec votre clé nano-gpt, qui ne quitte jamais votre navigateur. Aucun serveur ne conserve votre travail, aucune analytique ne vous suit. Transformez n’importe quel workflow en une app que vous partagez d’un simple lien, ou exportez-le en un seul fichier HTML qui vous appartient. Toute l’interface — et les réponses des modèles — parle votre langue.",
    faqQ: "C’est gratuit ?",
    faqA: "L’app elle-même est gratuite et ouverte. Vous ne payez que nano-gpt pour les appels aux modèles que vous effectuez, à l’usage et avec votre propre clé, sans abonnement.",
    cta: "Ouvrir l’éditeur",
    otherLabel: "Autres langues",
    legalLabel: "Mentions légales et confidentialité",
  },
  de: {
    ogLocale: "de_DE",
    title: "nanoodle — ein knotenbasiertes KI-Playground im Browser",
    desc: "nanoodle ist ein knotenbasiertes Playground im Stil von ComfyUI, das komplett in deinem Browser läuft. Kein Server, kein nanoodle-Konto, kein Tracking – du nutzt deinen eigenen nano-gpt-Schlüssel (Bezahlung pro Nutzung). Verbinde Text-, Bild-, Video- und Audiomodelle zu einem Workflow und mach daraus eine teilbare App oder eine einzelne exportierte HTML-Datei. Die Oberfläche und die Antworten der Modelle sind in deiner Sprache.",
    ogTitle: "nanoodle — wie ComfyUI, nur viel einfacher",
    h1: "KI-Workflows im Browser, auf Deutsch",
    tagline: "Wie ComfyUI, nur viel einfacher. Kein Server, kein nanoodle-Konto, kein Tracking.",
    imgAlt: "Neon-Nudeln, die aus einer Ramen-Schale zu leuchtenden Workflow-Kabeln aufsteigen, mit dem nanoodle-Logo",
    p1: "nanoodle ist ein kleines knotenbasiertes Playground für KI. Verbinde Text-, Bild-, Video- und Audiomodelle von nano-gpt zu einem Workflow, führe ihn direkt im Browser aus und sieh zu, wie die Ergebnisse von Knoten zu Knoten fließen. Nichts zu installieren, kein nanoodle-Konto: Du öffnest eine URL, testest ein kostenloses Beispiel und generierst für echt mit deinem nano-gpt-Schlüssel.",
    p2: "Alles läuft auf deinem eigenen Rechner mit deinem nano-gpt-Schlüssel, der deinen Browser nie verlässt. Es gibt keine Server, die deine Arbeit speichern, und kein Tracking, das dich verfolgt. Mach aus jedem Workflow eine App, die du als einfachen Link teilst, oder exportiere ihn in eine einzelne HTML-Datei, die dir gehört. Die ganze Oberfläche – und die Antworten der Modelle – spricht deine Sprache.",
    faqQ: "Ist es kostenlos?",
    faqA: "Die App selbst ist kostenlos und offen. Du zahlst nur nano-gpt für die Modellaufrufe, die du machst – pro Nutzung und mit deinem eigenen Schlüssel, ohne Abo.",
    cta: "Editor öffnen",
    otherLabel: "Andere Sprachen",
    legalLabel: "Rechtliches und Datenschutz",
  },
  pt: {
    ogLocale: "pt_BR",
    title: "nanoodle — um playground de IA em nós no seu navegador",
    desc: "nanoodle é um playground de nós no estilo ComfyUI que roda inteiramente no seu navegador. Sem servidor, sem conta nanoodle e sem analytics: você usa a sua própria chave da nano-gpt (pagamento por uso). Conecte modelos de texto, imagem, vídeo e áudio em um fluxo e transforme-o em um app para compartilhar ou em um único arquivo HTML exportado. A interface e as respostas dos modelos ficam no seu idioma.",
    ogTitle: "nanoodle — como o ComfyUI, mas muito mais simples",
    h1: "Fluxos de IA no seu navegador, em português",
    tagline: "Como o ComfyUI, mas muito mais simples. Sem servidor, sem conta nanoodle, sem analytics.",
    imgAlt: "Macarrão de neon subindo de uma tigela de ramen até cabos de fluxo brilhantes, com o logotipo da nanoodle",
    p1: "nanoodle é um pequeno playground de nós para IA. Conecte modelos de texto, imagem, vídeo e áudio da nano-gpt em um fluxo, execute-o direto no navegador e veja os resultados passarem de um nó para outro. Nada para instalar, sem conta nanoodle: você abre uma URL, testa uma amostra grátis e, para gerar de verdade, usa a sua chave da nano-gpt.",
    p2: "Tudo roda na sua própria máquina com a sua chave da nano-gpt, que nunca sai do seu navegador. Não há servidores guardando o seu trabalho nem analytics te rastreando. Transforme qualquer fluxo em um app que você compartilha com um link simples, ou exporte-o para um único arquivo HTML que é só seu. Toda a interface — e as respostas dos modelos — fala o seu idioma.",
    faqQ: "É grátis?",
    faqA: "O app em si é gratuito e aberto. Você só paga a nano-gpt pelas chamadas aos modelos que fizer, por uso e com a sua própria chave, sem assinatura.",
    cta: "Abrir o editor",
    otherLabel: "Outros idiomas",
    legalLabel: "Aviso legal e privacidade",
  },
  ja: {
    ogLocale: "ja_JP",
    title: "nanoodle — ブラウザで動くノード型AIプレイグラウンド",
    desc: "nanoodle は、ブラウザだけで完結する ComfyUI ライクなノード型プレイグラウンドです。サーバー不要、nanoodle アカウント不要、解析なし。自分の nano-gpt キーを使います（従量課金）。テキスト・画像・動画・音声のモデルをワークフローにつなぎ、共有できるアプリや 1 つの HTML ファイルとして書き出せます。画面もモデルの返答も、あなたの言語で表示されます。",
    ogTitle: "nanoodle — ComfyUI みたいに、でもずっとシンプルに",
    h1: "ブラウザで動くAIワークフローを、日本語で",
    tagline: "ComfyUI みたいに、でもずっとシンプル。サーバー不要、nanoodle アカウント不要、解析なし。",
    imgAlt: "ラーメンの丼から光るワークフローのケーブルへと立ちのぼるネオンの麺と、nanoodle のロゴ",
    p1: "nanoodle は、AI のための小さなノード型プレイグラウンドです。nano-gpt のテキスト・画像・動画・音声モデルをワークフローにつなぎ、ブラウザでそのまま実行して、結果がノードからノードへ流れていく様子を見られます。インストールも nanoodle アカウントも不要。URL を開けば無料サンプルを試せ、本番の生成は自分の nano-gpt キーで行います。",
    p2: "すべては、あなたの nano-gpt キーを使ってあなたの端末で動きます。キーがブラウザの外に出ることはありません。作業内容を保存するサーバーも、あなたを追跡する解析もありません。どんなワークフローも、リンク 1 つで共有できるアプリにしたり、そのまま持ち歩ける 1 つの HTML ファイルに書き出したりできます。画面もモデルの返答も、すべてあなたの言語で表示されます。",
    faqQ: "無料ですか？",
    faqA: "アプリ自体は無料でオープンです。料金がかかるのは、あなたが実行したモデル呼び出しの分だけ。自分のキーで、使った分だけ nano-gpt に支払います。サブスクリプションは不要です。",
    cta: "エディターを開く",
    otherLabel: "他の言語",
    legalLabel: "利用規約とプライバシー",
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function altLinks() {
  return CLUSTER.map((c) => `<link rel="alternate" hreflang="${c.hreflang}" href="${c.href}" />`).join("\n");
}

// The footer "other languages" row: current language bold, the rest link out.
function otherLangs(code) {
  return ["en", "es", "fr", "de", "pt", "ja"]
    .map((c) => {
      const href = c === "en" ? "/" : `/${c}/`;
      if (c === code) return `<strong>${esc(NATIVE[c])}</strong>`;
      return `<a href="${href}">${esc(NATIVE[c])}</a>`;
    })
    .join(" · ");
}

export function renderPage(code) {
  const p = PAGES[code];
  if (!p) throw new Error("no copy table for " + code);
  const url = `${SITE}/${code}/`;
  return `<!doctype html>
<html lang="${code}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.desc)}" />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:site_name" content="nanoodle" />
<meta property="og:locale" content="${p.ogLocale}" />
<meta property="og:title" content="${esc(p.ogTitle)}" />
<meta property="og:description" content="${esc(p.desc)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${OG_IMAGE}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(p.imgAlt)}" />

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(p.ogTitle)}" />
<meta name="twitter:description" content="${esc(p.desc)}" />
<meta name="twitter:image" content="${OG_IMAGE}" />
<meta name="twitter:image:alt" content="${esc(p.imgAlt)}" />

<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#0b0d12" />
<link rel="canonical" href="${url}" />
${altLinks()}
<style>
  :root{
    color-scheme: dark;
    --bg:#0b0d12; --panel:#12151d; --panel2:#171b25; --ink:#eef1f7; --dim:#aeb7c8; --muted:#c3c9d6;
    --line:#262c3a; --accent:#7c8cff; --accent2:#ff79c6;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{ background:var(--bg); color:var(--ink); min-height:100vh; display:flex; flex-direction:column; align-items:center;
        font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; padding:2rem 1.1rem 3rem; }
  a{ color:var(--accent); text-decoration:none } a:hover{ text-decoration:underline }
  :focus-visible{ outline:2px solid var(--accent); outline-offset:2px }
  main{ width:100%; max-width:660px }
  .logo{ font-weight:900; font-size:1.5rem; letter-spacing:.01em; margin:0 0 1.6rem }
  .logo .nano{ background:linear-gradient(90deg,#67e8f9,#7c8cff 70%); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .logo .ui{ color:var(--dim); font-weight:700; font-size:.62rem; letter-spacing:.14em; margin-left:.35rem; vertical-align:.14em; text-transform:uppercase; }
  h1{ font-size:2rem; line-height:1.2; margin:0 0 .6rem; letter-spacing:-.01em }
  .tagline{ color:var(--muted); font-size:1.05rem; margin:0 0 1.6rem }
  .hero{ display:block; width:100%; height:auto; border:1px solid var(--line); border-radius:.9rem; margin:0 0 1.8rem; }
  p{ color:var(--ink); margin:0 0 1.1rem }
  .faq{ background:var(--panel); border:1px solid var(--line); border-radius:.7rem; padding:.9rem 1.1rem; margin:.4rem 0 1.8rem }
  .faq .q{ font-weight:700; margin:0 0 .3rem } .faq .a{ color:var(--muted); margin:0 }
  .cta{ display:inline-block; background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#0b0d12;
        font-weight:800; font-size:1.05rem; padding:.8rem 1.5rem; border-radius:.6rem; }
  .cta:hover{ text-decoration:none; filter:brightness(1.05) }
  footer{ margin-top:2.4rem; color:var(--dim); font-size:.86rem; line-height:1.9 }
  footer a{ color:var(--dim) } footer a:hover{ color:var(--ink) }
  footer .langs strong{ color:var(--ink) }
  footer .sep{ margin:0 .5rem; opacity:.5 }
</style>
</head>
<body>
<main>
  <p class="logo"><span class="nano">nanoodle</span><span class="ui">node ui</span></p>
  <h1>${esc(p.h1)}</h1>
  <p class="tagline">${esc(p.tagline)}</p>
  <img class="hero" src="/og-card.png" width="1200" height="630" alt="${esc(p.imgAlt)}" />
  <p>${esc(p.p1)}</p>
  <p>${esc(p.p2)}</p>
  <div class="faq">
    <p class="q">${esc(p.faqQ)}</p>
    <p class="a">${esc(p.faqA)}</p>
  </div>
  <p><a class="cta" href="/?lang=${code}">${esc(p.cta)} →</a></p>
  <footer>
    <div class="langs">${p.otherLabel}: ${otherLangs(code)}</div>
    <div><a href="/legal">${esc(p.legalLabel)}</a></div>
  </footer>
</main>
</body>
</html>
`;
}

// --- CLI ------------------------------------------------------------------
// Only write files when run directly (not when imported by the guard).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : root;
  for (const code of Object.keys(PAGES)) {
    const dir = path.join(outDir, code);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), renderPage(code));
    console.log("wrote " + path.join(code, "index.html"));
  }
}
