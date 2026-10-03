// Adversarial German inputs: runs of frame-opening words and of spaces.
export const GERMAN_WORST_CASES = [
  "die kosten die kosten ".repeat(400),
  "mit den schönen hohen ".repeat(400),
  "ihr seit mir dem seid den mich ".repeat(300),
  `der ${"\t ".repeat(3_000)}vertrag`,
  "ich glaube weil um zu wissen was ob sondern ".repeat(300),
  "Wir habe. Sollte wir du kann ich hast ".repeat(300),
  "mir ist zu recht Ernst nach Links riesen Dank im arm die schuld ".repeat(250),
  "zwei und zwanzig hundert tausend mal drei an halb viele Lösung ".repeat(250),
  "Der Auto mit dem Frau eine sehr schönes Haus ich habe ein Tisch ".repeat(250),
  "ich helfe den Mann er fragt dem Lehrer das alter die grenzen meiner Stadt sind ".repeat(250),
  "rausgucken rum runterladen Rumspielen rein- und raus vom zweiten Weltkrieg ".repeat(250),
  "\nHallo Liebe Anna,\nLiebe Herr Müller, etwas ganz sehr besonderes ".repeat(250),
  `Ich ${"habe ein schöne neue ".repeat(400)}Haustürschlüsselbundanhänger.`,
  `Wann ${"kommst du ".repeat(2_000)}. Wie viel kostet das. Hast du Zeit, oder.`,
  `Seit${" ".repeat(4_000)}ihr. Das${" ".repeat(4_000)}ich am${" ".repeat(4_000)}12.3. mir`,
  `ist ${" ".repeat(4_000)}mir ${" ".repeat(4_000)}Recht. Ein ${" ".repeat(4_000)}schönes paar`,
  `zwei ${" ".repeat(4_000)}Million. ${"a".repeat(4_000)} seid ${"x".repeat(3_000)}`,
  `${"photo".repeat(800)}graphie ${"mikro".repeat(800)}phon auf Grund in Stand zuhause `,
  "Es kommt darauf an das ist es gewohnt der Test der im Haus die Frau die ich ".repeat(200),
  "jedes mal mit ja ist sehr Stolz auf an dritte bedarf es einem Gesetz als solches ".repeat(200),
  "uns gleich auf dem Weg ich schenke den Mann ein Bild wie sie das schaffen ab fuhr ".repeat(200),
  "zum Zeitung lesen Groß/Kleinschreibung mit neue Feldern solche Problem bereit standen ".repeat(
    200,
  ),
  // Capitalized word pairs that may be split compounds, each looked up in the noun supplement.
  "acht Kinder Gruppen einen Pflege Fall die Zeitungs Artikel kauft alt Gold an ".repeat(250),
  "Den das ergibt wir sind vorsorgt dienen Tisch sag Bescheid, wen das gut ist Haus, der da ".repeat(
    200,
  ),
  "Dr. Frau Weber macht für uns wenig Sinn die Infos Kuli Mathe Uni ".repeat(250),
  // A word whose frame checks a long window before it: the window is read in code.
  `${"Das Schiff \t ".repeat(600)}versengt ${"a b ".repeat(1_000)}versengte seid einweist paar`,
];
