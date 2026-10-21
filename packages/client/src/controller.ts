import { createAgent, type Agent, type AiLevel } from '@bokoboko/ai';
import {
  apply,
  awaitingSeats,
  createGame,
  createRng,
  legalActions,
  RESOURCES,
  toPlayerView,
  tradeRate,
  validateAction,
  victoryPoints,
  type Action,
  type GameState,
  type PlayerView,
  type Resource,
  type ResourceCounts,
  type Seat,
  type TradeTerms,
} from '@bokoboko/engine';
import { DEV_LABEL, formatCounts, RESOURCE_LABEL, seatNames, TERRAIN_LABEL } from './labels.js';

/** 新しいゲームの設定（ルームの設定に相当） */
export interface GameSettings {
  /** CPU の難易度（手番順。ふつうは3席分、観戦なら4席分） */
  readonly aiLevels: readonly AiLevel[];
  /** 観戦: 4席ともCPUにして、人間は見るだけ */
  readonly spectate?: boolean;
  /** 自分の席（手番順）をランダムにするか。false なら最初の手番 */
  readonly randomSeat: boolean;
  readonly seed: string;
}

export interface LogEntry {
  readonly seat: Seat | null;
  readonly text: string;
}

/**
 * ローカル対戦（人間1人 + AI 3人、または観戦用に AI 4人）の進行役。
 * ゲーム状態はここだけが持ち、画面には人間の席の PlayerView だけを渡す。
 * 観戦では、そのとき手番（入力待ち）の CPU の PlayerView を渡し、全員の手札も見せる。
 * サーバ版ではこの役割がサーバに移る。
 */
export class LocalGame {
  state: GameState;
  /** 人間の席。観戦なら -1（どの席でもない） */
  readonly humanSeat: Seat;
  readonly spectator: boolean;
  readonly names: readonly string[];
  readonly agents: readonly (Agent | null)[];
  readonly log: LogEntry[] = [];

  constructor(readonly settings: GameSettings) {
    this.state = createGame(settings.seed);
    const count = this.state.players.length;
    this.spectator = settings.spectate === true;
    this.humanSeat = this.spectator ? -1 : settings.randomSeat ? createRng(`seat:${settings.seed}`).int(count) : 0;
    this.names = seatNames(count, this.humanSeat);
    let cpu = 0;
    this.agents = this.state.players.map((p) =>
      p.seat === this.humanSeat ? null : createAgent(settings.aiLevels[cpu++] ?? 1, `${settings.seed}:${p.seat}`),
    );
    this.log.push({
      seat: null,
      text: this.spectator ? 'ゲーム開始（観戦: CPU 4人の対戦）' : `ゲーム開始。あなたは${this.humanSeat + 1}番手です`,
    });
  }

  /** 画面に見せる席。観戦なら入力待ちの席（いなければ手番の席） */
  viewSeat(): Seat {
    if (!this.spectator) return this.humanSeat;
    return awaitingSeats(this.state)[0] ?? this.state.currentSeat;
  }

  view(): PlayerView {
    return toPlayerView(this.state, this.viewSeat());
  }

  /** 人間が今取れる操作（観戦では何もない） */
  legal(): Action[] {
    if (this.spectator) return [];
    return legalActions(this.state, this.humanSeat);
  }

  /** 席の手札（観戦のときだけ全員分を見せる） */
  handOf(seat: Seat): ResourceCounts | null {
    return this.spectator || seat === this.humanSeat ? this.state.players[seat]!.hand : null;
  }

  /** 人間の操作を適用する。不正なら理由を返す */
  act(action: Action): string | null {
    if (this.spectator) return '観戦中は操作できません';
    if (action.seat !== this.humanSeat) return 'あなたの席の操作ではありません';
    const reason = validateAction(this.state, action);
    if (reason !== null) return reason;
    this.commit(action);
    return null;
  }

  /**
   * 画面に出す勝利点。自分の分と、ゲーム終了後は全員分を勝利点カード込みで、
   * それ以外は他人から見える点（勝利点カードを除く）を返す。
   */
  points(seat: Seat): number {
    const reveal = this.spectator || seat === this.humanSeat || this.state.winner !== null;
    return victoryPoints(this.state, seat, reveal);
  }

  /** 伏せられている勝利点カードの枚数（ゲーム終了後の公開用） */
  hiddenPointCards(seat: Seat): number {
    return this.state.players[seat]!.devCards.filter((c) => c.card === 'victoryPoint').length;
  }

  /** 人間が resource を銀行・港で交換するときのレート */
  bankRate(resource: Resource): number {
    return tradeRate(this.state, this.humanSeat, resource);
  }

