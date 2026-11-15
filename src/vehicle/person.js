// Who you are: David or Jody, both Mixamo characters with their own Mixamo clips (tools/person).
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
// fall at the same points), but Mixamo fits each to its character: on Jody, 2 cm shorter, they carry
// her hips 1.4% further a cycle (the walk 1.649 m/s to David's 1.626, measured by convert.mjs), so
// her paces are his times 1.014.
export const PEOPLE = {
  david: { id: 'david', name: 'David', file: 'person.glb', pace: { walk: 1.55, run: 5.0, back: 1.0 }, step: { walk: 0.225, run: 0.217 } },
  jody: { id: 'jody', name: 'Jody', file: 'person-jody.glb', pace: { walk: 1.57, run: 5.07, back: 1.01 }, step: { walk: 0.225, run: 0.217 } },
};

let current = 'david';
const subs = new Set();

export const personId = () => current;
export const person = (id = current) => PEOPLE[id] || PEOPLE.david;
export const personUrl = (id = current) => `${import.meta.env.BASE_URL}models/${person(id).file}`;
// A fresh copy of the person's model (its pictures shared with every other copy).
export const loadPerson = (id = current) => loadGLTF(personUrl(id));
// Choose who you are; everyone using the person loads the new one.
export function setPerson(id) {
  if (!PEOPLE[id] || id === current) return false;
  current = id;
  for (const f of subs) f(id);
  return true;
}
export function onPerson(f) { subs.add(f); return () => subs.delete(f); }
