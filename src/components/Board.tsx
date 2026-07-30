import type { Token, PlayerColor } from '../game/types';
import {
  BOARD_SIZE,
  COLORS,
  COLOR_DARK,
  COLOR_LIGHT,
  RING,
  HOME_STRETCH,
  YARD_ORIGIN,
  BASE_SLOTS,
  NEUTRAL_SAFE_INDICES,
  getTokenCell,
} from '../game/board';
import { START_OFFSET } from '../game/engine';
import './Board.css';

const COLOR_LIST: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

/**
 * Ludo King-style pawn silhouette centered on (0,0): dome head, narrow neck,
 * wide round base. ~1.05 cells tall so pieces feel chunky and slightly
 * overlap the cell above.
 */
const PAWN_PATH = [
  'M 0 -0.62',
  'C 0.14 -0.62 0.23 -0.52 0.23 -0.40',
  'C 0.23 -0.29 0.16 -0.21 0.10 -0.17',
  'C 0.12 -0.04 0.14 0.02 0.22 0.08',
  'C 0.33 0.15 0.35 0.24 0.33 0.31',
  'C 0.30 0.42 0.17 0.44 0 0.44',
  'C -0.17 0.44 -0.30 0.42 -0.33 0.31',
  'C -0.35 0.24 -0.33 0.15 -0.22 0.08',
  'C -0.14 0.02 -0.12 -0.04 -0.10 -0.17',
  'C -0.16 -0.21 -0.23 -0.29 -0.23 -0.40',
  'C -0.23 -0.52 -0.14 -0.62 0 -0.62',
  'Z',
].join(' ');

interface BoardProps {
  tokens: Token[];
  legalMoveIds: Set<string>;
  poppingIds: Set<string>;
  movingTokenId?: string | null;
  onTokenClick: (id: string) => void;
}

function Star({ row, col, light }: { row: number; col: number; light?: boolean }) {
  return (
    <text
      x={col + 0.5}
      y={row + 0.68}
      fontSize={0.55}
      textAnchor="middle"
      className={light ? 'board-star board-star-light' : 'board-star'}
    >
      ★
    </text>
  );
}

