import type { WorldSnapshot } from '../shared/world-snapshot.ts';

export type Tint = 'self' | 'kin' | 'rememberer' | 'affected' | 'neutral';

export function layoutTown(households: WorldSnapshot['households']) {
  const ordered = [...households].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
  const rowHeight = Math.max(66, ...ordered.map(house => 28 + Math.ceil(house.members.length / 6) * 14));
  const houses = ordered.map((house, index) => ({
    id: house.id, x: 10 + index % 6 * 100, y: 10 + Math.floor(index / 6) * rowHeight,
    w: 92, h: rowHeight - 8,
  }));
  const residents = ordered.flatMap((house, index) => [...house.members].sort((a, b) => a - b)
    .map((person, member) => ({
      person, household: house.id,
      x: houses[index]!.x + 11 + member % 6 * 14,
      y: houses[index]!.y + 28 + Math.floor(member / 6) * 14,
    })));
  return { houses, residents, height: Math.ceil(ordered.length / 6) * rowHeight + 20 };
}

export function townDrawList(world: WorldSnapshot) {
  const living = new Set(world.residents.filter(person => person.alive).map(person => person.id));
  const households = world.households.map(house => ({
    ...house, members: house.members.filter(person => living.has(person)),
  }));
  const kin = new Set(world.player.blood_ties.map(tie => tie.person));
  const rememberers = new Set(world.player.past_life_ties.map(tie => tie.rememberer));
  const affected = new Set(world.player_node?.options.flatMap(option => option.preview.map(entry => entry.person)) ?? []);
  const layout = layoutTown(households);
  return {
    ...layout,
    residents: layout.residents.map(marker => {
      const soul = world.player.place === 'body' && marker.person === world.player.body;
      const tint: Tint = soul ? 'self' : affected.has(marker.person) ? 'affected'
        : kin.has(marker.person) ? 'kin' : rememberers.has(marker.person) ? 'rememberer' : 'neutral';
      return { ...marker, soul, tint };
    }),
    graves: world.player.earlier_bodies,
  };
}
