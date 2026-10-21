"""学習AI（難易度2）の評価関数を学習する。

使い方:
    python3 train_value.py --data gen0.*.csv [--gen 0] --json model.json [--ts ../../ai/src/learned/weights.ts]

入力: src/selfplay.ts data が書き出す CSV（1行 = あるプレイヤーの手番の終わりの局面と、その人が最後に勝ったか）
出力:
    --json  sim の自己対戦で読む重み（JSON）
    --ts    アプリに組み込む重み（weights.ts）

モデル: 標準化 → 全結合(64, ReLU) → 全結合(32, ReLU) → 出力（シグモイド）。
試合単位で1割を検証用に分け、ロジスティック回帰（線形）と比べて成績を表示する。
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler


def load(paths: list[str]) -> pd.DataFrame:
    frames = []
    header = None
    for p in paths:
        with open(p) as f:
            first = f.readline()
        if first.startswith("game,"):
            df = pd.read_csv(p)
            header = list(df.columns)
        else:
            if header is None:
                raise SystemExit(f"{p} has no header; pass a file with a header first")
            df = pd.read_csv(p, header=None, names=header)
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+")
    ap.add_argument("--json")
    ap.add_argument("--ts")
    ap.add_argument("--gen", type=int, default=0)
    ap.add_argument("--hidden", default="64,32")
    ap.add_argument("--max-rows", type=int, default=1_500_000)
    ap.add_argument("--drop", default="", help="使わない特徴量（カンマ区切り）")
    ap.add_argument("--from-json", help="学習せずに、この JSON の重みを --ts に書き出すだけ")
    a = ap.parse_args()

    if a.from_json:
        with open(a.from_json) as f:
            model = json.load(f)
        write_ts(a.ts, model)
        return

    df = load(a.data)
    drop = set(filter(None, a.drop.split(",")))
    feats = [c for c in df.columns if c not in ("game", "seat", "agent", "win") and c not in drop]
    games = df["game"].unique()
    rng = np.random.default_rng(0)
    valid_games = set(rng.choice(games, size=max(1, len(games) // 10), replace=False))
    is_valid = df["game"].isin(valid_games)
    train, valid = df[~is_valid], df[is_valid]
    if len(train) > a.max_rows:
        train = train.sample(a.max_rows, random_state=0)
    print(f"学習 {len(train)} 局面 / 検証 {len(valid)} 局面（{len(games)} 試合、勝ち {df['win'].mean():.3f}）")

    scaler = StandardScaler().fit(train[feats])
    Xt, Xv = scaler.transform(train[feats]), scaler.transform(valid[feats])
    yt, yv = train["win"].to_numpy(), valid["win"].to_numpy()

    base = log_loss(yv, np.full(len(yv), yt.mean()))
    lin = LogisticRegression(max_iter=2000, C=1.0).fit(Xt, yt)
    pl = lin.predict_proba(Xv)[:, 1]
    print(f"線形      AUC {roc_auc_score(yv, pl):.4f} / 対数損失 {log_loss(yv, pl):.4f}（何も見ない {base:.4f}）")

    hidden = tuple(int(x) for x in a.hidden.split(","))
    mlp = MLPClassifier(hidden_layer_sizes=hidden, activation="relu", alpha=1e-4, batch_size=512,
                        learning_rate_init=1e-3, max_iter=40, early_stopping=True, validation_fraction=0.1,
                        n_iter_no_change=4, random_state=0, verbose=False).fit(Xt, yt)
    pm = mlp.predict_proba(Xv)[:, 1]
    auc, ll = roc_auc_score(yv, pm), log_loss(yv, pm)
    print(f"ニューラル AUC {auc:.4f} / 対数損失 {ll:.4f}（{mlp.n_iter_} 回）")

    # 予測の当たり具合（予測した勝率ごとの実際の勝率）
    bins = pd.cut(pm, [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0])
    cal = pd.DataFrame({"bin": bins, "p": pm, "y": yv}).groupby("bin", observed=True).agg(n=("y", "size"), pred=("p", "mean"), real=("y", "mean"))
    print(cal.round(3).to_string())

    layers = [{"W": w.T.round(6).tolist(), "b": b.round(6).tolist()} for w, b in zip(mlp.coefs_, mlp.intercepts_)]
    model = {
        "features": feats,
        "mean": scaler.mean_.round(6).tolist(),
        "scale": scaler.scale_.round(6).tolist(),
        "layers": layers,
        "info": {"generation": a.gen, "trainRows": int(len(train)), "games": int(len(games)),
                 "validAuc": round(float(auc), 4), "validLogLoss": round(float(ll), 4)},
    }
    with open(a.json, "w") as f:
        json.dump(model, f)
    print(f"書き出し: {a.json}")
    if a.ts:
        write_ts(a.ts, model)


def write_ts(path: str, model: dict) -> None:
    info = model.get("info", {})
    with open(path, "w") as f:
        f.write("// 自動生成: packages/sim/analysis/train_value.py（手で編集しない）\n")
        f.write("import type { ValueModel } from './model.js';\n\n")
        f.write(f"/** 学習AIの評価関数（第{info.get('generation', '?')}世代、検証 AUC {info.get('validAuc', '?')}） */\n")
        f.write("export const VALUE_MODEL: ValueModel = ")
        f.write(json.dumps(model, ensure_ascii=False, separators=(",", ":")))
        f.write(";\n")
    print(f"書き出し: {path}")


if __name__ == "__main__":
    main()