  /**
   * 交渉画面の下書き（自分から見た「出す・もらう」）を、提案者から見た条件に変換して操作にする。
   * 新規の提案なら proposeTrade、交渉中なら counterTrade。
   */
  tradeAction(draft: TradeDraft): Action {
    const myGive = nonZero(draft.myGive);
    const myGet = nonZero(draft.myGet);
    const phase = this.state.phase;
    if (draft.counter && phase.kind === 'negotiating') {
      const iAmProposer = phase.trade.proposer === this.humanSeat;
      const terms: TradeTerms = iAmProposer ? { give: myGive, receive: myGet } : { give: myGet, receive: myGive };
      return { type: 'counterTrade', seat: this.humanSeat, terms };
    }
    return { type: 'proposeTrade', seat: this.humanSeat, to: draft.to, terms: { give: myGive, receive: myGet } };
  }

  /** 下書きが送れない理由（送れるなら null） */
  tradeProblem(draft: TradeDraft): string | null {
    const action = this.tradeAction(draft);
    const reason = validateAction(this.state, action);
    if (reason === null) return null;
    if (reason.includes('no gifts')) return '出す札ともらう札を1枚以上ずつ選んでください。';
    if (reason.includes('same resource')) return '同じ資源を出す側ともらう側の両方には入れられません。';
    if (reason.includes('must change')) return '今の条件から何か変えてください。';
    if (reason.includes('do not have')) return '手札が足りません。';
    if (reason.includes('limit')) return 'これ以上は条件を返せません。応じるか断ってください。';
    return reason;
  }

  /** 募集の入力が送れない理由（送れるなら null） */
  requestProblem(want: ResourceCounts, offer: ResourceCounts): string | null {
    const { phase, currentSeat, winner } = this.state;
    if (winner !== null || phase.kind !== 'main' || currentSeat !== this.humanSeat) return '今は交換を募集できません。';
    if (RESOURCES.every((r) => want[r] === 0)) return 'ほしい物を1枚以上選んでください。';
    if (RESOURCES.every((r) => offer[r] === 0)) return 'あげてもいい物を1枚以上選んでください。';
    if (RESOURCES.some((r) => want[r] > 0 && offer[r] > 0)) return '同じ資源を「ほしい」と「あげてもいい」の両方には入れられません。';
    return null;
  }

  /**
   * 交換を募集し、各 CPU が出した条件を集める（ゲームの状態は変わらない）。
   * 条件は自分（募集した人）から見た向き。選んで提案すれば、その CPU は必ず応じる。
   */
  askForOffers(want: ResourceCounts, offer: ResourceCounts): { seat: Seat; terms: TradeTerms | null }[] {
    if (this.requestProblem(want, offer) !== null) return [];
    const request = { from: this.humanSeat, want: nonZero(want), offer: nonZero(offer) };
    this.log.push({
      seat: this.humanSeat,
      text: `${this.names[this.humanSeat]}が交換を募集: ${formatCounts(request.want)}がほしい（${formatCounts(request.offer)}まで出せる）`,
    });
    return this.state.players
      .filter((p) => p.seat !== this.humanSeat)
      .map((p) => {
        const agent = this.agents[p.seat];
        const terms = agent?.answerRequest?.(toPlayerView(this.state, p.seat), request) ?? null;
        const ok =
          terms !== null &&
          validateAction(this.state, { type: 'proposeTrade', seat: this.humanSeat, to: p.seat, terms }) === null;
        return { seat: p.seat, terms: ok ? terms : null };
      });
  }

  /** 入力待ちの AI の席（なければ undefined） */
  nextAiSeat(): Seat | undefined {
    return awaitingSeats(this.state).find((s) => this.agents[s] !== null && legalActions(this.state, s).length > 0);
  }

  /** AI に1手だけ指させる。指したら true */
  aiStep(): boolean {
    const seat = this.nextAiSeat();
    if (seat === undefined) return false;
    const action = this.agents[seat]!.decide(toPlayerView(this.state, seat), legalActions(this.state, seat));
    this.commit(action);
    return true;
  }

  private commit(action: Action): void {
    const before = this.state;
    this.state = apply(before, action);
    for (const text of describe(before, action, this.state, this.names, this.humanSeat, this.spectator)) {
      this.log.push({ seat: action.seat, text });
    }
    if (this.state.winner !== null && before.winner === null) {
      const w = this.state.winner;
      const hidden = this.hiddenPointCards(w);
      const reveal = hidden > 0 ? `（伏せていた勝利点カード${hidden}枚を含む）` : '';
      this.log.push({ seat: w, text: `${this.names[w]}が${this.points(w)}点で勝利！${reveal}` });
    }
  }
}

/** 交渉画面の下書き。自分から見た向きで持つ */
export interface TradeDraft {
  readonly to: Seat;
  readonly myGive: ResourceCounts;
  readonly myGet: ResourceCounts;
  readonly counter: boolean;
}

