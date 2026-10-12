"""シミュレーション結果（JSON Lines）を集計して、戦略の勝ちやすさをまとめる。

使い方:
    python3 analyze.py --baseline baseline*.jsonl --grid grid*.jsonl --out summary.json

出力:
    - 標準出力に表
    - summary.json にレポート用の数値
"""

from __future__ import annotations

import argparse
import glob
import json
import math

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

RES = ["wood", "brick", "sheep", "wheat", "ore"]
Z = 1.96  # 95% 信頼区間


def load(patterns: list[str]) -> pd.DataFrame:
    rows = []
    for pat in patterns:
        for path in sorted(glob.glob(pat)):
            with open(path) as f:
                for line in f:
                    if not line.strip():
                        continue
                    r = json.loads(line)
                    flat = {k: v for k, v in r.items() if k not in ("features", "outcome")}
                    feat = r["features"]
                    for k, v in feat.items():
                        if k == "pips":
                            for res, p in v.items():
                                flat[f"pips_{res}"] = p
                        elif k != "vertices":
                            flat[k] = v
                    for k, v in r["outcome"].items():
                        flat[k] = v
                    rows.append(flat)
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["win"] = df["win"].astype(int)
    df["ow"] = df["pips_ore"] + df["pips_wheat"]
    df["wb"] = df["pips_wood"] + df["pips_brick"]
    df["profile"] = np.where(df["ow"] >= df["wb"] + 3, "鉱石・小麦寄り", np.where(df["wb"] >= df["ow"] + 3, "木材・レンガ寄り", "中間"))
    return df


def rate(wins: int, n: int) -> dict:
    """勝率と Wilson の 95% 信頼区間"""
    if n == 0:
        return {"n": 0, "rate": None, "lo": None, "hi": None}
    p = wins / n
    denom = 1 + Z**2 / n
    center = (p + Z**2 / (2 * n)) / denom
    half = Z * math.sqrt(p * (1 - p) / n + Z**2 / (4 * n * n)) / denom
    return {"n": n, "rate": p, "lo": center - half, "hi": center + half}


def fmt(r: dict) -> str:
    if r["rate"] is None:
        return "   -   "
    return f"{r['rate']*100:5.1f}% [{r['lo']*100:4.1f}-{r['hi']*100:4.1f}] n={r['n']}"


def vp_sources(df: pd.DataFrame) -> dict:
    """勝利点の内訳の平均"""
    return {
        "settlements": float(df["settlements"].mean()),
        "cities": float((df["cities"] * 2).mean()),
        "longestRoad": float((df["longestRoad"].astype(int) * 2).mean()),
        "largestArmy": float((df["largestArmy"].astype(int) * 2).mean()),
        "vpCards": float(df["vpCards"].mean()),
    }


