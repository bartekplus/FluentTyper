import { finding } from "../finding";
import { alternation, frameMatches, isLang, SPACE, WORD_END } from "../phraseTemplates";
import type { DetectContext, RawFinding } from "../reviewDetectors";
import { ACTION_NOUNS, TORNAR } from "./styleMore";

/**
 * Opt-in wording advice (stylePhrasing): a verb with a noun or an adjective that one plain
 * verb says. The fixed wording rows are in the `phrases.style` table of grammar/rules/pt_BR.yaml.
 */

// Slots: infinitive; present 1sg 3sg 1pl 3pl; preterite 1sg 3sg 3pl; imperfect 3sg 3pl;
// future 3sg; conditional 3sg; present subjunctive 3sg; imperfect subjunctive 3sg; future
// subjunctive 3sg; gerund; participle.
const IRREGULAR: Record<string, string> = {
  dar: "dou dá damos dão dei deu deram dava davam dará daria dê desse der dando dado",
  fazer:
    "faço faz fazemos fazem fiz fez fizeram fazia faziam fará faria faça fizesse fizer fazendo feito",
  ter: "tenho tem temos têm tive teve tiveram tinha tinham terá teria tenha tivesse tiver tendo tido",
  manter:
    "mantenho mantém mantemos mantêm mantive manteve mantiveram mantinha mantinham manterá manteria mantenha mantivesse mantiver mantendo mantido",
  estar:
    "estou está estamos estão estive esteve estiveram estava estavam estará estaria esteja estivesse estiver estando estado",
  ser: "sou é somos são fui foi foram era eram será seria seja fosse for sendo sido",
  ir: "vou vai vamos vão fui foi foram ia iam irá iria vá fosse for indo ido",
  pôr: "ponho põe pomos põem pus pôs puseram punha punham porá poria ponha pusesse puser pondo posto",
  propor:
    "proponho propõe propomos propõem propus propôs propuseram propunha propunham proporá proporia proponha propusesse propuser propondo proposto",
  vir: "venho vem vimos vêm vim veio vieram vinha vinham virá viria venha viesse vier vindo vindo",
  ver: "vejo vê vemos veem vi viu viram via viam verá veria veja visse vir vendo visto",
  dizer:
    "digo diz dizemos dizem disse disse disseram dizia diziam dirá diria diga dissesse disser dizendo dito",
  saber:
    "sei sabe sabemos sabem soube soube souberam sabia sabiam saberá saberia saiba soubesse souber sabendo sabido",
  trazer:
    "trago traz trazemos trazem trouxe trouxe trouxeram trazia traziam trará traria traga trouxesse trouxer trazendo trazido",
  perder:
    "perco perde perdemos perdem perdi perdeu perderam perdia perdiam perderá perderia perca perdesse perder perdendo perdido",
  pedir:
    "peço pede pedimos pedem pedi pediu pediram pedia pediam pedirá pediria peça pedisse pedir pedindo pedido",
  cair: "caio cai caímos caem caí caiu caíram caía caíam cairá cairia caia caísse cair caindo caído",
  sair: "saio sai saímos saem saí saiu saíram saía saíam sairá sairia saia saísse sair saindo saído",
  subir:
    "subo sobe subimos sobem subi subiu subiram subia subiam subirá subiria suba subisse subir subindo subido",
  engolir:
    "engulo engole engolimos engolem engoli engoliu engoliram engolia engoliam engolirá engoliria engula engolisse engolir engolindo engolido",
  abrir:
    "abro abre abrimos abrem abri abriu abriram abria abriam abrirá abriria abra abrisse abrir abrindo aberto",
  sentir:
    "sinto sente sentimos sentem senti sentiu sentiram sentia sentiam sentirá sentiria sinta sentisse sentir sentindo sentido",
  seguir:
    "sigo segue seguimos seguem segui seguiu seguiram seguia seguiam seguirá seguiria siga seguisse seguir seguindo seguido",
  conseguir:
    "consigo consegue conseguimos conseguem consegui conseguiu conseguiram conseguia conseguiam conseguirá conseguiria consiga conseguisse conseguir conseguindo conseguido",
  preferir:
    "prefiro prefere preferimos preferem preferi preferiu preferiram preferia preferiam preferirá preferiria prefira preferisse preferir preferindo preferido",
  repetir:
    "repito repete repetimos repetem repeti repetiu repetiram repetia repetiam repetirá repetiria repita repetisse repetir repetindo repetido",
  dormir:
    "durmo dorme dormimos dormem dormi dormiu dormiram dormia dormiam dormirá dormiria durma dormisse dormir dormindo dormido",
  fugir:
    "fujo foge fugimos fogem fugi fugiu fugiram fugia fugiam fugirá fugiria fuja fugisse fugir fugindo fugido",
  ouvir:
    "ouço ouve ouvimos ouvem ouvi ouviu ouviram ouvia ouviam ouvirá ouviria ouça ouvisse ouvir ouvindo ouvido",
  poder:
    "posso pode podemos podem pude pôde puderam podia podiam poderá poderia possa pudesse puder podendo podido",
  querer:
    "quero quer queremos querem quis quis quiseram queria queriam quererá quereria queira quisesse quiser querendo querido",
  ler: "leio lê lemos leem li leu leram lia liam lerá leria leia lesse ler lendo lido",
  roer: "roo rói roemos roem roí roeu roeram roía roíam roerá roeria roa roesse roer roendo roído",
  obter:
    "obtenho obtém obtemos obtêm obtive obteve obtiveram obtinha obtinham obterá obteria obtenha obtivesse obtiver obtendo obtido",
  contrair:
    "contraio contrai contraímos contraem contraí contraiu contraíram contraía contraíam contrairá contrairia contraia contraísse contrair contraindo contraído",
  diferir:
    "difiro difere diferimos diferem diferi diferiu diferiram diferia diferiam diferirá diferiria difira diferisse diferir diferindo diferido",
};

