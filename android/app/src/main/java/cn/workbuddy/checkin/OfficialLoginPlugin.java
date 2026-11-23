package cn.workbuddy.checkin;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OfficialLogin")
public class OfficialLoginPlugin extends Plugin {

    @PluginMethod
    public void login(PluginCall call) {
        Intent intent = new Intent(getActivity(), LoginActivity.class);
        intent.putExtra(LoginActivity.EXTRA_URL, call.getString("url", "https://www.workbuddy.cn/"));
        startActivityForResult(call, intent, "loginResult");
    }

    @ActivityCallback
    private void loginResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("cancelled");
            return;
        }
        Intent data = result.getData();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("data", data == null ? "" : String.valueOf(data.getStringExtra(LoginActivity.EXTRA_DATA)));
        call.resolve(ret);
    }
}
