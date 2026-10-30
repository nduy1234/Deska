import type { Archetype } from '../sculpt/recognizer.js';
import type { BehaviorGraph } from './schema.js';

/** Default behavior for every archetype: the starter tools. */
export const DEFAULT_BEHAVIORS: Record<Archetype, BehaviorGraph> = {
  hourglass: {
    version: 1,
    name: 'Focus hourglass',
    vars: { minutes: 25, sessions: 0 },
    rules: [
      {
        when: { on: 'flip' },
        do: [
          { do: 'startTimer', timer: 'focus', minutes: { var: 'minutes' } },
          { do: 'playSound', sound: 'tap' },
          { do: 'showText', text: 'Focus · {minutes} min', seconds: 3 },
        ],
      },
      {
        when: { on: 'poke' },
        do: [
          { do: 'stopTimer', timer: 'focus' },
          { do: 'showText', text: 'Paused', seconds: 2 },
        ],
      },
      {
        when: { on: 'timerEnd', timer: 'focus' },
        do: [
          { do: 'playSound', sound: 'chime' },
          { do: 'setValue', var: 'sessions', add: 1 },
          { do: 'showText', text: 'Break time · {sessions} done today', seconds: 6 },
        ],
      },
    ],
  },
  jar: {
    version: 1,
    name: 'Notes jar',
    vars: { count: 0 },
    rules: [
      {
        when: { on: 'drop', item: 'note' },
        do: [
          { do: 'setValue', var: 'count', value: { event: 'count' } },
          { do: 'playSound', sound: 'place' },
          { do: 'showText', text: '{count} notes', seconds: 2 },
        ],
      },
      {
        when: { on: 'poke' },
        do: [
          { do: 'sortItems', by: 'priority' },
          { do: 'playSound', sound: 'sparkle' },
          { do: 'showText', text: 'Sorted by priority', seconds: 2 },
        ],
      },
    ],
  },
  lever: {
    version: 1,
    name: 'Morning routine',
    rules: [
      {
        when: { on: 'pull' },
        do: [
          {
            do: 'runSequence',
            steps: [
              { action: { do: 'playSound', sound: 'chime' } },
              { action: { do: 'dimRoom', level: 0 } },
              { action: { do: 'showText', text: 'Good morning', seconds: 2 } },
              { wait: 2, action: { do: 'showText', text: 'Water · stretch · breathe', seconds: 4 } },
              { wait: 4, action: { do: 'showText', text: 'Plan your top 3', seconds: 4 } },
              { wait: 4, action: { do: 'startTimer', timer: 'warmup', minutes: 5 } },
              { action: { do: 'showText', text: '5 min warm-up started', seconds: 3 } },
            ],
          },
        ],
      },
      {
        when: { on: 'timerEnd', timer: 'warmup' },
        do: [
          { do: 'playSound', sound: 'chime' },
          { do: 'showText', text: 'Ready. Flip the hourglass.', seconds: 5 },
        ],
      },
    ],
  },
  dial: {
    version: 1,
    name: 'Focus dial',
    vars: { focus: 0.3 },
    rules: [
      {
        when: { on: 'turn', step: 6 },
        do: [
          { do: 'setValue', var: 'focus', value: { event: 'value' } },
          { do: 'dimRoom', level: { var: 'focus' } },
          { do: 'playSound', sound: 'detent' },
          { do: 'showText', text: 'Focus {focus%}', seconds: 1.5 },
        ],
      },
    ],
  },
  button: {
    version: 1,
    name: 'Tally button',
    vars: { count: 0 },
    rules: [
      {
        when: { on: 'poke' },
        do: [
          { do: 'setValue', var: 'count', add: 1 },
          { do: 'playSound', sound: 'tap' },
          { do: 'showText', text: '{count}', seconds: 1.5 },
        ],
      },
    ],
  },
  block: {
    version: 1,
    name: 'Paperweight',
    rules: [{ when: { on: 'grab' }, do: [{ do: 'playSound', sound: 'tap' }] }],
  },
};

