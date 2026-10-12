import { RuleBasedAgent, strategyOf, type PlacementPreset, type PlayPreset } from '@bokoboko/ai';
import {
  apply,
  awaitingSeats,
  createGame,
  legalActions,
  RESOURCES,
  toPlayerView,
  type GameState,
  type Seat,
  type VertexId,
} from '@bokoboko/engine';
import { placementFeatures, playerOutcome, type PlacementFeatures, type PlayerOutcome } from './features.js';

/** 1席分の方針 */
export interface SeatStrategy {
  readonly placement: PlacementPreset;
  readonly play: PlayPreset;
}

/** 1試合・1席分の記録（分析の1行） */
export interface PlayerRecord {
  readonly experiment: string;
  readonly game: string;
  /** 手番順（0 が最初） */
  readonly seat: Seat;
  /** 方針を変えた「試す席」か（それ以外は標準AI） */
  readonly test: boolean;
  readonly placement: PlacementPreset;
  readonly play: PlayPreset;
  /** 試合の長さ（手番数） */
  readonly turns: number;
  /** 手数の上限で打ち切ったか */
  readonly unfinished: boolean;
  readonly features: PlacementFeatures;
  readonly outcome: PlayerOutcome;
}

const MAX_STEPS = 60_000;

/**
 * 4人の方針を指定して1試合を最後まで行い、席ごとの記録を返す。
 * 盤面は boardSeed で決まるので、同じ boardSeed なら方針だけを変えて比べられる。
 */
export function runGame(
  experiment: string,
  boardSeed: string,
  strategies: readonly SeatStrategy[],
  testSeat: Seat | null,
): PlayerRecord[] {
  const agents = strategies.map(
    (s, seat) => new RuleBasedAgent(`${boardSeed}:${seat}:${s.placement}:${s.play}`, strategyOf(s.placement, s.play)),
  );
  let state: GameState = createGame(boardSeed);
  const n = state.players.length;
  const settlementsPlaced: VertexId[][] = state.players.map(() => []);
  const startCards: number[] = state.players.map(() => 0);
  const devBought: number[] = state.players.map(() => 0);
  const firstCity: (number | null)[] = state.players.map(() => null);
  const thirdSettlement: (number | null)[] = state.players.map(() => null);
  let afterSetup: GameState | null = null;

  for (let step = 0; step < MAX_STEPS && state.winner === null; step++) {
    const seat = awaitingSeats(state)[0]!;
    const before = state;
    const action = agents[seat]!.decide(toPlayerView(state, seat), legalActions(state, seat));
    state = apply(state, action);

    if (action.type === 'placeSettlement') {
      settlementsPlaced[seat]!.push(action.vertex);
      if (before.phase.kind === 'setup' && before.phase.round === 2) {
        startCards[seat] = RESOURCES.reduce((s, r) => s + state.players[seat]!.hand[r], 0);
      }
    }
    if (action.type === 'buyDevCard') devBought[seat]! += 1;
    if (action.type === 'buildCity' && firstCity[seat] === null) firstCity[seat] = state.turn;
    if (action.type === 'buildSettlement' && settlementsPlaced[seat]!.push(action.vertex) === 3) {
      thirdSettlement[seat] = state.turn;
    }
    if (afterSetup === null && state.phase.kind !== 'setup') afterSetup = state;
  }

  const setupState = afterSetup ?? state;
  return Array.from({ length: n }, (_, seat) => ({
    experiment,
    game: boardSeed,
    seat,
    test: seat === testSeat,
    placement: strategies[seat]!.placement,
    play: strategies[seat]!.play,
    turns: state.turn,
    unfinished: state.winner === null,
    features: placementFeatures(
      setupState,
      seat,
      [settlementsPlaced[seat]![0]!, settlementsPlaced[seat]![1]!],
      startCards[seat]!,
    ),
    outcome: playerOutcome(state, seat, devBought[seat]!, firstCity[seat]!, thirdSettlement[seat]!),
  }));
}
