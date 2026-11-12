// The Halvorsen story: the recorder logs scattered down the map, and what the station crew
// say over the radio as a miner gets deeper and reads more of them.

export interface StoryLog {
  /** Depth in tiles where the recorder sits (give or take a few). */
  depth: number;
  /** Who is speaking. */
  who: string;
  title: string;
  text: string;
}

/** Forty years old, in the order the expedition recorded them. A log's id is its index here. */
export const LOGS: StoryLog[] = [
  { depth: 8, who: 'Ingrid Halvorsen', title: 'Day 1. Pad', text: 'Halvorsen Expedition, first entry. Four of us, two rigs, one stove. The Combine wants a core sample from under the glacier and is paying by the metre. Brask says the ice here is the wrong age for the planet. I told him ice is ice. Drilling starts at first light, if this place has one.' },
  { depth: 20, who: 'Pim Aldous', title: 'Day 3. Firn', text: "Pim, driver, rig two. Nobody told me the recorder was on. Anyway: the snow squeaks, the fuel gauge lies, and Oyelaran says if I park under a slab again she'll leave me there. Good crew. Bad planet." },
  { depth: 34, who: 'Teodor Brask', title: 'Day 6. Glacier top', text: 'Brask, geology. The glacier is layered like a cake that was baked once and never touched again. No melt seasons. No summers at all, for as long as this ice has existed. A world this close to its sun should not manage that.' },
  { depth: 52, who: 'Mirela Oyelaran', title: 'Day 9. Meltwater', text: "Oyelaran, engineering. Found liquid water sealed in the ice at minus sixty. It should be frozen solid. It isn't, so I ran it through the cracker and it burns clean. Free fuel. I don't trust free things, but the tanks are full." },
  { depth: 70, who: 'Ingrid Halvorsen', title: 'Day 12. The cold seam', text: "Minus seventy-eight at the core of the glacier and still dropping as we go down. The heaters are at their limit. The Combine's reply to my report was one line: keep drilling, bonus doubled. They did not ask how cold. They already had a number in mind." },
  { depth: 88, who: 'Pim Aldous', title: 'Day 15. Past the worst', text: "Here's a thing. It's getting warmer. We're a quarter mile under a glacier and my boots are drying out. Brask laughed for a full minute and then went very quiet and started writing." },
  { depth: 104, who: 'Teodor Brask', title: 'Day 17. Gradient', text: 'The temperature climbs with every metre below the cold seam. So the cold is not coming from the sky. It sits in a band, like a lid. Something below is warm, and something is keeping that warmth from reaching the surface. I do not have a word for the second thing yet.' },
  { depth: 126, who: 'Mirela Oyelaran', title: 'Day 21. Frozen soil', text: 'Out of the ice and into frozen ground. There are roots in it. Roots, seed husks, a river bed. This was a living valley, and it froze fast enough to keep the leaves on. Pim found a fossil the size of his rig and wants to keep it. I said the Combine owns it. He said the Combine can come and carry it.' },
  { depth: 150, who: 'Ingrid Halvorsen', title: 'Day 24. Supply drop', text: 'The supply drop came with new orders and a crate we did not ask for: charges. Thermal, shaped, enough to open a mountain. For a core sample. I have put the crate at the back of the cache and the key in my boot.' },
  { depth: 176, who: 'Pim Aldous', title: 'Day 27. Noise', text: "Rig two picks up a hum at night when the engine's off. Low, steady, like a fridge in another room. Oyelaran says it's the rock settling. Oyelaran also sleeps with her hand on the wall now, so." },
  { depth: 200, who: 'Teodor Brask', title: 'Day 30. Warm rock', text: 'Bedrock, and it is warm to the touch. Zero degrees, then ten. I have checked the instruments against each other and against my own hand. The planet has a hot core, an ordinary healthy one. The heat is simply not allowed to leave. It is being taken somewhere.' },
  { depth: 226, who: 'Mirela Oyelaran', title: 'Day 33. Radiators', text: "Rebuilt the radiators out of the spare heater cores, which is a sentence I never expected to say on an ice world. We came dressed for the cold. Forty degrees and rising. The Combine's answer to my parts request was a second crate of charges." },
  { depth: 252, who: 'Ingrid Halvorsen', title: 'Day 36. Orders', text: "I asked the Combine directly what is under us. They said a deposit. I asked what kind. They said the kind that pays for a station, a fleet, and my silence, in that order. I have stopped sending full reports. These recorders are the full reports." },
  { depth: 280, who: 'Pim Aldous', title: 'Day 39. Gas', text: "Lost rig two's front plating to a gas pocket. I'm fine. Ears ringing. Brask patched me up and said the hum is louder down here, and I said what hum, and he just looked at me, because I'd been tapping my foot to it for an hour." },
  { depth: 310, who: 'Teodor Brask', title: 'Day 42. Direction', text: 'I have mapped where the heat goes. It does not spread. It flows, down and inward, toward one point about three kilometres under the station pad. Rock does not do that. Rock has no opinions about direction. Something down there is pulling.' },
  { depth: 347, who: 'Mirela Oyelaran', title: 'Day 45. The tunnel', text: "We broke into a tunnel. Dead straight, dead vertical, two rigs wide, walls cut smooth. Nobody dug this with anything I've ever built or seen built. It runs down past the range of the lamp. There is no dust on the floor of the ledge. There is no floor." },
  { depth: 400, who: 'Ingrid Halvorsen', title: 'Day 47. Vote', text: 'We voted on going down the tunnel. Three to one. I was the one. I am recording that I was outvoted and that I am going anyway, because I will not have them go without me. Steam vents on every side now. The rock glows at the seams.' },
  { depth: 470, who: 'Pim Aldous', title: 'Day 50. The Hollow', text: "It opens out. Halls. Pillars. Somebody built rooms down here, a long time before the ice, and then left, or didn't. There's a stone the colour of a bruise that hums back when you hum at it. Brask says don't hum at it. I'm the driver, I don't take orders about humming." },
  { depth: 520, who: 'Teodor Brask', title: 'Day 52. Shards', text: 'The pink crystals grow thickest toward the bottom. They are warm and they never cool. I believe they are heat itself, laid down like frost in reverse: every winter this world has had for ten thousand years, stored. The Combine does not want a core sample. It wants the harvest.' },
  { depth: 592, who: 'Ingrid Halvorsen', title: 'Day 54. The Hearth', text: "It is a machine. It sits at the bottom and breathes in. Four vents feed it and the heart of it is behind them. Oyelaran says the charges would break it if we took the vents first, and the whole Hollow would come down after. The Combine sent the charges, so the Combine knows. They want it opened, not stopped. We are going to stop it. If you are hearing this, we were slower than the collapse. Take the vents. Then the heart. Then climb, and do not look down." },
];

