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
        // Install splash screen BEFORE super.onCreate for proper API 31+ splash
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        super.onCreate(savedInstanceState);

        // Keep splash screen visible until WebView finishes loading
        splashScreen.setKeepOnScreenCondition(() -> false);

        // Edge-to-edge layout: let app draw behind status bar + nav bar
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Make status bar + nav bar transparent so app content shows through
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        // Force white (light) status bar icons so they are visible on dark bg
        WindowInsetsControllerCompat wic = new WindowInsetsControllerCompat(
            getWindow(), getWindow().getDecorView()
        );
        wic.setAppearanceLightStatusBars(false);    // white icons on dark background
        wic.setAppearanceLightNavigationBars(false); // white nav icons on dark background

        // Request runtime permissions for Camera, Microphone & Media
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
            // Android 13+ (TIRAMISU) uses READ_MEDIA_IMAGES for gallery/screenshot access
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

            // Enable all storage for local asset mode
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccessFromFileURLs(true);
            settings.setAllowUniversalAccessFromFileURLs(true);
            settings.setMediaPlaybackRequiresUserGesture(false);

            // Enable JavaScript (required by React app)
            settings.setJavaScriptEnabled(true);

            // High render priority for smooth performance
            settings.setRenderPriority(WebSettings.RenderPriority.HIGH);

            // Enable text selection, copy, paste in the WebView
            webView.setLongClickable(true);

            // Clean up user-agent (remove "; wv" so sites treat it as a real browser)
            String defaultUA = settings.getUserAgentString();
            settings.setUserAgentString(defaultUA.replace("; wv", ""));

            // Suppress URL context menus ONLY on links/anchors.
            // Allow long-press on plain text so copy/paste works normally.
            webView.setOnLongClickListener(new View.OnLongClickListener() {
                @Override
                public boolean onLongClick(View v) {
                    WebView.HitTestResult result = ((WebView) v).getHitTestResult();
                    if (result != null) {
                        int type = result.getType();
                        if (type == WebView.HitTestResult.SRC_ANCHOR_TYPE ||
                            type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
                            return true; // suppress link/anchor URL popup
                        }
                    }
                    return false; // allow text selection & copy/paste
                }
            });

            // Hide scrollbars for a cleaner native-app look
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
        // Bridge handles re-requesting if needed
    }
}
