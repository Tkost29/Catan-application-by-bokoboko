import type { ActionOf } from '../actions.js';
import type { DevCard, GameState } from '../state.js';
import { emptyResources } from '../game.js';
import { RESOURCES, type Resource, type ResourceCounts, type Seat } from '../types.js';
import { hasResources, payToBank, takeFromBank, updatePlayer } from './common.js';
import { roadConnects } from './build.js';
import { updateLargestArmy, updateLongestRoad } from './score.js';

/**
 * 発展カード。
 * - 購入は main のみ。山札の一番上を引く（山札はゲーム開始時にシャッフル済み）
 * - 使用は preRoll と main で、1手番1枚まで。買ったその手番には使えない
 * - 勝利点カードは使わず、持っているだけで点になる
 */

/** 収穫カードの2枚（同じ資源なら2枚） */
function pairOf(a: Resource, b: Resource): ResourceCounts {
  const counts = emptyResources();
  counts[a] += 1;
  counts[b] += 1;
  return counts;
}

type PlayAction = ActionOf<'playKnight' | 'playRoadBuilding' | 'playYearOfPlenty' | 'playMonopoly'>;

const CARD_OF: Readonly<Record<PlayAction['type'], DevCard>> = {
  playKnight: 'knight',
  playRoadBuilding: 'roadBuilding',
  playYearOfPlenty: 'yearOfPlenty',
  playMonopoly: 'monopoly',
};

// ---------------------------------------------------------------------------
// 購入
// ---------------------------------------------------------------------------

export function validateBuyDevCard(state: GameState, action: ActionOf<'buyDevCard'>): string | null {
  if (state.devDeck.length === 0) return 'no development cards left';
  if (!hasResources(state.players[action.seat]!.hand, state.config.buildCosts.devCard)) return 'not enough resources';
  return null;
}

export function applyBuyDevCard(state: GameState, action: ActionOf<'buyDevCard'>): GameState {
  const paid = payToBank(state, action.seat, state.config.buildCosts.devCard);
  const [card, ...rest] = paid.devDeck;
  return {
    ...paid,
    devDeck: rest,
    players: updatePlayer(paid, action.seat, (p) => ({
      ...p,
      devCards: [...p.devCards, { card: card!, boughtTurn: state.turn }],
    })),
  };
}

// ---------------------------------------------------------------------------
// 使用（共通）
// ---------------------------------------------------------------------------

/** 今の手番で使えるそのカードを持っているか（買った手番のものは使えない） */
export function hasPlayableCard(state: GameState, seat: Seat, card: DevCard): boolean {
  return state.players[seat]!.devCards.some((c) => c.card === card && c.boughtTurn < state.turn);
}

/** 使えるカードを1枚手元から出し、使用済みにする */
function consumeCard(state: GameState, seat: Seat, card: DevCard): GameState {
  return {
    ...state,
    devCardPlayedThisTurn: true,
    players: updatePlayer(state, seat, (p) => {
      const i = p.devCards.findIndex((c) => c.card === card && c.boughtTurn < state.turn);
      return {
        ...p,
        devCards: p.devCards.filter((_, j) => j !== i),
        playedDevCards: [...p.playedDevCards, card],
      };
    }),
  };
}

export function validatePlayDevCard(state: GameState, action: PlayAction): string | null {
  if (state.devCardPlayedThisTurn) return 'only one development card per turn';
  if (!hasPlayableCard(state, action.seat, CARD_OF[action.type])) {
    return 'no playable card of that kind (cards bought this turn cannot be played)';
  }
  switch (action.type) {
    case 'playKnight':
      return null;
    case 'playRoadBuilding':
      return canPlaceFreeRoad(state, action.seat) ? null : 'no place to build a road';
    case 'playYearOfPlenty': {
      const [a, b] = action.resources;
      if (!RESOURCES.includes(a) || !RESOURCES.includes(b)) return 'unknown resource';
      return hasResources(state.bank, pairOf(a, b)) ? null : 'bank does not have those resources';
    }
    case 'playMonopoly':
      return RESOURCES.includes(action.resource) ? null : 'unknown resource';
  }
}

