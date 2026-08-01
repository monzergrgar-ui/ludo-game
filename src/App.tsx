import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import Board from './components/Board';
import {
  createInitialState,
  registerDiceRoll,
  getLegalMoves,
  getDistinctMoveOutcomes,
  getPlayableDice,
  isRollAllowed,
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
import { playSound, soundSettings, vibrate } from './game/sound';
import { stopVoice } from './game/voice';
import { emitCommentary, isUnderThreat, isTrailing } from './game/commentary';
import { COLORS, getTokenCell } from './game/board';
import { DEFAULT_RULES } from './game/engine';
import type { PlayerColor, Token, HouseRules } from './game/types';
import './App.css';

/** Seat sets per player count — 2 players sit on opposite corners. */
const SEATS_FOR_COUNT: Record<number, PlayerColor[]> = {
  2: ['red', 'yellow'],
  3: ['red', 'green', 'yellow'],
  4: ['red', 'green', 'yellow', 'blue'],
};

interface AnimState {
  tokenId: string;
  path: number[];
  /** -1 = anticipation wind-up, 0..path.length = hopping, >= length = done. */
  step: number;
  /** Which queued value this move spends. */
  dice: number;
}

type GameSpeed = 'normal' | 'fast';

/** Animation/pacing delays in ms, per speed setting. */
const SPEED_PRESETS: Record<GameSpeed, { step: number; autoMove: number; botRoll: number; botMove: number }> = {
  normal: { step: 180, autoMove: 400, botRoll: 650, botMove: 600 },
  fast: { step: 95, autoMove: 220, botRoll: 320, botMove: 300 },
};

/** Zoom focus point for the win sequence: each winner's yard corner. */
const ZOOM_ORIGIN: Record<PlayerColor, string> = {
  red: '18% 18%',
  green: '82% 18%',
  yellow: '82% 82%',
  blue: '18% 82%',
};

/* --- 3D-look die with proper pips --- */

/**
 * Standard die-face pip coordinates on a 100x100 face. Drawn as SVG so the
 * dots stay exactly aligned on a centered 3x3 grid at any die size (a CSS
 * grid of small dots picks up subpixel rounding at these sizes).
 */
const PL = 28; // left column / top row
const PM = 50; // centre
const PR = 72; // right column / bottom row
const PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[PM, PM]],
  2: [[PL, PL], [PR, PR]],
  3: [[PL, PL], [PM, PM], [PR, PR]],
  4: [[PL, PL], [PR, PL], [PL, PR], [PR, PR]],
  5: [[PL, PL], [PR, PL], [PM, PM], [PL, PR], [PR, PR]],
  6: [[PL, PL], [PR, PL], [PL, PM], [PR, PM], [PL, PR], [PR, PR]],
};

/**
 * Face-change schedule for one roll — 500ms total, in place. Faces swap every
 * 50ms through the first 350ms, then slow to a 100ms beat before landing.
 */
const DICE_TICK_DELAYS = [50, 50, 50, 50, 50, 50, 50, 100, 50];

interface DieProps {
  value: number | null;
  rolling: boolean;
  /** Whether a roll is currently allowed. Never disables the element. */
  canRoll: boolean;
  inactive: boolean;
  /** Squash-bounce + face punch right after the roll settles. */
  landing: boolean;
  onRoll: () => void;
}

/**
 * The die is deliberately never a `disabled` button: a disabled element fires
 * no pointer events at all, so a tap arriving in the split second before state
 * settles was silently swallowed. It stays interactive, acknowledges every
 * touch visually, and lets `onRoll` decide whether the tap rolls now, gets
 * buffered, or is ignored.
 */
