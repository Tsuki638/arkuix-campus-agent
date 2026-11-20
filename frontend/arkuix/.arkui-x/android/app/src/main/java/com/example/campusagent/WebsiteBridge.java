package com.example.campusagent;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import ohos.ace.adapter.capability.bridge.BridgePlugin;
import ohos.ace.adapter.capability.bridge.IMessageListener;
import ohos.stage.ability.adapter.StageActivity;

final class WebsiteBridge extends BridgePlugin implements IMessageListener {
    static final String NAME = "campus.browser";

    private final StageActivity activity;

    WebsiteBridge(StageActivity activity) {
        super(activity, NAME, activity.getBridgeManager());
        this.activity = activity;
        setMessageListener(this);
    }

    @Override
    public Object onMessage(Object message) {
        if (!(message instanceof String)) {
            return false;
        }
        Uri uri = Uri.parse((String) message).normalizeScheme();
        String scheme = uri.getScheme();
        if (!("https".equals(scheme) || "http".equals(scheme))
                || uri.getHost() == null || uri.getHost().isEmpty() || uri.getUserInfo() != null) {
            return false;
        }
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
            return true;
        } catch (ActivityNotFoundException | SecurityException exception) {
            return false;
        }
    }

    @Override
    public void onMessageResponse(Object message) {}
}
