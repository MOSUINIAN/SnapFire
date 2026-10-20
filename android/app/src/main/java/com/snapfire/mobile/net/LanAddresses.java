package com.snapfire.mobile.net;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.List;

/** Enumerates usable private IPv4 addresses for the host room screen. */
public final class LanAddresses {
    private LanAddresses() {}

    public static List<String> find() {
        List<String> addresses = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                Enumeration<InetAddress> inetAddresses = network.getInetAddresses();
                while (inetAddresses.hasMoreElements()) {
                    InetAddress address = inetAddresses.nextElement();
                    if (address.isLoopbackAddress() || !(address instanceof Inet4Address)) continue;
                    String hostAddress = address.getHostAddress();
                    if (hostAddress != null && hostAddress.indexOf(':') < 0) {
                        addresses.add(hostAddress);
                    }
                }
            }
        } catch (Exception ignored) {
            // A network transition can invalidate an interface mid-enumeration.
        }
        Collections.sort(addresses, new Comparator<String>() {
            @Override
            public int compare(String left, String right) {
                int rankDiff = Integer.compare(rank(left), rank(right));
                return rankDiff != 0 ? rankDiff : left.compareTo(right);
            }
        });
        return addresses;
    }

    private static int rank(String ip) {
        if (ip.startsWith("192.168.")) return 0;
        if (ip.startsWith("10.")) return 1;
        if (ip.matches("^172\\.(1[6-9]|2\\d|3[01])\\..*")) return 2;
        return 3;
    }
}
