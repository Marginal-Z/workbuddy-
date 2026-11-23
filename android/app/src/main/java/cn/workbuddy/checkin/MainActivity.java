package cn.workbuddy.checkin;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OfficialLoginPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
