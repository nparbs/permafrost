// Consumables sold at the Supply Store.

export type ItemKey = 'fuelcell' | 'repairkit' | 'charge' | 'megacharge' | 'beacon' | 'flare';

export interface Item {
  key: ItemKey;
  name: string;
  blurb: string;
  cost: number;
  /** Keyboard shortcut shown in the HUD. */
  hotkey: string;
}

export const ITEMS: Record<ItemKey, Item> = {
  fuelcell: { key: 'fuelcell', name: 'Fuel Cell', blurb: 'Refills half your tank, anywhere.', cost: 150, hotkey: '1' },
  repairkit: { key: 'repairkit', name: 'Repair Kit', blurb: 'Patches 40% of your hull.', cost: 250, hotkey: '2' },
  charge: { key: 'charge', name: 'Thermal Charge', blurb: 'Clears the 3x3 around you, boulders too. Ore in the blast is lost.', cost: 300, hotkey: '3' },
  megacharge: { key: 'megacharge', name: 'Shaped Charge', blurb: 'Clears a 5x5 circle around you.', cost: 900, hotkey: '4' },
  beacon: { key: 'beacon', name: 'Recall Beacon', blurb: 'Pulls you back to the station with your cargo.', cost: 800, hotkey: '5' },
  flare: { key: 'flare', name: 'Flare', blurb: 'Lights up a wide patch of the dark for a minute. Other miners see it too.', cost: 60, hotkey: '6' },
};

export const ITEM_ORDER: ItemKey[] = ['fuelcell', 'repairkit', 'charge', 'megacharge', 'beacon', 'flare'];
export const ITEM_STACK = 9;

export const newItems = (): Record<ItemKey, number> => ({ fuelcell: 0, repairkit: 0, charge: 0, megacharge: 0, beacon: 0, flare: 0 });

/** Seconds a flare burns, and its light radius in tiles. */
export const FLARE = { life: 60, radius: 7.5 };
