# Catan application by bokoboko

身内用のカタン風ボードゲーム。通常版ルールの4人対戦で、人間が4人に満たない席はAIが埋める。

## 構成

```
packages/
  engine/   ルールエンジン（UI・通信に依存しない純粋なゲームロジック）
  ai/       AIプレイヤー（PlayerView と合法手だけを見て1手を選ぶ）
  client/   ブラウザで遊ぶ画面（人間1人 + AI 3人のローカル対戦）
```

今後 `server` パッケージ（オンライン対戦）を追加していく。

## 遊び方（ローカル）

```sh
npm install
npm run dev -w @bokoboko/client   # http://localhost:5173 を開く
```

- 追加のライブラリは使わず、TypeScript と SVG だけで描いている（ビルドも `tsc` のみ）
- 盤面の光っている場所をクリックして建てる。手番中の操作は右側（スマホでは下）のパネルから
- 「新しいゲーム」で CPU 3人の難易度（ランダム / ふつう）と手番順のランダム化を選べる
- CPU の速さは上のバーで変えられる

## エンジンの使い方

```ts
import { apply, awaitingSeats, createGame, legalActions, toPlayerView } from '@bokoboko/engine';

let state = createGame('some-seed');          // 同じシードなら同じ盤面・同じダイス
const seat = awaitingSeats(state)[0]!;        // 今入力を待っている席
const view = toPlayerView(state, seat);       // その席から見える情報だけ（UI と AI に渡す）
const options = legalActions(state, seat);    // その席が今取れる操作
state = apply(state, options[0]!);            // 不正な操作なら IllegalActionError
```

国内交易の提案・逆提案は条件が自由なので、`legalActions` には代表的な単純な条件（1:1・2:1・1:2）だけが並ぶ。
UI からはそれ以外の条件も `apply` にそのまま渡せる。

## エンジンの現状

| 機能 | 状態 |
| --- | --- |
| 盤面トポロジー（ヘックス19・頂点54・辺72、隣接テーブル） | 済 |
| ルール定数の `GameConfig` への集約 | 済 |
| シード付き乱数（同じシードで完全再現） | 済 |
| 盤面のランダム生成（6 と 8 は隣接させない、港9つ） | 済 |
| ゲーム状態・公開API（`createGame` / `legalActions` / `apply` / `toPlayerView`） | 済 |
| 初期配置フェーズ（距離ルール、逆順の2巡目、初期資源） | 済 |
| ダイス・資源の生産（銀行の在庫不足ルール含む） | 済 |
| 7 の目: 捨て札（同時入力）・盗賊の移動と略奪 | 済 |
| 建設（道・開拓地・都市）・海外交易（4:1 / 港 3:1・2:1）・手番終了 | 済 |
| 最長交易路・勝利判定（自分の手番中に10点） | 済 |
| 発展カード（購入、騎士・街道建設・収穫・独占、勝利点）・最大騎士力 | 済 |
| 国内交易（相手を指定して自由に提案、承認・拒否・逆提案、取り下げ、往復上限） | 済 |

## AI の現状

| 難易度 | 中身 | 強さの目安 |
| --- | --- | --- |
| 0: ランダム | 操作の種類を等確率で選び、その中からランダム | 比較の基準 |
| 1: ふつう（ルールベース） | 目標（開拓地・都市・道・発展カード）を決めて建設・交易・カード使用を優先度順に判断 | ランダム3人相手に100戦100勝、平均約70手番で決着 |

新しい AI は `packages/ai/src/registry.ts` に1行追加すると、難易度として選べるようになる。
`playMatch` で AI 同士を対戦させて強さを比べられる。

## 開発

Node.js 20 以上。

```sh
npm install        # 初回のみ。パッケージを追加・更新したら package-lock.json もコミットする
npm test           # 全パッケージのテスト
npm run typecheck  # 型チェック
```

## 設計方針（抜粋）

- ルールの数値はコードに直書きせず `GameConfig` に集める
- UI・サーバ・AI はエンジンの公開関数だけを使う
- 状態は「設定 + シード + アクション列」から完全に再現できるようにする