/** The 17 slot forms of a verb: the irregular row, or the regular paradigm of its ending. */
export function conjugate(verb: string): string[] {
  const row = IRREGULAR[verb];
  if (row) return [verb, ...row.split(" ")];
  const stem = verb.slice(0, -2);
  const ending = verb.slice(-2);
  if (ending === "ar") {
    // "ficar" -> "fiquei", "pagar" -> "paguei", "começar" -> "comecei"; "passear" -> "passeia".
    const soft = stem.replace(/c$/, "qu").replace(/g$/, "gu").replace(/ç$/, "c");
    const ear = /e$/.test(stem) ? `${stem}i` : stem;
    return [
      verb,
      `${ear}o`,
      `${ear}a`,
      `${stem}amos`,
      `${ear}am`,
      `${soft}ei`,
      `${stem}ou`,
      `${stem}aram`,
      `${stem}ava`,
      `${stem}avam`,
      `${stem}ará`,
      `${stem}aria`,
      /e$/.test(stem) ? `${ear}e` : `${soft}e`,
      `${stem}asse`,
      verb,
      `${stem}ando`,
      `${stem}ado`,
    ];
  }
  if (ending !== "er" && ending !== "ir") throw new Error(`Not a verb: ${verb}`);
  // "concluir": the stressed i after a vowel takes an accent ("concluíram", "conclui").
  if (ending === "ir" && /[^gq]u$/.test(stem))
    return [
      verb,
      `${stem}o`,
      `${stem}i`,
      `${stem}ímos`,
      `${stem}em`,
      `${stem}í`,
      `${stem}iu`,
      `${stem}íram`,
      `${stem}ía`,
      `${stem}íam`,
      `${stem}irá`,
      `${stem}iria`,
      `${stem}a`,
      `${stem}ísse`,
      verb,
      `${stem}indo`,
      `${stem}ído`,
    ];
  // "conhecer" -> "conheço", "proteger" -> "protejo", "fingir" -> "finjo".
  const hard = stem.replace(/c$/, "ç").replace(/g$/, "j");
  const vowel = ending[0];
  return [
    verb,
    `${hard}o`,
    `${stem}e`,
    `${stem}${vowel}mos`,
    `${stem}em`,
    `${stem}i`,
    `${stem}${vowel === "e" ? "eu" : "iu"}`,
    `${stem}${vowel}ram`,
    `${stem}ia`,
    `${stem}iam`,
    `${stem}${vowel}rá`,
    `${stem}${vowel}ria`,
    `${hard}a`,
    `${stem}${vowel}sse`,
    verb,
    `${stem}${vowel}ndo`,
    `${stem}ido`,
  ];
}

/** A head verb in any slot, a complement that maps to a plain verb, and the text around them. */
function verbFrame(
  heads: string[],
  complements: Map<string, string>,
  before: string,
  after: string,
) {
  const slots = new Map<string, number>();
  for (const verb of heads)
    conjugate(verb).forEach((form, slot) => slots.has(form) || slots.set(form, slot));
  const pattern = `${before}(?<target>(?<head>${alternation(slots.keys())})${SPACE}(?<complement>${alternation(complements.keys())})${after})${WORD_END}`;
  return { slots, complements, pattern };
}
const VERB_FRAMES = [
  // "fez a análise do texto" -> "analisou o texto".
  verbFrame(["fazer", "realizar", "efetuar"], ACTION_NOUNS, "", `${SPACE}(?<of>de|d[oa]s?)`),
  // "torna possível o acesso" -> "possibilita o acesso"; "se torna possível" says "becomes".
  verbFrame(
    ["tornar"],
    TORNAR,
    `(?<!(?:^|[^\\p{L}])se${SPACE}|-se${SPACE})`,
    `(?=${SPACE}(?:que|[oa]s?|um|uma|essa?|este|esta|isso|isto|tudo|\\p{L}+[çs]ão)${WORD_END})`,
  ),
];

/** A verb with a noun or an adjective that one plain verb says, in the same tense (opt-in). */
export function verbFrames(ctx: DetectContext): RawFinding[] {
  if (!isLang(ctx, "pt")) return [];
  const findings: RawFinding[] = [];
  for (const { slots, complements, pattern } of VERB_FRAMES) {
    for (const m of frameMatches(ctx, pattern)) {
      const { head, complement, of } = m.groups!;
      const words = m.groups!.target.split(/[ \t\u00a0]+/);
      // A capital after the first word is a name; a user word stays as typed.
      if (
        words.some(
          (word, i) =>
            (i > 0 && word !== word.toLowerCase()) || ctx.dictionary.has(word.toLowerCase()),
        )
      )
        continue;
      const slot = slots.get(head.toLowerCase());
      const verb = complements.get(complement.toLowerCase().replace(/[ \t\u00a0]+/, " "));
      if (slot === undefined || !verb) continue;
      const article = !of || of.toLowerCase() === "de" ? "" : ` ${of.slice(1).toLowerCase()}`;
      let plain = `${conjugate(verb)[slot]}${article}`;
      if (/^\p{Lu}/u.test(head)) plain = plain[0].toUpperCase() + plain.slice(1);
      const [start, end] = m.indices!.groups!.target;
      findings.push(finding("stylePhrasing", "review_msg_style_phrasing", start, end, [plain]));
    }
  }
  return findings;
}
