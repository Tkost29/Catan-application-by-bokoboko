"""学習AIの判断の記録（src/decisions.ts）から、判断の基準を読み取れる形にする。

使い方:
    python3 decision_rules.py --learned decisions.jsonl [--rule decisions-rule.jsonl]

出すもの:
    - 都市か開拓地か（両方建てられるとき）: 都市を選ぶ割合と、それを分ける条件（深さ3の決定木）
    - 発展カードを買うか（勝利点になる建設ができないとき）: 買う割合と条件
    - 盗賊: 止めた・奪った相手が「一番脅威な相手」「点数が一番の相手」だった割合など
    比較のためにルールベースAIの記録も渡すと、並べて表示する。
"""

from __future__ import annotations

import argparse
import json

import pandas as pd
from sklearn.tree import DecisionTreeClassifier, export_text

JA = {
    "vp": "見えている点数", "vpCards": "勝利点カード", "settlements": "開拓地の数", "cities": "都市の数",
    "settlementsLeft": "残りの開拓地の駒", "spotsReachable": "道が届いている空き地", "bestSpot": "届く空き地の一番の価値",
    "spotsNear": "道2本以内の空き地", "prod_ore": "鉱石の生産", "prod_wheat": "小麦の生産", "prodTotal": "生産の合計",
    "handTotal": "手札の枚数", "missCity": "都市に足りない枚数", "missSettlement": "開拓地に足りない枚数",
    "devHeld": "手元の発展カード", "knights": "使った騎士", "armyGap": "騎士の差（自分−相手の最大）",
    "oppMaxVp": "相手の最高点", "vpGap": "点差（自分−相手の最高）", "turn": "手番数/100", "resourceTypes": "生産する資源の種類",
    "hasLargestArmy": "最大騎士力を持つ", "oppMaxKnights": "相手の最大騎士数",
}


def load(path: str) -> list[dict]:
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def frame(rows: list[dict], kind: str) -> pd.DataFrame:
    out = []
    for r in rows:
        if r.get("kind") != kind:
            continue
        d = {k: v for k, v in r.items() if k != "f"}
        d.update(r["f"])
        out.append(d)
    return pd.DataFrame(out)


def tree(df: pd.DataFrame, target: str, cols: list[str], depth: int = 3) -> str:
    X = df[cols].to_numpy()
    y = df[target].astype(int).to_numpy()
    t = DecisionTreeClassifier(max_depth=depth, min_samples_leaf=max(30, len(df) // 50), random_state=0).fit(X, y)
    names = [JA.get(c, c) for c in cols]
    return export_text(t, feature_names=names, show_weights=True, decimals=1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--learned", required=True)
    ap.add_argument("--rule")
    ap.add_argument("--out")
    a = ap.parse_args()
    sources = {"学習AI": load(a.learned)}
    if a.rule:
        sources["ルールベースAI"] = load(a.rule)
    summary: dict = {}

    for name, rows in sources.items():
        print(f"\n==================== {name} ====================")
        s: dict = {}
        # 都市か開拓地か
        b = frame(rows, "build")
        both = b[b["options"].apply(lambda o: "buildCity" in o and "buildSettlement" in o)].copy()
        both["city"] = both["chose"] == "buildCity"
        s["cityVsSettlement"] = {"n": int(len(both)), "cityShare": float(both["city"].mean())}
        print(f"\n■ 都市と開拓地の両方を建てられるとき（{len(both)}回）: 都市 {both['city'].mean() * 100:.0f}%")
        for col, bins in [("cities", [-1, 0, 1, 2, 9]), ("spotsReachable", [-1, 0, 1, 2, 30]), ("settlementsLeft", [-1, 0, 1, 2, 5])]:
            g = both.groupby(pd.cut(both[col], bins), observed=True)["city"].agg(["size", "mean"])
            print(f"  {JA[col]}別の都市の割合: " + ", ".join(f"{iv}: {m * 100:.0f}%({n})" for iv, (n, m) in g.iterrows()))
        cols = ["vp", "cities", "settlements", "settlementsLeft", "spotsReachable", "bestSpot", "prod_ore", "prod_wheat", "prodTotal", "oppMaxVp", "turn"]
        if both["city"].nunique() > 1:
            print(tree(both, "city", cols))

        # 発展カードを買うか
        d = frame(rows, "dev")
        s["devBuy"] = {"n": int(len(d)), "buyShare": float(d["bought"].mean())}
        print(f"\n■ 発展カードを買えて、勝利点になる建設はできないとき（{len(d)}回）: 買う {d['bought'].mean() * 100:.0f}%")
        if len(d) and d["bought"].nunique() > 1:
            print("  買わなかったときの手: " + ", ".join(f"{k} {v * 100:.0f}%" for k, v in d[~d["bought"]]["chose"].value_counts(normalize=True).items()))
            cols = ["vp", "handTotal", "missCity", "missSettlement", "spotsReachable", "spotsNear", "devHeld", "knights", "armyGap", "cities", "turn"]
            print(tree(d, "bought", cols))

        # 騎士
        k = frame(rows, "knight")
        if len(k):
            s["knight"] = {"n": int(len(k)), "playShare": float(k["played"].mean())}
            print(f"\n■ 騎士を使える局面（{len(k)}回）: 使う {k['played'].mean() * 100:.0f}%（サイコロ前 {k[k['phase'] == 'preRoll']['played'].mean() * 100:.0f}% / 手番中 {k[k['phase'] == 'main']['played'].mean() * 100:.0f}%）")

        # 盗賊
        r = frame(rows, "robber")
        with_victim = r[r["victim"].notna()]
        s["robber"] = {
            "n": int(len(r)),
            "blocksLeader": float(r["blocksLeader"].mean()),
            "blocksVpLeader": float(r["blocksVpLeader"].mean()),
            "multiple": float((r["blockedCount"] >= 2).mean()),
            "victimIsLeader": float(with_victim["victimIsLeader"].mean()),
            "victimIsVpLeader": float(with_victim["victimIsVpLeader"].mean()),
            "victimHasMostCards": float((with_victim["victimHand"] == with_victim["maxHand"]).mean()),
            "on68": float(r["hexNumber"].isin([6, 8]).mean()),
        }
        x = s["robber"]
        print(f"\n■ 盗賊（{len(r)}回）")
        print(f"  一番脅威な相手を止めた {x['blocksLeader'] * 100:.0f}% / 点数が一番の相手を止めた {x['blocksVpLeader'] * 100:.0f}% / 2人以上を止めた {x['multiple'] * 100:.0f}% / 6・8に置いた {x['on68'] * 100:.0f}%")
        print(f"  奪った相手: 一番脅威な相手 {x['victimIsLeader'] * 100:.0f}% / 点数が一番 {x['victimIsVpLeader'] * 100:.0f}% / 手札が一番多い {x['victimHasMostCards'] * 100:.0f}%")
        res = [rr for rr in rows if rr.get("kind") == "result"]
        s["winRate"] = sum(rr["win"] for rr in res) / max(1, len(res))
        print(f"\n  この記録での勝率 {s['winRate'] * 100:.1f}%（{len(res)}試合）")
        summary[name] = s

    if a.out:
        with open(a.out, "w") as f:
            json.dump(summary, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
