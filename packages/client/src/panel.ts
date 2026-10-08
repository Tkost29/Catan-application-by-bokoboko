import { AI_LEVELS } from '@bokoboko/ai';
import {
  RESOURCES,
  type Action,
  type ActionType,
  type PlayerView,
  type Resource,
} from '@bokoboko/engine';
import type { LocalGame } from './controller.js';
import { describeTerms } from './controller.js';
import { DEV_HELP, DEV_LABEL, escapeHtml, formatCounts, RESOURCE_LABEL } from './labels.js';
import { robberChoices, type Counts, type UiState } from './ui.js';

/**
 * 右側（スマホでは下側）の操作パネルを HTML 文字列として描く。
 * ボタンには data-act を付け、main.ts がクリックを1か所で受け取る。
 */

const has = (legal: readonly Action[], type: ActionType): boolean => legal.some((a) => a.type === type);

const btn = (act: string, label: string, opts: { primary?: boolean; disabled?: boolean; pressed?: boolean } = {}): string =>
  `<button type="button" class="btn${opts.primary ? ' primary' : ''}" data-act="${act}"` +
  `${opts.disabled ? ' disabled' : ''}${opts.pressed !== undefined ? ` aria-pressed="${opts.pressed}"` : ''}>${label}</button>`;

export function renderPanel(game: LocalGame, ui: UiState): string {
  const view = game.view();
  const legal = game.legal();
  return [
    renderStatus(game, view, legal),
    ui.error ? `<p class="error" role="alert">${escapeHtml(ui.error)}</p>` : '',
    renderActions(game, view, legal, ui),
    renderHand(view),
    renderPlayers(game, view),
    renderLog(game),
  ].join('');
}

// ---------------------------------------------------------------------------
// いま何をする場面か
// ---------------------------------------------------------------------------

function renderStatus(game: LocalGame, view: PlayerView, legal: readonly Action[]): string {
  const roll = view.lastRoll ? `<span class="dice" aria-label="直近のサイコロ">${die(view.lastRoll[0])}${die(view.lastRoll[1])}<b>${view.lastRoll[0] + view.lastRoll[1]}</b></span>` : '';
  return (
    `<section class="status"><div class="status-row"><span class="turn-chip p${view.currentSeat}">` +
    `${escapeHtml(game.names[view.currentSeat]!)}の番</span>${roll}</div>` +
    `<p class="prompt">${escapeHtml(prompt(game, view, legal))}</p></section>`
  );
}

const DIE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const die = (n: number): string => `<span class="die">${DIE_FACES[n - 1]}</span>`;

