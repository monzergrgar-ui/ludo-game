import type { GameState, PlayerColor, Token } from './types';
import { START_OFFSET, SAFE_SQUARES } from './engine';

/**
 * Egyptian-Arabic football-commentator reactions to game events.
 *
 * Text-first by design: game code emits a `CommentaryEvent`, and
 * `getCommentaryLine` maps it to a pre-written line (random pick, no API
 * calls). A TTS layer can later subscribe to the same events and speak the
 * returned line — nothing here would need to change.
 */

export type CommentaryEventType =
  | 'capture'
  | 'nearMiss'
  | 'threeSixes'
  | 'home'
  | 'comeback'
  | 'win';

export interface CommentaryEvent {
  type: CommentaryEventType;
  player: PlayerColor;
  /** The captured player, for capture events. */
  victim?: PlayerColor;
}

export const PLAYER_NAMES_AR: Record<PlayerColor, string> = {
  red: 'الأحمر',
  green: 'الأخضر',
  yellow: 'الأصفر',
  blue: 'الأزرق',
};

// {player} and {victim} get substituted with the Arabic color names.
const POOLS: Record<CommentaryEventType, string[]> = {
  capture: [
    'يا ساتر يا رب! {player} خطف {victim} خطف من قلب الملعب!',
    'جوووول قصدي كسسسر! {player} بعت {victim} البيت مشي على رجليه!',
    'إيه القسوة دي؟! {player} داس على {victim} من غير ما يرمش!',
    'استنى استنى... ريبلاي من فضلك! {player} أكل {victim} أكل في لقمة واحدة!',
    'كارثة بكل المقاييس لـ{victim}! كان ماشي في حاله و{player} قفله على الناصية!',
    'الدفاع فين؟! {victim} اتساب لوحده و{player} ما رحمش!',
  ],
  nearMiss: [
    'خطر! خطر يا {player}! في واحد واقف وراك على طول النفس!',
    'قلبي وقع في رجلي! {player} عدى جنب الموت وكمل ماشي!',
    'على شعرة يا جماعة! رقم واحد كان يفرق مع {player} النهاردة!',
    'يا لهوي! {player} واقف في منطقة نار مكشوفة... ربنا يستر الرمية الجاية!',
    'حبس الجمهور أنفاسه! {player} في مرمى النيران وبيبتسم!',
  ],
  threeSixes: [
    'تلاتة ستات؟! الحكم صفر وقال: كتير عليك يا {player}! الدور اتحرق!',
    'طمع يا {player} طمع! تلات ستات ورا بعض والنتيجة: بره يا حبيبي!',
    'الزهر قال كلمته النهاردة: مفيش حاجة اسمها كله ليا يا {player}!',
    'مأساة إغريقية على أرض الملعب! {player} كان طاير طيران وفجأة... راح كله في ثانية!',
    'ههههه معلش يا {player}، التلاتة الحلوين دول طلعوا خسارة مش مكسب!',
  ],
  home: [
    'وصلت بسلامة الله! حصان {player} دخل الإسطبل والجمهور واقف يصقف!',
    'تمام التمام يا معلم! {player} ودى واحدة الأمان... محدش يقدر يلمسها تاني!',
    'أهو ده الكلام اللي بنقعد نستناه! {player} يسجل نقطة غالية بعيدة عن أي رجلين!',
    'بالراحة كده على عتبة البيت... {player} يقفل الباب ويرمي المفتاح!',
    'قطعة في الخزنة يا {player}! الطريق كان طويل بس النهاية مسك!',
  ],
  comeback: [
    'الريمونتادا! الريمونتادا! {player} راجع من بعيد يا جماعة والماتش ولع تاني!',
    'مين قال خلاص؟! {player} قام من تحت الرماد وبيقول: أنا لسه هنا!',
    'يا سلام على الروح القتالية! {player} كان آخر الترتيب ودلوقتي بيهدد الكل!',
    'اللودو ما بتخلصش غير بصافرة النهاية! {player} بيكتب فصل جديد في الماتش!',
    'ارفعوا الرايات! المارد {player} صحي من النوم والدنيا هتقلب!',
  ],
  win: [
    'انتهى الماتش! انتهى الماتش! {player} بطل الديربي بجدارة واستحقاق!',
    'صافرة النهاية! {player} يرفع الكاس عالي عالي... ألف ألف مبرووووك!',
    'ليلة تاريخية من العمر! {player} يكتب اسمه بحروف من دهب في سجلات اللودو!',
    'خلصت الحكاية يا سادة! {player} كسبها واحنا شفنا ماتش يتحط في المتحف!',
    'سجدة الفوز! {player} ينهيها والملعب كله بيغني باسمه!',
  ],
};

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)];
}

export function getCommentaryLine(event: CommentaryEvent): string {
  return pick(POOLS[event.type])
    .replaceAll('{player}', PLAYER_NAMES_AR[event.player])
    .replaceAll('{victim}', event.victim ? PLAYER_NAMES_AR[event.victim] : '');
}

/* --- event-detection helpers (pure, engine-independent) --- */

function globalPosition(color: PlayerColor, position: number): number | null {
  if (position < 1 || position > 51) return null;
  return (START_OFFSET[color] + position - 1) % 52;
}

/**
 * True when the (just-moved) token stands on an unsafe shared-track square
 * with an enemy token 1-6 steps behind it — i.e. capturable on the very next
 * roll. Fuels the near-miss/danger lines.
 */
export function isUnderThreat(state: GameState, tokenId: string): boolean {
  const token = state.tokens.find(t => t.id === tokenId);
  if (!token) return false;
  const global = globalPosition(token.color, token.position);
  if (global === null || SAFE_SQUARES.includes(global)) return false;

  return state.tokens.some(enemy => {
    if (enemy.color === token.color) return false;
    const enemyGlobal = globalPosition(enemy.color, enemy.position);
    if (enemyGlobal === null) return false;
    const gap = (global - enemyGlobal + 52) % 52;
    return gap >= 1 && gap <= 6;
  });
}

function progressScore(tokens: Token[], color: PlayerColor): number {
  return tokens
    .filter(t => t.color === color)
    .reduce((sum, t) => sum + (t.position === -1 ? 0 : t.position), 0);
}

/** True when `color` is (or ties for) last place by total token progress. */
export function isTrailing(state: GameState, color: PlayerColor): boolean {
  if (state.players.length < 2) return false;
  const mine = progressScore(state.tokens, color);
  return state.players.every(p => p === color || progressScore(state.tokens, p) >= mine);
}
