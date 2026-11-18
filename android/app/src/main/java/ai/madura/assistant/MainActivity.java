package ai.madura.assistant;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQ_CODE = 101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Install Android 12+ SplashScreen
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        super.onCreate(savedInstanceState);

        // Keep native splash screen visible briefly, allowing web view to render
        splashScreen.setKeepOnScreenCondition(() -> false);

        // Edge-to-edge layout: app draws behind status and navigation bars
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Transparent system bars for clean immersion
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        // Dark theme: force light (white) status and navigation bar icons
        WindowInsetsControllerCompat wic = new WindowInsetsControllerCompat(
            getWindow(), getWindow().getDecorView()
        );
        wic.setAppearanceLightStatusBars(false);
        wic.setAppearanceLightNavigationBars(false);

        // Request runtime permissions for Camera, Microphone & Storage/Media
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            java.util.List<String> permsNeeded = new java.util.ArrayList<>();

            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED) {
                permsNeeded.add(Manifest.permission.CAMERA);
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                permsNeeded.add(Manifest.permission.RECORD_AUDIO);
            }
            // Android 13+ (TIRAMISU) uses READ_MEDIA_IMAGES for gallery/photos
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES)
                        != PackageManager.PERMISSION_GRANTED) {
                    permsNeeded.add(Manifest.permission.READ_MEDIA_IMAGES);
                }
            } else {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                        != PackageManager.PERMISSION_GRANTED) {
                    permsNeeded.add(Manifest.permission.READ_EXTERNAL_STORAGE);
                }
            }

            if (!permsNeeded.isEmpty()) {
                ActivityCompat.requestPermissions(
                    this,
                    permsNeeded.toArray(new String[0]),
                    PERMISSION_REQ_CODE
                );
            }
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            WebSettings settings = webView.getSettings();

            // Enable local storage, DOM storage, database access
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
            settings.setMediaPlaybackRequiresUserGesture(false);

            // Enable JavaScript execution
            settings.setJavaScriptEnabled(true);

            // High rendering priority for smooth 60fps scrolling
            settings.setRenderPriority(WebSettings.RenderPriority.HIGH);

            // Enable remote debugging of WebView via chrome://inspect
            WebView.setWebContentsDebuggingEnabled(true);

            // Allow Mixed Content (HTTPS WebView connecting to HTTP local server)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }

            // Enable text selection and copy-paste in WebView
            webView.setLongClickable(true);

            // Clean User-Agent
            String defaultUA = settings.getUserAgentString();
            if (defaultUA != null) {
                settings.setUserAgentString(defaultUA.replace("; wv", ""));
            }

            // Suppress link/anchor popup context menus, but PRESERVE text selection for copy-paste
            webView.setOnLongClickListener(new View.OnLongClickListener() {
                @Override
                public boolean onLongClick(View v) {
                    WebView.HitTestResult result = ((WebView) v).getHitTestResult();
                    if (result != null) {
                        int type = result.getType();
                        // Only suppress link/anchor preview popups
                        if (type == WebView.HitTestResult.SRC_ANCHOR_TYPE ||
                            type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
                            return true;
                        }
                    }
                    // Return false to allow default Android text selection & copy-paste toolbar
                    return false;
                }
            });

            // Hide scrollbars for native app appearance
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
        }
    }

    @Override
    public void onBackPressed() {
        if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
            bridge.getWebView().goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }
}
