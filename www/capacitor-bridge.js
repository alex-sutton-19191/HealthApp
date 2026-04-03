/**
 * Capacitor bridge — native iOS integrations
 * Only activates when running inside a Capacitor native shell.
 * Plugins are auto-injected by Capacitor at runtime via window.Capacitor.Plugins.
 */

(function () {
  // Bail out if not running in a native Capacitor shell
  if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

  document.addEventListener('DOMContentLoaded', function () {
    var Plugins = window.Capacitor.Plugins;

    // --- Status Bar: dark style to match the app theme ---
    if (Plugins.StatusBar) {
      Plugins.StatusBar.setStyle({ style: 'DARK' });
      Plugins.StatusBar.setBackgroundColor({ color: '#070008' });
    }

    // --- Keyboard: hide accessory bar for cleaner input UI ---
    if (Plugins.Keyboard) {
      Plugins.Keyboard.setAccessoryBarVisible({ isVisible: false });
    }

    // --- App lifecycle: handle back button ---
    if (Plugins.App) {
      Plugins.App.addListener('backButton', function (ev) {
        if (ev.canGoBack) {
          window.history.back();
        }
      });
    }

    // --- Haptic feedback helper for native interactions ---
    if (Plugins.Haptics) {
      window._nativeHaptic = function (style) {
        Plugins.Haptics.impact({ style: style || 'LIGHT' });
      };
    }

    // --- Splash screen: hide once app is ready ---
    if (Plugins.SplashScreen) {
      Plugins.SplashScreen.hide();
    }

    console.log('Capacitor native bridge initialized');
  });
})();
