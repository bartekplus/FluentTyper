// Nouns that are uncountable in everyday English: "a"/"an" and many/several/few do not take
// them ("an advice", "many luggage"). Authored list. Nouns with a common count sense too ("a
// fine wine", "a good education", "a great help") are left out or listed in MASS_WITH_COUNT_SENSE.
export const ENGLISH_MASS_NOUNS: ReadonlySet<string> = new Set(
  // Things and stuff
  (
    "advice information info equipment furniture luggage baggage feedback homework housework " +
    "paperwork software hardware firmware malware spyware ransomware freeware shareware " +
    "middleware machinery merchandise clothing footwear underwear sportswear swimwear eyewear " +
    "knitwear outerwear headwear tableware kitchenware silverware glassware cutlery crockery " +
    "stationery jewelry jewellery garbage rubbish trash litter junk stuff mail spam " +
    "scenery vocabulary graffiti accommodation infrastructure footage bedding scaffolding " +
    "money cash traffic transport transportation parking shopping sightseeing housing " +
    "wildlife livestock poultry foliage vegetation plankton pollen " +
    // Food and drink
    "wine bread butter flour rice pasta spaghetti oatmeal porridge cereal honey jam ketchup " +
    "mayonnaise mustard vinegar cinnamon garlic ginger yeast dough milk yogurt yoghurt " +
    "broccoli spinach celery asparagus lettuce seafood beef pork veal venison bacon mutton " +
    "toast food " +
    // Materials and substances
    "aluminium aluminum asphalt cement clay coal copper cotton denim gasoline petrol gravel " +
    "leather linen mercury mud nylon oxygen hydrogen nitrogen helium carbon calcium sodium " +
    "potassium chlorine ammonia plutonium uranium polyester silk soil steel sulfur sulphur " +
    "velvet wool wheat zinc timber sand dust dirt rust smoke steam sweat shampoo toothpaste " +
    "soap electricity gas " +
    // Weather and nature
    "weather sunshine sunlight moonlight lightning thunder hail snow humidity pollution smog " +
    "gravity " +
    // Fields and activities
    "physics mathematics maths economics linguistics biology chemistry geology botany zoology " +
    "astronomy anthropology archaeology sociology psychology arithmetic algebra calculus " +
    "geometry grammar punctuation spelling literature poetry photography journalism tourism " +
    "commerce marketing advertising management engineering research yoga tennis " +
    "chess golf soccer hockey rugby " +
    "gymnastics athletics aerobics music " +
    // Abstract
    "knowledge wisdom evidence progress anger applause assistance attention awareness " +
    "bravery chaos cleanliness compassion conduct courage cowardice dignity diligence " +
    "dishonesty enjoyment enthusiasm envy fame fatigue flexibility generosity gratitude greed " +
    "guidance guilt happiness harassment hatred health heritage honesty hospitality " +
    "humility hunger hygiene ignorance immigration impatience inflation ingenuity innocence " +
    "insomnia integrity jealousy justice laughter laziness legislation leisure literacy " +
    "litigation loneliness loyalty luck malnutrition mischief misinformation momentum " +
    "motivation nonsense nostalgia nourishment nutrition obedience obesity optimism " +
    "patience permission persistence pessimism plagiarism pneumonia poverty pride privacy " +
    "procrastination prosperity publicity racism recreation recycling relaxation reliability " +
    "resilience respect revenge safety sanitation sarcasm slang stamina supervision " +
    "tolerance turbulence unemployment vandalism violence warfare wealth welfare wrath " +
    "news"
  ).split(" "),
);

// Mass nouns with an everyday count sense: "a fine wine", "a rich vocabulary", "a healthy
// food", "a breakfast cereal". The article checks leave them alone; count words still do not
// take them ("many wine").
export const MASS_WITH_COUNT_SENSE: ReadonlySet<string> = new Set(
  (
    "wine vocabulary scenery food cereal bread grammar litter gas jam steel leather silk clay " +
    "soil infrastructure yogurt yoghurt toast spelling transport heritage justice literature pride " +
    "hunger nonsense enthusiasm motivation awareness algebra geometry hail lettuce beef pasta " +
    "copper soap shampoo"
  ).split(" "),
);
