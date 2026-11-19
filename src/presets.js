// Aura presets. Three independent layers, mixed into themes:
//   SHAPES      - geometry as expressions: x,y,z (+ alpha) of a point at s (0..1 along a line) in row dt (0..1)
//   COLORS      - hue/saturation/value/alpha expressions per point
//   BACKGROUNDS - backdrop + optional feedback trails (decay 0 = crisp and clean)
//
// Expression variables: s, dt, t, bass, mid, treble, level, beat, inst, PI, TAU,
//   fft(u)    spectrum at u (0 = bass ... 1 = treble); inside a shape it is delayed per row by `tmap` seconds
//   wave(u)   oscilloscope sample (-1..1)       hist(u,d)  spectrum d (0..1) of the way back in time
//   besj(m,x) Bessel J_m(x)      sin cos abs pow min max clamp mix trwv noise ...
// "defs" are named intermediate values, evaluated in order and usable by later expressions.
// Shape options: rows, pts, across (draw a line through the rows every N points), instances, tmap, width, fov.

export const SHAPES = {
  // Superformula "blob" with three lobes; the lobes swell with the music.
  'Tri-Lobe': {
    rows: 44, pts: 140, across: 7, width: 1.7, fov: 55,
    defs: [
      ['th', 'TAU * s - PI'],
      ['ph', 'PI * dt - PI / 2'],
      ['e', '.15 * (fft(.1) + fft(.2) + fft(.3) + fft(.6) + fft(.8))'],
      ['w', 'loose() * .14 * (sin(3 * th + 4 * ph + t * 1.1) + .6 * sin(5 * ph - 2 * th - t * .8))'],
      ['r1', '(abs(cos(3 * th / 4)) ^ .9 + abs(sin(3 * th / 4)) ^ 1.4) ^ (-1 / .6) + e + w'],
      ['r2', '(abs(cos(5 * ph / 4)) ^ 1.2 + abs(sin(5 * ph / 4)) ^ .8) ^ (-1 / .8) + e + w'],
    ],
    x: '11 * r1 * r2 * cos(th) * cos(ph)', y: '11 * r1 * r2 * sin(th) * cos(ph)', z: '11 * r2 * sin(ph)',
    alpha: '.9',
    tmap: '(.2 + .7 * loose()) * abs(dt - .5)',
    cam: { pos: ['(1 + .6 * level) * 36 * cos(t * .11)', '(1 + .6 * level) * 36 * sin(t * .09)', '(1 + .6 * level) * (14 * sin(t * .07) + 5)'], look: ['0', '0', '0'] },
  },

  // Vibrating circular drum head: sum of Bessel modes (their frequency ratios are not whole numbers,
  // which is why the surface never repeats). The outer ring is clamped flat, like a real rim.
  'Bessel': {
    rows: 30, pts: 150, across: 5, width: 1.7, fov: 50,
    defs: [
      ['r', 'dt'], ['th', 'TAU * s'], ['b', '2.2 * t'],
      ['m0', 'besj(0, 2.404826 * r) * cos(b)'],
      ['m1', 'besj(1, 3.831706 * r) * cos(th + .4) * cos(1.5933 * b + 1.1)'],
      ['m2', 'besj(2, 5.135622 * r) * cos(2 * th + .9) * cos(2.1355 * b + 2.4)'],
      ['m3', 'besj(0, 5.520078 * r) * cos(2.2954 * b + .6)'],
      ['m4', 'besj(3, 6.380162 * r) * cos(3 * th) * cos(2.6531 * b + 3.7)'],
      ['m5', 'besj(1, 7.015587 * r) * cos(th) * cos(2.9173 * b + 5)'],
      ['m6', 'besj(0, 8.653728 * r) * cos(3.5985 * b + 1.8)'],
    ],
    x: '12 * r * cos(th)', y: '12 * r * sin(th)',
    z: '4.2 * ((.25 + 1.4 * fft(.04)) * m0 + (.2 + 1.2 * fft(.09)) * m1 + (.15 + 1.2 * fft(.15)) * m2 + (.15 + 1.2 * fft(.22)) * m3 + (.12 + 1.1 * fft(.3)) * m4 + (.1 + 1.1 * fft(.4)) * m5 + (.08 + fft(.55)) * m6)',
    alpha: '.55 + .45 * dt',
    tmap: '.5 * dt',
    cam: { pos: ['30 * cos(t * .14)', '30 * sin(t * .14)', '15 + 3 * sin(t * .2)'], look: ['0', '0', '1'] },
  },

  // Two half-circles stacked into a tube; each ring remembers the audio a moment earlier.
  'Circular Symmetry': {
    rows: 26, pts: 100, across: 7, instances: 2, width: 1.7, fov: 55,
    defs: [['d', '14 + 16 * fft(.04 + .4 * trwv(2 * s))']],
    x: 'd * cos(s * PI + inst * PI)', y: 'd * sin(s * PI + inst * PI)', z: '-26 * (dt - .3)',
    alpha: '1.1 * (1 - dt)',
    tmap: '.4 * dt',
    cam: { pos: ['62 * cos(t * .13)', '62 * sin(t * .13)', '16 * sin(t * .09) + 12'], look: ['0', '0', '-5'] },
  },

  // The inside of a long tube, camera rolling slowly; the far end fades out.
  'Tunnel Vision': {
    axis: 'x',   // runs along x: the shape profile scales y and z
    rows: 60, pts: 70, across: 7, instances: 2, width: 1.7, fov: 75,
    defs: [
      ['b1', 'inst * PI'],
      ['d0', '2 * fft(.05 + .4 * trwv(2 * s))'],
      ['d1', '60 - 14 * d0 + loose() * 7 * sin(dt * 14 - t * 1.6)'],
    ],
    x: '300 * dt', y: 'sin(b1 + PI * s) * d1 + loose() * 9 * sin(dt * 7 - t * .9)', z: 'cos(b1 + PI * s) * d1 + loose() * 9 * cos(dt * 6 - t * .7)',
    alpha: '1.5 * (1 - dt)',
    tmap: '(.5 + .5 * loose()) * dt',
    cam: {
      pos: ['250', '0', '0'], look: ['0', '1', '0'],
      up: ['0', 'cos(sin(t / 5) + 2 * cos(t / 6) + 1.5 * cos(t / 3.3))', 'sin(sin(t / 5) + 2 * cos(t / 6) + 1.5 * cos(t / 3.3))'],
    },
  },

  // A torus whose tube radius follows the spectrum around the ring.
  'Warpo-Taurus': {
    rows: 36, pts: 240, across: 10, width: 1.7, fov: 55,
    defs: [
      ['d0', '.5 + 12 * pow(fft(.05 + .4 * trwv(4 * s)), .7) + loose() * 1.8 * sin(TAU * s * 3 + t * 1.2 + TAU * dt)'],
      ['d1', '40 + d0 * cos(TAU * dt)'],
    ],
    x: 'sin(TAU * s) * d1', y: 'cos(TAU * s) * d1', z: 'd0 * sin(TAU * dt) + loose() * 3 * sin(TAU * s * 2 + t * .8)',
    alpha: '1', tmap: 'loose() * .4 * abs(dt - .5)',
    cam: { pos: ['108 * cos(t * .12)', '108 * sin(t * .12)', '46 + 10 * sin(t * .2)'], look: ['0', '0', '0'] },
  },
};

