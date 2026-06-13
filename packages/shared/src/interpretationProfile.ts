import type { FinancialStatements } from "./financialStatements";

/** Stage-1 interpretation profiling (読み解き軸の自動選択).
 *
 *  The fixed explainer beat plan (PL waterfall → margins → BS …) reads well for a
 *  normal industrial/tech filer, but misleads for structurally different
 *  businesses: a bank's thin book equity is regulator-governed, not weakness; an
 *  investment holding has no meaningful operating margin; its bottom line swings
 *  with investment gains. This module is the single, deterministic place that
 *  classifies a company's structural archetype from the FinancialStatements SHAPE
 *  (no LLM, no quota, §3-safe — it only reads existing fields and computes ratios)
 *  and emits the interpretive AXIS plus which default beats to suppress, so the
 *  downstream prose (Gemini or Jules) is steered to the read that actually fits.
 *
 *  Division of labour: the structural axis is computable → code decides it here;
 *  the qualitative business-model nuance stays with the model, now aimed correctly. */

export type BusinessArchetype =
  | "financial-institution" // bank/insurer: the balance sheet IS the business
  | "investment-holding" // op income n/a; value flows through investment P&L
  | "financialized-industrial" // segment assets expose a finance/leasing arm (Toyota)
  | "standard"; // industrial/tech with a normal income statement

export interface InterpretationProfile {
  archetype: BusinessArchetype;
  /** revenue / totalAssets — low for balance-sheet-heavy financials. */
  assetTurnover: number | null;
  /** totalEquity / totalAssets. */
  equityRatio: number | null;
  /** Default beats whose generic framing misleads for this archetype. */
  suppress: { plWaterfall: boolean; grossMargin: boolean; operatingMargin: boolean };
  /** §2-safe steer naming the real interpretive axis; injected into the prose and
   *  Jules-research prompts so deep work targets the right structure. */
  axisNote: string;
  /** Reframed focus for the margin beat (null = use the default focus). */
  marginFocus: string | null;
  /** Reframed focus for the BS-ratio beat (null = use the default focus). */
  bsFocus: string | null;
}

const FIN_INST_NOTE =
  "この会社は銀行・保険などの金融機関で、損益計算書よりも貸借対照表そのものが事業の中心。『売上高』に当たるのは主に資金運用や手数料による収益で、製造業のような売上原価・粗利益は存在しない。総資産が収益の何十倍にもなるのは、預金・貸出金・有価証券といった金融資産を大量に抱えて利ざやを得る業態だから。自己資本比率が一桁台と低く出るのは金融機関では構造的に通常で、自己資本（自己資本比率）規制の下で別途管理されている——という事実を踏まえ、薄い自己資本を弱さと短絡しない。読み解きの主役は『BSの規模と構成が事業そのもの』という点に置く。";
const FIN_INST_MARGIN =
  "営業利益率・純利益率は、分母の『収益』が金融機関特有の資金運用・手数料収益である前提で読む。製造業の利益率と直接比べず、収益の大半が資金調達費用や営業経費・与信費用に充てられる構造であることを事実として述べる。良し悪しの評価はしない。";
const FIN_INST_BS =
  "比例縮尺の貸借対照表で、総資産の大半が金融資産・負債の大半が預金等であること、純資産が総資産に占める割合が一桁台で出ることを、金融機関の事業構造として事実説明する。これは自己資本規制の下で管理される業態の通常の姿であり、薄さを弱点と読まない。利益剰余金が自己資本の中核を成す点には触れてよい。";

const HOLDING_NOTE =
  "この会社は事業会社というより投資持株会社の性格が強く、本業の営業利益が開示されない／意味を持ちにくい。最終損益は保有する投資先の評価損益・売却損益を通じて大きく変動するため、年度間で純利益が大きく振れるのが構造的な特徴。読み解きの主役は『純利益が投資成果で動く』点と、貸借対照表が投資資産中心であること。営業利益率での評価はしない。";
