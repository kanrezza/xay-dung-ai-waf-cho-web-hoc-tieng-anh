"""
Lưu nhật ký (log) mọi request đi qua WAF vào SQLite, phục vụ dashboard giám sát.

Mỗi dòng ghi: thời gian, IP, phương thức, đường dẫn, quyết định (allow/block),
lớp nào ra quyết định, loại tấn công, điểm ML và một đoạn trích payload.
"""
import os
import sqlite3
import threading
import time

from . import config

_lock = threading.Lock()
_conn = None


def init():
    global _conn
    # Nhiều tiến trình WAF (EngPro và DVWA) cùng ghi vào một file log để một
    # dashboard thấy hết. WAL cho phép ghi đồng thời mà không khóa lẫn nhau.
    # Thư mục data/ không có trên GitHub (bị .gitignore), clone về thì tự tạo
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False, timeout=15)
    # Chờ thay vì báo lỗi ngay khi tiến trình WAF kia đang ghi
    _conn.execute("PRAGMA busy_timeout=15000")
    try:
        _conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.OperationalError:
        # Tiến trình kia đang đặt WAL. Chế độ này lưu trong file CSDL nên chỉ
        # cần đặt một lần, bỏ qua an toàn.
        pass
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            ts        REAL NOT NULL,
            ip        TEXT,
            method    TEXT,
            path      TEXT,
            decision  TEXT,          -- 'allow' | 'block'
            layer     TEXT,          -- 'rule' | 'ml' | 'anomaly' | '-'
            attack    TEXT,          -- loại tấn công hoặc NULL
            rule_id   TEXT,
            score     REAL,          -- điểm mô hình ML
            status    INTEGER,       -- mã HTTP trả về
            snippet   TEXT           -- trích đoạn payload
        )
    """)
    # Thêm cột 'target' cho CSDL cũ đã tạo trước khi có tính năng nhiều mục tiêu
    cols = [r[1] for r in _conn.execute("PRAGMA table_info(events)")]
    if "target" not in cols:
        _conn.execute("ALTER TABLE events ADD COLUMN target TEXT")
    _conn.execute("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)")
    _conn.commit()


def record(ip, method, path, decision, layer, attack, rule_id, score, status, snippet):
    with _lock:
        _conn.execute(
            "INSERT INTO events (ts, ip, method, path, decision, layer, attack, "
            "rule_id, score, status, snippet, target) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (time.time(), ip, method, path, decision, layer, attack,
             rule_id, score, status, (snippet or "")[:300], config.TARGET_NAME),
        )
        _conn.commit()


def _rows(cur):
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def recent(limit=100):
    with _lock:
        cur = _conn.execute(
            "SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))
        return _rows(cur)


def stats():
    """Số liệu tổng hợp cho dashboard."""
    with _lock:
        total = _conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        blocked = _conn.execute(
            "SELECT COUNT(*) FROM events WHERE decision='block'").fetchone()[0]
        by_attack = _rows(_conn.execute(
            "SELECT attack, COUNT(*) AS n FROM events WHERE decision='block' "
            "AND attack IS NOT NULL GROUP BY attack ORDER BY n DESC"))
        by_layer = _rows(_conn.execute(
            "SELECT layer, COUNT(*) AS n FROM events WHERE decision='block' "
            "GROUP BY layer ORDER BY n DESC"))
        top_ip = _rows(_conn.execute(
            "SELECT ip, COUNT(*) AS n FROM events WHERE decision='block' "
            "GROUP BY ip ORDER BY n DESC LIMIT 10"))
        by_target = _rows(_conn.execute(
            "SELECT COALESCE(target,'?') AS target, "
            "COUNT(*) AS total, "
            "SUM(CASE WHEN decision='block' THEN 1 ELSE 0 END) AS blocked "
            "FROM events GROUP BY target ORDER BY total DESC"))
    return {
        "total": total,
        "blocked": blocked,
        "allowed": total - blocked,
        "by_attack": by_attack,
        "by_layer": by_layer,
        "by_target": by_target,
        "top_ip": top_ip,
    }


def clear():
    with _lock:
        _conn.execute("DELETE FROM events")
        _conn.commit()