// ---- Tri-Lobe family -------------------------------------------------------------------------
const TRI_CAM = { pos: ['(1 + .6 * level) * 36 * cos(t * .11)', '(1 + .6 * level) * 36 * sin(t * .09)', '(1 + .6 * level) * (14 * sin(t * .07) + 5)'], look: ['0', '0', '0'] };
const TRI_E = ['e', '.15 * (fft(.1) + fft(.2) + fft(.3) + fft(.6) + fft(.8))'];

Object.assign(SHAPES, {
  // lobes spiral around the vertical axis
  'Tri-Lobe Twist': {
    rows: 48, pts: 140, across: 7, width: 1.7, fov: 55,
    defs: [
      ['th', 'TAU * s - PI + 2.6 * (dt - .5) * sin(t * .17)'],
      ['ph', 'PI * dt - PI / 2'], TRI_E,
      ['w', 'loose() * .14 * (sin(3 * th + 4 * ph + t * 1.1) + .6 * sin(5 * ph - 2 * th - t * .8))'],
      ['r1', '(abs(cos(3 * th / 4)) ^ .9 + abs(sin(3 * th / 4)) ^ 1.4) ^ (-1 / .6) + e + w'],
      ['r2', '(abs(cos(5 * ph / 4)) ^ 1.2 + abs(sin(5 * ph / 4)) ^ .8) ^ (-1 / .8) + e + w'],
    ],
    x: '11 * r1 * r2 * cos(th) * cos(ph)', y: '11 * r1 * r2 * sin(th) * cos(ph)', z: '11 * r2 * sin(ph)',
    alpha: '.9', tmap: '(.2 + .7 * loose()) * abs(dt - .5)', cam: TRI_CAM,
  },

  // five soft petals on a round body
  'Tri-Lobe Bloom': {
    rows: 40, pts: 160, across: 8, width: 1.7, fov: 55,
    defs: [
      ['th', 'TAU * s - PI'], ['ph', 'PI * dt - PI / 2'], TRI_E,
      ['w', 'loose() * .14 * (sin(3 * th + 4 * ph + t * 1.1) + .6 * sin(5 * ph - 2 * th - t * .8))'],
      ['r1', '(abs(cos(5 * th / 4)) ^ 1.1 + abs(sin(5 * th / 4)) ^ 2.2) ^ (-1 / .55) + e + w'],
      ['r2', '1 + .5 * e + w'],
    ],
    x: '13 * r1 * r2 * cos(th) * cos(ph)', y: '13 * r1 * r2 * sin(th) * cos(ph)', z: '10 * r2 * sin(ph)',
    alpha: '.9', tmap: '(.2 + .7 * loose()) * abs(dt - .5)', cam: TRI_CAM,
  },

  // sharp, faceted, low-poly feel
  'Tri-Lobe Crystal': {
    rows: 20, pts: 66, across: 3, width: 1.8, fov: 55,
    defs: [
      ['th', 'TAU * s - PI'], ['ph', 'PI * dt - PI / 2'], TRI_E,
      ['r1', '(abs(cos(3 * th / 4)) ^ .5 + abs(sin(3 * th / 4)) ^ .5) ^ (-1 / .35) + e'],
      ['r2', '(abs(cos(3 * ph / 4)) ^ .5 + abs(sin(3 * ph / 4)) ^ .5) ^ (-1 / .45) + e'],
    ],
    x: '14 * r1 * r2 * cos(th) * cos(ph)', y: '14 * r1 * r2 * sin(th) * cos(ph)', z: '14 * r2 * sin(ph)',
    alpha: '1', cam: TRI_CAM,
  },

  // two nested shells, the inner one dimmer and smaller
  'Tri-Lobe Pulse': {
    rows: 34, pts: 120, across: 8, instances: 2, width: 1.6, fov: 55,
    defs: [
      ['th', 'TAU * s - PI'], ['ph', 'PI * dt - PI / 2'], TRI_E,
      ['k', '1 - inst * (.45 - .1 * beat)'],
      ['w', 'loose() * .14 * (sin(3 * th + 4 * ph + t * 1.1) + .6 * sin(5 * ph - 2 * th - t * .8))'],
      ['r1', '(abs(cos(3 * th / 4)) ^ .9 + abs(sin(3 * th / 4)) ^ 1.4) ^ (-1 / .6) + e + w'],
      ['r2', '(abs(cos(5 * ph / 4)) ^ 1.2 + abs(sin(5 * ph / 4)) ^ .8) ^ (-1 / .8) + e + w'],
    ],
    x: '11 * k * r1 * r2 * cos(th) * cos(ph)', y: '11 * k * r1 * r2 * sin(th) * cos(ph)', z: '11 * k * r2 * sin(ph)',
    alpha: '1 - inst * .5', tmap: '(.2 + .7 * loose()) * abs(dt - .5)', cam: TRI_CAM,
  },
});

