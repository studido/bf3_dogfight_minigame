// Desktop wrapper (Electron): opens LaunchGame.html in its own window. The game itself is
// unchanged; this only adds the window, icon, fullscreen toggle and a few Chromium flags.
//   npm start        run it from source
//   npm run build    make the portable Windows exe in dist/ (see README)
const { app, BrowserWindow, shell, globalShortcut, Menu } = require('electron');
const path = require('path');

// Use the GPU even if it's on Chromium's blocklist (older laptop drivers), and let audio
// start without a click first (the game still starts it from the FLY button anyway).
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 600,
    title: 'Dogfight 313',
    icon: path.join(__dirname, '..', 'assets', 'icon', 'jet.ico'),
    backgroundColor: '#0b1016',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep the sim running if the window loses focus mid-match
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, '..', 'LaunchGame.html'));

  // Credit links etc. open in the user's normal browser, never inside the game window
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });

  // F11 toggles fullscreen (Esc stays the game's pause key)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { globalShortcut.unregisterAll(); app.quit(); });
