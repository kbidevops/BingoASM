package com.bingoasm.tools;

import com.bingoasm.common.CryptoConverter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.util.*;

/**
 * Copies every row of an H2 file database (the default dev DB) into a PostgreSQL database that already has the
 * Flyway schema. Runs from the server jar without starting the app:
 *
 * <pre>
 *   java -cp bingoasm-server.jar -Dloader.main=com.bingoasm.tools.H2ToPostgres \
 *        org.springframework.boot.loader.launch.PropertiesLauncher --source=/path/bingoasm.mv.db [--dry-run] [--replace]
 * </pre>
 *
 * Target: DB_URL / DB_USER / DB_PASSWORD (as in asm.env). Encrypted columns (users.mobile/email/totp_secret,
 * otp_challenges.setup_secret) are decrypted with SOURCE_DATA_KEY (default: the dev default key) and re-encrypted
 * with DATA_KEY; without DATA_KEY they are cleared (users then register Google OTP again).
 * Source and target must be at the same Flyway version (start the new server once against the target first).
 * Only columns present in both databases are copied. IDs are kept and identity counters are moved past them.
 * Everything runs in one transaction: on any error the target is left as it was. See docs/DB_MIGRATIONS.md.
 */
public final class H2ToPostgres {
    /** Columns stored encrypted by CryptoConverter. */
    private static final Map<String, Set<String>> ENCRYPTED = Map.of(
            "users", Set.of("mobile", "email", "totp_secret"),
            "otp_challenges", Set.of("setup_secret"));
    private static final Set<String> SKIP = Set.of("flyway_schema_history");
    private static final int BATCH = 500;

    private H2ToPostgres() {}