// ---- Symmetric shapes --------------------------------------------------------------------------
// mirrored spectrum (trwv) gives left/right and n-fold symmetry; each is built so the spectrum fills it evenly
Object.assign(SHAPES, {
  // layered rings with six mirrored petals that bloom with the music
  'Mandala': {
    rows: 16, pts: 360, width: 1.6, fov: 50,
    defs: [
      ['th', 'TAU * s'],
      ['m', 'fft(.04 + .7 * trwv(6 * s))'],
      ['r', '(2 + dt * 12) * (1 + .32 * m * (.4 + dt)) + 1.2 * cos(12 * th + dt * 5 + t * .3) * dt + loose() * 1.6 * sin(5 * th - t * 1.3 + dt * 6) * dt'],
      ['ang', 'th + (dt - .5) * .5 * sin(t * .15) + loose() * .12 * sin(3 * th + t + dt * 4)'],
    ],
    x: 'r * cos(ang)', y: 'r * sin(ang)', z: '4 * (1 - dt)',
    alpha: '.35 + .65 * (1 - dt * .5)', tmap: '(.3 + .6 * loose()) * dt',
    cam: { pos: ['8 * sin(t * .12)', '-42', '30'], look: ['0', '0', '1'] },
  },

  // seven-pointed star curves (hypotrochoids), stacked and turned; every layer listens to a different band
  'Spirograph': {
    rows: 20, pts: 700, width: 1.5, fov: 50,
    defs: [
      ['a', 'TAU * s'],
      ['f', 'fft(.05 + .5 * dt)'],
      ['d', '1.2 + 6 * dt * (.35 + 1.1 * f) + loose() * 1.4 * sin(t * .7 + dt * 5)'],
      ['rot', 'dt * .35 + t * .1'],
      ['px', '6 * cos(a) + d * cos(6 * a) + loose() * 1.2 * sin(2 * a + t * .8 + dt * 4)'],
      ['py', '6 * sin(a) - d * sin(6 * a) + loose() * 1.2 * cos(2 * a + t * .8 + dt * 4)'],
    ],
    x: '1.3 * (px * cos(rot) - py * sin(rot))', y: '1.3 * (px * sin(rot) + py * cos(rot))', z: '(dt - .5) * 4',
    alpha: '1 - dt * .45',
    cam: { pos: ['6 * sin(t * .1)', '-30', '26'], look: ['0', '0', '0'] },
  },

  // sphere pushed and pulled by spherical-harmonic style lobes (4-fold, 6-fold and top/bottom), one band each
  'Harmonic': {
    rows: 40, pts: 120, across: 8, width: 1.6, fov: 55,
    defs: [
      ['th', 'TAU * s'], ['ph', 'PI * dt'],
      ['b1', '.25 + 1.5 * fft(.06)'], ['b2', '.25 + 1.4 * fft(.18)'], ['b3', '.2 + 1.4 * fft(.4)'],
      ['r', '8 * (1 + .3 * b1 * cos(4 * th) * sin(ph) ^ 2 + .22 * b2 * cos(2 * ph) + .18 * b3 * cos(6 * th) * sin(ph) ^ 4 + loose() * .12 * sin(3 * th + 2 * ph - t * 1.2))'],
    ],
    x: 'r * sin(ph) * cos(th)', y: 'r * sin(ph) * sin(th)', z: 'r * cos(ph)',
    alpha: '.9', tmap: '(.15 + .5 * loose()) * abs(dt - .5)', cam: TRI_CAM,
  },

  // concentric rings, six mirrored lobes; each ring remembers the sound a moment earlier, so waves travel outward
  'Aperture': {
    rows: 30, pts: 180, across: 10, width: 1.5, fov: 50,
    defs: [
      ['m', 'fft(.03 + .5 * trwv(3 * s))'],
      ['r', '2.5 + dt * 16 + 3.5 * m * (1 - dt * .4) + loose() * 1.5 * sin(TAU * s * 2 + t * .9 - dt * 5)'],
    ],
    x: 'r * cos(TAU * s)', y: 'r * sin(TAU * s)', z: '-3 * dt + 4 * m * (1 - dt) + loose() * 2 * sin(TAU * s * 3 + dt * 6 - t * 1.4)',
    alpha: '1 - dt * .55', tmap: '(.4 + .6 * loose()) * dt',
    cam: { pos: ['8 * sin(t * .1)', '-44', '30'], look: ['0', '0', '-1'] },
  },

  // a super-ellipsoid: loud music squares the sphere into a cube, quiet lets it relax into a ball or a star
  'Cube Morph': {
    rows: 36, pts: 120, across: 6, width: 1.6, fov: 55,
    defs: [
      ['th', 'TAU * s - PI'], ['ph', 'PI * dt - PI / 2'],
      ['ex', '.35 + 1.0 * (1 - clamp(level * 1.8, 0, 1))'],
      ['c', 'abs(cos(ph)) ^ ex'],
      ['fl', '1 + loose() * .07 * sin(3 * th + 3 * ph + t * 1.3)'],
    ],
    x: '9 * fl * sign(cos(th)) * abs(cos(th)) ^ ex * c', y: '9 * fl * sign(sin(th)) * abs(sin(th)) ^ ex * c', z: '9 * fl * sign(sin(ph)) * abs(sin(ph)) ^ ex',
    alpha: '.95', cam: TRI_CAM,
  },
});

