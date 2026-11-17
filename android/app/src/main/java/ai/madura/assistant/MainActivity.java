package ai.madura.assistant;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQ_CODE = 101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Ensure runtime Camera & Audio permissions are prompted on Android 6.0+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean needCamera = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED;
            boolean needAudio = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED;
            if (needCamera || needAudio) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO},
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

            // Enable storage and media for audio/file processing
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setMediaPlaybackRequiresUserGesture(false);

            // Hide URL previews, link tooltips, and context menus to ensure all URLs remain strictly private
            webView.setOnLongClickListener(new View.OnLongClickListener() {
                @Override
                public boolean onLongClick(View v) {
                    WebView.HitTestResult result = ((WebView) v).getHitTestResult();
                    if (result != null) {
                        int type = result.getType();
                        // Suppress URL popups on links, images, and anchors
                        if (type == WebView.HitTestResult.SRC_ANCHOR_TYPE ||
                            type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE ||
                            type == WebView.HitTestResult.IMAGE_TYPE) {
                            return true;
                        }
                    }
                    return false;
                }
            });
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
}