const HOLDING_MARGIN =
  "営業利益が開示されない投資持株のため、営業利益率は扱わない。純利益が投資先の評価・売却損益で構成され年度間で変動しやすい事実を、前期比の振れ幅があれば具体的に述べて読み解く。将来予測や売買の含意は出さない。";
const HOLDING_BS =
  "比例縮尺の貸借対照表で、資産側が投資資産中心であること、純資産の厚みを事実として読み解く。事業会社の自己資本比率と同じ尺度で良し悪しを論じない。";

const FINANCIALIZED_NOTE =
  "この会社は製造・販売が本業だが、販売金融やリースの金融事業を連結に抱えるため、その金融子会社の資産・負債が連結BSを大きく膨らませ、自己資本比率が事業の実態より低めに出る。読み解きの主役は『売上構成と資産構成のズレ』——金融事業は売上比は小さいのに資産を大きく抱える——という構造の非対称に置く。";

const STANDARD_NOTE =
  "この会社は製品・サービスの販売が本業の事業会社。読み解きの主役は、費用構造（原価・販管費・研究開発のどこに費用の重心があるか）が示す利益率の意味と、稼いだ利益が利益剰余金として自己資本に積み上がるPLとBSの連関に置く。";

/** Classify the archetype from the newest period's shape and return the axis steer
 *  plus beat-suppression flags. Deterministic & §3-safe (reads existing fields only). */
export function deriveInterpretationProfile(fs: FinancialStatements): InterpretationProfile {
  const p = fs.periods[0];
  const pl = p?.incomeStatement;
  const bs = p?.balanceSheet;
  const rev = pl?.revenue ?? null;
  const op = pl?.operatingIncome ?? null;
  const net = pl?.netIncome ?? null;
  const gross = pl?.grossProfit ?? null;
  const ta = bs?.totalAssets ?? null;
  const te = bs?.totalEquity ?? null;
  const assetTurnover = rev != null && ta ? rev / ta : null;
  const equityRatio = te != null && ta ? te / ta : null;
  const hasSegAssets = (fs.segments ?? []).filter((s) => s.assets != null).length >= 2;
  const base = { assetTurnover, equityRatio };

  // 1) Financial institution: assets dwarf revenue, no COGS/gross, thin regulated
  //    equity. The balance sheet, not the P&L, is the story.
  if (assetTurnover != null && assetTurnover < 0.2 && gross == null && equityRatio != null && equityRatio < 0.2) {
    return {
      archetype: "financial-institution",
      ...base,
      suppress: { plWaterfall: true, grossMargin: true, operatingMargin: false },
      axisNote: FIN_INST_NOTE,
      marginFocus: FIN_INST_MARGIN,
      bsFocus: FIN_INST_BS,
    };
  }
  // 2) Investment holding: operating income is not disclosed/meaningful; the bottom
  //    line is driven by investment gains/losses and is volatile year to year.
  if (op == null && net != null && (assetTurnover == null || assetTurnover < 0.6)) {
    return {
      archetype: "investment-holding",
      ...base,
      suppress: { plWaterfall: true, grossMargin: true, operatingMargin: true },
      axisNote: HOLDING_NOTE,
      marginFocus: HOLDING_MARGIN,
      bsFocus: HOLDING_BS,
    };
  }
  // 3) Financialized industrial: a finance/leasing arm shows up as segment assets
  //    that bloat the consolidated BS (Toyota). Keep every beat; reinforce the axis.
  if (hasSegAssets) {
    return {
      archetype: "financialized-industrial",
      ...base,
      suppress: { plWaterfall: false, grossMargin: gross == null, operatingMargin: false },
      axisNote: FINANCIALIZED_NOTE,
      marginFocus: null,
      bsFocus: null,
    };
  }
  // 4) Standard industrial/tech.
  return {
    archetype: "standard",
    ...base,
    suppress: { plWaterfall: false, grossMargin: gross == null, operatingMargin: false },
    axisNote: STANDARD_NOTE,
    marginFocus: null,
    bsFocus: null,
  };
}