// ---- Head ------------------------------------------------------------------------------------
// A wireframe head built from horizontal slices (rows, bottom of the neck -> crown). Every slice is an
// ellipse; the face is carved into its radius as gaussian bumps/dents (nose, brow, eye sockets, lips, chin,
// cheeks, ears). The mouth reacts to the music: openness follows loudness, width follows mid/treble,
// the jaw drops, and the eyes narrow on every beat.
const HEAD_DEFS = [
  ['th', 'TAU * s'],
  ['dth', 'atan2(sin(th), cos(th))'],        // angle around the head, 0 = straight ahead
  ['ad', 'abs(dth)'],
  ['zz', '-16 + 29 * dt'],                     // height
  ['op', 'clamp(level * 2.6 + beat * .4, 0, 1)'],
  ['wide', 'clamp(1.1 * treble + .8 * mid, 0, 1)'],
  ['jaw', 'op * 2.6 * smoothstep(-3.2, -7, zz)'],
  ['hr', '9 * sqrt(max(.03, 1 - ((zz - 2.5) / 11.5) ^ 2))'],
  ['neck', '4.7 * smoothstep(-5, -8, zz)'],
  ['nose', '3.4 * g(zz - .4, 3.4) * g(dth, .16) + 2.6 * g(zz + 1.9, 1.1) * g(dth, .22)'],
  ['brow', '1.1 * g(zz - 3.9, .9) * g(dth, .9)'],
  ['eyes', '-(1.7 - .5 * beat) * g(zz - 2.6, 1.1 - .3 * beat) * g(ad - .46, .17) + .9 * g(zz - 2.6, .6) * g(ad - .46, .09)'],
  ['mouth', '-(.7 + op * 2.6) * g(zz + 4.8, .28 + op) * g(dth, .22 + .22 * wide) + 1.2 * g(zz + 4, .6) * g(dth, .32) + 1.1 * g(zz + 5.7, .6) * g(dth, .3)'],
  ['chin', '1.8 * g(zz + 7.6, 1.1) * g(dth, .42)'],
  ['sides', '.9 * g(zz + 1.2, 1.6) * g(ad - .95, .3) + 1.8 * g(zz - .8, 1.5) * g(ad - 1.6, .22)'],
  // the form itself follows the spectrum, like the other shapes: lumps around the head from the spectrum
  // (mirrored left/right) plus a small overall swell from a few bands, as in Tri-Lobe
  ['vib', '(5 * fft(.04 + .45 * trwv(2 * s)) + 1.1 * (fft(.1) + fft(.3) + fft(.6) + fft(.8))) * (.3 + .7 * smoothstep(-9, -3, zz)) + loose() * (.25 + 1.2 * level) * sin(zz * .8 + 2 * dth - t * 1.9) * smoothstep(-9, -3, zz)'],
  ['rr', 'max(hr, neck) + nose + brow + eyes + mouth + chin + sides + vib'],
];
const HEAD = {
  rows: 66, pts: 140, across: 0, width: 1.6, fov: 45, dfade: [44, 66],
  defs: HEAD_DEFS,
  x: 'rr * cos(th) * (1.02 + .24 * clamp(-cos(th), 0, 1)) - 2.8 * smoothstep(-4, -9, zz)', y: '.92 * rr * sin(th)', z: 'zz - jaw',
  tmap: '(.1 + .35 * loose()) * (1 - dt)',
  alpha: '.3 + .7 * smoothstep(0, .3, dt)',
};
Object.assign(SHAPES, {
  'Head': { ...HEAD, across: 14,
    cam: { pos: ['54 * cos(1.05 * sin(t * .17))', '54 * sin(1.05 * sin(t * .17))', '3 + 2 * sin(t * .13)'], look: ['0', '0', '-1'] } },
  'Head Profile': { ...HEAD, rows: 90, pts: 150, across: 0,
    cam: { pos: ['54 * cos(-1.57 + .12 * sin(t * .2))', '54 * sin(-1.57 + .12 * sin(t * .2))', '2'], look: ['0', '0', '-1.5'] } },
});

