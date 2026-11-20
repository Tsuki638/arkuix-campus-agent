package com.example.campusagent;

import android.os.Bundle;
import android.util.Log;

import ohos.stage.ability.adapter.StageActivity;


/**
 * Example ace activity class, which will load ArkUI-X ability instance.
 * StageActivity is provided by ArkUI-X
 * @see <a href=
 * "https://gitee.com/arkui-crossplatform/doc/blob/master/contribute/tutorial/how-to-build-Android-app.md">
 * to build android library</a>
 */
public class EntryEntryAbilityActivity extends StageActivity {
    private WebsiteBridge browserBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Log.e("HiHelloWorld", "EntryEntryAbilityActivity");
        setInstanceName("cn.kaleteam.campusagent:entry:EntryAbility:");
        browserBridge = new WebsiteBridge(this);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onDestroy() {
        if (browserBridge != null) {
            browserBridge.unRegister(WebsiteBridge.NAME);
        }
        super.onDestroy();
    }
}