def analyze_baseline(df: pd.DataFrame) -> dict:
    out: dict = {}
    games = df["game"].nunique()
    print(f"\n=== 標準AI 4人の対戦: {games} 試合 ===")
    print(f"打ち切り: {int(df.groupby('game')['unfinished'].first().sum())} 試合 / 平均手番数 {df.groupby('game')['turns'].first().mean():.1f}")

    seats = []
    for seat, g in df.groupby("seat"):
        r = rate(int(g["win"].sum()), len(g))
        seats.append({"seat": int(seat), **r})
        print(f"手番 {seat + 1}番目: {fmt(r)}")
    out["seat"] = seats

    winners = df[df["win"] == 1]
    out["winnerVp"] = vp_sources(winners)
    out["games"] = games
    out["avgTurns"] = float(df.groupby("game")["turns"].first().mean())
    print("勝者の勝利点の内訳（平均）:", {k: round(v, 2) for k, v in out["winnerVp"].items()})

    # 配置の特徴ごとの勝率
    out["bins"] = {}

    def binned(col: str, bins: list, labels: list[str]) -> None:
        cut = pd.cut(df[col], bins=bins, labels=labels, right=False)
        res = []
        print(f"\n-- {col} 別の勝率 --")
        for lab in labels:
            g = df[cut == lab]
            r = rate(int(g["win"].sum()), len(g))
            res.append({"bin": lab, **r})
            print(f"{lab:>10}: {fmt(r)}")
        out["bins"][col] = res

    binned("totalPips", [0, 16, 19, 22, 25, 100], ["〜15", "16〜18", "19〜21", "22〜24", "25〜"])
    binned("resourceTypes", [0, 3, 4, 5, 6], ["2種以下", "3種", "4種", "5種"])
    binned("ow", [0, 4, 8, 12, 100], ["〜3", "4〜7", "8〜11", "12〜"])
    binned("wb", [0, 4, 8, 12, 100], ["〜3", "4〜7", "8〜11", "12〜"])
    binned("expansionSpots", [0, 2, 4, 6, 100], ["0〜1", "2〜3", "4〜5", "6〜"])

    res = []
    print("\n-- 港 別の勝率 --")
    for port in ["none", "generic", "special", "matched"]:
        g = df[df["port"] == port]
        r = rate(int(g["win"].sum()), len(g))
        res.append({"bin": port, **r})
        print(f"{port:>10}: {fmt(r)}")
    out["bins"]["port"] = res

    out["logit"] = logistic(df)

    # その資源が取れない人の勝率
    print("\n-- 初期配置で取れない資源別の勝率 --")
    out["missing"] = []
    for r in RES:
        g = df[df[f"pips_{r}"] == 0]
        rr = rate(int(g["win"].sum()), len(g))
        out["missing"].append({"resource": r, "share": len(g) / len(df), **rr})
        print(f"{r:>6}（{len(g) / len(df) * 100:4.1f}%の人）: {fmt(rr)}")

    # 接する数字の種類数（出やすさの合計はほぼ同じ）
    out["bins"]["distinctNumbers"] = []
    print("\n-- 接する数字の種類数別の勝率 --")
    for k, g in df.groupby("distinctNumbers"):
        if len(g) < 100:
            continue
        rr = rate(int(g["win"].sum()), len(g))
        out["bins"]["distinctNumbers"].append({"bin": int(k), "avgPips": float(g["totalPips"].mean()), **rr})
        print(f"{k}種: {fmt(rr)} 平均pips {g['totalPips'].mean():.1f}")

    # 建設の速さ（相関であって因果ではない）
    def timing(col: str, edges: list[tuple[int, int, str]]) -> list[dict]:
        t = df[col].fillna(10**6)
        res = []
        for lo, hi, lab in edges:
            g = df[(t >= lo) & (t < hi)]
            res.append({"bin": lab, **rate(int(g["win"].sum()), len(g))})
            print(f"{lab:>8}: {fmt(res[-1])}")
        return res

    print("\n-- 3軒目の開拓地を建てた手番別の勝率 --")
    out["thirdSettlement"] = timing("thirdSettlementTurn", [(0, 15, "〜14"), (15, 25, "15〜24"), (25, 40, "25〜39"), (40, 10**6, "40〜"), (10**6, 10**6 + 1, "建てず")])
    print("\n-- 最初の都市を建てた手番別の勝率 --")
    out["firstCity"] = timing("firstCityTurn", [(0, 20, "〜19"), (20, 35, "20〜34"), (35, 50, "35〜49"), (50, 10**6, "50〜"), (10**6, 10**6 + 1, "建てず")])

    # 配置の型ごとの勝率と、勝者の勝利点の内訳
    out["profiles"] = []
    print("\n-- 配置の型ごとの勝率と勝ち方 --")
    for pf in ["鉱石・小麦寄り", "中間", "木材・レンガ寄り"]:
        g = df[df["profile"] == pf]
        w = g[g["win"] == 1]
        d = {"profile": pf, "share": len(g) / len(df), **rate(int(g["win"].sum()), len(g)), **vp_sources(w),
             "devBought": float(w["devBought"].mean()), "roads": float(w["roads"].mean())}
        out["profiles"].append(d)
        print(pf, fmt(rate(int(g["win"].sum()), len(g))), {k: round(v, 2) for k, v in vp_sources(w).items()}, "発展購入", round(d["devBought"], 1))
    return out


def logistic(df: pd.DataFrame) -> dict:
    """配置の特徴と手番順から勝ち負けを予測するロジスティック回帰（標準化した係数）"""
    feats = ["totalPips", "pips_wood", "pips_brick", "pips_sheep", "pips_wheat", "pips_ore", "resourceTypes", "distinctNumbers", "expansionSpots"]
    X = df[feats].astype(float).copy()
    for p in ["generic", "special", "matched"]:
        X[f"port_{p}"] = (df["port"] == p).astype(float)
    for s in [1, 2, 3]:
        X[f"seat_{s + 1}"] = (df["seat"] == s).astype(float)
    # totalPips は資源別の合計と一次従属なので、資源別だけを使う
    X = X.drop(columns=["totalPips"])
    mu, sd = X.mean(), X.std().replace(0, 1)
    Xs = (X - mu) / sd
    model = LogisticRegression(C=1.0, max_iter=2000).fit(Xs, df["win"])
    coefs = sorted(zip(Xs.columns, model.coef_[0]), key=lambda x: -abs(x[1]))
    print("\n-- 勝ち負けへの影響（ロジスティック回帰の標準化係数。+ は勝ちやすい） --")
    for k, v in coefs:
        print(f"{k:>16}: {v:+.3f}")
    # 予測の当たりやすさ（参考）
    from sklearn.metrics import roc_auc_score

    auc = roc_auc_score(df["win"], model.predict_proba(Xs)[:, 1])
    print(f"AUC: {auc:.3f}")
    # 資源の出やすさ 1 あたりの勝ちやすさ（標準化を戻した係数 = 対数オッズ / pip）
    per_pip = {r: float(model.coef_[0][list(Xs.columns).index(f"pips_{r}")] / sd[f"pips_{r}"]) for r in RES}
    print("1pip あたりの対数オッズ:", {k: round(v, 3) for k, v in per_pip.items()})
    return {"coef": [{"feature": k, "coef": float(v)} for k, v in coefs], "auc": float(auc), "perPip": per_pip}