// ---- Text ------------------------------------------------------------------------------------
// Your own text (type in the Text field) or an SVG file, as an extruded outline. The spectrum runs left -> right across
// the text (bass on the first letters, treble on the last), stretching the letters up and down; the layers
// behind the front one read slightly older audio, so the motion trails back in depth.
Object.assign(SHAPES, {
  // the spectrum wrapped into a ring (bass at the right, treble at the left, mirrored); older rings drift back and keep the sound from earlier
  'Radial Spectrum': {
    rows: 30, pts: 256, across: 16, width: 1.5, fov: 50,
    defs: [
      ['th', 'TAU * s'],
      ['m', 'fft(.02 + .8 * trwv(2 * s))'],
      ['r', '5 + dt * 13 + 9 * m * (1 - .45 * dt) + loose() * 1.3 * sin(5 * th - t * 1.1 + dt * 4)'],
    ],
    x: 'r * cos(th)', y: 'r * sin(th)', z: '-dt * 11 + loose() * 1.5 * sin(3 * th + dt * 5 - t)',
    alpha: '1 - dt * .7', tmap: '(.3 + .5 * loose()) * dt',
    cam: { pos: ['10 * sin(t * .12)', '-42', '26'], look: ['0', '0', '-4'] },
  },

  // the live waveform (oscilloscope) drawn as layered ribbons
  'Wave Ribbon': {
    rows: 14, pts: 320, width: 1.6, fov: 50,
    defs: [
      ['u', '.04 + .92 * s'],
      ['k', '1 - .75 * abs(dt - .5) * 2'],
    ],
    x: '(s * 2 - 1) * 22', y: '(dt - .5) * 12 + loose() * 2 * sin(s * 6 + t * 1.2 + dt * 3)', z: '(6 + 8 * level) * wave(u) * k',
    alpha: '.35 + .65 * k',
    cam: { pos: ['7 * sin(t * .1)', '-40', '11'], look: ['0', '0', '0'] },
  },

  // spectrum history as a mountain range ("Unknown Pleasures"): the newest line is at the front, older ones move back
  'Landscape': {
    rows: 50, pts: 140, width: 1.4, fov: 50,
    defs: [
      ['e', 'abs(2 * s - 1)'],
      ['f', 'fft(.02 + .85 * e)'],
    ],
    x: '(s * 2 - 1) * 21', y: '-16 + dt * 32', z: '17 * f * (1 - .75 * e) + loose() * 1.2 * sin(s * 9 + dt * 5 - t * .8) * dt',
    alpha: '1 - dt * .65', tmap: '.9 * dt',
    cam: { pos: ['5 * sin(t * .1)', '-54', '30'], look: ['0', '3', '1'] },
  },

  // the waveform plotted against a delayed copy of itself: loops that change shape with the tone
  'Lissajous': {
    rows: 6, pts: 300, width: 1.5, fov: 50,
    defs: [
      ['u', '.1 + .78 * s'],
      ['A', '13 * (.5 + 1.1 * level)'],
      ['px', 'A * wave(u)'], ['py', 'A * wave(u + .015 + .07 * dt)'],
      ['rot', 'dt * .5 + t * .1'],
    ],
    x: 'px * cos(rot) - py * sin(rot)', y: 'px * sin(rot) + py * cos(rot)', z: '(dt - .5) * 7 + loose() * 1.5 * sin(s * TAU * 2 + t)',
    alpha: '1 - dt * .5',
    cam: { pos: ['6 * sin(t * .1)', '-34', '22'], look: ['0', '0', '0'] },
  },

  // a (2,3) torus knot; the tube swells with bass and mid
  'Torus Knot': {
    rows: 6, pts: 420, width: 1.6, fov: 55,
    defs: [
      ['a', 'TAU * s'],
      ['mn', '3.2 + 1.6 * (fft(.08) + fft(.25)) + loose() * .6 * sin(3 * a + t)'],
      ['ph', 'dt * TAU + 2 * a'],
      ['rr', '1.5 * (9 + mn * cos(3 * a)) + 1.1 * cos(ph)'],
    ],
    x: 'rr * cos(2 * a)', y: 'rr * sin(2 * a)', z: '1.5 * mn * sin(3 * a) + 1.1 * sin(ph)',
    alpha: '.95', cam: { pos: ['56 * cos(t * .11)', '56 * sin(t * .09)', '22 * sin(t * .07) + 8'], look: ['0', '0', '0'] },
  },

  // double helix: the spectrum runs along its length (bass at the start); the rungs connect the two strands
  'DNA': {
    rows: 2, pts: 320, across: 6, width: 1.7, fov: 52,
    defs: [
      ['rr', '3.5 + 7 * fft(.02 + .8 * s) + loose() * .8 * sin(s * 9 + t * 1.3)'],
      ['ang', 'TAU * s * 3 + dt * PI + t * .6'],
    ],
    x: 'rr * cos(ang)', y: 'rr * sin(ang)', z: '(s - .5) * 42',
    alpha: '.95',
    cam: { pos: ['44 * cos(t * .1)', '44 * sin(t * .1)', '5 * sin(t * .2)'], look: ['0', '0', '0'] },
  },

  // rings that spread out like rain on a pond; the bass lifts the water, the spectrum shapes each ring
  'Ripples': {
    rows: 14, pts: 200, width: 1.6, fov: 50,
    defs: [
      ['ph', 'fract(dt + t * .16)'],
      ['m', 'fft(.02 + .6 * trwv(2 * s))'],
      ['r', '(2 + ph * 20 + 1.5 * beat) * (1 + .22 * m * (1 - ph * .5))'],
    ],
    x: 'r * cos(TAU * s)', y: 'r * sin(TAU * s)', z: '(1 + 3 * bass) * sin(r * .8 - t * 3) * (1 - ph) + loose() * .8 * sin(TAU * s * 3 + ph * 8)',
    alpha: '.15 + .85 * (1 - ph) * smoothstep(0, .08, ph)',
    cam: { pos: ['5 * sin(t * .1)', '-34', '24'], look: ['0', '0', '0'] },
  },

  // a globe: the spectrum bulges it along the longitudes (mirrored), and it slowly turns
  'Globe': {
    rows: 36, pts: 130, across: 8, width: 1.6, fov: 55,
    defs: [
      ['th', 'TAU * s + t * .2'], ['ph', 'PI * dt'],
      ['m', 'fft(.03 + .85 * trwv(2 * s))'],
      ['r', '12 * (1 + .5 * m * sin(ph) ^ 2) + loose() * .8 * sin(4 * th + 3 * ph - t * 1.2)'],
    ],
    x: 'r * sin(ph) * cos(th)', y: 'r * sin(ph) * sin(th)', z: 'r * cos(ph)',
    alpha: '.9', cam: { pos: ['40 * cos(t * .11)', '40 * sin(t * .09)', '12 * sin(t * .07) + 5'], look: ['0', '0', '0'] },
  },

  'Text / SVG': {
    rows: 7, pts: 'text', across: 5, width: 1.6, fov: 55,
    defs: [['u', 'clamp((tx(s) + 1) / 2, 0, 1)'], ['f', 'fft(.02 + .55 * u)']],
    x: 'tx(s) * 14 + loose() * .5 * sin(ty(s) * 4 + t * 1.1)', y: '(dt - .5) * 4.5 + 2.2 * f * dt', z: 'ty(s) * 14 * (1 + .9 * f) + loose() * .5 * sin(tx(s) * 5 + t * 1.5 + dt * 3)',
    alpha: 'tb(s) > .5 ? -1 : 1 - dt * .55',
    tmap: '(.2 + .5 * loose()) * dt',
    cam: { pos: ['9 * sin(t * .2)', '-38', '5 + 2 * sin(t * .16)'], look: ['0', '0', '0'] },
  },
});

