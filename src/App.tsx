import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
import type { PlayerColor, Token } from './game/types';
import './App.css';

const COLOR_HEX: Record<PlayerColor, string> = {
  red: '#e63946',
  green: '#2a9d3e',
  yellow: '#f4c531',
  blue: '#3178c6',
};

/** Seat sets per player count — 2 players sit on opposite corners. */
const SEATS_FOR_COUNT: Record<number, PlayerColor[]> = {
  2: ['red', 'yellow'],
  3: ['red', 'green', 'yellow'],
  4: ['red', 'green', 'yellow', 'blue'],
};

interface AnimState {
  tokenId: string;
  path: number[];
  step: number;
}

interface SetupScreenProps {
  onStart: (players: PlayerColor[], bots: Set<PlayerColor>) => void;
}

function SetupScreen({ onStart }: SetupScreenProps) {
  const [count, setCount] = useState(4);
  const [bots, setBots] = useState<Set<PlayerColor>>(new Set());
  const players = SEATS_FOR_COUNT[count];

  const toggleBot = (color: PlayerColor) => {
    setBots(prev => {
      const next = new Set(prev);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  };

  return (
    <div className="setup">
      <h2>New Game</h2>
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
      <div className="setup-seats">
        {players.map(color => (
          <div
            key={color}
            className="seat-row"
            style={{ '--seat-color': COLOR_HEX[color] } as CSSProperties}
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
      <button
        className="start-btn"
        onClick={() => onStart(players, new Set(players.filter(c => bots.has(c))))}
      >
        Start Game
      </button>
    </div>
  );
}

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

function App() {
  const [players, setPlayers] = useState<PlayerColor[] | null>(null);
  const [botSeats, setBotSeats] = useState<Set<PlayerColor>>(new Set());
  const [state, setState] = useState(() => createInitialState());
  const [rolling, setRolling] = useState(false);
  const [diceFace, setDiceFace] = useState<number | null>(null);
  const [anim, setAnim] = useState<AnimState | null>(null);
  const [poppingIds, setPoppingIds] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);

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

  // Step the currently-moving token through its path one cell at a time.
  useEffect(() => {
    if (!anim) return;

    if (anim.step >= anim.path.length) {
      const dice = state.diceValue!;
      const result = applyMove(state, anim.tokenId, dice);
      if (result.lastAction?.type === 'move' && result.lastAction.captured.length) {
        const captured = new Set(result.lastAction.captured);
        setPoppingIds(captured);
        setTimeout(() => setPoppingIds(new Set()), 400);
      }
      setState(result);
      setAnim(null);
      return;
    }
    const timer = setTimeout(() => setAnim(a => (a ? { ...a, step: a.step + 1 } : null)), 180);
    return () => clearTimeout(timer);
  }, [anim, state]);

  // Show a transient banner for forfeits/passes, then clear it.
  useEffect(() => {
    if (!state.lastAction) return;
    if (state.lastAction.type === 'forfeitSixes') {
      setBanner(`${state.lastAction.player.toUpperCase()} rolled three 6s — turn forfeited!`);
    } else if (state.lastAction.type === 'pass') {
      setBanner(`${state.lastAction.player.toUpperCase()} had no legal moves — turn passed.`);
    } else {
      return;
    }
    const t = setTimeout(() => setBanner(null), 1800);
    return () => clearTimeout(t);
  }, [state.lastAction]);

  const legalMoves: Token[] = state.diceValue !== null ? getLegalMoves(state, state.diceValue) : [];
  const busy = anim !== null || rolling;
  const currentIsBot = inGame && botSeats.has(state.currentPlayer);
  const legalMoveIds = new Set(currentIsBot ? [] : legalMoves.map(t => t.id));

  const handleRoll = async () => {
    if (busy || state.diceValue !== null || state.winner) return;
    setRolling(true);
    const record = await providerRef.current.roll(clientSeed);
    const nextCommitment = await providerRef.current.getCommitment();
    let ticks = 0;
    const interval = setInterval(() => {
      setDiceFace(Math.floor(Math.random() * 6) + 1);
      ticks++;
      if (ticks >= 6) {
        clearInterval(interval);
        setDiceFace(record.value);
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
    setDiceFace(null);
    setAnim(null);
    setBanner(null);
  };

  const restart = () => {
    setPlayers(null);
    setAnim(null);
    setBanner(null);
    setDiceFace(null);
  };

  // Override the animating token's position with its current path step for rendering.
  const renderTokens = state.tokens.map(t => {
    if (anim && t.id === anim.tokenId) {
      const idx = Math.min(anim.step, anim.path.length - 1);
      return { ...t, position: anim.path[idx] };
    }
    return t;
  });

  if (!inGame) {
    return (
      <div className="app-root">
        <h1>Ludo</h1>
        <SetupScreen onStart={startGame} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <h1>Ludo</h1>

      <div
        className="turn-indicator"
        style={{ '--turn-color': COLOR_HEX[state.currentPlayer] } as CSSProperties}
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

      <Board
        tokens={renderTokens}
        legalMoveIds={legalMoveIds}
        poppingIds={poppingIds}
        onTokenClick={handleTokenClick}
      />

      <div className="controls">
        {state.winner ? (
          <div className="winner-actions">
            <button
              className="start-btn"
              onClick={() => startGame(players!, botSeats)}
            >
              Play Again
            </button>
            <button className="pass-btn" onClick={restart}>
              Change Players
            </button>
          </div>
        ) : (
          <>
            <button
              className={`dice ${rolling ? 'rolling' : ''}`}
              onClick={handleRoll}
              disabled={busy || state.diceValue !== null || currentIsBot}
            >
              {diceFace ?? '🎲'}
            </button>

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
    </div>
  );
}

export default App;
