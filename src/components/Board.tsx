import type { Token, PlayerColor } from '../game/types';
import {
  BOARD_SIZE,
  COLORS,
  COLOR_TINT,
  RING,
  HOME_STRETCH,
  YARD_ORIGIN,
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
  onTokenClick: (id: string) => void;
}

function Star({ row, col }: { row: number; col: number }) {
  return (
    <text
      x={col + 0.5}
      y={row + 0.68}
      fontSize={0.55}
      textAnchor="middle"
      className="board-star"
    >
      ★
    </text>
  );
}

export default function Board({ tokens, legalMoveIds, poppingIds, onTokenClick }: BoardProps) {
  return (
    <svg
      className="ludo-board"
      viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
      role="img"
      aria-label="Ludo board"
    >
      {/* base board background */}
      <rect x={0} y={0} width={BOARD_SIZE} height={BOARD_SIZE} className="board-bg" />

      {/* 4 yards */}
      {COLOR_LIST.map(color => {
        const [row, col] = YARD_ORIGIN[color];
        return (
          <g key={color}>
            <rect x={col} y={row} width={6} height={6} fill={COLORS[color]} rx={0.3} />
            <rect x={col + 1} y={row + 1} width={4} height={4} className="yard-inner" rx={0.3} />
          </g>
        );
      })}

      {/* center pinwheel (home triangles) */}
      <polygon points="6,6 6,9 7.5,7.5" fill={COLORS.red} />
      <polygon points="6,6 9,6 7.5,7.5" fill={COLORS.green} />
      <polygon points="9,6 9,9 7.5,7.5" fill={COLORS.yellow} />
      <polygon points="6,9 9,9 7.5,7.5" fill={COLORS.blue} />

      {/* home stretch lanes */}
      {COLOR_LIST.map(color =>
        HOME_STRETCH[color].map(([row, col], i) => (
          <rect
            key={`${color}-hs-${i}`}
            x={col}
            y={row}
            width={1}
            height={1}
            fill={COLOR_TINT[color]}
            stroke="#bbb"
            strokeWidth={0.02}
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
              fill={startColor ? COLOR_TINT[startColor] : '#fff'}
              stroke="#bbb"
              strokeWidth={0.02}
            />
            {(startColor || isNeutralSafe) && <Star row={row} col={col} />}
          </g>
        );
      })}

      {/* tokens */}
      {tokens.map(token => {
        const { row, col } = getTokenCell(token);
        const isLegal = legalMoveIds.has(token.id);
        const isPopping = poppingIds.has(token.id);
        return (
          <g
            key={token.id}
            transform={`translate(${col} ${row})`}
            className={`token ${isLegal ? 'token-legal' : ''} ${isPopping ? 'token-popping' : ''}`}
            onClick={() => isLegal && onTokenClick(token.id)}
          >
            {isLegal && <circle r={0.42} className="token-highlight" />}
            <circle r={0.33} fill={COLORS[token.color]} stroke="#fff" strokeWidth={0.06} />
          </g>
        );
      })}
    </svg>
  );
}
