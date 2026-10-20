package com.snapfire.mobile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.snapfire.mobile.net.LanAddresses;
import com.snapfire.mobile.net.LanWebSocketServer;

import java.util.List;

/**
 * Capacitor transport bridge. Game rules stay in the shared TypeScript
 * RoomEngine; this plugin only exposes a reliable local WebSocket server.
 */
@CapacitorPlugin(name = "HostServer")
public class HostServerPlugin extends Plugin implements LanWebSocketServer.Listener {
    private volatile LanWebSocketServer server;
    private volatile boolean starting;

    @PluginMethod
    public void startServer(PluginCall call) {
        LanWebSocketServer current = server;
        if (current != null && current.isRunning()) {
            call.resolve(serverInfo(current.getPort()));
            return;
        }
        if (starting) {
            call.reject("房间服务正在启动");
            return;
        }
        starting = true;
        new Thread(() -> {
            try {
                LanWebSocketServer instance = new LanWebSocketServer(
                    LanWebSocketServer.DEFAULT_START_PORT,
                    this
                );
                int port = instance.start();
                server = instance;
                call.resolve(serverInfo(port));
            } catch (Exception error) {
                server = null;
                call.reject("无法启动局域网服务: " + error.getMessage());
            } finally {
                starting = false;
            }
        }, "snapfire-host-server-start").start();
    }

    @PluginMethod
    public void stopServer(PluginCall call) {
        new Thread(() -> {
            LanWebSocketServer current = server;
            server = null;
            if (current != null) current.stop();
            call.resolve();
        }, "snapfire-host-server-stop").start();
    }

    @PluginMethod
    public void getLanIps(PluginCall call) {
        JSObject result = new JSObject();
        JSArray ips = new JSArray();
        for (String ip : LanAddresses.find()) ips.put(ip);
        result.put("ips", ips);
        call.resolve(result);
    }

    @PluginMethod
    public void sendToClient(PluginCall call) {
        String clientId = call.getString("clientId");
        String message = call.getString("message");
        LanWebSocketServer current = server;
        if (current == null) {
            call.reject("房间服务未启动");
            return;
        }
        if (clientId == null || message == null) {
            call.reject("clientId 和 message 不能为空");
            return;
        }
        if (!current.sendToClient(clientId, message)) {
            call.reject("客户端不存在或已断开");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void broadcast(PluginCall call) {
        String message = call.getString("message");
        LanWebSocketServer current = server;
        if (current == null) {
            call.reject("房间服务未启动");
            return;
        }
        if (message == null) {
            call.reject("message 不能为空");
            return;
        }
        int sent = current.broadcast(message);
        JSObject result = new JSObject();
        result.put("sent", sent);
        call.resolve(result);
    }

    @PluginMethod
    public void closeClient(PluginCall call) {
        String clientId = call.getString("clientId");
        LanWebSocketServer current = server;
        if (current != null && clientId != null) {
            current.closeClient(clientId, 1000, "closed by host");
        }
        call.resolve();
    }

    @Override
    public void onClientConnected(String clientId) {
        JSObject data = new JSObject();
        data.put("clientId", clientId);
        notifyListeners("clientConnected", data);
    }

    @Override
    public void onClientDisconnected(String clientId) {
        JSObject data = new JSObject();
        data.put("clientId", clientId);
        notifyListeners("clientDisconnected", data);
    }

    @Override
    public void onClientMessage(String clientId, String message) {
        JSObject data = new JSObject();
        data.put("clientId", clientId);
        data.put("message", message);
        notifyListeners("clientMessage", data);
    }

    @Override
    public void onServerError(String message) {
        JSObject data = new JSObject();
        data.put("message", message);
        notifyListeners("serverError", data);
    }

    @Override
    protected void handleOnDestroy() {
        LanWebSocketServer current = server;
        server = null;
        if (current != null) current.stop();
        super.handleOnDestroy();
    }

    private JSObject serverInfo(int port) {
        JSObject result = new JSObject();
        result.put("port", port);
        List<String> ips = LanAddresses.find();
        JSArray lanIps = new JSArray();
        for (String ip : ips) lanIps.put(ip);
        result.put("lanIps", lanIps);
        return result;
    }
}
