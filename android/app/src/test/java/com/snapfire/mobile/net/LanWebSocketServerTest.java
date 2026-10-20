package com.snapfire.mobile.net;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.junit.After;
import org.junit.Test;

import java.net.ServerSocket;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class LanWebSocketServerTest {
    private final List<LanWebSocketServer> servers = new ArrayList<>();
    private final List<TestClient> clients = new ArrayList<>();

    @After
    public void tearDown() {
        for (TestClient client : clients) {
            try {
                client.closeBlocking();
            } catch (Exception ignored) {
                // ignore
            }
        }
        clients.clear();
        for (LanWebSocketServer server : servers) {
            server.stop();
        }
        servers.clear();
    }

    @Test
    public void startsRelaysMessagesAndStops() throws Exception {
        RecordingListener listener = new RecordingListener();
        LanWebSocketServer server = startServer(freePort(), listener);
        TestClient client = connect(server.getPort());

        String clientId = listener.connected.poll(5, TimeUnit.SECONDS);
        assertNotNull(clientId);

        client.send("hello");
        Message message = listener.messages.poll(5, TimeUnit.SECONDS);
        assertNotNull(message);
        assertEquals(clientId, message.clientId);
        assertEquals("hello", message.message);

        assertTrue(server.sendToClient(clientId, "ack:" + message.message));
        assertEquals("ack:hello", client.messages.poll(5, TimeUnit.SECONDS));
        assertEquals(1, server.getClientCount());

        server.stop();
        assertEquals(0, server.getClientCount());
        assertFalse(server.isRunning());
    }

    @Test
    public void supportsSixClientsAndBroadcast() throws Exception {
        RecordingListener listener = new RecordingListener();
        LanWebSocketServer server = startServer(freePort(), listener);
        int port = server.getPort();

        for (int index = 0; index < 6; index += 1) {
            TestClient client = connect(port);
            client.send("from-" + index);
        }

        Set<String> clientIds = new HashSet<>();
        Set<String> received = new HashSet<>();
        for (int index = 0; index < 6; index += 1) {
            String clientId = listener.connected.poll(5, TimeUnit.SECONDS);
            assertNotNull(clientId);
            clientIds.add(clientId);
            Message message = listener.messages.poll(5, TimeUnit.SECONDS);
            assertNotNull(message);
            received.add(message.message);
        }
        assertEquals(6, server.getClientCount());
        assertEquals(6, clientIds.size());
        assertEquals(
            new HashSet<>(List.of("from-0", "from-1", "from-2", "from-3", "from-4", "from-5")),
            received
        );

        assertEquals(6, server.broadcast("broadcast"));
        for (TestClient client : clients) {
            assertEquals("broadcast", client.messages.poll(5, TimeUnit.SECONDS));
        }
    }

    @Test
    public void fallsBackToNextPortWhenStartPortIsOccupied() throws Exception {
        try (ServerSocket occupied = new ServerSocket(0)) {
            int occupiedPort = occupied.getLocalPort();
            RecordingListener listener = new RecordingListener();
            LanWebSocketServer server = startServer(occupiedPort, listener);
            assertTrue(server.getPort() > occupiedPort);
            assertTrue(server.getPort() < occupiedPort + LanWebSocketServer.PORT_ATTEMPTS);
            assertTrue(server.isRunning());
        }
    }

    @Test
    public void rejectsMessagesToUnknownClients() throws Exception {
        RecordingListener listener = new RecordingListener();
        LanWebSocketServer server = startServer(freePort(), listener);
        assertFalse(server.sendToClient("missing", "hello"));
        assertEquals(0, server.getClientCount());
    }

    private LanWebSocketServer startServer(int port, RecordingListener listener) throws Exception {
        LanWebSocketServer server = new LanWebSocketServer(port, listener);
        server.start();
        servers.add(server);
        return server;
    }

    private TestClient connect(int port) throws Exception {
        TestClient client = new TestClient(new URI("ws://127.0.0.1:" + port));
        assertTrue(client.connectBlocking(5, TimeUnit.SECONDS));
        clients.add(client);
        return client;
    }

    private static int freePort() throws Exception {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    private static final class Message {
        final String clientId;
        final String message;

        Message(String clientId, String message) {
            this.clientId = clientId;
            this.message = message;
        }
    }

    private static final class RecordingListener implements LanWebSocketServer.Listener {
        final BlockingQueue<String> connected = new LinkedBlockingQueue<>();
        final BlockingQueue<String> disconnected = new LinkedBlockingQueue<>();
        final BlockingQueue<Message> messages = new LinkedBlockingQueue<>();
        final BlockingQueue<String> errors = new LinkedBlockingQueue<>();

        @Override
        public void onClientConnected(String clientId) {
            connected.add(clientId);
        }

        @Override
        public void onClientDisconnected(String clientId) {
            disconnected.add(clientId);
        }

        @Override
        public void onClientMessage(String clientId, String message) {
            messages.add(new Message(clientId, message));
        }

        @Override
        public void onServerError(String message) {
            errors.add(message);
        }
    }

    private static final class TestClient extends WebSocketClient {
        final BlockingQueue<String> messages = new LinkedBlockingQueue<>();
        final BlockingQueue<String> errors = new LinkedBlockingQueue<>();

        TestClient(URI uri) {
            super(uri);
        }

        @Override
        public void onOpen(ServerHandshake handshake) {}

        @Override
        public void onMessage(String message) {
            messages.add(message);
        }

        @Override
        public void onClose(int code, String reason, boolean remote) {}

        @Override
        public void onError(Exception error) {
            errors.add(error == null ? "unknown" : error.getMessage());
        }
    }
}