export const COLORS = {
  'Cyan Line':   { h: '.52 + .05 * dt', s: '.55', v: '.95', a: '1' },
  'Ocean':       { h: '.56 + .1 * dt + .06 * fft(s)', s: '.6', v: '.95', a: '1' },
  'Aqua-Violet': { h: '.48 + .3 * dt', s: '.65', v: '.95', a: '1' },
  'Sunset':      { h: '.98 + .13 * s + .04 * dt', s: '.7', v: '1', a: '1' },
  'Spectrum':    { h: '.66 - .5 * fft(s)', s: '.65', v: '.95', a: '1' },
  'Lime':        { h: '.24 + .12 * dt', s: '.7', v: '.95', a: '1' },
  'Rainbow Road': { h: 's + dt * .2 + t * .05', s: '.7', v: '.95', a: '1' },
  'Mono':        { h: '.6', s: '.06', v: '.95', a: '1' },
  'Custom ramp': { h: 'rh(s)', s: 'rs(s)', v: 'rv(s)', a: '1' },   // replaced live by the colour ramp editor
};

// type: 0 calm radial gradient, 4 vertical gradient, 3 slow aurora.
// zoom/rot/dx/dy/decay drive optional feedback trails; decay 0 = crisp, no trails.
const still = { zoom: '1', rot: '0', dx: '0', dy: '0', decay: '0' };
export const BACKGROUNDS = {
  'Black':    { type: 0, hue: '.62', hue2: '.62', bright: '0', ...still },
  'Midnight': { type: 0, hue: '.62', hue2: '.68', bright: '.3', ...still },
  'Dusk':     { type: 4, hue: '.72', hue2: '.58', bright: '.3', ...still },
  'Slate':    { type: 4, hue: '.58', hue2: '.6', bright: '.2', ...still },
  'Aurora':   { type: 3, hue: '.45', hue2: '.75', bright: '.55', ...still },
  'Soft Trails': { type: 0, hue: '.64', hue2: '.7', bright: '.25', zoom: '1.002', rot: '.0015', dx: '0', dy: '0', decay: '.62' },
};