/**
 * Intent templates: the offline "make a tool" path and the agent's last
 * fallback. Each is picked by keyword overlap with the spoken intent.
 */
export interface IntentTemplate {
  id: string;
  /** Shown on the hand-pickable intent card. */
  card: string;
  keywords: string[];
  archetype: Archetype;
  behavior: BehaviorGraph;
}

export const INTENT_TEMPLATES: IntentTemplate[] = [
  {
    id: 'focus-dial',
    card: 'A dial that sets my focus level',
    keywords: ['dial', 'focus', 'level', 'dim', 'knob', 'turn', 'ambient', 'volume', 'light'],
    archetype: 'dial',
    behavior: DEFAULT_BEHAVIORS.dial,
  },
  {
    id: 'pomodoro',
    card: 'A 25 minute focus timer',
    keywords: ['timer', 'pomodoro', 'focus', 'minutes', 'hourglass', 'countdown', 'work'],
    archetype: 'hourglass',
    behavior: DEFAULT_BEHAVIORS.hourglass,
  },
  {
    id: 'break-timer',
    card: 'A 5 minute break timer',
    keywords: ['break', 'rest', 'short', 'five', '5', 'pause', 'stretch'],
    archetype: 'hourglass',
    behavior: {
      version: 1,
      name: 'Break hourglass',
      vars: { minutes: 5 },
      rules: [
        {
          when: { on: 'flip' },
          do: [
            { do: 'startTimer', timer: 'break', minutes: { var: 'minutes' } },
            { do: 'dimRoom', level: 0.6 },
            { do: 'showText', text: 'Break · {minutes} min', seconds: 3 },
          ],
        },
        {
          when: { on: 'timerEnd', timer: 'break' },
          do: [
            { do: 'playSound', sound: 'chime' },
            { do: 'dimRoom', level: 0.1 },
            { do: 'showText', text: 'Back to it', seconds: 4 },
          ],
        },
      ],
    },
  },
  {
    id: 'water',
    card: 'A button that counts glasses of water',
    keywords: ['water', 'count', 'counter', 'tally', 'button', 'drink', 'track', 'habit'],
    archetype: 'button',
    behavior: {
      version: 1,
      name: 'Water counter',
      vars: { glasses: 0 },
      rules: [
        {
          when: { on: 'poke' },
          do: [
            { do: 'setValue', var: 'glasses', add: 1 },
            { do: 'playSound', sound: 'tap' },
            { do: 'showText', text: '{glasses} glasses today', seconds: 2 },
          ],
        },
      ],
    },
  },
  {
    id: 'shutdown',
    card: 'A lever that runs my end-of-day shutdown',
    keywords: ['lever', 'routine', 'shutdown', 'evening', 'end', 'day', 'sequence', 'wind', 'down'],
    archetype: 'lever',
    behavior: {
      version: 1,
      name: 'Shutdown routine',
      rules: [
        {
          when: { on: 'pull' },
          do: [
            {
              do: 'runSequence',
              steps: [
                { action: { do: 'playSound', sound: 'whoosh' } },
                { action: { do: 'showText', text: 'Write tomorrow’s first task', seconds: 4 } },
                { wait: 4, action: { do: 'dimRoom', level: 0.7 } },
                { action: { do: 'showText', text: 'Close your tabs', seconds: 3 } },
                { wait: 3, action: { do: 'playSound', sound: 'chime' } },
                { action: { do: 'showText', text: 'Done for today', seconds: 4 } },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'notes-jar',
    card: 'A jar that sorts my notes',
    keywords: ['jar', 'notes', 'sort', 'sticky', 'inbox', 'priority', 'ideas', 'collect'],
    archetype: 'jar',
    behavior: DEFAULT_BEHAVIORS.jar,
  },
];

/** Closest template by keyword overlap (ties → first). Offline-safe. */
export function closestTemplate(intent: string): IntentTemplate {
  const words = intent.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let best = INTENT_TEMPLATES[0];
  let bestScore = -1;
  for (const t of INTENT_TEMPLATES) {
    const score = words.reduce((n, w) => n + (t.keywords.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** Daily-growth upgrades: level 2 behaviors that replace the defaults. */
export const UPGRADED_BEHAVIORS: Partial<Record<Archetype, Record<number, BehaviorGraph>>> = {
  hourglass: {
    2: {
      version: 1,
      name: 'Focus hourglass II',
      vars: { minutes: 25, breakMinutes: 5, sessions: 0 },
      rules: [
        {
          when: { on: 'flip' },
          do: [
            { do: 'startTimer', timer: 'focus', minutes: { var: 'minutes' } },
            { do: 'stopTimer', timer: 'break' },
            { do: 'dimRoom', level: 0.35 },
            { do: 'playSound', sound: 'tap' },
            { do: 'showText', text: 'Focus · {minutes} min', seconds: 3 },
          ],
        },
        {
          when: { on: 'poke' },
          do: [
            { do: 'stopTimer', timer: 'focus' },
            { do: 'stopTimer', timer: 'break' },
            { do: 'showText', text: 'Paused', seconds: 2 },
          ],
        },
        {
          when: { on: 'timerEnd', timer: 'focus' },
          do: [
            { do: 'playSound', sound: 'chime' },
            { do: 'setValue', var: 'sessions', add: 1 },
            { do: 'dimRoom', level: 0 },
            { do: 'startTimer', timer: 'break', minutes: { var: 'breakMinutes' } },
            { do: 'showText', text: 'Break · {sessions} done today', seconds: 6 },
          ],
        },
        {
          when: { on: 'timerEnd', timer: 'break' },
          do: [
            { do: 'playSound', sound: 'chime' },
            { do: 'showText', text: 'Flip me for another round', seconds: 6 },
          ],
        },
      ],
    },
  },
  dial: {
    2: {
      version: 1,
      name: 'Focus dial II',
      vars: { focus: 0.3 },
      rules: [
        {
          when: { on: 'turn', step: 6 },
          do: [
            { do: 'setValue', var: 'focus', value: { event: 'value' } },
            { do: 'dimRoom', level: { var: 'focus' } },
            { do: 'playSound', sound: 'detent' },
            { do: 'showText', text: 'Focus {focus%}', seconds: 1.5 },
          ],
        },
        {
          when: { on: 'turn', step: 6 },
          if: { var: 'focus', op: 'ge', value: 0.6 },
          do: [{ do: 'setColor', color: '#e3a06e' }],
        },
        {
          when: { on: 'turn', step: 6 },
          if: { var: 'focus', op: 'lt', value: 0.6 },
          do: [{ do: 'setColor', color: '#9db896' }],
        },
      ],
    },
  },
  jar: {
    2: {
      version: 1,
      name: 'Notes jar II',
      vars: { count: 0 },
      rules: [
        {
          when: { on: 'drop', item: 'note' },
          do: [
            { do: 'setValue', var: 'count', value: { event: 'count' } },
            { do: 'playSound', sound: 'place' },
            { do: 'showText', text: '{count} notes', seconds: 2 },
          ],
        },
        {
          when: { on: 'drop', item: 'note' },
          if: { var: 'count', op: 'ge', value: 5 },
          do: [{ do: 'showText', text: 'Getting full · tap to sort', seconds: 3 }],
        },
        {
          when: { on: 'poke' },
          do: [
            { do: 'sortItems', by: 'priority' },
            { do: 'playSound', sound: 'sparkle' },
            { do: 'showText', text: 'Red first · {count} notes', seconds: 2.5 },
          ],
        },
      ],
    },
  },
};

/** The behavior a fresh tool of this archetype gets at a growth level. */
export function behaviorFor(archetype: Archetype, level: number): BehaviorGraph {
  for (let l = level; l >= 2; l--) {
    const g = UPGRADED_BEHAVIORS[archetype]?.[l];
    if (g) return g;
  }
  return DEFAULT_BEHAVIORS[archetype];
}
