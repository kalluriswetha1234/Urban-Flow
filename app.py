from flask import Flask, render_template, request, jsonify
import sqlite3
from pathlib import Path
from datetime import datetime

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "urbanflow.db"

# Demonstration-only coordinates and incidents. Replace with verified local data before real use.
SAMPLE_INCIDENTS = [
    {
        "title": "Waterlogged road near Market Road",
        "category": "Flooding",
        "location": "Market Road (DEMO LOCATION)",
        "lat": 15.8281, "lng": 78.0373,
        "severity": 5, "repeat_reports": 2, "impact": 2,
        "description": "Sample report: water accumulation after heavy rainfall.",
        "status": "Reported", "assigned_to": ""
    },
    {
        "title": "Possible blocked drain near Bus Stand",
        "category": "Blocked Drain",
        "location": "Bus Stand area (DEMO LOCATION)",
        "lat": 15.8300, "lng": 78.0410,
        "severity": 3, "repeat_reports": 1, "impact": 1,
        "description": "Sample report: drainage flow appears restricted.",
        "status": "Assigned", "assigned_to": "Demo Worker A"
    },
    {
        "title": "Minor waterlogging on College Road",
        "category": "Flooding",
        "location": "College Road (DEMO LOCATION)",
        "lat": 15.8230, "lng": 78.0340,
        "severity": 2, "repeat_reports": 0, "impact": 1,
        "description": "Sample report: shallow water near road edge.",
        "status": "In Progress", "assigned_to": "Demo Worker B"
    }
]

def priority_score(severity, repeat_reports, impact):
    """Illustrative rule-based score: severity (0-5) + recurrence (0-3) + impact (0-2)."""
    return max(0, min(5, int(severity))) + max(0, min(3, int(repeat_reports))) + max(0, min(2, int(impact)))

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                location TEXT NOT NULL,
                lat REAL,
                lng REAL,
                severity INTEGER NOT NULL DEFAULT 3,
                repeat_reports INTEGER NOT NULL DEFAULT 0,
                impact INTEGER NOT NULL DEFAULT 1,
                description TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Reported',
                assigned_to TEXT DEFAULT '',
                is_sample INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """)
        count = conn.execute("SELECT COUNT(*) FROM incidents").fetchone()[0]
        if count == 0:
            now = datetime.now().isoformat(timespec="minutes")
            for item in SAMPLE_INCIDENTS:
                score = priority_score(item["severity"], item["repeat_reports"], item["impact"])
                conn.execute("""
                    INSERT INTO incidents
                    (title, category, location, lat, lng, severity, repeat_reports, impact,
                     description, status, assigned_to, is_sample, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """, (
                    item["title"], item["category"], item["location"], item["lat"], item["lng"],
                    item["severity"], item["repeat_reports"], item["impact"], item["description"],
                    item["status"], item["assigned_to"], now
                ))
        conn.commit()

def incident_dict(row):
    data = dict(row)
    data["priority_score"] = priority_score(data["severity"], data["repeat_reports"], data["impact"])
    data["priority_label"] = "High" if data["priority_score"] >= 8 else ("Medium" if data["priority_score"] >= 5 else "Low")
    return data

@app.route("/")
def index():
    return render_template("index.html")

@app.get("/api/incidents")
def list_incidents():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM incidents ORDER BY id DESC").fetchall()
    incidents = [incident_dict(row) for row in rows]
    stats = {
        "total": len(incidents),
        "active": sum(1 for i in incidents if i["status"] != "Resolved"),
        "high_priority": sum(1 for i in incidents if i["priority_label"] == "High" and i["status"] != "Resolved"),
        "resolved": sum(1 for i in incidents if i["status"] == "Resolved"),
        "blocked_drains": sum(1 for i in incidents if i["category"] == "Blocked Drain" and i["status"] != "Resolved")
    }
    return jsonify({"incidents": incidents, "stats": stats})

@app.post("/api/incidents")
def create_incident():
    data = request.get_json(silent=True) or request.form
    required = ["title", "category", "location", "severity"]
    if any(not str(data.get(field, "")).strip() for field in required):
        return jsonify({"error": "Please complete title, category, location and severity."}), 400
    try:
        severity = max(1, min(5, int(data.get("severity", 3))))
        repeats = max(0, min(3, int(data.get("repeat_reports", 0))))
        impact = max(0, min(2, int(data.get("impact", 1))))
        lat = float(data.get("lat")) if str(data.get("lat", "")).strip() else None
        lng = float(data.get("lng")) if str(data.get("lng", "")).strip() else None
    except (ValueError, TypeError):
        return jsonify({"error": "Severity, repeat reports, impact and coordinates must be valid numbers."}), 400

    now = datetime.now().isoformat(timespec="minutes")
    with get_db() as conn:
        cur = conn.execute("""
            INSERT INTO incidents
            (title, category, location, lat, lng, severity, repeat_reports, impact,
             description, status, assigned_to, is_sample, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Reported', '', 0, ?)
        """, (
            str(data["title"]).strip(), str(data["category"]).strip(),
            str(data["location"]).strip(), lat, lng, severity, repeats, impact,
            str(data.get("description", "")).strip(), now
        ))
        new_id = cur.lastrowid
        conn.commit()
        row = conn.execute("SELECT * FROM incidents WHERE id = ?", (new_id,)).fetchone()
    return jsonify({"incident": incident_dict(row), "message": "Incident report saved."}), 201

@app.patch("/api/incidents/<int:incident_id>")
def update_incident(incident_id):
    data = request.get_json(silent=True) or {}
    allowed_statuses = {"Reported", "Assigned", "In Progress", "Resolved"}
    status = data.get("status")
    assigned_to = data.get("assigned_to")
    if status is not None and status not in allowed_statuses:
        return jsonify({"error": "Invalid status."}), 400
    with get_db() as conn:
        row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if row is None:
            return jsonify({"error": "Incident not found."}), 404
        conn.execute("""
            UPDATE incidents
            SET status = ?, assigned_to = ?
            WHERE id = ?
        """, (
            status if status is not None else row["status"],
            str(assigned_to).strip() if assigned_to is not None else row["assigned_to"],
            incident_id
        ))
        conn.commit()
        updated = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
    return jsonify({"incident": incident_dict(updated), "message": "Incident updated."})

@app.get("/api/health")
def health():
    return jsonify({"ok": True, "app": "UrbanFlow"})

if __name__ == "__main__":
    init_db()
    print("UrbanFlow demo running at http://127.0.0.1:5000")
    app.run(debug=True)
