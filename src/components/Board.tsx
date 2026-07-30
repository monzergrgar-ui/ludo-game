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
  return (
    <svg
      className="ludo-board"
      viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
      role="img"
      aria-label="Ludo board"
    >
      <defs>
        {COLOR_LIST.map(color => (
          <radialGradient key={color} id={`tok-${color}`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor={COLOR_LIGHT[color]} />
            <stop offset="45%" stopColor={COLORS[color]} />
            <stop offset="100%" stopColor={COLOR_DARK[color]} />
          </radialGradient>
        ))}
        {COLOR_LIST.map(color => (
          <linearGradient key={`yard-${color}`} id={`yard-${color}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={COLORS[color]} />
            <stop offset="100%" stopColor={COLOR_DARK[color]} />
          </linearGradient>
        ))}
        <filter id="token-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0.03" dy="0.07" stdDeviation="0.05" floodOpacity="0.45" />
        </filter>
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
      <polygon points="6,6 6,9 7.5,7.5" fill={`url(#yard-red)`} stroke="#fff" strokeWidth={0.04} />
      <polygon points="6,6 9,6 7.5,7.5" fill={`url(#yard-green)`} stroke="#fff" strokeWidth={0.04} />
      <polygon points="9,6 9,9 7.5,7.5" fill={`url(#yard-yellow)`} stroke="#fff" strokeWidth={0.04} />
      <polygon points="6,9 9,9 7.5,7.5" fill={`url(#yard-blue)`} stroke="#fff" strokeWidth={0.04} />

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

      {/* tokens */}
      {tokens.map(token => {
        const { row, col } = getTokenCell(token);
        const isLegal = legalMoveIds.has(token.id);
        const isPopping = poppingIds.has(token.id);
        const isMoving = token.id === movingTokenId;
        return (
          <g
            key={token.id}
            transform={`translate(${col} ${row})`}
            className={[
              'token',
              isLegal ? 'token-legal' : '',
              isPopping ? 'token-popping' : '',
              isMoving ? 'token-moving' : '',
            ].join(' ')}
            onClick={() => isLegal && onTokenClick(token.id)}
          >
            {isLegal && <circle r={0.44} className="token-highlight" />}
            <g className="token-body" filter="url(#token-shadow)">
              <circle r={0.34} fill={COLOR_DARK[token.color]} />
              <circle r={0.32} cy={-0.03} fill={`url(#tok-${token.color})`} />
              <ellipse cx={-0.09} cy={-0.15} rx={0.12} ry={0.08} className="token-gloss" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
