"""開拓地が接するヘックス（資源×数字）の価値と、資源の組み合わせの良し悪しを推定する。

使い方:
    python3 hex_value.py --train train.csv [train2.csv ...] --valid valid.csv --out hex-summary.json

入力は src/export-hexes.ts が書き出す CSV（1行 = 1人の初期配置と勝敗）。

モデル（ロジスティック回帰）:
    勝ち負け ~ 資源ごとに「持っているか（0/1）」+「出やすさの合計」
              + 接する数字の種類数 + 手番順
    「持っているか」の係数が、その資源を初めて取るときの上乗せ分になる。
"""

from __future__ import annotations

import argparse
import itertools
import json
import math

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

RES = ["wood", "brick", "sheep", "wheat", "ore"]
JA = {"wood": "木材", "brick": "レンガ", "sheep": "羊毛", "wheat": "小麦", "ore": "鉱石"}
PIPS = {2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1}


def parse(cell: str) -> list[tuple[str, int]]:
    if not isinstance(cell, str) or not cell:
        return []
    return [(r, int(n)) for r, n in (x.split(":") for x in cell.split(";"))]


def features(df: pd.DataFrame, synergy: bool = False) -> pd.DataFrame:
    rows = []
    for s1, s2, seat in zip(df["s1"], df["s2"], df["seat"]):
        a, b = parse(s1), parse(s2)
        f: dict[str, float] = {}
        for r in RES:
            p = sum(PIPS[n] for rr, n in a + b if rr == r)
            f[f"has_{r}"] = 1.0 if p > 0 else 0.0
            f[f"pips_{r}"] = float(p)
        f["distinct"] = float(len({n for _, n in a + b}))
        # 出やすさに比例しない分の補正（6・8 は盗賊に狙われやすい、2・12 はほぼ出ない）
        f["n68"] = float(sum(1 for _, n in a + b if n in (6, 8)))
        f["n212"] = float(sum(1 for _, n in a + b if n in (2, 12)))
        for s in (1, 2, 3):
            f[f"seat_{s + 1}"] = 1.0 if seat == s else 0.0
        if synergy:
            # 同じ開拓地に鉱石と小麦（都市にしたとき両方2倍）/ 木材とレンガ（道と開拓地）がそろっているか
            def pair(settle, x, y):
                px = sum(PIPS[n] for rr, n in settle if rr == x)
                py = sum(PIPS[n] for rr, n in settle if rr == y)
                return min(px, py)

            f["ow_same"] = float(max(pair(a, "ore", "wheat"), pair(b, "ore", "wheat")))
            f["wb_same"] = float(max(pair(a, "wood", "brick"), pair(b, "wood", "brick")))
        rows.append(f)
    return pd.DataFrame(rows)


