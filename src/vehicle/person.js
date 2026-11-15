// Who you are: David or Kachujin, both Mixamo characters with their own Mixamo clips (tools/person).
// Chosen on the splash before you begin and remembered (settings.person). The same person is you on
// foot, at the wheel, in the saddle, at the pump and under the parachute, and the other players in a
// room see the one you chose.
//
// Each person's model is its own file, loaded fresh by each user (walker, driver, skydiver), which
// share the pictures (gltf.js). Choosing again on the splash loads the new file and each user swaps
// it in (onPerson); the clips are the same Mixamo motions on both, so everything posed from bones
// (the seat, the reins, the pump, the climbs) fits either.
import { loadGLTF } from '../world/gltf.js';

// pace: each clip's own pace in m/s (the walk, run and walk backwards), measured off the planted
// foot where the feet do not slide; step: where in the walk and run the left foot is furthest
// forward, so the two keep step as they blend. The clips are the same motions on both (so the steps
// fall at the same points), but Mixamo fits each to its character, so each one's paces are measured
// on them (the hips' travel a cycle from convert.mjs, against David's: walk 1.626, run 5.389 m/s).
// Kachujin, scaled to 1.70 m, travels 3.8% further a cycle (walk 1.688), so hers are his times 1.038.
export const PEOPLE = {
  david: { id: 'david', name: 'David', file: 'person.glb', pace: { walk: 1.55, run: 5.0, back: 1.0 }, step: { walk: 0.225, run: 0.217 } },
  kachujin: { id: 'kachujin', name: 'Kachujin', file: 'person-kachujin.glb', pace: { walk: 1.61, run: 5.19, back: 1.04 }, step: { walk: 0.225, run: 0.217 } },
};

// Jody, the first woman offered, was replaced by Kachujin: anyone who picked her gets Kachujin.
const ALIAS = { jody: 'kachujin' };
export const personKey = (id) => (PEOPLE[ALIAS[id] || id] ? ALIAS[id] || id : 'david');
let current = 'david';
const subs = new Set();

export const personId = () => current;
export const person = (id = current) => PEOPLE[id] || PEOPLE.david;
export const personUrl = (id = current) => `${import.meta.env.BASE_URL}models/${person(id).file}`;
// A fresh copy of the person's model (its pictures shared with every other copy).
export const loadPerson = (id = current) => loadGLTF(personUrl(id));
// Choose who you are; everyone using the person loads the new one.
export function setPerson(id) {
  id = personKey(id);
  if (id === current) return false;
  current = id;
  for (const f of subs) f(id);
  return true;
}
export function onPerson(f) { subs.add(f); return () => subs.delete(f); }
