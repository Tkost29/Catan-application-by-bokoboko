"""盤面の資源の量と手番順によって、資源×数字の価値がどう変わるかを推定する。

使い方:
    python3 hex_context.py --hexes hex-train.csv [hex-valid.csv ...] --boards boards.csv --out hex-context.json

入力:
    hexes  : src/export-hexes.ts の CSV（1行 = 1人の初期配置と勝敗）
    boards : src/export-boards.ts の CSV（盤面ごとの資源別の出やすさの合計）

やること:
    1. 盤面の量で3段階（少ない / 普通 / 多い）に分け、それぞれで資源の点数を推定する
       （少ない = 資源ごとの下位25%、多い = 上位25%）。量の段階はその資源ごとに決まるので、
       5資源それぞれについて「その資源が少ない盤面だけ」で同じモデルを当てる。
    2. 手番順（1〜4番）ごとに同じモデルを当て、資源の点数を比べる。
    3. 1開拓地目と2開拓地目（初期資源がもらえる側）で、資源の価値が違うかを見る。
    点数は全データで推定した「木材の出やすさ1つ分」を1点とする（段階・手番間で同じ物差しにするため）。
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from hex_value import JA, PIPS, RES, features, parse


def fit(X: pd.DataFrame, y: pd.Series) -> dict[str, float]:
    m = LogisticRegression(C=10.0, max_iter=5000).fit(X, y)
    return dict(zip(X.columns, map(float, m.coef_[0])))


def boot_se(X: pd.DataFrame, y: pd.Series, keys: list[str], n: int = 40, seed: int = 0) -> dict[str, float]:
    rng = np.random.default_rng(seed)
    draws = {k: [] for k in keys}
    for _ in range(n):
        idx = rng.integers(0, len(X), len(X))
        c = fit(X.iloc[idx].reset_index(drop=True), y.iloc[idx].reset_index(drop=True))
        for k in keys:
            draws[k].append(c[k])
    return {k: float(np.std(v, ddof=1)) for k, v in draws.items()}


def points(c: dict[str, float], unit: float, r: str, pips: int) -> tuple[float, float]:
    """1ヘックスの点数（すでに持っている / 初めて）。6・8 と 2・12 の補正は入れない（資源同士の比較用）"""
    held = c[f"pips_{r}"] * pips
    return held / unit, (held + c[f"has_{r}"]) / unit


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hexes", nargs="+", required=True)
    ap.add_argument("--boards", required=True)
    ap.add_argument("--out", default="hex-context.json")
    ap.add_argument("--boot", type=int, default=40)
    a = ap.parse_args()

    df = pd.concat([pd.read_csv(p) for p in a.hexes], ignore_index=True)
    boards = pd.read_csv(a.boards)
    df = df.merge(boards, on="game", how="left", suffixes=("", "_supply"))
    X = features(df)
    y = df["win"]
    print(f"{len(df)} 人分 / {df['game'].nunique()} 盤面")

    base = fit(X, y)
    unit = base["pips_wood"]
    out: dict = {"unit": "木材の出やすさ1つ分 = 1点（全データ）", "n": len(df)}

    # 1. 盤面の量
    print("\n■ 盤面の量ごとの資源の点数（5・9 の1ヘックス: すでに持っている / 初めて）")
    print(f"{'資源':<6}{'盤面の量':<8}{'人数':>7}{'持っている':>10}{'初めて':>8}{'±(初めて)':>10}")
    scarcity = []
    for r in RES:
        q1, q3 = boards[r].quantile(0.25), boards[r].quantile(0.75)
        for label, mask in [("少ない", df[r] <= q1), ("普通", (df[r] > q1) & (df[r] < q3)), ("多い", df[r] >= q3)]:
            Xs, ys = X[mask].reset_index(drop=True), y[mask].reset_index(drop=True)
            c = fit(Xs, ys)
            se = boot_se(Xs, ys, [f"has_{r}", f"pips_{r}"], n=a.boot)
            held, first = points(c, unit, r, 4)
            first_se = float(np.hypot(se[f"has_{r}"], se[f"pips_{r}"] * 4)) / unit
            winrate_has = float(ys[Xs[f"has_{r}"] == 1].mean())
            winrate_not = float(ys[Xs[f"has_{r}"] == 0].mean())
            scarcity.append({"resource": r, "tier": label, "range": [float(boards[r].min() if label == "少ない" else (q1 + 1 if label == "普通" else q3)),
                                                                        float(q1 if label == "少ない" else (q3 - 1 if label == "普通" else boards[r].max()))],
                             "n": int(mask.sum()), "held": held, "first": first, "firstSe": first_se,
                             "winHas": winrate_has, "winNot": winrate_not, "pctNot": float((Xs[f"has_{r}"] == 0).mean())})
            print(f"{JA[r]:<6}{label:<8}{int(mask.sum()):>7}{held:>10.1f}{first:>8.1f}{1.96 * first_se:>9.1f}"
                  f"   持つ{winrate_has * 100:5.1f}% / 持たない{winrate_not * 100:5.1f}%（持たない人 {(Xs[f'has_{r}'] == 0).mean() * 100:.0f}%）")
    out["scarcity"] = scarcity

    # 2. 手番順
    print("\n■ 手番順ごとの資源の点数（5・9 の1ヘックス: すでに持っている / 初めて）")
    Xn = X.drop(columns=[c for c in X.columns if c.startswith("seat_")])
    seats = []
    for s in range(4):
        mask = df["seat"] == s
        Xs, ys = Xn[mask].reset_index(drop=True), y[mask].reset_index(drop=True)
        c = fit(Xs, ys)
        row = {"seat": s + 1, "n": int(mask.sum()), "winRate": float(ys.mean()),
               "distinct": c["distinct"] / unit, "n68": c["n68"] / unit, "n212": c["n212"] / unit}
        line = f"{s + 1}番 勝率{ys.mean() * 100:5.1f}% "
        for r in RES:
            held, first = points(c, unit, r, 4)
            row[r] = {"held": held, "first": first}
            line += f" {JA[r]} {held:4.1f}/{first:4.1f}"
        line += f"  数字の種類 {row['distinct']:+.1f}"
        seats.append(row)
        print(line)
    out["seats"] = seats

    # 手番順 × 資源の差の検定: 全データで seat×has / seat×pips の交互作用を入れ、1番との差を見る
    print("\n■ 手番順による違いの大きさ（1番と比べた「初めて」の点数の差、±は95%の幅）")
    Xi = X.copy()
    for s in (1, 2, 3):
        for r in RES:
            Xi[f"has_{r}_s{s + 1}"] = X[f"has_{r}"] * (df["seat"] == s)
            Xi[f"pips_{r}_s{s + 1}"] = X[f"pips_{r}"] * (df["seat"] == s)
    ci = fit(Xi, y)
    keys = [k for k in Xi.columns if "_s" in k and (k.startswith("has_") or k.startswith("pips_"))]
    se = boot_se(Xi, y, keys, n=a.boot)
    seat_diff = []
    for s in (2, 3, 4):
        line = f"{s}番 "
        for r in RES:
            d = (ci[f"has_{r}_s{s}"] + 4 * ci[f"pips_{r}_s{s}"]) / unit
            dse = float(np.hypot(se[f"has_{r}_s{s}"], 4 * se[f"pips_{r}_s{s}"])) / unit
            seat_diff.append({"seat": s, "resource": r, "diff": d, "se": dse})
            line += f" {JA[r]} {d:+4.1f}±{1.96 * dse:.1f}"
        print(line)
    out["seatDiff"] = seat_diff

    # 3. 1開拓地目と2開拓地目
    print("\n■ 1開拓地目と2開拓地目（初期資源がもらえる側）の出やすさ1つあたりの点数")
    rows = []
    for s1, s2 in zip(df["s1"], df["s2"]):
        f = {}
        for tag, cell in (("a", s1), ("b", s2)):
            for r in RES:
                f[f"{tag}_{r}"] = float(sum(PIPS[n] for rr, n in parse(cell) if rr == r))
        rows.append(f)
    Xo = pd.concat([X.drop(columns=[f"pips_{r}" for r in RES]), pd.DataFrame(rows)], axis=1)
    co = fit(Xo, y)
    order = []
    for r in RES:
        order.append({"resource": r, "first": co[f"a_{r}"] / unit, "second": co[f"b_{r}"] / unit})
        print(f"  {JA[r]}: 1軒目 {co[f'a_{r}'] / unit:.2f} / 2軒目 {co[f'b_{r}'] / unit:.2f}")
    out["settlementOrder"] = order

    with open(a.out, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"\n書き出し: {a.out}")


if __name__ == "__main__":
    main()
