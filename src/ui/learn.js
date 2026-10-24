// The Learn panel: short, plain explanations of the aurora terms on the radio,
// and a six-step "How auroras work" lesson with simple drawings.

const SVG = (body) => `<svg viewBox="0 0 240 110" aria-hidden="true">${body}</svg>`;
const KP_BAR = SVG(`${[...Array(10)].map((_, i) => `<rect x="${12 + i * 22}" y="40" width="20" height="26" rx="3" fill="${i < 3 ? '#3a5466' : i < 5 ? '#4f8f6b' : i < 7 ? '#5cf2a0' : '#ff6b6b'}"/><text x="${22 + i * 22}" y="84" font-size="11" text-anchor="middle" fill="#a9b4bd">${i}</text>`).join('')}<text x="12" y="30" font-size="11" fill="#a9b4bd">quiet</text><text x="122" y="30" font-size="11" fill="#a9b4bd">active</text><text x="196" y="30" font-size="11" fill="#ff8b8b">storm</text>`);

export const TERMS = [
  { id: 'kp', title: 'Kp index', graphic: KP_BAR, text: ['A scale from 0 to 9 that measures how disturbed Earth\u2019s magnetic field is. It is updated every three hours.', 'Higher numbers push the aurora further south. Kp 0 to 2 is quiet, 3 and 4 are active, and 5 or more is a geomagnetic storm.'] },
  { id: 'forecast', title: 'Forecast (the radio)', text: ['The radio predicts activity for the next few hours from the Kp outlook and the solar wind. The dashed line is the prediction, the green line is what has happened tonight.', 'It is a guide, not a promise. Real aurora comes in bursts, so keep an eye on the sky.'] },
  { id: 'activity', title: 'Activity', text: ['How bright the aurora is right now where you are, from none to faint to bright.', 'It depends on the forecast, but also on clouds, darkness and city light. A high Kp under cloud still means no show.'] },
  { id: 'clouds', title: 'Cloud cover', text: ['Aurora happens 100 kilometres or more up, far above the clouds, so any cloud between you and it hides it.', 'Watch the cloud percentage and drive toward clearer sky. The north and the highlands are often clearer than the south coast.'] },
  { id: 'darkness', title: 'Darkness', text: ['Aurora is faint next to daylight, so you need a properly dark sky.', 'In an Icelandic summer the sun barely sets. From May to August the nights stay too bright to see it, which is why June and July show midnight sun.'] },
  { id: 'glow', title: 'Light pollution', text: ['Street lights and buildings brighten the sky and wash out faint aurora.', 'Drive away from Reykjavík or Akureyri and the sky gets much darker. Even a short drive makes a big difference.'] },
  { id: 'types', title: 'Aurora types', graphic: SVG('<path d="M10 80 Q120 40 230 80" stroke="#5cf2a0" stroke-width="6" fill="none" opacity="0.8"/><text x="18" y="100" font-size="11" fill="#a9b4bd">arc</text><path d="M60 70 q15 -30 30 0 t30 0 t30 0" stroke="#5cf2a0" stroke-width="4" fill="none"/><text x="92" y="100" font-size="11" fill="#a9b4bd">curtain</text>' + [...Array(7)].map((_, i) => `<line x1="${180 + i * 7}" y1="20" x2="${180 + i * 7}" y2="70" stroke="#5cf2a0" stroke-width="2" opacity="${0.4 + (i % 3) * 0.2}"/>`).join('') + '<text x="186" y="100" font-size="11" fill="#a9b4bd">rays</text>'),
    text: ['An arc is a calm band across the sky. Bands and curtains fold and ripple, and rays are vertical streaks of light.', 'A corona is when the rays seem to burst out from straight overhead. It only happens during strong activity.'] },
  { id: 'solar', title: 'Solar wind and magnetosphere', text: ['The Sun constantly streams out charged particles, called the solar wind.', 'Earth\u2019s magnetic field, the magnetosphere, shields us, but it channels some of those particles down toward the polar regions, where they make the air glow.'] },
];

