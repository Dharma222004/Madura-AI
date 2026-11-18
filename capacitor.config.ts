import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.madura.assistant',
  appName: 'Madura AI',
  webDir: 'dist/client',
  server: {
    // Point to Node.js backend — phone must be on same WiFi as this PC (10.62.19.85)
    url: 'http://10.62.19.85:3001',
    cleartext: true,
    androidScheme: 'http',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0d0d0d',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#0d0d0d',
    androidScheme: 'http',
  },
};

export default config;