function Die({ value, rolling, canRoll, inactive, landing, onRoll }: DieProps) {
  const face = value ?? 6;
  const [pressed, setPressed] = useState(false);

  // pointerdown, not click: fires on touch-down with no ~300ms tap delay and
  // no chance of being lost to a scroll/settle in between down and up.
  const handlePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault(); // no double-tap zoom, no synthetic click afterwards
    setPressed(true);
    setTimeout(() => setPressed(false), 140);
    onRoll();
  };

  return (
    <button
      type="button"
      className={[
        'die',
        rolling ? 'die-tumble' : '',
        inactive ? 'die-dark' : '',
        landing ? 'die-land' : '',
        pressed ? 'die-pressed' : '',
      ].join(' ')}
      onPointerDown={handlePointerDown}
      aria-label="Roll the die"
      aria-disabled={!canRoll}
    >
      <svg className="die-face" viewBox="0 0 100 100" aria-hidden="true">
        {PIP_POSITIONS[face].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={9} className="pip" />
        ))}
      </svg>
    </button>
  );
}

/* --- corner player panel: avatar + name + that player's die --- */

/** A queued value not yet aimed, drawn as a small pip face. */
function MiniDie({ value }: { value: number }) {
  return (
    <span className="mini-die" aria-label={`${value} queued`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {PIP_POSITIONS[value].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={11} className="pip" />
        ))}
      </svg>
    </span>
  );
}

/** Which board corner each colour's die sits at, matching its yard. */
const CORNER_CLASS: Record<PlayerColor, string> = {
  red: 'cd-tl',
  green: 'cd-tr',
  yellow: 'cd-br',
  blue: 'cd-bl',
};

interface CornerDieProps {
  color: PlayerColor;
  isBot: boolean;
  active: boolean;
  face: number | null;
  rolling: boolean;
  canRoll: boolean;
  dieLanding: boolean;
  /** Unspent values beyond the aimed one, shown beside the die. */
  queue: number[];
  /** Another roll is available — show the nudge arrow. */
  extraRoll: boolean;
  onRoll: (color: PlayerColor) => void;
}

/**
 * A player indicator is just their die, parked diagonally outside their own
 * corner of the board. The queued values ride along beside it in an absolutely
 * positioned strip, so nothing here can ever change the board's size.
 */
