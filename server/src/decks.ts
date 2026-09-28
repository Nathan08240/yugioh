// 40-card decks from LOB / MRD / MRL / PSV, as [passcode, copies].
type DeckList = [code: number, copies: number][];

export const SLIFER_ANIME = 511600399;
export const OBELISK_ANIME = 511600398;

const yugi: DeckList = [
  [46986414, 2], // Dark Magician
  [70781052, 2], // Summoned Skull
  [6368038, 1], // Gaia The Fierce Knight
  [28279543, 1], // Curse of Dragon
  [91152256, 3], // Celtic Guardian
  [32452818, 2], // Beaver Warrior
  [13039848, 2], // Giant Soldier of Stone
  [15025844, 2], // Mystical Elf
  [41392891, 2], // Feral Imp
  [90357090, 2], // Silver Fang
  [99785935, 1], // Alpha The Magnet Warrior
  [39256679, 1], // Beta The Magnet Warrior
  [11549357, 1], // Gamma The Magnet Warrior
  [40640057, 1], // Kuriboh
  [SLIFER_ANIME, 1],
  [53129443, 1], // Dark Hole
  [83764718, 1], // Monster Reborn
  [55144522, 1], // Pot of Greed
  [72302403, 1], // Swords of Revealing Light
  [12580477, 1], // Raigeki
  [5318639, 1], // Mystical Space Typhoon
  [4031928, 1], // Change of Heart
  [64047146, 1], // Horn of the Unicorn
  [4206964, 2], // Trap Hole
  [44095762, 1], // Mirror Force
  [12607053, 1], // Waboku
  [17814387, 2], // Reinforcements
  [18807108, 1], // Spellbinding Circle
  [50045299, 1], // Dragon Capture Jar
];

const kaiba: DeckList = [
  [89631139, 3], // Blue-Eyes White Dragon
  [17985575, 1], // Lord of D.
  [5053103, 2], // Battle Ox
  [66602787, 2], // Saggi the Dark Clown
  [76184692, 2], // Hitotsu-Me Giant
  [24611934, 2], // Ryu-Kishin Powered
  [97590747, 2], // La Jinn the Mystical Genie of the Lamp
  [14898066, 2], // Vorse Raider
  [30113682, 1], // Judge Man
  [26378150, 2], // Rude Kaiser
  [68516705, 2], // Mystic Horseman
  [17444133, 1], // Kaiser Sea Horse
  [62397231, 1], // Hyozanryu
  [OBELISK_ANIME, 1],
  [53129443, 1], // Dark Hole
  [83764718, 1], // Monster Reborn
  [55144522, 1], // Pot of Greed
  [66788016, 2], // Fissure
  [12580477, 1], // Raigeki
  [5318639, 1], // Mystical Space Typhoon
  [46130346, 2], // Hinotama
  [24068492, 2], // Just Desserts
  [4206964, 2], // Trap Hole
  [44095762, 1], // Mirror Force
  [17814387, 1], // Reinforcements
  [50045299, 1], // Dragon Capture Jar
];

const expand = (list: DeckList) => list.flatMap(([code, copies]) => Array<number>(copies).fill(code));

export const YUGI = expand(yugi);
export const KAIBA = expand(kaiba);
