import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Board from './components/Board';
import {
  createInitialState,
  registerDiceRoll,
  getLegalMoves,
  getMovePath,
  applyMove,
  passTurn,
} from './game/engine';
import {
  SimulatedFairnessServer,
  verifyRoll,
  randomSeedHex,
  type RollCommitment,
  type FairRollRecord,
} from './game/fairness';
import { ruleBasedBot } from './game/bot';
import { playSound, soundSettings } from './game/sound';
import {
  getCommentaryLine,
  isUnderThreat,
  isTrailing,
  type CommentaryEvent,
} from './game/commentary';
import { COLORS } from './game/board';
import type { PlayerColor, Token } from './game/types';
import './App.css';

/** Seat sets per player count — 2 players sit on opposite corners. */
const SEATS_FOR_COUNT: Record<number, PlayerColor[]> = {
  2: ['red', 'yellow'],
  3: ['red', 'green', 'yellow'],
  4: ['red', 'green', 'yellow', 'blue'],
};

/** Corner panel rows around the board, matching each color's yard corner. */
const TOP_ROW: PlayerColor[] = ['red', 'green'];
const BOTTOM_ROW: PlayerColor[] = ['blue', 'yellow'];

interface AnimState {
  tokenId: string;
  path: number[];
  step: number;
}

/* --- 3D-look die with proper pips --- */

const PIP_LAYOUT: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

interface DieProps {
  value: number | null;
  rolling: boolean;
  disabled: boolean;
  inactive: boolean;
  onClick: () => void;
}