def fit(X: pd.DataFrame, y: pd.Series) -> LogisticRegression:
    return LogisticRegression(C=10.0, max_iter=5000).fit(X, y)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", nargs="+", required=True)
    ap.add_argument("--valid", required=True)
    ap.add_argument("--out", default="hex-summary.json")
    a = ap.parse_args()

    train = pd.concat([pd.read_csv(p) for p in a.train], ignore_index=True)
    valid = pd.read_csv(a.valid)
    print(f"学習 {len(train)} 人分 / 検証 {len(valid)} 人分（別の盤面）")

    out: dict = {}
    models = {}
    for name, syn in [("additive", False), ("synergy", True)]:
        Xt, Xv = features(train, syn), features(valid, syn)
        m = fit(Xt, train["win"])
        pv = m.predict_proba(Xv)[:, 1]
        auc, ll = roc_auc_score(valid["win"], pv), log_loss(valid["win"], pv)
        base_ll = log_loss(valid["win"], np.full(len(valid), valid["win"].mean()))
        print(f"[{name}] 検証 AUC {auc:.3f} / 対数損失 {ll:.4f}（何も見ない予測 {base_ll:.4f}）")
        models[name] = (m, list(Xt.columns))
        out[name] = {"auc": auc, "logLoss": ll, "baseLogLoss": base_ll,
                     "coef": dict(zip(Xt.columns, map(float, m.coef_[0])))}

    m, cols = models["additive"]
    coef = dict(zip(cols, m.coef_[0]))
    print("\n係数（対数オッズ）:")
    for r in RES:
        print(f"  {JA[r]}: 持っている {coef[f'has_{r}']:+.3f} / 出やすさ1あたり {coef[f'pips_{r}']:+.3f}")
    print(f"  数字の種類1つあたり {coef['distinct']:+.3f} / 6・8 1枚あたり {coef['n68']:+.3f} / 2・12 1枚あたり {coef['n212']:+.3f}")

    # 1ヘックスの点数。学習・検証の両方を合わせて推定し、「木材の出やすさ1つ分 = 1点」にそろえる
    all_rows = pd.concat([train, valid], ignore_index=True)
    Xa = features(all_rows, False)
    ma = fit(Xa, all_rows["win"])
    ca = dict(zip(Xa.columns, ma.coef_[0]))
    unit = ca["pips_wood"]
    print(f"\n6・8 の補正 {ca['n68'] / unit:+.2f}点 / 2・12 の補正 {ca['n212'] / unit:+.2f}点（1ヘックスあたり）")
    table = []
    for r in RES:
        for n in [2, 3, 4, 5, 6]:
            p = PIPS[n]
            held = ca[f"pips_{r}"] * p + (ca["n68"] if n == 6 else 0) + (ca["n212"] if n == 2 else 0)
            table.append({"resource": r, "number": f"{n}・{14 - n}", "pips": p,
                          "held": held / unit, "first": (held + ca[f"has_{r}"]) / unit})
    out["hexPoints"] = table
    out["hexPointsUnit"] = "木材の出やすさ1つ分 = 1点"
    print("1ヘックスの点数（木材の出やすさ1つ分=1点）: すでに持っている資源 / 初めての資源")
    print("        " + "".join(f"{x:>13}" for x in ["2・12", "3・11", "4・10", "5・9", "6・8"]))
    for r in RES:
        line = f"{JA[r]:>5} "
        for n in [2, 3, 4, 5, 6]:
            t = next(x for x in table if x["resource"] == r and x["pips"] == PIPS[n])
            line += f"   {t['held']:4.1f} / {t['first']:4.1f}"
        print(line)

    # 開拓地1軒の資源の組み合わせ: 実際の勝率と、加法モデルの予測との差（相乗効果があるか）
    both = pd.concat([train, valid], ignore_index=True)
    pred = m.predict_proba(features(both, False))[:, 1]
    both = both.assign(pred=pred)
    combos = []
    for col in ("s1", "s2"):
        for cell, win, pr in zip(both[col], both["win"], both["pred"]):
            hexes = parse(cell)
            if len(hexes) != 3:
                continue
            key = "・".join(JA[r] for r in sorted({r for r, _ in hexes}, key=RES.index))
            dup = len({r for r, _ in hexes}) < 3
            combos.append({"combo": key + ("（重複あり）" if dup else ""), "win": win, "pred": pr,
                           "pips": sum(PIPS[n] for _, n in hexes)})
    cdf = pd.DataFrame(combos)
    res = []
    for k, g in cdf.groupby("combo"):
        if len(g) < 400:
            continue
        diff = g["win"] - g["pred"]
        res.append({"combo": k, "n": int(len(g)), "winRate": float(g["win"].mean()), "avgPips": float(g["pips"].mean()),
                    "excess": float(diff.mean()), "excessSe": float(diff.std(ddof=1) / math.sqrt(len(g)))})
    res.sort(key=lambda x: -x["winRate"])
    out["settlementCombos"] = res
    print("\n開拓地1軒の資源の組み合わせ（3ヘックスとも陸、400件以上）")
    print(f"{'組み合わせ':<16}{'件数':>7}{'勝率':>8}{'平均出やすさ':>10}{'予測との差':>12}")
    for x in res:
        print(f"{x['combo']:<16}{x['n']:>7}{x['winRate'] * 100:>7.1f}%{x['avgPips']:>10.1f}{x['excess'] * 100:>+9.1f}±{1.96 * x['excessSe'] * 100:.1f}")

    with open(a.out, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"\n書き出し: {a.out}")


if __name__ == "__main__":
    main()
