import type { CSSProperties } from 'react';
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

/**
 * The last shared-track cell before each color turns into its home column,
 * with the arrow's pointing direction (0 = right, degrees clockwise).
 * Ring indices: (START_OFFSET + 51 - 1) % 52 for each color.
 */
const ENTRY_ARROWS: { color: PlayerColor; cell: [number, number]; angle: number }[] = [
  { color: 'red', cell: RING[50], angle: 0 },
  { color: 'green', cell: RING[11], angle: 90 },
  { color: 'yellow', cell: RING[24], angle: 180 },
  { color: 'blue', cell: RING[37], angle: 270 },
];

interface BoardProps {
  tokens: Token[];
  legalMoveIds: Set<string>;
  movingTokenId?: string | null;
  /** windup = anticipation dip before the first hop; stepping = hopping. */
  movePhase?: 'windup' | 'stepping' | null;
  /** Token that just finished a move: plays the overshoot-and-settle. */
  landedTokenId?: string | null;
  /** Token that just reached home: plays the spin-shrink + sparkles. */
  homedTokenId?: string | null;
  /** Captured tokens flying back to base: id -> offset (in cells) they fly FROM. */
  flights?: Map<string, { dx: number; dy: number }>;
  /** Human must pick a move: dims non-movable tokens to focus attention. */
  choosing?: boolean;
  onTokenClick: (id: string) => void;
}

/** Outlined (stroke-only) star, as in the reference boards. */
function Star({ row, col, light }: { row: number; col: number; light?: boolean }) {
  return (
    <text
      x={col + 0.5}
      y={row + 0.68}
      fontSize={0.55}
      textAnchor="middle"
      className={light ? 'board-star board-star-light' : 'board-star'}
    >
      ☆
    </text>
  );
}