const STEPS = [
  { title: 'The Sun blows a wind', text: 'The Sun throws out a constant stream of charged particles, called the solar wind. Big eruptions on the Sun send out extra-strong gusts.',
    art: SVG('<circle cx="40" cy="55" r="26" fill="#ffcf5a"/>' + [...Array(9)].map((_, i) => `<circle cx="${90 + (i % 3) * 40}" cy="${30 + Math.floor(i / 3) * 25}" r="3" fill="#ffd98a"/>`).join('') + '<path d="M80 55 h140" stroke="#ffd98a" stroke-dasharray="4 6"/>') },
  { title: 'Earth has a shield', text: 'Earth\u2019s magnetic field forms a bubble around the planet, the magnetosphere. It turns most of the solar wind away.',
    art: SVG('<circle cx="160" cy="55" r="18" fill="#3b6fb0"/><path d="M160 37 C110 10 110 100 160 73 M160 37 C210 10 210 100 160 73" stroke="#8fd3ff" fill="none"/><path d="M20 55 h100" stroke="#ffd98a" stroke-dasharray="4 6"/>') },
  { title: 'Particles slide to the poles', text: 'Some particles get caught and guided along the magnetic field lines down toward the north and south poles.',
    art: SVG('<circle cx="120" cy="60" r="26" fill="#3b6fb0"/><path d="M120 34 C60 0 40 70 100 84 M120 34 C180 0 200 70 140 84" stroke="#8fd3ff" fill="none"/><circle cx="120" cy="34" r="5" fill="#5cf2a0"/>') },
  { title: 'They crash into the air', text: 'High up, 100 to 300 kilometres above the ground, the particles hit oxygen and nitrogen in the atmosphere.',
    art: SVG('<rect x="10" y="20" width="220" height="20" fill="#1d2a38"/><rect x="10" y="40" width="220" height="20" fill="#26394a"/><rect x="10" y="60" width="220" height="30" fill="#2c4256"/><text x="18" y="34" font-size="10" fill="#a9b4bd">300 km</text><text x="18" y="54" font-size="10" fill="#a9b4bd">200 km</text><text x="18" y="78" font-size="10" fill="#a9b4bd">100 km</text><path d="M150 10 l-10 70" stroke="#ffd98a" stroke-dasharray="3 4"/>') },
  { title: 'The air glows', text: 'The gases light up as they settle down again. Oxygen glows green, and red very high up. Nitrogen adds pink and purple at the lower edge.',
    art: SVG('<path d="M20 90 C60 30 100 30 120 60 S190 20 220 90" stroke="#5cf2a0" stroke-width="16" fill="none" opacity="0.7"/><path d="M20 70 C60 10 100 10 120 40 S190 0 220 70" stroke="#ff6b8b" stroke-width="5" fill="none" opacity="0.5"/>') },
  { title: 'A ring of light round the pole', text: 'The glow forms an oval around the magnetic pole. Iceland sits right under it, and when Kp rises the oval grows and slides further south.',
    art: SVG('<ellipse cx="120" cy="55" rx="70" ry="34" stroke="#5cf2a0" stroke-width="10" fill="none" opacity="0.7"/><ellipse cx="120" cy="55" rx="92" ry="44" stroke="#5cf2a0" stroke-width="3" fill="none" stroke-dasharray="5 5" opacity="0.6"/><circle cx="62" cy="40" r="5" fill="#e7ecef"/><text x="40" y="30" font-size="10" fill="#e7ecef">Iceland</text>') },
];

export class Learn {
  constructor() {
    this.dialog = document.getElementById('learn');
    this.body = document.getElementById('learn-body');
    this.step = 0;
    this.dialog.querySelectorAll('[data-ltab]').forEach((t) => t.addEventListener('click', () => this.show(t.dataset.ltab)));
    // Every (i) button in the HUD opens its entry.
    document.querySelectorAll('[data-learn]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.open(b.dataset.learn); }));
  }
  open(id = null) {
    this.show('terms', id);
    if (!this.dialog.open) this.dialog.showModal();
  }
  show(tab, focusId = null) {
    this.dialog.querySelectorAll('[data-ltab]').forEach((t) => { const on = t.dataset.ltab === tab; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on)); });
    if (tab === 'terms') {
      this.body.innerHTML = TERMS.map((t) => `<section class="learn-entry" id="learn-${t.id}"><h3>${t.title}</h3>${t.graphic || ''}${t.text.map((p) => `<p>${p}</p>`).join('')}</section>`).join('');
      if (focusId) {
        const el = document.getElementById(`learn-${focusId}`);
        if (el) { el.classList.add('is-focus'); setTimeout(() => el.scrollIntoView({ block: 'start' }), 30); }
      }
    } else this.renderStep();
  }
  renderStep() {
    const s = STEPS[this.step];
    this.body.innerHTML = `<div class="lesson"><p class="lesson-count">Step ${this.step + 1} of ${STEPS.length}</p>${s.art}<h3>${s.title}</h3><p>${s.text}</p>
      <div class="lesson-nav"><button class="btn btn-quiet" id="lesson-prev" ${this.step === 0 ? 'disabled' : ''}>Back</button><button class="btn btn-primary" id="lesson-next">${this.step === STEPS.length - 1 ? 'Done' : 'Next'}</button></div></div>`;
    this.body.querySelector('#lesson-prev').onclick = () => { this.step = Math.max(0, this.step - 1); this.renderStep(); };
    this.body.querySelector('#lesson-next').onclick = () => { if (this.step === STEPS.length - 1) { this.step = 0; this.show('terms'); } else { this.step++; this.renderStep(); } };
  }
}
