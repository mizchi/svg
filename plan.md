# WPT SVG 対応計画

## 方針
- painting / pservers / coordinate-systems / struct を優先
- text は別モジュールへ分離して対応
- WPT 追加は `scripts/generate-wpt-svg.mjs` の対象を段階的に拡張
- skip している WPT 領域は小さく解禁して Red → Green → Refactoring

## 優先順位
1. painting
2. pservers
3. coordinate-systems / struct
4. marker / external-reference / nested-svg-sizing
5. text（別モジュール化後）

## 対応スコープ
### 1) painting
- clipPath / mask の複数子要素対応
- maskUnits / maskContentUnits の追加ケース
- paint-order / vector-effect（non-scaling-stroke）の検討
- 既存実装で不足する描画順序や合成の補完

### 2) pservers
- linear/radial gradient の形状別対応（rect以外）
- gradientUnits / gradientTransform / spreadMethod
- patternUnits / patternContentUnits / patternTransform / x/y
- paint fallback と currentColor の実ケース検証

### 3) coordinate-systems / struct
- nested <svg> の viewBox / preserveAspectRatio の解決
- <symbol> / <use> の座標系引き継ぎ
- objectBoundingBox / userSpaceOnUse の一貫性チェック

### 4) marker / external-reference / nested-svg-sizing
- markerUnits / markerWidth / markerHeight / orient の段階実装
- 外部参照（<use> / <image> の外部 SVG）を data: / 相対パスから順に対応
- WPT では外部 SVG の defs を inline して url() を #id に書き換える（暫定）
- nested <svg> の sizing / overflow / viewBox 解釈の再点検
- data:image/svg+xml;base64 のデコード対応

#### 進捗メモ
- marker viewBox のオフセット/clip を修正（marker-002/004/006 解禁）
- display="none" 祖先内の marker 定義も解禁（marker-007）
- 複数サブパスの marker 配置ルールを調整（marker-009）
- WPT fuzzy meta を読み取り、ケースごとに許容差を適用（runner 側）
- marker-path の一部を解禁（001/011 を除外）
- 残り: marker-orient-002 / marker-path-001 / marker-path-011 / marker-units / marker-external-reference / nested-svg-sizing

### 5) text（別モジュール化）
- text を独立モジュールへ分離
- text レイアウト / textPath / textLength 等は別フェーズで対応

## 進め方（TDD）
1. WPT で該当ケースを小さく選んで Red
2. 最小実装で Green
3. 既存ケースが落ちないことを確認して Refactoring

## 実行コマンド
- WPT 生成: `node scripts/generate-wpt-svg.mjs --pattern=<dir>`
- WPT 実行: `just wpt-svg`
- テスト: `moon test`
- 整形/インタフェース更新: `moon info && moon fmt`
