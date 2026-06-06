// ---------------------------------------------------------------------------
// tray.js — the menu-bar icon and its menu.
//
// The tray is the app's only real UI surface (there's no dock icon). It drives
// cat colour, stretch reminders, the Pomodoro timer, and quitting. The menu is
// rebuilt whenever something changes so the radio ticks stay in sync.
// ---------------------------------------------------------------------------

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');
const { STRETCH_INTERVALS_MIN, POMODORO_WORK_MIN, ASSETS_DIR } = require('./config');
const settings = require('./settings');

// Display labels for each cat colour (key -> menu label). Order matches the spec.
const CAT_CHOICES = [
  ['ginger', 'Ginger'],
  ['white', 'White'],
  ['black', 'Black'],
  ['oreo', 'Oreo'],
];

function createTray({ brain, reminders, onQuit }) {
  const icon = nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray.png'));
  const tray = new Tray(icon);
  tray.setToolTip('MeowDesk');

  function build() {
    const currentCat = brain.getCat();
    const currentStretch = reminders.getStretchInterval();

    const colorItems = CAT_CHOICES.map(([key, label]) => ({
      label,
      type: 'radio',
      checked: currentCat === key,
      click: () => {
        brain.setCat(key);
        settings.set('cat', key);
        build();
      },
    }));

    const stretchItems = STRETCH_INTERVALS_MIN.map((min) => ({
      label: min === 0 ? 'Off' : `${min} min`,
      type: 'radio',
      checked: currentStretch === min,
      click: () => {
        reminders.setStretchInterval(min);
        settings.set('stretchIntervalMin', min);
        build();
      },
    }));

    const pomActive = reminders.isPomodoroActive();
    const pomodoroItems = [
      {
        label: `Start ${POMODORO_WORK_MIN} min`,
        enabled: !pomActive,
        click: () => {
          reminders.startPomodoro();
          build();
        },
      },
      {
        label: 'Stop',
        enabled: pomActive,
        click: () => {
          reminders.stopPomodoro();
          build();
        },
      },
    ];

    const menu = Menu.buildFromTemplate([
      { label: 'MeowDesk', enabled: false },
      { type: 'separator' },
      { label: 'Cat Color', submenu: colorItems },
      { label: 'Stretch Reminder', submenu: stretchItems },
      { label: 'Pomodoro', submenu: pomodoroItems },
      { type: 'separator' },
      { label: 'Quit MeowDesk', click: () => onQuit() },
    ]);

    tray.setContextMenu(menu);
  }

  build();
  return { tray, rebuild: build };
}

module.exports = { createTray };
