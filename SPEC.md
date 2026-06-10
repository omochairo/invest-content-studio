# SPEC — Invest Content Studio

> 本書はプロジェクトの**確定仕様**。`README.md` のロードマップ素案を本書が上書き・精緻化する
> （主な改訂点は末尾「README からの改訂差分」を参照）。

## 0. 一行で言うと

**「構造化データ → 音声/動画」を自動生成するパイプラインの能力R&D。** 投資ジャンルを検証台に使い、
完成した動画自動化能力を本業（omochairo / 知育玩具メディア）へ逆輸入することを最終目的とする。

## 1. 目的とポジショニング

| 観点 | 方針 |
|---|---|
| **主目的** | 動画自動化パイプラインの能力獲得（R&D）。投資コンテンツ自体は手段 |
| **検証台に投資を選ぶ理由** | 株価・決算・指標・時価総額が全て数値＝**構造化データが動画テンプレに流し込みやすい** |
| **主戦場** | **動画 / 音声**。YouTube・ショート・Podcast 等、ドメイン権威性より鮮度×継続を評価する土俵 |
| **テキストの扱い** | **テキストSEOは主戦場にしない**（金融YMYLは大手が構造的に優位で個人自動化は不利）。記事は動画台本の副産物として任意出力 |
| **逆輸入の核** | ドメイン非依存の `ContentPackage` 契約（§3）。投資もおもちゃも同じ形に落とせば同じレンダラーが動画化できる |

## 2. 戦略的判断（なぜこの設計か）

- **一次情報起点が必須**：他社記事（日経/Reuters等）の要約転載は著作権侵害。**一次情報**（SEC EDGAR
  filing / TDnet 適時開示 / 各社IR / 価格API）を起点にすれば、転載でも助言でもない「事実報道＋構造化」の
  安全圏に収まる。コンプラと著作権を同時に解決する。
- **R&Dの鉄則＝最難所を先に潰す**：fetch/生成/配信は omochairo で実証済み。未知でリスクが高いのは
  「**自動動画が視聴に耐える品質になるか**」。よって通常の Phase 1 から作らず、まず動画合成を **Phase 0
  スパイク**で単独検証し、Go/ピボットを判断する（§7）。

## 3. 中心設計：ContentPackage 契約（移植性の核）

データ層とレンダリング層を疎結合にし、間に**ドメイン非依存の中間スキーマ**を1枚噛ませる。
投資パイプライン＝「市況データ → ContentPackage」、omochairo＝「おもちゃデータ → ContentPackage」。
**レンダラー（Remotion）と TTS は ContentPackage の裏に隠れ、共用かつ差し替え可能**。

```jsonc
// ContentPackage — これが逆輸入を実現する具体物
{
  "meta":      { "title": "", "lang": "ja", "format": "short|wide",
                 "disclaimer": "", "sources": [{ "label": "", "url": "" }] },
  "narration": [{ "text": "", "ssml": null }],          // 読み上げ原稿（→TTS）
  "scenes":    [{ "duration_ms": 0, "visual_ref": "", "caption": "" }],
  "assets":    [{ "id": "", "type": "chart|image", "spec": {} }]  // 数値→図表の生成指示
}
```

- TTS エンジン・動画エンジンを変えても **ContentPackage は不変**＝契約。差し替えコストを契約境界に閉じ込める。
- `meta.disclaimer` と `meta.sources` は**必須**（コンプラ要件、§6 / AGENTS.md）。

## 4. パイプライン全体像

```text
[1] データ fetch      投資: CoinGecko / SEC EDGAR / TDnet / 指標API   ← omochairo の定期fetch cron 流用
[2] ストーリー化      Jules/LLM が ContentPackage を生成              ← omochairo の生成層流用 + コンプラgate
[3] 音声化 (TTS)      narration → ナレーション音声 (VOICEVOX)          ★新規
[4] 図表生成          assets.spec → チャート画像 (React/Remotion内 or matplotlib) ★新規
[5] 動画合成          ContentPackage → mp4 (Remotion ヘッドレスレンダ) ★新規・本丸
[6] 配信              YouTube Data API 自動アップ（当初は限定公開）    ← omochairo の配信cron 流用
```

