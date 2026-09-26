// Pilot difficulty levels. Distances are in world units: the shorter side of
// the window is always 800 units. Masses are gravitational parameters (G*M).
export const LEVELS = [
  {
    id: 1,
    name: 'Deep space',
    description: 'No planet. Learn to fly.',
    targets: 2,
  },
  {
    id: 2,
    name: 'Small planet',
    description: 'One small planet pulls everything in.',
    planet: { radius: 30, mass: 1.4e6, sprite: 'planetSmall' },
    shipOrbit: 280,
    targets: 2,
  },
  {
    id: 3,
    name: 'Planet and moon',
    description: 'A bigger planet with a satellite in orbit.',
    planet: { radius: 52, mass: 3.2e6, sprite: 'planetBig' },
    moon: { radius: 15, mass: 1.6e5, orbit: 190, sprite: 'moon' },
    shipOrbit: 310,
    targets: 3,
  },
  {
    id: 4,
    name: 'Asteroid field',
    description: 'Planet, satellite and asteroids passing by.',
    planet: { radius: 52, mass: 3.2e6, sprite: 'planetBig' },
    moon: { radius: 15, mass: 1.6e5, orbit: 190, sprite: 'moon' },
    shipOrbit: 310,
    targets: 3,
    asteroids: { every: [2.5, 5], max: 6 },
  },
];

export const ASTEROID_SIZES = {
  large: { radius: 24, mass: 6000, score: 20, splitInto: 'medium' },
  medium: { radius: 15, mass: 2500, score: 50, splitInto: 'small' },
  small: { radius: 9, mass: 800, score: 100, splitInto: null },
};
