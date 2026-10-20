package com.snapfire.mobile.net;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Native WebSocket transport used by the Android host. It deliberately owns no
 * game rules: JSON messages are relayed to the TypeScript RoomEngine in the
 * WebView, which remains the single source of truth.
 *
 * This class is Android-independent so it can be exercised by JVM unit tests.
 */
public final class LanWebSocketServer {
    public static final int DEFAULT_START_PORT = 17890;
    public static final int PORT_ATTEMPTS = 20;

    public interface Listener {
        void onClientConnected(String clientId);
        void onClientDisconnected(String clientId);
        void onClientMessage(String clientId, String message);
        void onServerError(String message);
    }

    private final int startPort;
    private final Listener listener;
    private final Map<String, WebSocket> clients = new ConcurrentHashMap<>();
    private final Map<WebSocket, String> socketIds = new ConcurrentHashMap<>();
    private volatile Server server;
    private volatile int port = -1;

    public LanWebSocketServer(int startPort, Listener listener) {
        this.startPort = startPort;
        this.listener = listener;
    }

    public synchronized int start() throws Exception {
        if (server != null && server.isAlive()) return port;
        Exception lastError = null;
        for (int attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
            int candidatePort = startPort + attempt;
            Server candidate = new Server(candidatePort);
            candidate.start();
            boolean ready = candidate.awaitStartup(3, TimeUnit.SECONDS);
            if (ready && candidate.startupError == null && candidate.isAlive()) {
                server = candidate;
                port = candidate.getPort();
                return port;
            }
            lastError = candidate.startupError;
            try {
                candidate.stop(500);
            } catch (Exception ignored) {
                // candidate may never have bound
            }
        }
        throw new Exception(
            "unable to bind LAN room service on ports " + startPort + "-" +
                (startPort + PORT_ATTEMPTS - 1) +
                (lastError == null ? "" : ": " + lastError.getMessage())
        );
    }

    public synchronized void stop() {
        Server current = server;
        server = null;
        port = -1;
        if (current != null) {
            current.markStopped();
            for (WebSocket socket : clients.values()) {
                try {
                    socket.close(1001, "room closed");
                } catch (Exception ignored) {
                    // closing a dead socket is harmless
                }
            }
            try {
                current.stop(1000);
            } catch (Exception ignored) {
                // ignore shutdown noise
            }
        }
        clients.clear();
        socketIds.clear();
    }

    public boolean isRunning() {
        Server current = server;
        return current != null && current.isAlive();
    }

    public int getPort() {
        return port;
    }

    public int getClientCount() {
        return clients.size();
    }

    public List<String> getClientIds() {
        return new ArrayList<>(clients.keySet());
    }

    public boolean sendToClient(String clientId, String message) {
        WebSocket socket = clients.get(clientId);
        if (socket == null || !socket.isOpen()) return false;
        try {
            socket.send(message);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    public int broadcast(String message) {
        int sent = 0;
        for (WebSocket socket : clients.values()) {
            if (!socket.isOpen()) continue;
            try {
                socket.send(message);
                sent += 1;
            } catch (Exception ignored) {
                // A single dead client must not abort the broadcast.
            }
        }
        return sent;
    }

    public boolean closeClient(String clientId, int code, String reason) {
        WebSocket socket = clients.get(clientId);
        if (socket == null) return false;
        try {
            socket.close(code, reason);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void emitClientConnected(String clientId) {
        try {
            listener.onClientConnected(clientId);
        } catch (Exception ignored) {
            // UI listener failures must not kill the transport thread.
        }
    }

    private void emitClientDisconnected(String clientId) {
        try {
            listener.onClientDisconnected(clientId);
        } catch (Exception ignored) {
            // ignore listener failure
        }
    }

    private void emitClientMessage(String clientId, String message) {
        try {
            listener.onClientMessage(clientId, message);
        } catch (Exception ignored) {
            // ignore listener failure
        }
    }

    private void emitServerError(String message) {
        try {
            listener.onServerError(message);
        } catch (Exception ignored) {
            // ignore listener failure
        }
    }

    private final class Server extends WebSocketServer {
        private final CountDownLatch started = new CountDownLatch(1);
        private volatile Exception startupError;
        private volatile boolean startupFinished;
        private volatile boolean running;

        Server(int port) {
            super(new InetSocketAddress("0.0.0.0", port));
            setReuseAddr(true);
            setMaxPendingConnections(64);
        }

        boolean isAlive() {
            return running;
        }

        void markStopped() {
            running = false;
        }

        boolean awaitStartup(long timeout, TimeUnit unit) throws InterruptedException {
            return started.await(timeout, unit);
        }

        @Override
        public void onStart() {
            startupFinished = true;
            running = true;
            started.countDown();
        }

        @Override
        public void onOpen(WebSocket connection, ClientHandshake handshake) {
            String clientId = UUID.randomUUID().toString();
            clients.put(clientId, connection);
            socketIds.put(connection, clientId);
            emitClientConnected(clientId);
        }

        @Override
        public void onMessage(WebSocket connection, String message) {
            String clientId = socketIds.get(connection);
            if (clientId != null) emitClientMessage(clientId, message);
        }

        @Override
        public void onMessage(WebSocket connection, java.nio.ByteBuffer message) {
            emitServerError("binary WebSocket messages are not supported");
        }

        @Override
        public void onClose(WebSocket connection, int code, String reason, boolean remote) {
            String clientId = socketIds.remove(connection);
            if (clientId == null) return;
            clients.remove(clientId);
            emitClientDisconnected(clientId);
        }

        @Override
        public void onError(WebSocket connection, Exception error) {
            if (!startupFinished) {
                startupError = error;
                started.countDown();
                return;
            }
            if (connection != null) {
                try {
                    connection.close(1011, "server error");
                } catch (Exception ignored) {
                    // ignore
                }
            }
            emitServerError(error == null ? "WebSocket server error" : error.getMessage());
        }
    }
}