// Themes are ready-made combinations of a shape + colour + background (change any of the three yourself and the
// theme shows "Egendefinert").
export const THEMES = {
  'Cyber Head':      ['Head', 'Cyan Line', 'Black'],
  'Sonar':           ['Head Profile', 'Cyan Line', 'Midnight'],
  'Deep Sea':        ['Tri-Lobe', 'Ocean', 'Midnight'],
  'Orchid':          ['Tri-Lobe Twist', 'Aqua-Violet', 'Dusk'],
  'Solar Bloom':     ['Tri-Lobe Bloom', 'Sunset', 'Black'],
  'Ice Shard':       ['Tri-Lobe Crystal', 'Ocean', 'Slate'],
  'Echo':            ['Tri-Lobe Pulse', 'Spectrum', 'Slate'],
  'War Drum':        ['Bessel', 'Sunset', 'Black'],
  'Cathedral':       ['Circular Symmetry', 'Aqua-Violet', 'Dusk'],
  'Hyperdrive':      ['Tunnel Vision', 'Spectrum', 'Black'],
  'Neon Ring':       ['Warpo-Taurus', 'Lime', 'Slate'],
  'Kaleidoscope':    ['Mandala', 'Rainbow Road', 'Midnight'],
  'Spiro':           ['Spirograph', 'Sunset', 'Black'],
  'Resonance':       ['Harmonic', 'Aqua-Violet', 'Slate'],
  'Iris':            ['Aperture', 'Cyan Line', 'Black'],
  'Cubist':          ['Cube Morph', 'Mono', 'Midnight'],
  'Pulse Ring':      ['Radial Spectrum', 'Spectrum', 'Black'],
  'Scope':           ['Wave Ribbon', 'Cyan Line', 'Black'],
  'Joy':             ['Landscape', 'Mono', 'Black'],
  'Phase':           ['Lissajous', 'Aqua-Violet', 'Midnight'],
  'Knot':            ['Torus Knot', 'Sunset', 'Slate'],
  'Helix':           ['DNA', 'Lime', 'Midnight'],
  'Pond':            ['Ripples', 'Cyan Line', 'Midnight'],
  'Globe':           ['Globe', 'Rainbow Road', 'Black'],
  'Your Text':       ['Text / SVG', 'Aqua-Violet', 'Midnight'],
};