def analyze_grid(df: pd.DataFrame) -> dict:
    out: dict = {}
    t = df[df["test"]].copy()
    boards = t["game"].nunique()
    print(f"\n=== 1席だけ方針を変えた対戦: {boards} 盤面 × {t.groupby(['placement', 'play']).ngroups} 通り ===")
    placements = list(dict.fromkeys(t["placement"]))
    plays = list(dict.fromkeys(t["play"]))

    # 基準（標準 × 標準）と同じ盤面・同じ席での差（対応のある比較）
    base = t[(t["placement"] == "standard") & (t["play"] == "standard")].set_index("game")["win"]
    cells = []
    print(f"{'':>12}" + "".join(f"{p:>34}" for p in plays))
    for pl in placements:
        line = f"{pl:>12}"
        for py in plays:
            g = t[(t["placement"] == pl) & (t["play"] == py)]
            r = rate(int(g["win"].sum()), len(g))
            diff = g.set_index("game")["win"] - base.reindex(g["game"]).values
            se = diff.std(ddof=1) / math.sqrt(len(diff)) if len(diff) > 1 else float("nan")
            cells.append({"placement": pl, "play": py, **r, "diff": float(diff.mean()), "diffLo": float(diff.mean() - Z * se), "diffHi": float(diff.mean() + Z * se),
                          "avgVp": float(g["vp"].mean()), "avgTurnsWhenWin": float(g[g["win"] == 1]["turns"].mean()) if g["win"].sum() else None})
            line += f"{fmt(r):>34}"
        print(line)
    out["cells"] = cells

    # 勝ち方: 方針ごとの勝者の勝利点の内訳と、建設の速さ
    out["howWin"] = []
    for (pl, py), g in t.groupby(["placement", "play"]):
        w = g[g["win"] == 1]
        if len(w) == 0:
            continue
        out["howWin"].append({"placement": pl, "play": py, "wins": int(len(w)), **vp_sources(w),
                              "devBought": float(w["devBought"].mean()), "roads": float(w["roads"].mean()),
                              "thirdSettlementTurn": float(w["thirdSettlementTurn"].median()) if w["thirdSettlementTurn"].notna().any() else None,
                              "firstCityTurn": float(w["firstCityTurn"].median()) if w["firstCityTurn"].notna().any() else None})

    # 実際に置いた配置の型 × 手番中の方針（ランダム配置は除く）
    print("\n-- 実際の配置の型 × 手番中の方針（試す席の勝率） --")
    tt = t[t["placement"] != "random"]
    prof = []
    for pf in ["鉱石・小麦寄り", "中間", "木材・レンガ寄り"]:
        line = f"{pf:>10}"
        for py in plays:
            g = tt[(tt["profile"] == pf) & (tt["play"] == py)]
            r = rate(int(g["win"].sum()), len(g))
            prof.append({"profile": pf, "play": py, **r})
            line += f"{fmt(r):>34}"
        print(line)
    out["profile"] = prof

    # 手番順 × 配置の方針（手番中は標準）
    print("\n-- 手番順 × 配置の方針（手番中は標準、試す席の勝率） --")
    seat_pl = []
    for pl in placements:
        line = f"{pl:>12}"
        for seat in range(4):
            g = t[(t["placement"] == pl) & (t["play"] == "standard") & (t["seat"] == seat)]
            r = rate(int(g["win"].sum()), len(g))
            seat_pl.append({"placement": pl, "seat": seat, **r})
            line += f"{fmt(r):>32}"
        print(line)
    out["seatPlacement"] = seat_pl

    # 配置の方針ごとの、実際の配置の特徴（平均）
    out["placementTraits"] = []
    print("\n-- 配置の方針ごとの実際の配置（平均） --")
    for pl, g in t[t["play"] == "standard"].groupby("placement", sort=False):
        d = {"placement": pl, "totalPips": float(g["totalPips"].mean()), "ow": float(g["ow"].mean()), "wb": float(g["wb"].mean()),
             "sheep": float(g["pips_sheep"].mean()), "resourceTypes": float(g["resourceTypes"].mean()),
             "expansionSpots": float(g["expansionSpots"].mean()), "portRate": float((g["port"] != "none").mean())}
        out["placementTraits"].append(d)
        print(pl, {k: round(v, 2) if isinstance(v, float) else v for k, v in d.items() if k != "placement"})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", nargs="*", default=[])
    ap.add_argument("--grid", nargs="*", default=[])
    ap.add_argument("--out", default="summary.json")
    a = ap.parse_args()
    summary: dict = {}
    b = load(a.baseline)
    if not b.empty:
        summary["baseline"] = analyze_baseline(b)
    g = load(a.grid)
    if not g.empty:
        summary["grid"] = analyze_grid(g)
    with open(a.out, "w") as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    print(f"\n書き出し: {a.out}")


if __name__ == "__main__":
    main()