`[1][2][6]` は omochairo 資産がほぼ流用可。**真に新規で成否を決めるのは `[3][4][5]`、特に `[5]`**。

## 5. 技術スタック（確定）

| レイヤ | 採用 | 備考 |
|---|---|---|
| データfetch | Python | omochairo と同言語。一次情報API群 |
| ストーリー生成 | Jules / LLM | omochairo パイプライン流用。出力＝ContentPackage |
| **動画合成** | **Remotion (React/TS)** | データ連動・字幕・チャートに強い。`@remotion/renderer` でヘッドレス出力 |
| **TTS** | **VOICEVOX** | 無料・ローカル・商用可・日本語特化。品質バーを上げる時は ElevenLabs 等に契約境界で差し替え |
| 図表 | React内 (Remotion) / matplotlib | まずは Remotion 内で描画しデータ連動アニメを狙う |
| 配信 | YouTube Data API | 当初は限定公開でレビュー後に公開 |
| TODO管理 | GitHub Issues | omochairo 同様。memory に TODO を書かない |

## 6. コンプラ / 法務（要点。詳細は AGENTS.md）

投資コンテンツ特有の最重要制約。生成段階で機械的に守らせる。

- **金融商品取引法**：個別銘柄の売買推奨・断定的判断の提供（「必ず上がる」「今が買い」「利回り保証」）は
  **投資助言業（登録制）**に該当しうる。無登録は違法 → **生成段階で禁止表現をブロックするコンプラgateを必須化**。
- 出力は常に「教育・情報提供・事実報道・一般論」に限定。`meta.disclaimer` を全成果物に自動挿入。
- **著作権**：他社記事の転載・要約転載は禁止。一次情報起点＋出典リンク（`meta.sources`）必須。
- **景表法 / ステマ規制**：アフィリエイト導線には PR 表記を自動付与。

## 7. フェーズ計画

### Phase 0 — スパイク（最難所を先に検証）★最初にやる
**ゴール**：手書きの `ContentPackage` JSON 1個から、**視聴に耐える 60秒 mp4 を1本**自動生成する。
データ配管はまだ作らない。検証する4ピース：
1. Remotion 環境（Node）でヘッドレスレンダリング（縦/横）
2. 日本語フォント・字幕の焼き込み品質
3. チャートの React 描画＋データ連動アニメ
4. VOICEVOX 音声をナレーションとして尺同期

→ 及第点なら全体投資 **GO**、ダメなら**ピボット**の意思決定ゲート。

### Phase 1 — 1ジャンルで end-to-end 配管
Phase 0 通過後、**1ジャンルだけ**で `[1]→[6]` を自動化（日次の市況/決算速報動画 → 限定公開アップ）。
ジャンルは Phase 0 完了時に確定（候補：米国株決算速報＝EDGAR起点でテンプレ化が綺麗／暗号資産＝API無料・24/7）。

### Phase 2 — 品質・コンプラ・公開
コンプラgate 本実装、字幕・尺・retention 改善、公開化、計測（視聴維持率）。

### Phase 3 — omochairo へ逆輸入
ContentPackage レンダラーを omochairo データに接続（おもちゃランキング動画 等）。**本来の目的を回収**。

横展開（3ジャンル並走）は Phase 1 の配管が安定してから。同時立ち上げはしない。

## 8. リポジトリ構成

README の monorepo 構成を踏襲しつつ Remotion / ContentPackage に合わせて調整（詳細は実装時に確定）。
- `packages/shared/` … **ContentPackage の型定義（最重要の契約）**
- `packages/article-generator/` … データfetch＋ストーリー化（Python）
- `packages/audio-generator/` … VOICEVOX 連携
- `packages/video-generator/` … **Remotion プロジェクト**（旧 README の FFmpeg/アバターから変更）
- `apps/web/` … 管理ダッシュボード（後フェーズ）

## README からの改訂差分

1. **テキスト先行 → 動画先行**：README Phase 1（記事SEOエンジン先行）を改訂。テキストSEOは主戦場にせず、
   Phase 0 で動画品質を先に検証する。
2. **動画エンジン**：FFmpeg + アバターAPI(HeyGen/D-ID) → **Remotion** に確定。
3. **新概念の追加**：ContentPackage 移植契約 / omochairo 逆輸入 / 金商法コンプラgate。