function Die({ value, rolling, disabled, inactive, onClick }: DieProps) {
  const face = value ?? 6;
  return (
    <button
      className={`die ${rolling ? 'die-tumble' : ''} ${inactive ? 'die-dark' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label="Roll the die"
    >
      <span className="die-face">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={`pip ${PIP_LAYOUT[face].includes(i) ? 'on' : ''}`} />
        ))}
      </span>
    </button>
  );
}

/* --- corner player panel: avatar + name + that player's die --- */

interface CornerPanelProps {
  color: PlayerColor;
  isBot: boolean;
  active: boolean;
  homeCount: number;
  face: number | null;
  rolling: boolean;
  canRoll: boolean;
  onRoll: () => void;
}

function CornerPanel({
  color,
  isBot,
  active,
  homeCount,
  face,
  rolling,
  canRoll,
  onRoll,
}: CornerPanelProps) {
  return (
    <div
      className={`corner-panel ${active ? 'panel-active' : ''}`}
      style={{ '--panel-color': COLORS[color] } as CSSProperties}
    >
      {active && <span className="turn-arrow">▼</span>}
      <span className="avatar">{isBot ? '🤖' : '🙂'}</span>
      <span className="panel-info">
        <span className="panel-name">{color.toUpperCase()}</span>
        <span className="panel-score">🏠 {homeCount}/4</span>
      </span>
      <Die
        value={face}
        rolling={rolling && active}
        disabled={!canRoll}
        inactive={!active}
        onClick={onRoll}
      />
    </div>
  );
}

/* --- win confetti --- */

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 2.2,
        dur: 2.6 + Math.random() * 2.2,
        color: [COLORS.red, COLORS.green, COLORS.yellow, COLORS.blue, '#ffffff'][i % 5],
        size: 6 + Math.random() * 7,
        rot: Math.random() * 360,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.left}%`,
            background: p.color,
            width: p.size,
            height: p.size * 0.45,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/* --- setup: mode selection, then per-mode options --- */

const SEAT_ORDER: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];
const OPPOSITE: Record<PlayerColor, PlayerColor> = {
  red: 'yellow',
  yellow: 'red',
  green: 'blue',
  blue: 'green',
};

type GameMode = 'vsComputer' | 'passPlay';

interface SetupScreenProps {
  onStart: (players: PlayerColor[], bots: Set<PlayerColor>) => void;
}

function SetupScreen({ onStart }: SetupScreenProps) {
  const [mode, setMode] = useState<GameMode | null>(null);
  // Play vs Computer
  const [myColor, setMyColor] = useState<PlayerColor>('red');
  const [oppCount, setOppCount] = useState(1);
  // Pass & Play
  const [count, setCount] = useState(4);
  const [advanced, setAdvanced] = useState(false);
  const [bots, setBots] = useState<Set<PlayerColor>>(new Set());

  const toggleBot = (color: PlayerColor) => {
    setBots(prev => {
      const next = new Set(prev);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  };

  const startVsComputer = () => {
    // Opposite corner first for good board spread, then the rest.
    const preference = [
      OPPOSITE[myColor],
      ...SEAT_ORDER.filter(c => c !== myColor && c !== OPPOSITE[myColor]),
    ];
    const opponents = preference.slice(0, oppCount);
    const seats = SEAT_ORDER.filter(c => c === myColor || opponents.includes(c));
    // Rotate so the human rolls first (cyclic order is preserved).
    const me = seats.indexOf(myColor);
    onStart([...seats.slice(me), ...seats.slice(0, me)], new Set(opponents));
  };

  const passPlayers = SEATS_FOR_COUNT[count];

  if (mode === null) {
    return (
      <div className="setup">
        <h2>Choose Mode</h2>
        <div className="mode-btns">
          <button className="mode-btn" onClick={() => setMode('vsComputer')}>
            <span className="mode-icon">🤖</span>
            <span className="mode-title">Play vs Computer</span>
            <span className="mode-sub">You against 1–3 bot opponents</span>
          </button>
          <button className="mode-btn" onClick={() => setMode('passPlay')}>
            <span className="mode-icon">👥</span>
            <span className="mode-title">Pass &amp; Play</span>
            <span className="mode-sub">Friends on this device</span>
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'vsComputer') {
    return (
      <div className="setup">
        <h2>Play vs Computer</h2>
        <div className="setup-group">
          <p className="setup-label">Your color</p>
          <div className="color-picker">
            {SEAT_ORDER.map(color => (
              <button
                key={color}
                className={`color-swatch ${myColor === color ? 'selected' : ''}`}
                style={{ '--swatch-color': COLORS[color] } as CSSProperties}
                onClick={() => setMyColor(color)}
                aria-label={color}
              />
            ))}
          </div>
        </div>
        <div className="setup-group">
          <p className="setup-label">Opponents</p>
          <div className="setup-counts">
            {[1, 2, 3].map(n => (
              <button
                key={n}
                className={`count-btn ${oppCount === n ? 'selected' : ''}`}
                onClick={() => setOppCount(n)}
              >
                {n} bot{n > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>
        <button className="start-btn" onClick={startVsComputer}>
          Start Game
        </button>
        <button className="restart-link" onClick={() => setMode(null)}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="setup">
      <h2>Pass &amp; Play</h2>
      <div className="setup-group">
        <p className="setup-label">Players</p>
        <div className="setup-counts">
          {[2, 3, 4].map(n => (
            <button
              key={n}
              className={`count-btn ${count === n ? 'selected' : ''}`}
              onClick={() => setCount(n)}
            >
              {n} players
            </button>
          ))}
        </div>
      </div>
      <button className="advanced-toggle" onClick={() => setAdvanced(a => !a)}>
        Advanced: mixed humans &amp; bots {advanced ? '▴' : '▾'}
      </button>
      {advanced && (
        <div className="setup-seats">
          {passPlayers.map(color => (
            <div
              key={color}
              className="seat-row"
              style={{ '--seat-color': COLORS[color] } as CSSProperties}
            >
              <span className="seat-dot" />
              <span className="seat-name">{color.toUpperCase()}</span>
              <label className="seat-toggle">
                <input
                  type="checkbox"
                  checked={bots.has(color)}
                  onChange={() => toggleBot(color)}
                />
                Bot
              </label>
            </div>
          ))}
        </div>
      )}
      <button
        className="start-btn"
        onClick={() =>
          onStart(
            passPlayers,
            new Set(advanced ? passPlayers.filter(c => bots.has(c)) : []),
          )
        }
      >
        Start Game
      </button>
      <button className="restart-link" onClick={() => setMode(null)}>
        ← Back
      </button>
    </div>
  );
}

/* --- provably-fair panel --- */

interface FairnessPanelProps {
  commitment: RollCommitment | null;
  lastRoll: FairRollRecord | null;
  lastRollValid: boolean | null;
  clientSeed: string;
  onClientSeedChange: (seed: string) => void;
}

function FairnessPanel({
  commitment,
  lastRoll,
  lastRollValid,
  clientSeed,
  onClientSeedChange,
}: FairnessPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fairness">
      <button className="fairness-toggle" onClick={() => setOpen(o => !o)}>
        🛡 Verify this roll {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="fairness-body">
          <div className="fairness-section">
            <h4>Next roll (committed)</h4>
            <dl>
              <dt>nonce</dt>
              <dd>{commitment?.nonce ?? '…'}</dd>
              <dt>SHA-256(server seed)</dt>
              <dd className="hash">{commitment?.serverSeedHash ?? '…'}</dd>
              <dt>your client seed</dt>
              <dd>
                <input
                  className="seed-input"
                  value={clientSeed}
                  onChange={e => onClientSeedChange(e.target.value)}
                  spellCheck={false}
                />
              </dd>
            </dl>
          </div>
          {lastRoll && (
            <div className="fairness-section">
              <h4>
                Last roll: {lastRoll.value}{' '}
                {lastRollValid === null ? '' : lastRollValid ? '✅ verified' : '❌ INVALID'}
              </h4>
              <dl>
                <dt>nonce</dt>
                <dd>{lastRoll.nonce}</dd>
                <dt>client seed</dt>
                <dd className="hash">{lastRoll.clientSeed}</dd>
                <dt>server seed (revealed)</dt>
                <dd className="hash">{lastRoll.serverSeed}</dd>
                <dt>SHA-256(server seed)</dt>
                <dd className="hash">{lastRoll.serverSeedHash}</dd>
                <dt>HMAC-SHA256(seed, client:nonce)</dt>
                <dd className="hash">{lastRoll.hmac}</dd>
              </dl>
              <p className="fairness-note">
                Hash of the revealed seed must equal the pre-roll commitment, and the first
                HMAC byte below 252, mod 6, plus 1 must equal the rolled value.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --- main app --- */

function App() {
  const [players, setPlayers] = useState<PlayerColor[] | null>(null);
  const [botSeats, setBotSeats] = useState<Set<PlayerColor>>(new Set());
  const [state, setState] = useState(() => createInitialState());
  const [rolling, setRolling] = useState(false);
  const [faces, setFaces] = useState<Partial<Record<PlayerColor, number>>>({});
  const [anim, setAnim] = useState<AnimState | null>(null);
  const [poppingIds, setPoppingIds] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [feed, setFeed] = useState<string[]>([]);
  const [muted, setMuted] = useState(soundSettings.muted);

  // Provably-fair dice: simulated server + commitment/reveal bookkeeping.
  const providerRef = useRef(new SimulatedFairnessServer());
  const [clientSeed, setClientSeed] = useState(() => randomSeedHex(8));
  const [commitment, setCommitment] = useState<RollCommitment | null>(null);
  const [lastRoll, setLastRoll] = useState<FairRollRecord | null>(null);
  const [lastRollValid, setLastRollValid] = useState<boolean | null>(null);

  const inGame = players !== null;

  useEffect(() => {
    providerRef.current.getCommitment().then(setCommitment);
  }, []);

  const pushComment = (event: CommentaryEvent) => {
    setFeed(f => [getCommentaryLine(event), ...f].slice(0, 3));
  };

  const toggleMute = () => {
    soundSettings.muted = !soundSettings.muted;
    setMuted(soundSettings.muted);
  };

  // Step the currently-moving token through its path one cell at a time.
  useEffect(() => {
    if (!anim) return;

    if (anim.step >= anim.path.length) {
      const dice = state.diceValue!;
      const mover = state.currentPlayer;
      const wasTrailing = isTrailing(state, mover);
      const result = applyMove(state, anim.tokenId, dice);
      const action = result.lastAction;

      if (action?.type === 'move' && action.captured.length) {
        playSound('capture');
        setShaking(true);
        setTimeout(() => setShaking(false), 450);
        const captured = new Set(action.captured);
        setPoppingIds(captured);
        setTimeout(() => setPoppingIds(new Set()), 400);
        const victim = result.tokens.find(t => t.id === action.captured[0])!.color;
        pushComment({ type: wasTrailing ? 'comeback' : 'capture', player: mover, victim });
      } else if (result.winner) {
        // handled below
      } else if (action?.type === 'move' && action.to === 58) {
        playSound('home');
        pushComment({ type: wasTrailing ? 'comeback' : 'home', player: mover });
      } else if (isUnderThreat(result, anim.tokenId) && Math.random() < 0.5) {
        pushComment({ type: 'nearMiss', player: mover });
      }

      if (result.winner) {
        playSound('win');
        pushComment({ type: 'win', player: result.winner });
      }

      setState(result);
      setAnim(null);
      return;
    }
    const timer = setTimeout(() => {
      playSound('step');
      setAnim(a => (a ? { ...a, step: a.step + 1 } : null));
    }, 180);
    return () => clearTimeout(timer);
  }, [anim, state]);

  // Soft cue whenever the turn moves to another player.
  const prevPlayerRef = useRef(state.currentPlayer);
  useEffect(() => {
    if (state.currentPlayer !== prevPlayerRef.current) {
      prevPlayerRef.current = state.currentPlayer;
      if (inGame && !state.winner) playSound('turn');
    }
  }, [state.currentPlayer, state.winner, inGame]);

  // Show a transient banner for forfeits/passes, then clear it.
  useEffect(() => {
    if (!state.lastAction) return;
    if (state.lastAction.type === 'forfeitSixes') {
      setBanner(`${state.lastAction.player.toUpperCase()} rolled three 6s — turn forfeited!`);
      pushComment({ type: 'threeSixes', player: state.lastAction.player });
    } else if (state.lastAction.type === 'pass') {
      setBanner(`${state.lastAction.player.toUpperCase()} had no legal moves — turn passed.`);
    } else {
      return;
    }
    const t = setTimeout(() => setBanner(null), 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastAction]);

  const legalMoves: Token[] = state.diceValue !== null ? getLegalMoves(state, state.diceValue) : [];
  const busy = anim !== null || rolling;
  const currentIsBot = inGame && botSeats.has(state.currentPlayer);
  const legalMoveIds = new Set(currentIsBot ? [] : legalMoves.map(t => t.id));

  const handleRoll = async () => {
    if (busy || state.diceValue !== null || state.winner) return;
    const roller = state.currentPlayer;
    setRolling(true);
    playSound('dice');
    const record = await providerRef.current.roll(clientSeed);
    const nextCommitment = await providerRef.current.getCommitment();
    let ticks = 0;
    const interval = setInterval(() => {
      setFaces(f => ({ ...f, [roller]: Math.floor(Math.random() * 6) + 1 }));
      ticks++;
      if (ticks >= 6) {
        clearInterval(interval);
        setFaces(f => ({ ...f, [roller]: record.value }));
        setLastRoll(record);
        setCommitment(nextCommitment);
        verifyRoll(record).then(r => setLastRollValid(r.valid));
        setRolling(false);
        setState(s => registerDiceRoll(s, record.value));
      }
    }, 80);
  };

  const moveToken = (tokenId: string) => {
    if (anim || state.diceValue === null) return;
    const token = state.tokens.find(t => t.id === tokenId)!;
    const path = getMovePath(token, state.diceValue);
    setAnim({ tokenId, path, step: 0 });
  };

  const handleTokenClick = (tokenId: string) => {
    if (busy || currentIsBot) return;
    moveToken(tokenId);
  };

  const handlePass = () => setState(s => passTurn(s));

  // Bot autoplay: roll, then move (or pass), with small delays for readability.
  useEffect(() => {
    if (!currentIsBot || busy || state.winner) return;
    if (state.diceValue === null) {
      const t = setTimeout(() => void handleRoll(), 650);
      return () => clearTimeout(t);
    }
    if (legalMoves.length === 0) {
      const t = setTimeout(() => handlePass(), 900);
      return () => clearTimeout(t);
    }
    const t = setTimeout(async () => {
      const tokenId = await ruleBasedBot(state, legalMoves, state.diceValue!);
      moveToken(tokenId);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIsBot, busy, state]);

  const startGame = (seats: PlayerColor[], bots: Set<PlayerColor>) => {
    setPlayers(seats);
    setBotSeats(bots);
    setState(createInitialState(seats));
    setFaces({});
    setAnim(null);
    setBanner(null);
    setFeed([]);
  };

  const restart = () => {
    setPlayers(null);
    setAnim(null);
    setBanner(null);
    setFaces({});
    setFeed([]);
  };

  // Override the animating token's position with its current path step for rendering.
  const renderTokens = state.tokens.map(t => {
    if (anim && t.id === anim.tokenId) {
      const idx = Math.min(anim.step, anim.path.length - 1);
      return { ...t, position: anim.path[idx] };
    }
    return t;
  });

  const homeCounts = useMemo(() => {
    const counts = {} as Record<PlayerColor, number>;
    for (const t of state.tokens) {
      if (t.position === 58) counts[t.color] = (counts[t.color] ?? 0) + 1;
    }
    return counts;
  }, [state.tokens]);

  const muteButton = (
    <button className="mute-btn" onClick={toggleMute} aria-label="Toggle sound">
      {muted ? '🔇' : '🔊'}
    </button>
  );

  if (!inGame) {
    return (
      <div className="app-root">
        {muteButton}
        <h1>Ludo</h1>
        <SetupScreen onStart={startGame} />
      </div>
    );
  }

  return (
    <div className="app-root">
      {muteButton}
      <h1>Ludo</h1>

      <div
        className="turn-indicator"
        style={{ '--turn-color': COLORS[state.currentPlayer] } as CSSProperties}
      >
        {state.winner ? (
          <span className="winner-text">{state.winner.toUpperCase()} WINS!</span>
        ) : (
          <span>
            Turn: <b>{state.currentPlayer.toUpperCase()}</b>
            {currentIsBot && <span className="bot-tag">🤖</span>}
          </span>
        )}
      </div>

      {banner && <div className="banner">{banner}</div>}

      {feed.length > 0 && (
        <div className="commentary" dir="rtl">
          <span className="commentary-mic">🎙️</span>
          <div className="commentary-lines">
            {feed.map((line, i) => (
              <p key={`${line}-${i}`} className={i === 0 ? 'commentary-latest' : 'commentary-old'}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="table">
        {[TOP_ROW, BOTTOM_ROW].map((rowColors, rowIdx) => (
          <div className="table-row" key={rowIdx} style={{ order: rowIdx === 0 ? 0 : 2 }}>
            {rowColors.map(color =>
              players!.includes(color) ? (
                <CornerPanel
                  key={color}
                  color={color}
                  isBot={botSeats.has(color)}
                  active={color === state.currentPlayer && !state.winner}
                  homeCount={homeCounts[color] ?? 0}
                  face={faces[color] ?? null}
                  rolling={rolling}
                  canRoll={
                    color === state.currentPlayer &&
                    !currentIsBot &&
                    !busy &&
                    state.diceValue === null &&
                    !state.winner
                  }
                  onRoll={handleRoll}
                />
              ) : (
                <div key={color} className="corner-spacer" />
              ),
            )}
          </div>
        ))}
        <div className={`board-wrap ${shaking ? 'shake' : ''}`} style={{ order: 1 }}>
          <div className="board-frame">
            <Board
              tokens={renderTokens}
              legalMoveIds={legalMoveIds}
              poppingIds={poppingIds}
              movingTokenId={anim?.tokenId ?? null}
              onTokenClick={handleTokenClick}
            />
          </div>
        </div>
      </div>

      <div className="controls">
        {state.winner ? (
          <div className="winner-actions">
            <button className="start-btn" onClick={() => startGame(players!, botSeats)}>
              Play Again
            </button>
            <button className="pass-btn" onClick={restart}>
              Change Players
            </button>
          </div>
        ) : (
          <>
            {state.diceValue !== null && !anim && !currentIsBot && legalMoves.length === 0 && (
              <button className="pass-btn" onClick={handlePass}>
                No legal moves — Pass turn
              </button>
            )}

            <button className="restart-link" onClick={restart}>
              ⟲ Restart
            </button>
          </>
        )}

        <FairnessPanel
          commitment={commitment}
          lastRoll={lastRoll}
          lastRollValid={lastRollValid}
          clientSeed={clientSeed}
          onClientSeedChange={setClientSeed}
        />
      </div>

      {state.winner && <Confetti />}
    </div>
  );
}

export default App;