export default function Board({
  tokens,
  legalMoveIds,
  movingTokenId,
  movePhase,
  landedTokenId,
  homedTokenId,
  flights,
  choosing,
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
      className={`ludo-board ${choosing ? 'choosing' : ''}`}
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
        <radialGradient id="ground-shadow">
          <stop offset="0%" stopColor="rgba(0,0,0,0.40)" />
          <stop offset="65%" stopColor="rgba(0,0,0,0.18)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>

      {/* base board background */}
      <rect x={0} y={0} width={BOARD_SIZE} height={BOARD_SIZE} className="board-bg" rx={0.35} />

      {/* 4 yards: flat saturated quadrant, white rounded panel, 2x2 sockets */}
      {COLOR_LIST.map(color => {
        const [row, col] = YARD_ORIGIN[color];
        return (
          <g key={color}>
            <rect x={col} y={row} width={6} height={6} fill={COLORS[color]} rx={0.35} />
            <rect x={col + 0.75} y={row + 0.75} width={4.5} height={4.5} className="yard-inner" rx={0.45} />
            {/* flat colored token sockets, like the reference */}
            {BASE_SLOTS[color].map(([r, c], i) => (
              <circle
                key={i}
                cx={c}
                cy={r}
                r={0.5}
                fill={COLORS[color]}
                stroke={COLOR_DARK[color]}
                strokeWidth={0.025}
              />
            ))}
          </g>
        );
      })}

      {/* center 4-triangle goal */}
      <rect x={6} y={6} width={3} height={3} fill="#fffdf7" />
      <polygon points="6,6 6,9 7.5,7.5" fill={COLORS.red} stroke="#fff" strokeWidth={0.05} />
      <polygon points="6,6 9,6 7.5,7.5" fill={COLORS.green} stroke="#fff" strokeWidth={0.05} />
      <polygon points="9,6 9,9 7.5,7.5" fill={COLORS.yellow} stroke="#fff" strokeWidth={0.05} />
      <polygon points="6,9 9,9 7.5,7.5" fill={COLORS.blue} stroke="#fff" strokeWidth={0.05} />

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
              fill={startColor ? COLORS[startColor] : '#fffdf7'}
              stroke="#b9b0a0"
              strokeWidth={0.03}
            />
            {startColor && <Star row={row} col={col} light />}
            {isNeutralSafe && <Star row={row} col={col} />}
          </g>
        );
      })}

      {/* entry arrows: the last ring cell before each color's home column */}
      {ENTRY_ARROWS.map(({ color, cell: [row, col], angle }) => (
        <polygon
          key={`arrow-${color}`}
          points={`${col + 0.26},${row + 0.28} ${col + 0.26},${row + 0.72} ${col + 0.78},${row + 0.5}`}
          fill={COLORS[color]}
          stroke={COLOR_DARK[color]}
          strokeWidth={0.025}
          strokeLinejoin="round"
          transform={`rotate(${angle} ${col + 0.5} ${row + 0.5})`}
        />
      ))}

      {/* pawns */}
      {sortedTokens.map(token => {
        const { row, col } = cellOf.get(token.id)!;
        const stack = groups.get(`${row},${col}`)!;
        const stackIdx = stack.indexOf(token.id);
        const spread = stack.length > 1 ? Math.min(0.16, 0.44 / (stack.length - 1)) : 0;
        const dx = (stackIdx - (stack.length - 1) / 2) * spread;
        const scale = stack.length > 1 ? 0.82 : 1;
        const isLegal = legalMoveIds.has(token.id);
        const isMoving = token.id === movingTokenId && movePhase === 'stepping';
        const isWindup = token.id === movingTokenId && movePhase === 'windup';
        const flight = flights?.get(token.id);
        return (
          <g
            key={token.id}
            transform={`translate(${col + dx} ${row}) scale(${scale})`}
            className={[
              'token',
              isLegal ? 'token-legal' : '',
              isMoving ? 'token-moving' : '',
              isWindup ? 'token-windup' : '',
              token.id === landedTokenId ? 'token-landed' : '',
              token.id === homedTokenId ? 'token-homed' : '',
              flight ? 'token-flying' : '',
            ].join(' ')}
            style={
              flight
                ? ({ '--fx': `${flight.dx}px`, '--fy': `${flight.dy}px` } as CSSProperties)
                : undefined
            }
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

      {/* celebration burst from the centre goal in the arriving player's colour */}
      {homedTokenId &&
        (() => {
          const owner = tokens.find(t => t.id === homedTokenId);
          if (!owner) return null;
          const shades = [COLORS[owner.color], COLOR_LIGHT[owner.color], '#ffffff'];
          return (
            <g className="home-burst" transform="translate(7.5 7.5)" pointerEvents="none">
              {Array.from({ length: 16 }, (_, i) => {
                const angle = (i / 16) * Math.PI * 2 + (i % 2 ? 0.2 : 0);
                const reach = 2.6 + (i % 3) * 0.5;
                return (
                  <rect
                    key={i}
                    x={-0.075}
                    y={-0.075}
                    width={0.15}
                    height={0.26}
                    rx={0.05}
                    fill={shades[i % shades.length]}
                    className="burst-bit"
                    style={
                      {
                        '--bx': `${Math.cos(angle) * reach}px`,
                        '--by': `${Math.sin(angle) * reach}px`,
                        '--spin': `${(i % 2 ? 1 : -1) * 260}deg`,
                        animationDelay: `${(i % 4) * 0.03}s`,
                      } as CSSProperties
                    }
                  />
                );
              })}
            </g>
          );
        })()}

      {/* sparkle burst where a token just entered home */}
      {homedTokenId &&
        (() => {
          const cell = cellOf.get(homedTokenId);
          if (!cell) return null;
          return (
            <g className="sparkles" transform={`translate(${cell.col} ${cell.row})`}>
              {Array.from({ length: 7 }, (_, i) => {
                const a = (i / 7) * Math.PI * 2;
                return (
                  <circle
                    key={i}
                    r={0.07}
                    className="sparkle"
                    style={
                      {
                        '--sx': `${Math.cos(a) * 0.75}px`,
                        '--sy': `${Math.sin(a) * 0.75}px`,
                        animationDelay: `${i * 0.03}s`,
                      } as CSSProperties
                    }
                  />
                );
              })}
            </g>
          );
        })()}

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