function nonZero(c: ResourceCounts): Partial<ResourceCounts> {
  const out: Partial<ResourceCounts> = {};
  for (const r of RESOURCES) if (c[r] > 0) out[r] = c[r];
  return out;
}

function diff(a: ResourceCounts, b: ResourceCounts): Partial<ResourceCounts> {
  const out: Partial<ResourceCounts> = {};
  for (const r of RESOURCES) if (b[r] !== a[r]) out[r] = b[r] - a[r];
  return out;
}

function positive(d: Partial<ResourceCounts>): Partial<ResourceCounts> {
  const out: Partial<ResourceCounts> = {};
  for (const r of RESOURCES) if ((d[r] ?? 0) > 0) out[r] = d[r]!;
  return out;
}

/** 提案者から見た条件を「誰が何を出すか」の文に */
export function describeTerms(terms: TradeTerms, proposer: string, counterparty: string): string {
  return `${proposer}は${formatCounts(terms.give)}、${counterparty}は${formatCounts(terms.receive)}を出す`;
}

/** ログに出す文。他人の手札や引いた発展カードなど、人間に見えない情報は書かない */
export function describe(
  before: GameState,
  action: Action,
  after: GameState,
  names: readonly string[],
  humanSeat: Seat,
  /** 観戦: 奪ったカードや引いた発展カードも書く */
  revealAll = false,
): string[] {
  const me = action.seat;
  const name = names[me]!;
  switch (action.type) {
    case 'placeSettlement':
    case 'buildSettlement':
      return [`${name}が開拓地を建てた`];
    case 'placeRoad':
    case 'buildRoad':
      return [`${name}が道を置いた`];
    case 'buildCity':
      return [`${name}が都市を建てた`];
    case 'rollDice': {
      const [a, b] = after.lastRoll!;
      const lines = [`${name}のサイコロ: ${a} + ${b} = ${a + b}`];
      if (a + b === 7) {
        lines.push('7 が出た。手札が8枚以上の人は半分を捨てる');
      } else {
        after.players.forEach((p, seat) => {
          const gain = positive(diff(before.players[seat]!.hand, p.hand));
          if (Object.keys(gain).length > 0) lines.push(`${names[seat]}: ${formatCounts(gain)}を獲得`);
        });
      }
      return lines;
    }
    case 'discard':
      return [`${name}が${formatCounts(action.resources)}を捨てた`];
    case 'moveRobber': {
      const lines = [`${name}が盗賊を${TERRAIN_LABEL[after.board.terrains[action.hex]!]}に移動`];
      if (action.victim !== null) {
        const victim = names[action.victim]!;
        const stolen = positive(diff(before.players[me]!.hand, after.players[me]!.hand));
        const showCard = revealAll || me === humanSeat || action.victim === humanSeat;
        lines.push(`${name}が${victim}から${showCard ? formatCounts(stolen) : '1枚'}を奪った`);
      }
      return lines;
    }
    case 'bankTrade': {
      const rate = tradeRate(before, me, action.give);
      return [`${name}が交換: ${RESOURCE_LABEL[action.give]}${rate}枚 → ${RESOURCE_LABEL[action.receive]}1枚`];
    }
    case 'buyDevCard': {
      const card = after.players[me]!.devCards.at(-1)?.card;
      return [`${name}が発展カードを買った${(revealAll || me === humanSeat) && card ? `（${DEV_LABEL[card]}）` : ''}`];
    }
    case 'playKnight':
      return [`${name}が騎士を使った`];
    case 'playRoadBuilding':
      return [`${name}が街道建設を使った`];
    case 'playYearOfPlenty':
      return [`${name}が収穫を使い、${formatCounts(positive(diff(before.players[me]!.hand, after.players[me]!.hand)))}を受け取った`];
    case 'playMonopoly': {
      const n = after.players[me]!.hand[action.resource] - before.players[me]!.hand[action.resource];
      return [`${name}が独占を使い、${RESOURCE_LABEL[action.resource]}を${n}枚集めた`];
    }
    case 'proposeTrade':
      return [`${name}が${names[action.to]}に交換を提案: ${describeTerms(action.terms, name, names[action.to]!)}`];
    case 'counterTrade': {
      if (before.phase.kind !== 'negotiating') return [];
      const { proposer, counterparty } = before.phase.trade;
      return [`${name}が逆提案: ${describeTerms(action.terms, names[proposer]!, names[counterparty]!)}`];
    }
    case 'acceptTrade':
      return [`${name}が交換に応じた`];
    case 'rejectTrade':
      return [`${name}が交換を断った`];
    case 'withdrawTrade':
      return [`${name}が提案を取り下げた`];
    case 'endTurn':
      return [];
  }
}