export interface RadioLine {
  who: 'Depot' | 'Assayer' | 'Mechanic';
  text: string;
}

/** Said once, the first time a miner's deepest dig passes `depth` (in tiles). */
export const RADIO_DEPTH: (RadioLine & { depth: number })[] = [
  { depth: 30, who: 'Depot', text: "That's the glacier under you. It gets colder before it gets better. Buy a heater or buy a lot of fuel. I sell one of those." },
  { depth: 85, who: 'Mechanic', text: 'Coldest spot on the map, right there. Funny thing, it warms up below that. Nobody up here can tell you why.' },
  { depth: 125, who: 'Assayer', text: "Frozen soil. There are fossils in it. The Combine pays well for them and doesn't say what it does with them. I've stopped asking." },
  { depth: 220, who: 'Mechanic', text: "Bedrock. You'll want a radiator soon. Yes, on an ice planet. I just fit them, I don't write the brochure." },
  { depth: 300, who: 'Depot', text: "Fifty-five degrees at your depth and it's minus thirty-five on my forecourt. Forty years I've pumped fuel here. Nobody's explained that to me either." },
  { depth: 340, who: 'Mechanic', text: 'Geothermal zone. The vents blow every six seconds and the glowing rock is the bad rock. Somewhere near you there is supposed to be a tunnel. Old crews talked about it.' },
  { depth: 400, who: 'Assayer', text: "For the record, the price list for what's below you was written before anyone had been down there. Somebody knew what they'd find. It wasn't me." },
  { depth: 460, who: 'Depot', text: "You've gone off the bottom of my map. Head office calls it the Hollow. They had a name ready. Think about that while you're down there." },
  { depth: 560, who: 'Mechanic', text: "Whatever's humming on your channel, it isn't your engine. Check your charges. Check them again. And listen: if it all starts coming down, you go up." },
];

/** Said once, when a miner has found this many recorders. */
export const RADIO_LOGS: (RadioLine & { count: number })[] = [
  { count: 1, who: 'Assayer', text: "That's a Halvorsen recorder. Forty years old. Bring them to the Comms Tower and we can play them back. Officially I'm meant to log them and send them to head office unheard." },
  { count: 5, who: 'Depot', text: "I knew Pim Aldous. Sold him his last tank. They told us the expedition went home on a different ship. I've been listening to these and I don't think there was a ship." },
  { count: 10, who: 'Mechanic', text: "Charges, for a core sample. I've got the same crates in my store room, same stencil, forty years newer. I always figured they were for boulders." },
  { count: 15, who: 'Assayer', text: "I ran the numbers on the pink ones. One Heartshard is a winter. A whole winter, somewhere up here, that never ended. We've been buying them by the crate." },
  { count: 20, who: 'Depot', text: "That's all of them. Halvorsen went down to stop it and the Combine sent us to finish opening it. Well. I pump the fuel. You're the one with the charges. Vents first, she said." },
];

/** The credits that roll after the Hearth breaks. */
export const CREDITS: string[] = [
  'The Hearth is broken.',
  'For the first time in ten thousand years, the heat of this world is going where heat goes.',
  'At Rime Station, water is dripping off the depot roof.',
  'Depot: "Forecourt\'s a puddle. I\'m not mopping a planet."',
  'Assayer: "Head office is on the line. I have decided the line is faulty."',
  'Mechanic: "Rig\'s a write-off. Pilot\'s fine. I\'ll fetch a new one. Rig, I mean."',
  'In memory of the Halvorsen Expedition: Ingrid Halvorsen, Teodor Brask, Mirela Oyelaran, Pim Aldous.',
  'They were slower than the collapse. You were not.',
  'PERMAFROST',
  'The ice will take a while. There is still ore down there, and the Combine still pays.',
];
