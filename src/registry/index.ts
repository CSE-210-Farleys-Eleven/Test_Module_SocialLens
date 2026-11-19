import { parseNsid } from '../shared';
import type { Nsid } from '../shared/contract';
import type { AppDefinition, CollectionDefinition, CollectionInventory, CreateRegistry, Registry } from './contract';
import { REGISTRY_DATA } from './data';

const byNsid: ReadonlyMap<string, CollectionDefinition> = new Map(REGISTRY_DATA.collections.map((c) => [c.nsid as string, c]));
const byApp: ReadonlyMap<string, AppDefinition> = new Map(REGISTRY_DATA.apps.map((a) => [a.id as string, a]));

const registry: Registry = Object.freeze({
  data: REGISTRY_DATA,
  app(id) {
    return byApp.get(id) as AppDefinition;
  },
  collection(nsid) {
    return typeof nsid === 'string' ? (byNsid.get(nsid) ?? null) : null;
  },
  analysedCollections() {
    return REGISTRY_DATA.collections;
  },
  inventory(advertised): CollectionInventory {
    const valid = new Set<Nsid>();
    for (const raw of advertised) {
      const n = parseNsid(raw);
      if (n !== null) valid.add(n);
    }
    const nsids = REGISTRY_DATA.collections.map((c) => c.nsid);
    return {
      present: nsids.filter((n) => valid.has(n)),
      absent: nsids.filter((n) => !valid.has(n)),
      presentNotAnalysed: [...valid].filter((n) => !byNsid.has(n)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    };
  },
} satisfies Registry);

export const createRegistry: CreateRegistry = () => registry;