    public static void main(String[] args) throws Exception {
        String source = null;
        boolean dryRun = false, replace = false;
        for (String a : args) {
            if (a.startsWith("--source=")) source = a.substring("--source=".length());
            else if (a.equals("--dry-run")) dryRun = true;
            else if (a.equals("--replace")) replace = true;
            else fail("Unknown option: " + a + "\nOptions: --source=<file.mv.db> [--dry-run] [--replace]");
        }
        if (source == null) fail("--source=<path to bingoasm.mv.db> is required");
        Path file = Path.of(source.endsWith(".mv.db") ? source : source + ".mv.db").toAbsolutePath();
        if (!Files.isRegularFile(file)) fail("H2 file not found: " + file);
        String base = file.toString().substring(0, file.toString().length() - ".mv.db".length()).replace('\\', '/');

        String url = env("DB_URL", null), user = env("DB_USER", null), password = env("DB_PASSWORD", "");
        if (url == null || user == null) fail("Set DB_URL and DB_USER (and DB_PASSWORD) for the target PostgreSQL, e.g. by loading asm.env");
        if (!url.startsWith("jdbc:postgresql:")) fail("DB_URL must be a PostgreSQL JDBC URL: " + url);
        String targetKey = env("DATA_KEY", null);
        byte[] srcKey = CryptoConverter.keyOf(env("SOURCE_DATA_KEY", CryptoConverter.DEFAULT_KEY));
        byte[] dstKey = targetKey == null ? null : CryptoConverter.keyOf(targetKey);

        System.out.println("Source H2   : " + file);
        System.out.println("Target      : " + url + " (user " + user + ")");
        System.out.println("Personal data: " + (dstKey == null ? "CLEARED (no DATA_KEY set)" : "re-encrypted with DATA_KEY"));

        // AUTO_SERVER lets this read the file even while a dev server has it open.
        try (Connection src = DriverManager.getConnection("jdbc:h2:file:" + base + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;AUTO_SERVER=TRUE;IFEXISTS=TRUE", "sa", "");
             Connection dst = DriverManager.getConnection(url, user, password)) {
            src.setReadOnly(true);
            if (!tables(dst).contains("flyway_schema_history"))
                fail("The target has no Flyway schema yet. Start the new server once against it (it creates the tables), stop it, then run this again.");
            String sv = schemaVersion(src), tv = schemaVersion(dst);
            System.out.println("Schema      : source v" + sv + ", target v" + tv);
            if (!Objects.equals(sv, tv))
                fail("Source and target are at different schema versions (v" + sv + " vs v" + tv + "). Start the same new server jar once against each "
                        + "(dev H2 and the target PostgreSQL) so both are migrated, stop them, then run this again.");

            Map<String, List<String>> srcCols = columns(src), dstCols = columns(dst);
            List<String> order = insertOrder(dst, dstCols.keySet());
            System.out.println();
            for (String t : srcCols.keySet()) if (!dstCols.containsKey(t) && !SKIP.contains(t)) System.out.println("  skip table " + t + " (not in target)");

            Map<String, Long> targetRows = new LinkedHashMap<>();
            for (String t : order) targetRows.put(t, count(dst, t));
            long existing = targetRows.values().stream().mapToLong(Long::longValue).sum();

            System.out.printf("%n%-28s %10s %10s  %s%n", "table", "source", "target", "notes");
            for (String t : order) {
                List<String> sc = srcCols.get(t);
                String note = sc == null ? "not in source (left empty)" : "";
                if (sc != null) {
                    List<String> dropped = sc.stream().filter(c -> !dstCols.get(t).contains(c)).toList();
                    if (!dropped.isEmpty()) note = "source-only columns not copied: " + String.join(", ", dropped);
                }
                System.out.printf("%-28s %10s %10d  %s%n", t, sc == null ? "-" : String.valueOf(count(src, t)), targetRows.get(t), note);
            }
            String replaceHint = "The target already has " + existing + " rows. Back it up, then add --replace to delete them and load the H2 data instead.";
            if (dryRun) {
                System.out.println("\nDry run: nothing was changed." + (existing > 0 && !replace ? "\n" + replaceHint : ""));
                return;
            }
            if (existing > 0 && !replace) fail("\n" + replaceHint);

            dst.setAutoCommit(false);
            try {
                if (replace && existing > 0) {
                    try (Statement st = dst.createStatement()) { st.execute("TRUNCATE " + String.join(", ", order) + " RESTART IDENTITY CASCADE"); }
                    System.out.println("\nCleared " + existing + " existing rows.");
                }
                long total = 0;
                for (String t : order) {
                    if (!srcCols.containsKey(t)) continue;
                    List<String> cols = srcCols.get(t).stream().filter(dstCols.get(t)::contains).toList();
                    total += copy(src, dst, t, cols, srcKey, dstKey);
                }
                resetIdentities(dst);
                dst.commit();
                System.out.println("Copied " + total + " rows. Done.");
            } catch (Exception e) {
                dst.rollback();
                throw e;
            }
        }
    }

    private static long copy(Connection src, Connection dst, String table, List<String> cols, byte[] srcKey, byte[] dstKey) throws SQLException {
        if (cols.isEmpty()) return 0;
        Set<String> enc = ENCRYPTED.getOrDefault(table, Set.of());
        String list = String.join(", ", cols);
        String marks = String.join(", ", Collections.nCopies(cols.size(), "?"));
        long n = 0;
        try (Statement s = src.createStatement(); ResultSet rs = s.executeQuery("SELECT " + list + " FROM " + table);
             PreparedStatement ins = dst.prepareStatement("INSERT INTO " + table + " (" + list + ") VALUES (" + marks + ")")) {
            while (rs.next()) {
                for (int i = 0; i < cols.size(); i++) {
                    Object v = rs.getObject(i + 1);
                    if (enc.contains(cols.get(i)) && v != null)
                        v = dstKey == null ? null : CryptoConverter.encrypt(dstKey, CryptoConverter.decrypt(srcKey, (String) v));
                    ins.setObject(i + 1, v);
                }
                ins.addBatch();
                if (++n % BATCH == 0) ins.executeBatch();
            }
            ins.executeBatch();
        } catch (IllegalStateException e) {
            throw new IllegalStateException("Could not decrypt " + table + " encrypted columns with SOURCE_DATA_KEY. Set SOURCE_DATA_KEY to the DATA_KEY the H2 database was written with.", e);
        }
        System.out.printf("  %-26s %8d rows%n", table, n);
        return n;
    }

    /** Moves every identity counter past the copied ids, so new rows don't collide. */
    private static void resetIdentities(Connection dst) throws SQLException {
        List<String[]> ids = new ArrayList<>();
        try (Statement s = dst.createStatement(); ResultSet rs = s.executeQuery(
                "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND is_identity = 'YES'")) {
            while (rs.next()) ids.add(new String[]{rs.getString(1), rs.getString(2)});
        }
        try (Statement s = dst.createStatement()) {
            for (String[] c : ids)
                s.execute("SELECT setval(pg_get_serial_sequence('" + c[0] + "', '" + c[1] + "'), COALESCE((SELECT MAX(" + c[1] + ") FROM " + c[0] + "), 0) + 1, false)");
        }
    }

    /** Tables ordered so a table comes after the tables its foreign keys point to. */
    private static List<String> insertOrder(Connection dst, Set<String> tables) throws SQLException {
        Map<String, Set<String>> parents = new HashMap<>();
        DatabaseMetaData md = dst.getMetaData();
        for (String t : tables) {
            Set<String> p = new HashSet<>();
            try (ResultSet rs = md.getImportedKeys(null, dst.getSchema(), t)) { while (rs.next()) p.add(rs.getString("PKTABLE_NAME")); }
            p.remove(t);
            parents.put(t, p);
        }
        List<String> out = new ArrayList<>();
        Set<String> left = new TreeSet<>(tables);
        left.removeAll(SKIP);
        while (!left.isEmpty()) {
            // First table whose parents are all placed; a cycle (none qualifies) just takes the next one.
            String next = left.stream().filter(t -> parents.get(t).stream().noneMatch(left::contains)).findFirst().orElse(left.iterator().next());
            out.add(next);
            left.remove(next);
        }
        return out;
    }

    private static Set<String> tables(Connection c) throws SQLException {
        Set<String> out = new TreeSet<>();
        try (ResultSet rs = c.getMetaData().getTables(null, c.getSchema(), "%", new String[]{"TABLE", "BASE TABLE"})) {
            while (rs.next()) out.add(rs.getString("TABLE_NAME").toLowerCase(Locale.ROOT));
        }
        return out;
    }

    /** table → column names (lower case), in table order. */
    private static Map<String, List<String>> columns(Connection c) throws SQLException {
        Map<String, List<String>> out = new TreeMap<>();
        for (String t : tables(c)) {
            if (SKIP.contains(t)) continue;
            List<String> cols = new ArrayList<>();
            try (ResultSet rs = c.getMetaData().getColumns(null, c.getSchema(), t, "%")) {
                while (rs.next()) cols.add(rs.getString("COLUMN_NAME").toLowerCase(Locale.ROOT));
            }
            out.put(t, cols);
        }
        return out;
    }

    /** Latest applied Flyway version, or null when there is no history table. */
    private static String schemaVersion(Connection c) throws SQLException {
        if (!tables(c).contains("flyway_schema_history")) return null;
        try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery(
                "SELECT version FROM flyway_schema_history WHERE success = TRUE AND version IS NOT NULL ORDER BY installed_rank DESC")) {
            return rs.next() ? rs.getString(1) : null;
        }
    }

    private static long count(Connection c, String table) throws SQLException {
        try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SELECT COUNT(*) FROM " + table)) { rs.next(); return rs.getLong(1); }
    }

    private static String env(String name, String def) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? def : v;
    }

    private static void fail(String msg) {
        System.err.println(msg);
        System.exit(1);
    }
}