export default function Board({
  tokens,
  legalMoveIds,
  poppingIds,
  movingTokenId,
  onTokenClick,
}: BoardProps) {
  // Group tokens sharing a cell so stacks fan out; draw top rows first so
  // lower pawns overlap the ones behind them.
  const cellOf = new Map<string, { row: number; col: number }>();
  const groups = new Map<string, string[]>();
  for (const t of tokens) {
    const cell = getTokenCell(t);
    cellOf.set(t.id, cell);
    const key = `${cell.row},${cell.col}`;
    const group = groups.get(key);
    if (group) group.push(t.id);
    else groups.set(key, [t.id]);
  }
  const sortedTokens = [...tokens].sort(
    (a, b) => cellOf.get(a.id)!.row - cellOf.get(b.id)!.row,
  );

  return (
    <svg
      className="ludo-board"
      viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
      role="img"
      aria-label="Ludo board"
    >
      <defs>
        {COLOR_LIST.map(color => (
          <radialGradient key={color} id={`pawn-${color}`} cx="32%" cy="22%" r="88%">
            <stop offset="0%" stopColor={COLOR_LIGHT[color]} />
            <stop offset="42%" stopColor={COLORS[color]} />
            <stop offset="100%" stopColor={COLOR_DARK[color]} />
          </radialGradient>
        ))}
        {COLOR_LIST.map(color => (
          <linearGradient key={`yard-${color}`} id={`yard-${color}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={COLORS[color]} />
            <stop offset="100%" stopColor={COLOR_DARK[color]} />
          </linearGradient>
        ))}
        <radialGradient id="ground-shadow">
          <stop offset="0%" stopColor="rgba(0,0,0,0.40)" />
          <stop offset="65%" stopColor="rgba(0,0,0,0.18)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <filter id="cell-inset" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0.02" stdDeviation="0.02" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* base board background */}
      <rect x={0} y={0} width={BOARD_SIZE} height={BOARD_SIZE} className="board-bg" rx={0.35} />

      {/* 4 yards */}
      {COLOR_LIST.map(color => {
        const [row, col] = YARD_ORIGIN[color];
        return (
          <g key={color}>
            <rect x={col} y={row} width={6} height={6} fill={`url(#yard-${color})`} rx={0.35} />
            <rect x={col + 0.9} y={row + 0.9} width={4.2} height={4.2} className="yard-inner" rx={0.3} />
            {/* token parking slots */}
            {BASE_SLOTS[color].map(([r, c], i) => (
              <circle
                key={i}
                cx={c}
                cy={r}
                r={0.42}
                fill="#fff"
                stroke={COLOR_DARK[color]}
                strokeWidth={0.06}
                filter="url(#cell-inset)"
              />
            ))}
          </g>
        );
      })}

      {/* center pinwheel (home triangles) */}
      <polygon points="6,6 6,9 7.5,7.5" fill={'url(#yard-red)'} stroke="#fff" strokeWidth={0.04} />
      <polygon points="6,6 9,6 7.5,7.5" fill={'url(#yard-green)'} stroke="#fff" strokeWidth={0.04} />
      <polygon points="9,6 9,9 7.5,7.5" fill={'url(#yard-yellow)'} stroke="#fff" strokeWidth={0.04} />
      <polygon points="6,9 9,9 7.5,7.5" fill={'url(#yard-blue)'} stroke="#fff" strokeWidth={0.04} />

      {/* home stretch lanes — full player color */}
      {COLOR_LIST.map(color =>
        HOME_STRETCH[color].map(([row, col], i) => (
          <rect
            key={`${color}-hs-${i}`}
            x={col}
            y={row}
            width={1}
            height={1}
            fill={COLORS[color]}
            stroke={COLOR_DARK[color]}
            strokeWidth={0.03}
          />
        ))
      )}

      {/* 52 ring cells */}
      {RING.map(([row, col], idx) => {
        const startColor = COLOR_LIST.find(c => START_OFFSET[c] === idx);
        const isNeutralSafe = NEUTRAL_SAFE_INDICES.includes(idx);
        return (
          <g key={`ring-${idx}`}>
            <rect
              x={col}
              y={row}
              width={1}
              height={1}
              fill={startColor ? COLORS[startColor] : isNeutralSafe ? '#ece7db' : '#fffdf7'}
              stroke="#b9b0a0"
              strokeWidth={0.03}
            />
            {startColor && <Star row={row} col={col} light />}
            {isNeutralSafe && <Star row={row} col={col} />}
          </g>
        );
      })}

      {/* pawns */}
      {sortedTokens.map(token => {
        const { row, col } = cellOf.get(token.id)!;
        const stack = groups.get(`${row},${col}`)!;
        const stackIdx = stack.indexOf(token.id);
        const spread = stack.length > 1 ? Math.min(0.16, 0.44 / (stack.length - 1)) : 0;
        const dx = (stackIdx - (stack.length - 1) / 2) * spread;
        const scale = stack.length > 1 ? 0.82 : 1;
        const isLegal = legalMoveIds.has(token.id);
        const isPopping = poppingIds.has(token.id);
        const isMoving = token.id === movingTokenId;
        return (
          <g
            key={token.id}
            transform={`translate(${col + dx} ${row}) scale(${scale})`}
            className={[
              'token',
              isLegal ? 'token-legal' : '',
              isPopping ? 'token-popping' : '',
              isMoving ? 'token-moving' : '',
            ].join(' ')}
            onClick={() => isLegal && onTokenClick(token.id)}
          >
            {isLegal && <circle r={0.46} cy={0.06} className="token-highlight" />}
            <g className="token-body">
              <ellipse cx={0} cy={0.42} rx={0.32} ry={0.11} fill="url(#ground-shadow)" />
              <path
                d={PAWN_PATH}
                fill={`url(#pawn-${token.color})`}
                stroke={COLOR_DARK[token.color]}
                strokeWidth={0.045}
                strokeLinejoin="round"
              />
              <ellipse
                cx={-0.08}
                cy={-0.46}
                rx={0.1}
                ry={0.06}
                transform="rotate(-22 -0.08 -0.46)"
                className="token-gloss"
              />
            </g>
            {/* generous invisible hit area */}
            <circle r={0.52} cy={-0.05} fill="transparent" />
          </g>
        );
      })}

      {/* count badges on crowded squares */}
      {[...groups.entries()]
        .filter(([, ids]) => ids.length >= 3)
        .map(([key, ids]) => {
          const [row, col] = key.split(',').map(Number);
          return (
            <g key={`badge-${key}`} className="stack-badge" transform={`translate(${col + 0.34} ${row - 0.34})`}>
              <circle r={0.19} />
              <text y={0.08} textAnchor="middle" fontSize={0.28}>
                {ids.length}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