function CornerDie({
  color,
  isBot,
  active,
  face,
  rolling,
  canRoll,
  dieLanding,
  queue,
  extraRoll,
  onRoll,
}: CornerDieProps) {
  return (
    <div
      className={`corner-die ${CORNER_CLASS[color]} ${active ? 'corner-active' : ''}`}
      style={{ '--panel-color': COLORS[color] } as CSSProperties}
    >
      {active && extraRoll && <span className="roll-again" aria-hidden="true" />}
      <span className="corner-avatar" aria-hidden="true">
        {isBot ? '🤖' : '🙂'}
      </span>
      <Die
        value={face}
        rolling={rolling && active}
        canRoll={canRoll}
        inactive={!active}
        landing={dieLanding && active}
        onRoll={() => onRoll(color)}
      />
      {active && queue.length > 0 && (
        <span className="corner-queue">
          {queue.map((v, i) => (
            <MiniDie key={i} value={v} />
          ))}
        </span>
      )}
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

/* --- settings panel --- */

interface SettingsPanelProps {
  speed: GameSpeed;
  onSpeedChange: (s: GameSpeed) => void;
  muted: boolean;
  onMutedChange: (m: boolean) => void;
  voiceMuted: boolean;
  onVoiceMutedChange: (m: boolean) => void;
  autoMoveSingles: boolean;
  onAutoMoveChange: (v: boolean) => void;
  rules: HouseRules;
  onRulesChange: (r: HouseRules) => void;
  /** Only present mid-game; returns to the setup screen. */
  onRestart?: () => void;
  /** The provably-fair panel, kept out of the board's way. */
  fairness: React.ReactNode;
  onClose: () => void;
}

const HOUSE_RULE_LABELS: { key: keyof HouseRules; label: string; hint: string }[] = [
  {
    key: 'mandatoryCapture',
    label: 'Mandatory capture',
    hint: 'Skip an available capture and your leading token goes back to base.',
  },
  {
    key: 'quickMode',
    label: 'Quick mode',
    hint: 'First token home wins, instead of all four.',
  },
  {
    key: 'threeSixesSendsLeaderToBase',
    label: 'Three sixes penalty',
    hint: 'A third consecutive 6 also sends your leading token back to base.',
  },
];

function SettingsPanel({
  speed,
  onSpeedChange,
  muted,
  onMutedChange,
  voiceMuted,
  onVoiceMutedChange,
  autoMoveSingles,
  onAutoMoveChange,
  rules,
  onRulesChange,
  onRestart,
  fairness,
  onClose,
}: SettingsPanelProps) {
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-group">
          <p className="settings-label">Game speed</p>
          <div className="setup-counts">
            {(['normal', 'fast'] as GameSpeed[]).map(s => (
              <button
                key={s}
                className={`count-btn ${speed === s ? 'selected' : ''}`}
                onClick={() => onSpeedChange(s)}
              >
                {s === 'normal' ? 'Normal' : 'Fast'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-group">
          <label className="settings-row">
            <input
              type="checkbox"
              checked={!muted}
              onChange={e => onMutedChange(!e.target.checked)}
            />
            <span>Sound effects</span>
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={!voiceMuted}
              onChange={e => onVoiceMutedChange(!e.target.checked)}
            />
            <span>
              Commentary voice
              <small>Recorded Arabic call-outs for captures and tokens reaching home.</small>
            </span>
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={autoMoveSingles}
              onChange={e => onAutoMoveChange(e.target.checked)}
            />
            <span>Auto-move single options</span>
          </label>
          <label className="settings-row">
            <input
              type="checkbox"
              checked={rules.rollAllFirst}
              onChange={e => onRulesChange({ ...rules, rollAllFirst: e.target.checked })}
            />
            <span>
              Roll all dice before moving
              <small>
                Re-roll every 6 first, then spend the values in any order. Off restores the
                classic order — move after each roll.
              </small>
            </span>
          </label>
        </div>

        <div className="settings-group">
          <p className="settings-label">House rules</p>
          {HOUSE_RULE_LABELS.map(({ key, label, hint }) => (
            <label key={key} className="settings-row">
              <input
                type="checkbox"
                checked={rules[key]}
                onChange={e => onRulesChange({ ...rules, [key]: e.target.checked })}
              />
              <span>
                {label}
                <small>{hint}</small>
              </span>
            </label>
          ))}
        </div>

        <div className="settings-group">{fairness}</div>

        <div className="settings-actions">
          {onRestart && (
            <button
              className="pass-btn"
              onClick={() => {
                onRestart();
                onClose();
              }}
            >
              ⟲ Restart
            </button>
          )}
          <button className="start-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
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

  // Always 1 human vs 1 bot, seated on opposite corners.
  const startVsComputer = () => {
    const opponent = OPPOSITE[myColor];
    onStart([myColor, opponent], new Set([opponent]));
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
            <span className="mode-sub">One-on-one against a bot</span>
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
        <p className="setup-note">
          You play <b>{myColor.toUpperCase()}</b> against one bot as{' '}
          <b>{OPPOSITE[myColor].toUpperCase()}</b>.
        </p>
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
  const [banner, setBanner] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [muted, setMuted] = useState(soundSettings.muted);
  const [voiceMuted, setVoiceMuted] = useState(soundSettings.voiceMuted);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speed, setSpeed] = useState<GameSpeed>('normal');
  const [rules, setRules] = useState<HouseRules>(DEFAULT_RULES);
  // juice state
  const [flights, setFlights] = useState<Map<string, { dx: number; dy: number }>>(new Map());
  const [hitstop, setHitstop] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [homedId, setHomedId] = useState<string | null>(null);
  const [dieLanding, setDieLanding] = useState(false);
  const [winStage, setWinStage] = useState(0); // 0 idle, 1 zoom, 2 confetti, 3 panel
  const [autoMoveSingles, setAutoMoveSingles] = useState(true);
  /** Which queued value the player is spending next (null = first playable). */
  const [selectedDice, setSelectedDice] = useState<number | null>(null);
  /** Everything rolled this turn, so spent values can still be shown greyed. */
  const [rolledThisTurn, setRolledThisTurn] = useState<number[]>([]);
  /** Another roll is waiting to be taken — drives the nudge arrow. */
  const [extraRollPending, setExtraRollPending] = useState(false);
  const pendingRollAt = useRef<number | null>(null);

  /**
   * Bumped once per completed dice roll. Everything that must react to *every*
   * roll — however deep into an extra-turn chain — keys off this rather than
   * object identity, so a re-render can never swallow a roll.
   */
  const [rollSeq, setRollSeq] = useState(0);
  /** Latest-value refs: timers and async callbacks read these, never closures. */
  const stateRef = useRef(state);
  const animRef = useRef(anim);
  /** Guards against two roll chains running at once (double registerDiceRoll). */
  const rollingRef = useRef(false);
  /** Queue signature an auto-move has already been scheduled for. */
  const autoScheduledKeyRef = useRef<string | null>(null);
  /** Last movement step a tick sound was played for. */
  const lastTickRef = useRef<string | null>(null);

  stateRef.current = state;
  animRef.current = anim;

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

  const applyMuted = (m: boolean) => {
    soundSettings.muted = m;
    setMuted(m);
    if (m) stopVoice();
  };

  const applyVoiceMuted = (m: boolean) => {
    soundSettings.voiceMuted = m;
    setVoiceMuted(m);
    if (m) stopVoice();
  };

  // House rules live on the game state so the engine can consult them; keep
  // the two in sync when they're changed from the settings panel.
  const applyRules = (next: HouseRules) => {
    setRules(next);
    setState(s => ({ ...s, rules: next }));
  };

  const timings = SPEED_PRESETS[speed];

  // Step the currently-moving token through its path one cell at a time.
  // State is applied the moment the hop sequence ends — decorative effects
  // (flights, shake, sparkles) never gate the game state.
  useEffect(() => {
    if (!anim) return;

    // anticipation wind-up before the first hop
    if (anim.step === -1) {
      const t = setTimeout(() => setAnim(a => (a ? { ...a, step: 0 } : null)), 130);
      return () => clearTimeout(t);
    }

    if (anim.step >= anim.path.length) {
      const dice = anim.dice;
      const mover = state.currentPlayer;
      const movedId = anim.tokenId;
      const wasTrailing = isTrailing(state, mover);
      const result = applyMove(state, movedId, dice);
      const action = result.lastAction;
      const captured = action?.type === 'move' ? action.captured : [];
      const reachedHome = action?.type === 'move' && action.to === 58;

      if (captured.length) {
        // Visible arc back to base: offsets from each victim's old cell.
        const map = new Map<string, { dx: number; dy: number }>();
        for (const cid of captured) {
          const from = getTokenCell(state.tokens.find(t => t.id === cid)!);
          const to = getTokenCell(result.tokens.find(t => t.id === cid)!);
          map.set(cid, { dx: from.col - to.col, dy: from.row - to.row });
        }
        // Hit-stop: freeze the impact for ~80ms, then unleash everything.
        setFlights(map);
        setHitstop(true);
        setTimeout(() => {
          setHitstop(false);
          playSound('capture');
          vibrate([35, 40, 70]);
          setShaking(true);
          setTimeout(() => setShaking(false), 450);
        }, 80);
        setTimeout(() => setFlights(new Map()), 800);
        const victim = result.tokens.find(t => t.id === captured[0])!.color;
        emitCommentary({ type: wasTrailing ? 'comeback' : 'capture', player: mover, victim });
      } else if (result.winner) {
        // win sequence effect takes over
      } else if (reachedHome) {
        playSound('home');
        vibrate([20, 30, 25]);
        setHomedId(movedId);
        setTimeout(() => setHomedId(null), 750);
        emitCommentary({ type: wasTrailing ? 'comeback' : 'home', player: mover });
      } else if (isUnderThreat(result, movedId) && Math.random() < 0.5) {
        emitCommentary({ type: 'nearMiss', player: mover });
      }

      if (!reachedHome && !result.winner) {
        // follow-through: overshoot-and-settle on the final cell
        setLandedId(movedId);
        setTimeout(() => setLandedId(null), 450);
      }

      if (result.winner) {
        emitCommentary({ type: 'win', player: result.winner });
      }

      setState(result);
      setAnim(null);
      return;
    }
    const timer = setTimeout(
      () => setAnim(a => (a ? { ...a, step: a.step + 1 } : null)),
      timings.step,
    );
    return () => clearTimeout(timer);
  }, [anim, state, timings.step]);

  // Cinematic win sequence: pause -> zoom toward the winner's yard ->
  // confetti + fanfare -> game-over panel eases in.
  useEffect(() => {
    if (!state.winner) {
      setWinStage(0);
      return;
    }
    const t1 = setTimeout(() => setWinStage(1), 350);
    const t2 = setTimeout(() => {
      playSound('win');
      vibrate([60, 80, 60, 80, 140]);
      setWinStage(2);
    }, 800);
    const t3 = setTimeout(() => setWinStage(3), 1700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [state.winner]);

  // A fresh rolling phase with nothing queued means a new turn (or an earned
  // extra roll), so the tray starts empty again.
  useEffect(() => {
    if (state.phase === 'rolling' && state.diceQueue.length === 0) {
      setRolledThisTurn([]);
      setSelectedDice(null);
    }
  }, [state.phase, state.diceQueue.length]);

  // The nudge arrow: another roll is available whenever the player is back in
  // the rolling phase having already rolled, or holds an unspent 6 chain.
  const prevTurnRef = useRef(state.currentPlayer);
  useEffect(() => {
    const sameTurn = prevTurnRef.current === state.currentPlayer;
    prevTurnRef.current = state.currentPlayer;
    if (state.winner || state.phase !== 'rolling') {
      setExtraRollPending(false);
      return;
    }
    // Rolling again mid-turn: either a 6 kept the roll alive, or a capture or
    // home entry earned one. A brand-new turn is not an "extra" roll.
    setExtraRollPending(sameTurn && (state.diceQueue.length > 0 || rolledThisTurn.length > 0));
  }, [state.currentPlayer, state.phase, state.diceQueue.length, state.winner, rolledThisTurn.length]);

  // Soft cue whenever the turn moves to another player.
  const prevPlayerRef = useRef(state.currentPlayer);
  useEffect(() => {
    if (state.currentPlayer !== prevPlayerRef.current) {
      prevPlayerRef.current = state.currentPlayer;
      if (inGame && !state.winner) playSound('turn');
    }
  }, [state.currentPlayer, state.winner, inGame]);

  // Show a transient banner for three-sixes forfeits, then clear it.
  // (No-move turns get their pre-pass indicator from the auto-pass effect.)
  useEffect(() => {
    if (state.lastAction?.type !== 'forfeitSixes') return;
    setBanner(`${state.lastAction.player.toUpperCase()} rolled three 6s — turn forfeited!`);
    emitCommentary({ type: 'threeSixes', player: state.lastAction.player });
    const t = setTimeout(() => setBanner(null), 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastAction]);

  // Values still spendable this turn, and which one the player is aiming.
  const playableDice = state.phase === 'moving' ? getPlayableDice(state) : [];
  const activeDice =
    selectedDice !== null && playableDice.includes(selectedDice)
      ? selectedDice
      : (playableDice[0] ?? null);
  const legalMoves: Token[] = activeDice !== null ? getLegalMoves(state, activeDice) : [];

  // Mini dice are a "what's left to play" list, and only earn their space when
  // there is more than one value: with a single pending value the main die
  // already shows it. diceQueue keeps roll order and drops spent values, so the
  // row stays stationary and each spent value's face simply disappears.
  const queueMinis = state.diceQueue.length >= 2 ? state.diceQueue : [];
  const busy = anim !== null || rolling;
  const currentIsBot = inGame && botSeats.has(state.currentPlayer);
  const legalMoveIds = new Set(currentIsBot ? [] : legalMoves.map(t => t.id));

  const handleRoll = async () => {
    // Ref lock, not render state: two callers in the same tick (a tap plus a
    // buffered/bot roll) would otherwise both pass a stale `busy` check and
    // register two rolls.
    if (rollingRef.current) return;
    const s0 = stateRef.current;
    if (animRef.current || s0.phase !== 'rolling' || s0.winner) return;
    rollingRef.current = true;

    const roller = s0.currentPlayer;
    setRolling(true);
    playSound('dice');
    const record = await providerRef.current.roll(clientSeed);
    const nextCommitment = await providerRef.current.getCommitment();

    let tick = 0;
    let shown = 0;
    const nextTick = () => {
      if (tick < DICE_TICK_DELAYS.length) {
        // never repeat the previous face — a repeat reads as a dropped frame
        let next = Math.floor(Math.random() * 6) + 1;
        if (next === shown) next = (next % 6) + 1;
        shown = next;
        setFaces(f => ({ ...f, [roller]: next }));
        setTimeout(nextTick, DICE_TICK_DELAYS[tick]);
        tick++;
        return;
      }
      // landing: scale punch only — the die never moves and rests flat
      setFaces(f => ({ ...f, [roller]: record.value }));
      setDieLanding(true);
      setTimeout(() => setDieLanding(false), 130);
      vibrate(12);
      setLastRoll(record);
      setCommitment(nextCommitment);
      verifyRoll(record).then(r => setLastRollValid(r.valid));
      rollingRef.current = false;
      setRolling(false);
      setRolledThisTurn(r => [...r, record.value]);
      setState(s => registerDiceRoll(s, record.value));
      setRollSeq(n => n + 1);
    };
    nextTick();
  };

  // Instant-response roll request with input buffering: a tap during the last
  // step of a move animation is queued and fires the moment the board is free.
  /** `color` is the die that was tapped — never assume it is the active one. */
  const requestRoll = (color: PlayerColor) => {
    // A die belongs to one player. Tapping anyone else's does nothing at all,
    // and is never buffered — otherwise it would fire on their turn instead.
    if (color !== state.currentPlayer || botSeats.has(color)) return;

    if (!busy && !rollingRef.current && isRollAllowed(state, color)) {
      void handleRoll();
      return;
    }
    // Anything we can't act on right now is buffered rather than dropped. The
    // panel glows the moment the turn changes, but the die only truly accepts
    // input once the previous move's state has settled — a fast tap lands in
    // that gap. Buffer unconditionally (bar a finished game) and let the
    // effect below decide when it is safe to fire; staleness is judged there.
    if (!state.winner) {
      pendingRollAt.current = Date.now();
    }
  };

  // Fires a buffered tap as soon as the die genuinely accepts input. Depends on
  // the whole state object so it re-checks after every transition, not just the
  // one that happened to be in flight when the tap arrived.
  useEffect(() => {
    if (pendingRollAt.current === null) return;
    if (busy || rollingRef.current || state.winner || currentIsBot) return;
    if (state.phase !== 'rolling') return;
    // Generous enough to cover a full move animation, short enough that a tap
    // from a previous turn can never roll for you.
    const fresh = Date.now() - pendingRollAt.current < 2500;
    pendingRollAt.current = null;
    if (fresh) void handleRoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, state, currentIsBot]);

  // Reads live refs so a delayed caller (auto-move timer, bot) can never act on
  // a stale snapshot of the game.
  const moveToken = (tokenId: string, dice: number) => {
    const s = stateRef.current;
    if (animRef.current || s.phase !== 'moving' || !s.diceQueue.includes(dice)) return;
    const token = s.tokens.find(t => t.id === tokenId);
    if (!token) return;
    const path = getMovePath(token, dice);
    setSelectedDice(null);
    setAnim({ tokenId, path, step: -1, dice }); // -1 = wind-up first
  };

  // One tick per cell entered: fires as the token renders in each new cell, so
  // a move of N cells plays exactly N ticks in sync with the hops.
  useEffect(() => {
    if (!anim || anim.step < 0 || anim.step >= anim.path.length) return;
    const key = `${anim.tokenId}:${anim.step}`;
    if (lastTickRef.current === key) return;
    lastTickRef.current = key;
    playSound('step');
  }, [anim]);

  const handleTokenClick = (tokenId: string) => {
    if (busy || currentIsBot || activeDice === null) return;
    moveToken(tokenId, activeDice);
  };

  // No legal moves: hold the rolled face just long enough to read, then move
  // on. No banner, no prompt — the turn simply advances.
  useEffect(() => {
    if (state.winner || busy || state.phase !== 'moving') return;
    if (playableDice.length > 0) return;
    playSound('unlucky');
    const t = setTimeout(() => setState(s => passTurn(s)), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, busy]);

  // Auto-move when the legal moves collapse to a single distinct OUTCOME —
  // not merely a single legal token. Two pawns stacked on one square offer
  // two "choices" that land identically, which is no choice at all.
  // Re-evaluated fresh after EVERY roll (keyed on rollSeq), however deep an
  // extra-turn chain runs.
  //
  // Deliberately no cleanup/clearTimeout: the previous version cancelled its
  // pending auto-move on any re-render, and the decorative timers left over
  // from earlier moves in a chain (landing, capture flight, die bounce) fire
  // inside the 400ms window. A cancel that landed while `busy` was momentarily
  // true left nothing to reschedule it, so the player was stuck tapping. The
  // timer now survives re-renders and re-validates against live refs instead.
  // With a queue, "no real choice" means one spendable value AND one distinct
  // outcome for it. Keyed on the queue itself rather than rollSeq, so it also
  // fires for the second value of a 6,6,3 turn once the first is spent.
  const autoKey = `${rollSeq}:${state.diceQueue.join(',')}`;
  useEffect(() => {
    if (!autoMoveSingles || currentIsBot || busy) return;
    if (state.winner || state.phase !== 'moving') return;
    if (autoScheduledKeyRef.current === autoKey) return;
    const spendable = getPlayableDice(state);
    if (spendable.length !== 1) return;
    const dice = spendable[0];
    const outcomes = getDistinctMoveOutcomes(state, dice);
    if (outcomes.length !== 1) return;

    autoScheduledKeyRef.current = autoKey;
    const tokenId = outcomes[0].id;
    // Brief delay so the highlight is visible before the token sets off.
    setTimeout(() => {
      const s = stateRef.current;
      if (animRef.current || s.winner || s.phase !== 'moving') return;
      const still = getPlayableDice(s);
      if (still.length !== 1 || still[0] !== dice) return;
      const stillOne = getDistinctMoveOutcomes(s, dice);
      if (stillOne.length === 1 && stillOne[0].id === tokenId) moveToken(tokenId, dice);
    }, timings.autoMove);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, state, busy, currentIsBot, autoMoveSingles, timings.autoMove]);

  // Bot autoplay: roll, then move, with small delays for readability.
  // (The shared no-move effect above handles the bot's pass case too.)
  useEffect(() => {
    if (!currentIsBot || busy || state.winner) return;
    if (state.phase === 'rolling') {
      const t = setTimeout(() => void handleRoll(), timings.botRoll);
      return () => clearTimeout(t);
    }
    if (playableDice.length === 0) return;
    const t = setTimeout(async () => {
      const choice = await ruleBasedBot(stateRef.current);
      if (choice) moveToken(choice.tokenId, choice.dice);
    }, timings.botMove);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIsBot, busy, state, timings.botRoll, timings.botMove]);

  const resetTransients = () => {
    setAnim(null);
    setBanner(null);
    setFaces({});
    setFlights(new Map());
    setHitstop(false);
    setLandedId(null);
    setHomedId(null);
    setShaking(false);
    setRolling(false);
    pendingRollAt.current = null;
    rollingRef.current = false;
    autoScheduledKeyRef.current = null;
    lastTickRef.current = null;
    animRef.current = null;
    setSelectedDice(null);
    setRolledThisTurn([]);
  };

  const startGame = (seats: PlayerColor[], bots: Set<PlayerColor>) => {
    setPlayers(seats);
    setBotSeats(bots);
    setState(createInitialState(seats, rules));
    resetTransients();
  };

  const restart = () => {
    setPlayers(null);
    resetTransients();
  };

  // Override the animating token's position with its current path step for
  // rendering (during the wind-up, step is -1 and the token stays put).
  const renderTokens = state.tokens.map(t => {
    if (anim && t.id === anim.tokenId && anim.step >= 0) {
      const idx = Math.min(anim.step, anim.path.length - 1);
      return { ...t, position: anim.path[idx] };
    }
    return t;
  });

  const settingsUi = (
    <>
      <button
        className="mute-btn"
        onClick={() => setSettingsOpen(true)}
        aria-label="Settings"
      >
        ⚙
      </button>
      {settingsOpen && (
        <SettingsPanel
          speed={speed}
          onSpeedChange={setSpeed}
          muted={muted}
          onMutedChange={applyMuted}
          voiceMuted={voiceMuted}
          onVoiceMutedChange={applyVoiceMuted}
          autoMoveSingles={autoMoveSingles}
          onAutoMoveChange={setAutoMoveSingles}
          rules={rules}
          onRulesChange={applyRules}
          onRestart={inGame ? restart : undefined}
          fairness={
            <FairnessPanel
              commitment={commitment}
              lastRoll={lastRoll}
              lastRollValid={lastRollValid}
              clientSeed={clientSeed}
              onClientSeedChange={setClientSeed}
            />
          }
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );

  if (!inGame) {
    return (
      <div className="app-root">
        {settingsUi}
        <h1>Ludo</h1>
        <SetupScreen onStart={startGame} />
      </div>
    );
  }

  return (
    <div className="app-root">
      {settingsUi}

      {banner && <div className="banner">{banner}</div>}

      <div className="table">
        <div
          className={[
            'board-wrap',
            shaking ? 'shake' : '',
            hitstop ? 'hitstop' : '',
            winStage >= 1 ? 'board-zoom' : '',
          ].join(' ')}
          style={{
            transformOrigin: state.winner ? ZOOM_ORIGIN[state.winner] : undefined,
          }}
        >
          <div className="board-frame">
            <Board
              tokens={renderTokens}
              legalMoveIds={legalMoveIds}
              movingTokenId={anim?.tokenId ?? null}
              movePhase={anim ? (anim.step === -1 ? 'windup' : 'stepping') : null}
              landedTokenId={landedId}
              homedTokenId={homedId}
              flights={flights}
              choosing={!currentIsBot && !busy && legalMoves.length > 0}
              onTokenClick={handleTokenClick}
            />
          </div>
        </div>

        {players!.map(color => (
          <CornerDie
            key={color}
            color={color}
            active={color === state.currentPlayer && !state.winner}
            face={faces[color] ?? null}
            rolling={rolling}
            canRoll={
              color === state.currentPlayer &&
              !currentIsBot &&
              !rolling &&
              !state.winner &&
              // rollable now, or mid-move-animation (taps near the end are
              // buffered by requestRoll and fire right after)
              (state.phase === 'rolling' || anim !== null)
            }
            dieLanding={dieLanding}
            queue={queueMinis}
            isBot={botSeats.has(color)}
            extraRoll={extraRollPending}
            onRoll={requestRoll}
          />
        ))}
      </div>

      {winStage >= 2 && <Confetti />}

      {winStage >= 3 && state.winner && (
        <div className="game-over">
          <div
            className="game-over-panel"
            style={{ '--winner-color': COLORS[state.winner] } as CSSProperties}
          >
            <span className="game-over-trophy">🏆</span>
            <h2>{state.winner.toUpperCase()} WINS!</h2>
            <div className="winner-actions">
              <button className="start-btn" onClick={() => startGame(players!, botSeats)}>
                Play Again
              </button>
              <button className="pass-btn" onClick={restart}>
                Change Players
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