function prompt(game: LocalGame, view: PlayerView, legal: readonly Action[]): string {
  const phase = view.phase;
  const current = game.names[view.currentSeat]!;
  if (phase.kind === 'gameOver') return `${game.names[view.winner!]}の勝ちです。`;
  const mine = legal.length > 0;
  switch (phase.kind) {
    case 'setup':
      if (!mine) return `${current}が初期配置をしています。`;
      return phase.step === 'settlement'
        ? `開拓地を置く場所を選んでください（${phase.round}巡目）。光っている点に置けます。`
        : '置いた開拓地から道を1本伸ばしてください。';
    case 'preRoll':
      return mine ? 'サイコロを振ってください。発展カードは振る前にも使えます。' : `${current}がサイコロを振ります。`;
    case 'discard': {
      const n = phase.remaining[view.seat] ?? 0;
      return n > 0 ? `7 が出ました。手札を${n}枚選んで捨ててください。` : '手札の多い人が捨てるのを待っています。';
    }
    case 'moveRobber':
      return mine ? '盗賊を置くヘックスを選んでください。' : `${current}が盗賊を動かしています。`;
    case 'roadBuilding':
      return mine ? `無料の道をあと${phase.remaining}本置けます。光っている辺を選んでください。` : `${current}が道を置いています。`;
    case 'main':
      return mine ? '建設や交換をして、終わったら「手番を終える」を押してください。' : `${current}の手番です。`;
    case 'negotiating': {
      const t = phase.trade;
      if (t.awaiting === view.seat) return `${game.names[t.history.at(-1)!.by]}から交換の提案が来ています。`;
      if (t.proposer === view.seat) return `${game.names[t.counterparty]}の返事を待っています。`;
      return `${game.names[t.proposer]}と${game.names[t.counterparty]}が交渉中です。`;
    }
  }
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

function renderActions(game: LocalGame, view: PlayerView, legal: readonly Action[], ui: UiState): string {
  const parts: string[] = [];
  const phase = view.phase;

  if (phase.kind === 'gameOver') {
    const w = view.winner!;
    const hidden = game.hiddenPointCards(w);
    parts.push(`<p class="result">${escapeHtml(game.names[w]!)} が ${game.points(w)} 点で勝利</p>`);
    if (hidden > 0) parts.push(`<p class="hint">伏せていた勝利点カード${hidden}枚を含みます。</p>`);
    parts.push(btn('open:newGame', 'もう一度遊ぶ', { primary: true }));
    return section('actions', parts.join(''));
  }

  if (ui.dialog.kind !== 'none') return section('actions', renderDialog(game, view, legal, ui));

  if (phase.kind === 'discard' && (phase.remaining[view.seat] ?? 0) > 0) {
    return section('actions', renderDiscard(view, phase.remaining[view.seat]!, ui.discard));
  }

  if (phase.kind === 'moveRobber' && ui.robberHex !== null) {
    const choices = robberChoices(legal, ui.robberHex);
    parts.push('<p class="hint">誰から1枚奪いますか？</p><div class="row">');
    for (const c of choices) {
      if (c.victim !== null) parts.push(btn(`victim:${c.victim}`, `${escapeHtml(game.names[c.victim]!)}から奪う`, { primary: true }));
    }
    parts.push(btn('robber:cancel', '置き場所を選び直す'), '</div>');
    return section('actions', parts.join(''));
  }

  if (phase.kind === 'negotiating') return section('actions', renderNegotiation(game, view, legal));

  if (phase.kind === 'preRoll' && has(legal, 'rollDice')) {
    parts.push(`<div class="row">${btn('roll', 'サイコロを振る', { primary: true })}</div>`);
    parts.push(devCardButtons(legal));
  }

  if (phase.kind === 'main' && has(legal, 'endTurn')) {
    parts.push('<div class="row build">');
    parts.push(btn('mode:road', '道', { disabled: !has(legal, 'buildRoad'), pressed: ui.mode === 'road' }));
    parts.push(btn('mode:settlement', '開拓地', { disabled: !has(legal, 'buildSettlement'), pressed: ui.mode === 'settlement' }));
    parts.push(btn('mode:city', '都市', { disabled: !has(legal, 'buildCity'), pressed: ui.mode === 'city' }));
    parts.push(btn('buy', '発展カードを買う', { disabled: !has(legal, 'buyDevCard') }));
    parts.push('</div>');
    if (ui.mode !== 'none') parts.push('<p class="hint">盤面の光っている場所を選んでください。</p>');
    parts.push('<div class="row">');
    parts.push(btn('open:bank', '銀行・港と交換', { disabled: !has(legal, 'bankTrade') }));
    parts.push(btn('open:request', 'プレイヤーと交渉', { disabled: !has(legal, 'proposeTrade') }));
    parts.push('</div>');
    parts.push(devCardButtons(legal));
    parts.push(`<div class="row end">${btn('endTurn', '手番を終える', { primary: true })}</div>`);
  }

  return parts.length > 0 ? section('actions', parts.join('')) : '';
}

function devCardButtons(legal: readonly Action[]): string {
  const b: string[] = [];
  if (has(legal, 'playKnight')) b.push(btn('play:knight', '騎士を使う'));
  if (has(legal, 'playRoadBuilding')) b.push(btn('play:roadBuilding', '街道建設を使う'));
  if (has(legal, 'playYearOfPlenty')) b.push(btn('open:plenty', '収穫を使う'));
  if (has(legal, 'playMonopoly')) b.push(btn('open:monopoly', '独占を使う'));
  return b.length > 0 ? `<div class="row cards">${b.join('')}</div>` : '';
}

function section(cls: string, inner: string): string {
  return `<section class="${cls}">${inner}</section>`;
}

function counter(group: string, r: Resource, value: number, max: number): string {
  return (
    `<div class="counter"><span class="res-dot r-${r}" aria-hidden="true"></span><span class="res-name">${RESOURCE_LABEL[r]}</span>` +
    `<button type="button" class="step" data-act="dec:${group}:${r}" aria-label="${RESOURCE_LABEL[r]}を減らす"${value <= 0 ? ' disabled' : ''}>−</button>` +
    `<output class="num">${value}</output>` +
    `<button type="button" class="step" data-act="inc:${group}:${r}" aria-label="${RESOURCE_LABEL[r]}を増やす"${value >= max ? ' disabled' : ''}>＋</button></div>`
  );
}

function renderDiscard(view: PlayerView, required: number, draft: Counts): string {
  const chosen = RESOURCES.reduce((s, r) => s + draft[r], 0);
  return (
    `<p class="hint">捨てる札を選んでください（${chosen} / ${required}枚）</p><div class="counters">` +
    RESOURCES.map((r) => counter('discard', r, draft[r], view.me.hand[r])).join('') +
    `</div><div class="row">${btn('discard', `${required}枚捨てる`, { primary: true, disabled: chosen !== required })}</div>`
  );
}

function renderNegotiation(game: LocalGame, view: PlayerView, legal: readonly Action[]): string {
  if (view.phase.kind !== 'negotiating') return '';
  const t = view.phase.trade;
  const terms = t.history.at(-1)!.terms;
  const proposerName = game.names[t.proposer]!;
  const counterName = game.names[t.counterparty]!;
  const iAmProposer = view.seat === t.proposer;
  const myGive = iAmProposer ? terms.give : terms.receive;
  const myGet = iAmProposer ? terms.receive : terms.give;
  const parts = [
    `<div class="offer"><div><span class="label">あなたが出す</span><b>${formatCounts(myGive)}</b></div>` +
      `<div><span class="label">あなたがもらう</span><b>${formatCounts(myGet)}</b></div></div>`,
    `<p class="hint">${escapeHtml(describeTerms(terms, proposerName, counterName))}</p>`,
    '<div class="row">',
  ];
  if (has(legal, 'acceptTrade')) parts.push(btn('trade:accept', '応じる', { primary: true }));
  if (has(legal, 'rejectTrade')) parts.push(btn('trade:reject', '断る'));
  if (has(legal, 'counterTrade')) parts.push(btn('open:counter', '条件を変えて返す'));
  if (has(legal, 'withdrawTrade')) parts.push(btn('trade:withdraw', '提案を取り下げる'));
  parts.push('</div>');
  if (!has(legal, 'acceptTrade') && t.awaiting === view.seat) {
    parts.push('<p class="hint">手札が足りないので、この条件には応じられません。</p>');
  }
  return parts.join('');
}

function renderDialog(game: LocalGame, view: PlayerView, legal: readonly Action[], ui: UiState): string {
  const d = ui.dialog;
  const select = (id: string, value: Resource, label: string, rate?: (r: Resource) => string): string =>
    `<label class="field" for="${id}"><span>${label}</span><select id="${id}" data-field="${id}">` +
    RESOURCES.map(
      (r) => `<option value="${r}"${r === value ? ' selected' : ''}>${RESOURCE_LABEL[r]}${rate ? `（${rate(r)}）` : ''}</option>`,
    ).join('') +
    '</select></label>';
  const close = btn('close', 'やめる');

  switch (d.kind) {
    case 'bank': {
      const r = (x: Resource): string => `${game.bankRate(x)}:1`;
      const ok = legal.some((a) => a.type === 'bankTrade' && a.give === d.give && a.receive === d.receive);
      return (
        `<h3 class="dlg-title">銀行・港と交換</h3><div class="fields">` +
        select('bank-give', d.give, '出す資源', r) +
        select('bank-receive', d.receive, 'もらう資源（1枚）') +
        `</div><div class="row">${btn('bank:go', `${RESOURCE_LABEL[d.give]}${game.bankRate(d.give)}枚を${RESOURCE_LABEL[d.receive]}1枚に`, { primary: true, disabled: !ok })}${close}</div>`
      );
    }
    case 'trade': {
      const opponents = view.opponents.map((o) => o.seat);
      const who = d.counter
        ? ''
        : `<label class="field" for="trade-to"><span>相手</span><select id="trade-to" data-field="trade-to">` +
          opponents
            .map((s) => `<option value="${s}"${s === d.to ? ' selected' : ''}>${escapeHtml(game.names[s]!)}</option>`)
            .join('') +
          '</select></label>';
      const reason = game.tradeProblem(d);
      return (
        `<h3 class="dlg-title">${d.counter ? '条件を変えて返す' : 'プレイヤーと交渉'}</h3>${who}` +
        `<p class="label">あなたが出す</p><div class="counters">${RESOURCES.map((r) => counter('myGive', r, d.myGive[r], view.me.hand[r])).join('')}</div>` +
        `<p class="label">あなたがもらう</p><div class="counters">${RESOURCES.map((r) => counter('myGet', r, d.myGet[r], 9)).join('')}</div>` +
        (reason ? `<p class="hint">${escapeHtml(reason)}</p>` : '') +
        `<div class="row">${btn('trade:send', d.counter ? 'この条件で返す' : '提案する', { primary: true, disabled: reason !== null })}` +
        `${d.counter ? '' : btn('open:request', 'ほしい物から募集する')}${close}</div>`
      );
    }
    case 'request': {
      const problem = game.requestProblem(d.want, d.offer);
      const replies =
        d.replies === null
          ? ''
          : `<ul class="replies">${d.replies
              .map((rep) => {
                const name = escapeHtml(game.names[rep.seat]!);
                if (rep.terms === null) return `<li class="reply none"><b>${name}</b><span class="muted">応じられない</span></li>`;
                return (
                  `<li class="reply"><b>${name}</b>` +
                  `<span>あなたが出す: <b>${formatCounts(rep.terms.give)}</b> ／ もらう: <b>${formatCounts(rep.terms.receive)}</b></span>` +
                  btn(`request:take:${rep.seat}`, 'この条件で交換', { primary: true }) +
                  '</li>'
                );
              })
              .join('')}</ul>` +
            (d.replies.every((r) => r.terms === null) ? '<p class="hint">応じてくれる人はいませんでした。条件を変えてもう一度聞けます。</p>' : '');
      return (
        `<h3 class="dlg-title">交換を募集する</h3>` +
        `<p class="hint">ほしい物と、代わりにあげてもいい物（上限）を選ぶと、各CPUが応じられる条件を出します。</p>` +
        `<p class="label">ほしい物</p><div class="counters">${RESOURCES.map((r) => counter('want', r, d.want[r], 9)).join('')}</div>` +
        `<p class="label">あげてもいい物（この枚数まで）</p><div class="counters">${RESOURCES.map((r) => counter('offer', r, d.offer[r], view.me.hand[r])).join('')}</div>` +
        (problem && d.replies === null ? `<p class="hint">${escapeHtml(problem)}</p>` : '') +
        `<div class="row">${btn('request:ask', 'CPUに聞く', { primary: d.replies === null, disabled: problem !== null })}` +
        `${btn('open:trade', '条件を全部決めて提案')}${close}</div>${replies}`
      );
    }
    case 'plenty': {
      const ok = legal.some(
        (a) =>
          a.type === 'playYearOfPlenty' &&
          ((a.resources[0] === d.a && a.resources[1] === d.b) || (a.resources[0] === d.b && a.resources[1] === d.a)),
      );
      return (
        `<h3 class="dlg-title">収穫: 銀行から2枚</h3><div class="fields">${select('plenty-a', d.a, '1枚目')}${select('plenty-b', d.b, '2枚目')}</div>` +
        `<div class="row">${btn('plenty:go', '受け取る', { primary: true, disabled: !ok })}${close}</div>`
      );
    }
    case 'monopoly':
      return (
        `<h3 class="dlg-title">独占: 全員から集める資源</h3><div class="fields">${select('monopoly-r', d.resource, '資源')}</div>` +
        `<div class="row">${btn('monopoly:go', `${RESOURCE_LABEL[d.resource]}を集める`, { primary: true })}${close}</div>`
      );
    case 'newGame': {
      const s = game.settings;
      const levels = [0, 1, 2]
        .map((i) => {
          const value = s.aiLevels[i] ?? 1;
          return (
            `<label class="field" for="ai-${i}"><span>CPU ${i + 1}</span><select id="ai-${i}" data-field="ai-${i}">` +
            Object.entries(AI_LEVELS)
              .map(([lv, def]) => `<option value="${lv}"${Number(lv) === value ? ' selected' : ''}>${def.label}</option>`)
              .join('') +
            '</select></label>'
          );
        })
        .join('');
      return (
        `<h3 class="dlg-title">新しいゲーム</h3><div class="fields">${levels}</div>` +
        `<label class="check" for="random-seat"><input type="checkbox" id="random-seat" data-field="random-seat"${s.randomSeat ? ' checked' : ''}> 手番順をランダムにする</label>` +
        `<div class="row">${btn('newGame:start', 'はじめる', { primary: true })}${close}</div>`
      );
    }
    case 'none':
      return '';
  }
}

// ---------------------------------------------------------------------------
// 手札・プレイヤー・ログ
// ---------------------------------------------------------------------------

function renderHand(view: PlayerView): string {
  const cards = RESOURCES.map(
    (r) =>
      `<li class="card r-${r}${view.me.hand[r] === 0 ? ' empty' : ''}"><span class="card-name">${RESOURCE_LABEL[r]}</span><span class="card-num">${view.me.hand[r]}</span></li>`,
  ).join('');
  const dev =
    view.me.devCards.length === 0
      ? '<p class="muted">発展カードはまだありません</p>'
      : `<ul class="devs">${view.me.devCards
          .map((c) => {
            const fresh = c.boughtTurn >= view.turn && c.card !== 'victoryPoint';
            return `<li title="${DEV_HELP[c.card]}"><b>${DEV_LABEL[c.card]}</b><span class="muted">${fresh ? '次の手番から' : DEV_HELP[c.card]}</span></li>`;
          })
          .join('')}</ul>`;
  return `<section class="hand"><h2>あなたの手札</h2><ul class="cards-row">${cards}</ul>${dev}</section>`;
}

function renderPlayers(game: LocalGame, view: PlayerView): string {
  const rows = game.names
    .map((name, seat) => {
      const isMe = seat === view.seat;
      const opp = view.opponents.find((o) => o.seat === seat);
      const handCount = isMe ? RESOURCES.reduce((s, r) => s + view.me.hand[r], 0) : opp!.handCount;
      const devCount = isMe ? view.me.devCards.length : opp!.devCardCount;
      const knights = isMe ? view.me.playedKnights : opp!.playedKnights;
      const badges = [
        view.longestRoad === seat ? '<span class="badge">最長交易路</span>' : '',
        view.largestArmy === seat ? '<span class="badge">最大騎士力</span>' : '',
      ].join('');
      const level = game.agents[seat] ? `<span class="muted">${game.agents[seat]!.name === 'random' ? 'ランダム' : 'ふつう'}</span>` : '';
      return (
        `<li class="player${seat === view.currentSeat ? ' current' : ''}">` +
        `<span class="seat-dot p${seat}" aria-hidden="true"></span>` +
        `<span class="pname">${escapeHtml(name)} ${level}</span>` +
        `<span class="vp" title="勝利点"><b>${game.points(seat)}</b> 点</span>` +
        `<span class="stats">手札${handCount}・発展${devCount}・騎士${knights}</span>${badges}</li>`
      );
    })
    .join('');
  return `<section class="players"><h2>プレイヤー <span class="muted">（${view.config.victoryPointsToWin}点で勝利）</span></h2><ul>${rows}</ul></section>`;
}

function renderLog(game: LocalGame): string {
  const items = game.log
    .slice(-40)
    .reverse()
    .map((e) => `<li>${e.seat !== null ? `<span class="seat-dot small p${e.seat}" aria-hidden="true"></span>` : ''}${escapeHtml(e.text)}</li>`)
    .join('');
  return `<section class="log"><h2>できごと</h2><ol>${items}</ol></section>`;
}
