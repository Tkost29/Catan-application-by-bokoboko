import type { GameState, PlayerState } from './state.js';
import type { Seat } from './types.js';

/** 他プレイヤーについて公開される情報（手札は枚数のみ） */
export interface OpponentView {
  readonly seat: Seat;
  readonly handCount: number;
  readonly devCardCount: number;
  readonly playedKnights: number;
  readonly piecesLeft: PlayerState['piecesLeft'];
}

/**
 * あるプレイヤーから見たゲーム状態。人間のクライアントにも AI にもこれだけを渡す。
 * 他人の手札・発展カード、山札の中身、乱数の状態とシード（＝今後のダイス）は含めない。
 */
export interface PlayerView {
  readonly seat: Seat;
  readonly config: GameState['config'];
  readonly board: GameState['board'];
  readonly buildings: GameState['buildings'];
  readonly roads: GameState['roads'];
  readonly robberHex: GameState['robberHex'];
  readonly bank: GameState['bank'];
  readonly devDeckCount: number;
  readonly longestRoad: GameState['longestRoad'];
  readonly largestArmy: GameState['largestArmy'];
  readonly phase: GameState['phase'];
  readonly turn: number;
  readonly currentSeat: Seat;
  readonly winner: Seat | null;
  readonly me: PlayerState;
  readonly opponents: readonly OpponentView[];
}

const sumCounts = (counts: Record<string, number>): number => Object.values(counts).reduce((a, b) => a + b, 0);

export function toPlayerView(state: GameState, seat: Seat): PlayerView {
  const me = state.players.find((p) => p.seat === seat);
  if (me === undefined) throw new Error(`no player at seat ${seat}`);
  return {
    seat,
    config: state.config,
    board: state.board,
    buildings: state.buildings,
    roads: state.roads,
    robberHex: state.robberHex,
    bank: state.bank,
    devDeckCount: state.devDeck.length,
    longestRoad: state.longestRoad,
    largestArmy: state.largestArmy,
    phase: state.phase,
    turn: state.turn,
    currentSeat: state.currentSeat,
    winner: state.winner,
    me,
    opponents: state.players
      .filter((p) => p.seat !== seat)
      .map((p) => ({
        seat: p.seat,
        handCount: sumCounts(p.hand),
        devCardCount: p.devCards.length,
        playedKnights: p.playedKnights,
        piecesLeft: p.piecesLeft,
      })),
  };
}
