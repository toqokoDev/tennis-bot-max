export interface BracketMatch {
  id: string;
  round: number;
  player1?: number;
  player2?: number;
  winner?: number;
  score?: string[];
  next_match_id?: string;
}

export interface BracketTree {
  rounds: BracketMatch[][];
}

export function generateOlympicBracket(participantIds: number[]): BracketTree {
  const n = participantIds.length;
  const size = 2 ** Math.ceil(Math.log2(n));
  const slots: (number | undefined)[] = [...participantIds];
  while (slots.length < size) slots.push(undefined);

  const rounds: BracketMatch[][] = [];
  let roundPlayers = slots;
  let roundNum = 1;

  while (roundPlayers.length > 1) {
    const matches: BracketMatch[] = [];
    const half = roundPlayers.length / 2;
    for (let i = 0; i < half; i++) {
      // В 1-м круге сажаем BYE-слоты (хвост слотов) напротив реальных игроков
      // по схеме "1 против N" — иначе при чётном числе BYE (например 2 свободных
      // места из 8) они попадали бы в одну пару друг с другом, создавая матч без
      // единого игрока, который никогда не получает победителя и «замораживает»
      // всю ветку сетки дальше.
      const [p1, p2] = roundNum === 1
        ? [roundPlayers[i], roundPlayers[roundPlayers.length - 1 - i]]
        : [roundPlayers[i * 2], roundPlayers[i * 2 + 1]];
      matches.push({
        id: `r${roundNum}m${i}`,
        round: roundNum,
        player1: p1,
        player2: p2,
      });
    }
    rounds.push(matches);
    roundPlayers = matches.map(() => undefined);
    roundNum += 1;
  }

  for (let r = 0; r < rounds.length - 1; r++) {
    for (let m = 0; m < rounds[r].length; m++) {
      const nextIdx = Math.floor(m / 2);
      rounds[r][m].next_match_id = rounds[r + 1][nextIdx]?.id;
    }
  }

  return { rounds };
}

export function advanceWinner(bracket: BracketTree, matchId: string, winnerId: number, score: string[]): BracketTree {
  const copy: BracketTree = JSON.parse(JSON.stringify(bracket));
  for (const round of copy.rounds) {
    const match = round.find((m) => m.id === matchId);
    if (match) {
      match.winner = winnerId;
      match.score = score;
      if (match.next_match_id) {
        for (const r of copy.rounds) {
          const next = r.find((m) => m.id === match.next_match_id);
          if (next) {
            if (!next.player1) next.player1 = winnerId;
            else if (!next.player2) next.player2 = winnerId;
          }
        }
      }
      break;
    }
  }
  return copy;
}

export function generateRoundRobin(participantIds: number[]): Record<string, unknown> {
  const table: Record<string, { played: number; wins: number; points: number }> = {};
  for (const id of participantIds) {
    table[String(id)] = { played: 0, wins: 0, points: 0 };
  }
  const matches: { id: string; p1: number; p2: number; played: boolean }[] = [];
  let idx = 0;
  for (let i = 0; i < participantIds.length; i++) {
    for (let j = i + 1; j < participantIds.length; j++) {
      matches.push({
        id: `rr_${idx}`,
        p1: participantIds[i]!,
        p2: participantIds[j]!,
        played: false,
      });
      idx += 1;
    }
  }
  return { table, matches };
}

export function bracketToText(bracket: BracketTree): string {
  return bracket.rounds
    .map((round, i) => {
      const lines = round.map((m) => {
        const p1 = m.player1 ?? '—';
        const p2 = m.player2 ?? '—';
        const w = m.winner ? ` → ${m.winner}` : '';
        return `${p1} vs ${p2}${w}`;
      });
      return `R${i + 1}:\n${lines.join('\n')}`;
    })
    .join('\n\n');
}