export function applyPlayDevCard(state: GameState, action: PlayAction): GameState {
  const { seat } = action;
  const used = consumeCard(state, seat, CARD_OF[action.type]);
  const returnTo = state.phase.kind === 'preRoll' ? 'preRoll' : 'main';

  switch (action.type) {
    case 'playKnight': {
      const counted: GameState = {
        ...used,
        players: updatePlayer(used, seat, (p) => ({ ...p, playedKnights: p.playedKnights + 1 })),
      };
      return { ...updateLargestArmy(counted, seat), phase: { kind: 'moveRobber', returnTo } };
    }
    case 'playRoadBuilding': {
      const remaining = Math.min(2, used.players[seat]!.piecesLeft.road);
      return { ...used, phase: { kind: 'roadBuilding', remaining, returnTo } };
    }
    case 'playYearOfPlenty': {
      return takeFromBank(used, seat, pairOf(...action.resources));
    }
    case 'playMonopoly': {
      const r = action.resource;
      const taken = used.players.reduce((sum, p) => (p.seat === seat ? sum : sum + p.hand[r]), 0);
      return {
        ...used,
        players: used.players.map((p) =>
          p.seat === seat ? { ...p, hand: { ...p.hand, [r]: p.hand[r] + taken } } : { ...p, hand: { ...p.hand, [r]: 0 } },
        ),
      };
    }
  }
}

/** preRoll / main で currentSeat が取りうる発展カード関連のアクション候補 */
export function devCardCandidates(state: GameState): ActionOf<'buyDevCard' | PlayAction['type']>[] {
  const seat = state.currentSeat;
  const out: ActionOf<'buyDevCard' | PlayAction['type']>[] = [
    { type: 'buyDevCard', seat },
    { type: 'playKnight', seat },
    { type: 'playRoadBuilding', seat },
  ];
  RESOURCES.forEach((a, i) => {
    for (const b of RESOURCES.slice(i)) out.push({ type: 'playYearOfPlenty', seat, resources: [a, b] });
  });
  for (const resource of RESOURCES) out.push({ type: 'playMonopoly', seat, resource });
  return out;
}

// ---------------------------------------------------------------------------
// 街道建設: 無料の道を最大2本
// ---------------------------------------------------------------------------

type RoadBuildingPhase = Extract<GameState['phase'], { kind: 'roadBuilding' }>;

/** 無料の道を置ける場所が1つでもあるか */
export function canPlaceFreeRoad(state: GameState, seat: Seat): boolean {
  if (state.players[seat]!.piecesLeft.road <= 0) return false;
  return state.roads.some((owner, edge) => owner === null && roadConnects(state, seat, edge));
}

export function validateFreeRoad(state: GameState, action: ActionOf<'buildRoad'>): string | null {
  const { seat, edge } = action;
  if (!Number.isInteger(edge) || edge < 0 || edge >= state.roads.length) return 'no such edge';
  if (state.players[seat]!.piecesLeft.road <= 0) return 'no roads left';
  if (state.roads[edge] !== null) return 'edge already has a road';
  if (!roadConnects(state, seat, edge)) return 'road must connect to your road or building';
  return null;
}

export function applyFreeRoad(state: GameState, phase: RoadBuildingPhase, action: ActionOf<'buildRoad'>): GameState {
  const roads = state.roads.slice();
  roads[action.edge] = action.seat;
  const placed = updateLongestRoad({
    ...state,
    roads,
    players: updatePlayer(state, action.seat, (p) => ({
      ...p,
      piecesLeft: { ...p.piecesLeft, road: p.piecesLeft.road - 1 },
    })),
  });
  const remaining = phase.remaining - 1;
  // 置き終わったか、もう置ける場所がなければ元のフェーズに戻る
  return remaining > 0 && canPlaceFreeRoad(placed, action.seat)
    ? { ...placed, phase: { ...phase, remaining } }
    : { ...placed, phase: { kind: phase.returnTo } };
}
