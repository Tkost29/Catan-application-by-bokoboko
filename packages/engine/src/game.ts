import { generateBoard, topologyFor } from './board/generate.js';
import { DEFAULT_CONFIG, type GameConfig } from './config.js';
import { createRng, seedState } from './rng.js';
import type { DevCard, GameState, PlayerState } from './state.js';
import { RESOURCES, type ResourceCounts, type Seat } from './types.js';

export function emptyResources(): ResourceCounts {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

function fullBank(config: GameConfig): ResourceCounts {
  const bank = emptyResources();
  for (const r of RESOURCES) bank[r] = config.resourcesPerType;
  return bank;
}

function createPlayer(config: GameConfig, seat: Seat): PlayerState {
  return {
    seat,
    hand: emptyResources(),
    devCards: [],
    playedKnights: 0,
    piecesLeft: { ...config.pieceLimits },
  };
}

function createDevDeck(config: GameConfig, seed: string): DevCard[] {
  const cards = (Object.keys(config.devCardCounts) as DevCard[]).flatMap((card) =>
    Array<DevCard>(config.devCardCounts[card]).fill(card),
  );
  return createRng(`dev:${seed}`).shuffle(cards);
}

/**
 * 新しいゲームを作る。同じ config と seed からは必ず同じ初期状態になる。
 * 席0から初期配置を始める（席順のランダム化はルーム側で行う）。
 */
export function createGame(seed: string, config: GameConfig = DEFAULT_CONFIG): GameState {
  const topology = topologyFor(config);
  const board = generateBoard(config, seed);
  return {
    schemaVersion: 1,
    config,
    seed,
    board,
    buildings: topology.vertexPositions.map(() => null),
    roads: topology.edgeVertices.map(() => null),
    robberHex: board.initialRobberHex,
    players: Array.from({ length: config.playerCount }, (_, seat) => createPlayer(config, seat)),
    bank: fullBank(config),
    devDeck: createDevDeck(config, seed),
    longestRoad: null,
    largestArmy: null,
    phase: { kind: 'setup', round: 1, step: 'settlement', lastSettlement: null },
    turn: 0,
    currentSeat: 0,
    lastRoll: null,
    rngState: seedState(`game:${seed}`),
    winner: null,
  };
}
