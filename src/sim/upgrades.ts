// Rig upgrade lines. Tier 0 is what a new rig has.

export type UpgradeKey = 'drill' | 'hull' | 'engine' | 'tank' | 'cargo' | 'heater' | 'radiator';

export interface Tier {
  name: string;
  value: number;
  cost: number;
}

export interface UpgradeLine {
  key: UpgradeKey;
  name: string;
  blurb: string;
  format: (v: number) => string;
  tiers: Tier[];
}

const tiers = (names: string[], values: number[], costs: number[]): Tier[] =>
  names.map((name, i) => ({ name, value: values[i], cost: costs[i] }));

export const UPGRADES: Record<UpgradeKey, UpgradeLine> = {
  drill: {
    key: 'drill',
    name: 'Drill',
    blurb: 'Digs faster, which also saves fuel.',
    format: (v) => `${v.toFixed(1)}x speed`,
    tiers: tiers(
      ['Stock Auger', 'Carbide Auger', 'Diamond Crown', 'Thermal Lance', 'Sonic Bore', 'Plasma Bore', 'Hearthcutter'],
      [1, 1.45, 2.1, 3, 4.2, 5.8, 7.5],
      [0, 500, 1800, 6000, 16000, 40000, 90000],
    ),
  },
  hull: {
    key: 'hull',
    name: 'Hull',
    blurb: 'Survives longer falls, gas pockets and heat.',
    format: (v) => `${v} hull`,
    tiers: tiers(
      ['Tin Shell', 'Steel Plating', 'Ceramic Plating', 'Titanium Frame', 'Nanoweave Shell', 'Graphene Armor', 'Bastion Hull'],
      [30, 45, 70, 105, 150, 210, 300],
      [0, 400, 1500, 5000, 14000, 35000, 80000],
    ),
  },
  engine: {
    key: 'engine',
    name: 'Engine',
    blurb: 'Drives, climbs and flies faster.',
    format: (v) => `${v.toFixed(2)}x power`,
    tiers: tiers(
      ['Diesel 40', 'Diesel 90 Turbo', 'Ion Pulse', 'Twin Ion', 'Fusion Torch', 'Antimatter Torch', 'Aurora Drive'],
      [1, 1.15, 1.32, 1.52, 1.75, 2.0, 2.3],
      [0, 450, 1600, 5500, 15000, 38000, 85000],
    ),
  },
  tank: {
    key: 'tank',
    name: 'Fuel Tank',
    blurb: 'Carries more fuel for longer trips.',
    format: (v) => `${v} L`,
    tiers: tiers(
      ['Jerry Tank', 'Long-Range Tank', 'Bladder Tank', 'Pressure Tank', 'Cryo Tank', 'Fusion Cell', 'Deep Reserve'],
      [10, 15, 22, 32, 45, 62, 85],
      [0, 350, 1200, 4000, 12000, 30000, 70000],
    ),
  },
  cargo: {
    key: 'cargo',
    name: 'Cargo Bay',
    blurb: 'Holds more ore per trip.',
    format: (v) => `${v} slots`,
    tiers: tiers(
      ['Toolbox Bay', 'Hopper', 'Ore Skip', 'Twin Skip', 'Freight Pod', 'Compression Hold', 'Pocket Vault'],
      [8, 13, 20, 30, 44, 60, 80],
      [0, 400, 1500, 5000, 14000, 36000, 82000],
    ),
  },
  heater: {
    key: 'heater',
    name: 'Heater',
    blurb: 'Keeps the rig working in the deep cold of the glacier.',
    format: (v) => `down to ${v}°C`,
    tiers: tiers(['Glow Plug', 'Coolant Heater', 'Plasma Heater', 'Core Furnace'], [-50, -60, -72, -85], [0, 600, 2500, 8000]),
  },
  radiator: {
    key: 'radiator',
    name: 'Radiator',
    blurb: 'Stops the hull cooking in the hot zones far below.',
    format: (v) => `up to ${v}°C`,
    tiers: tiers(
      ['Fan Radiator', 'Oil Cooler', 'Liquid Loop', 'Phase Cooler', 'Cryo Sink', 'Vacuum Shroud', 'Zero-Point Sink'],
      [40, 80, 130, 190, 260, 340, 420],
      [0, 2000, 6000, 15000, 35000, 70000, 120000],
    ),
  },
};

export const UPGRADE_ORDER: UpgradeKey[] = ['drill', 'hull', 'engine', 'tank', 'cargo', 'heater', 'radiator'];

export type Upgrades = Record<UpgradeKey, number>;

export const newUpgrades = (): Upgrades => ({ drill: 0, hull: 0, engine: 0, tank: 0, cargo: 0, heater: 0, radiator: 0 });

export function tierOf(u: Upgrades, key: UpgradeKey): Tier {
  const t = UPGRADES[key].tiers;
  return t[Math.max(0, Math.min(t.length - 1, u[key] | 0))];
}
