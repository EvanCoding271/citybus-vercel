"""
CityBus — FastAPI backend for Vercel + Supabase
Fixes applied:
  1. SSL required for Supabase — added sslmode=require
  2. dict | None syntax replaced with Optional[dict] for Python 3.9
  3. List[str] instead of list[str] for Python 3.9
  4. on_event("startup") replaced — unreliable on Vercel serverless;
     seed now runs lazily on first real request via _ensure_seeded()
  5. Better error handling — all exceptions caught and returned as 500 with detail
  6. DATABASE_URL: automatically converts postgres:// -> postgresql:// (psycopg2 needs postgresql://)
  7. get_db context manager now rolls back on exception to avoid stale transactions
"""

import os, time, json, hashlib, hmac, base64, traceback
from contextlib import contextmanager
from typing import Optional, List

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from mangum import Mangum

# ─── Environment ──────────────────────────────────────────────────────────────
_raw_url   = os.environ.get("DATABASE_URL", "")
# psycopg2 needs postgresql://, Supabase/Heroku gives postgres://
DATABASE_URL = _raw_url.replace("postgres://", "postgresql://", 1) if _raw_url.startswith("postgres://") else _raw_url
SECRET_KEY   = os.environ.get("JWT_SECRET", "citybus-change-me-in-prod")
TOKEN_TTL    = 60 * 60 * 24   # 24 h

# ─── JWT (pure stdlib, no PyJWT needed) ───────────────────────────────────────
def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

def _unb64(s: str) -> bytes:
    s += "=" * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)

def create_token(payload: dict) -> str:
    hdr  = _b64(b'{"alg":"HS256","typ":"JWT"}')
    body = _b64(json.dumps({**payload, "exp": int(time.time()) + TOKEN_TTL}).encode())
    sig  = _b64(hmac.new(SECRET_KEY.encode(), f"{hdr}.{body}".encode(), hashlib.sha256).digest())
    return f"{hdr}.{body}.{sig}"

def decode_token(token: str) -> Optional[dict]:
    try:
        hdr, body, sig = token.split(".")
        expected = _b64(hmac.new(SECRET_KEY.encode(), f"{hdr}.{body}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        pl = json.loads(_unb64(body))
        return pl if pl.get("exp", 0) > time.time() else None
    except Exception:
        return None

def hash_pw(pw: str) -> str:
    salt = os.urandom(16).hex()
    return salt + ":" + hashlib.sha256(f"{salt}{pw}".encode()).hexdigest()

def verify_pw(pw: str, stored: str) -> bool:
    try:
        salt, h = stored.split(":", 1)
        return hmac.compare_digest(h, hashlib.sha256(f"{salt}{pw}".encode()).hexdigest())
    except Exception:
        return False

# ─── DB connection ─────────────────────────────────────────────────────────────
@contextmanager
def get_db():
    if not DATABASE_URL:
        raise HTTPException(500, "DATABASE_URL environment variable is not set. Check Vercel settings.")
    try:
        conn = psycopg2.connect(
            DATABASE_URL,
            cursor_factory=psycopg2.extras.RealDictCursor,
            sslmode="require",          # Supabase requires SSL
            connect_timeout=10,
        )
        conn.autocommit = False
    except psycopg2.OperationalError as e:
        raise HTTPException(500, f"Cannot connect to database: {str(e)}")
    try:
        yield conn
    except HTTPException:
        conn.rollback()
        conn.close()
        raise
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(500, f"Database error: {str(e)}")
    else:
        conn.close()

# ─── Lazy seed (runs once per cold start, safely) ─────────────────────────────
_seeded = False

def _ensure_seeded():
    global _seeded
    if _seeded:
        return
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) AS c FROM users")
            if cur.fetchone()["c"] > 0:
                _seeded = True
                return

            # Roles
            for r, d in [("admin","Admin"),("operator","Operator"),("finance","Finance"),("passenger","Passenger")]:
                cur.execute("INSERT INTO roles (name,description) VALUES (%s,%s) ON CONFLICT DO NOTHING", (r, d))

            # Users
            for row in [
                ("Juan Dela Cruz",  "juan@example.com",     "0912-345-6789", hash_pw("password123"), "passenger"),
                ("Maria Santos",    "maria@example.com",    "0917-654-3210", hash_pw("password123"), "passenger"),
                ("Admin User",      "admin@citybus.com",    "0900-000-0001", hash_pw("admin123"),    "admin"),
                ("Finance User",    "finance@citybus.com",  "0900-000-0002", hash_pw("finance123"),  "finance"),
                ("Operator User",   "operator@citybus.com", "0900-000-0003", hash_pw("operator123"), "operator"),
            ]:
                cur.execute(
                    "INSERT INTO users (full_name,email,phone,password_hash,role) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                    row
                )

            # Buses
            for row in [
                ("Bus Alpha","ABC-1234",25,"active"),
                ("Bus Beta", "XYZ-5678",25,"active"),
                ("Bus Gamma","DEF-9012",25,"active"),
                ("Bus Delta","GHI-3456",25,"maintenance"),
            ]:
                cur.execute(
                    "INSERT INTO buses (name,plate_number,capacity,status) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                    row
                )

            # Routes
            for row in [
                ("Route 1","Manila",     "Makati", 65,"active"),
                ("Route 2","Quezon City","Ortigas",72,"active"),
                ("Route 3","Pasay",      "MOA",    55,"active"),
                ("Route 4","Manila",     "BGC",    80,"inactive"),
            ]:
                cur.execute(
                    "INSERT INTO routes (name,origin,destination,base_fare,status) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                    row
                )

            # Seed schedules (need bus_id and route_id)
            cur.execute("SELECT id FROM buses WHERE plate_number='ABC-1234'")
            b1 = cur.fetchone()
            cur.execute("SELECT id FROM buses WHERE plate_number='XYZ-5678'")
            b2 = cur.fetchone()
            cur.execute("SELECT id FROM routes WHERE name='Route 1'")
            r1 = cur.fetchone()
            cur.execute("SELECT id FROM routes WHERE name='Route 2'")
            r2 = cur.fetchone()

            if b1 and r1:
                cur.execute(
                    "INSERT INTO schedules (bus_id,route_id,departure_time,arrival_time,status) VALUES (%s,%s,'2026-06-01 07:30:00+08','2026-06-01 09:00:00+08','active') ON CONFLICT DO NOTHING",
                    (b1["id"], r1["id"])
                )
                cur.execute("SELECT id FROM schedules WHERE bus_id=%s AND route_id=%s", (b1["id"], r1["id"]))
                sched = cur.fetchone()
                if sched:
                    seats = [f"{chr(65+r)}{c}" for r in range(5) for c in range(1,6)]
                    for sl in seats:
                        cur.execute(
                            "INSERT INTO seats (schedule_id,seat_label,status) VALUES (%s,%s,'available') ON CONFLICT DO NOTHING",
                            (sched["id"], sl)
                        )
            if b2 and r2:
                cur.execute(
                    "INSERT INTO schedules (bus_id,route_id,departure_time,arrival_time,status) VALUES (%s,%s,'2026-06-01 08:00:00+08','2026-06-01 09:15:00+08','active') ON CONFLICT DO NOTHING",
                    (b2["id"], r2["id"])
                )
                cur.execute("SELECT id FROM schedules WHERE bus_id=%s AND route_id=%s", (b2["id"], r2["id"]))
                sched = cur.fetchone()
                if sched:
                    seats = [f"{chr(65+r)}{c}" for r in range(5) for c in range(1,6)]
                    for sl in seats:
                        cur.execute(
                            "INSERT INTO seats (schedule_id,seat_label,status) VALUES (%s,%s,'available') ON CONFLICT DO NOTHING",
                            (sched["id"], sl)
                        )

            conn.commit()
            _seeded = True
    except HTTPException:
        raise
    except Exception as e:
        print(f"[seed] skipped: {e}")

# ─── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="CityBus API",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global error handler — turns unhandled exceptions into a JSON 500
# instead of a raw HTML Vercel error page
@app.exception_handler(Exception)
async def global_exc(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print(f"[ERROR] {request.url}\n{tb}")
    return JSONResponse(status_code=500, content={"detail": str(exc)})

security = HTTPBearer()

def current_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    payload = decode_token(creds.credentials)
    if not payload:
        raise HTTPException(401, "Invalid or expired token")
    return payload

def require(*roles):
    def guard(u=Depends(current_user)):
        if u["role"] not in roles:
            raise HTTPException(403, "Insufficient permissions")
        return u
    return guard

# ─── Pydantic models ───────────────────────────────────────────────────────────
class RegisterIn(BaseModel):
    full_name: str
    email: EmailStr
    phone: Optional[str] = ""
    password: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class EmpLoginIn(BaseModel):
    email: EmailStr
    password: str

class UserUpdateIn(BaseModel):
    full_name: Optional[str] = None
    status: Optional[str] = None
    role: Optional[str] = None

class ProfileIn(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = None

class RouteIn(BaseModel):
    name: str
    origin: str
    destination: str
    base_fare: float

class RouteUpdateIn(BaseModel):
    name: Optional[str] = None
    base_fare: Optional[float] = None
    status: Optional[str] = None

class BusIn(BaseModel):
    name: str
    plate_number: str
    capacity: int

class BusUpdateIn(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None

class ScheduleIn(BaseModel):
    bus_id: int
    route_id: int
    departure_time: str
    arrival_time: str

class ScheduleUpdateIn(BaseModel):
    status: Optional[str] = None
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None

class BookingIn(BaseModel):
    schedule_id: int
    seat_labels: List[str]
    passenger_name: str
    payment_method: str

class VerifyIn(BaseModel):
    qr_code: str

class CreateUserIn(BaseModel):
    full_name: str
    email: EmailStr
    phone: Optional[str] = ""
    role: Optional[str] = "passenger"
    password: Optional[str] = "changeme123"

# ─────────────────────────────────────────
#  HEALTH  — visit /api/health to debug
# ─────────────────────────────────────────
@app.get("/api/health")
def health():
    info = {
        "status": "unknown",
        "DATABASE_URL_set": bool(DATABASE_URL),
        "DATABASE_URL_prefix": DATABASE_URL[:25] + "..." if DATABASE_URL else "NOT SET",
    }
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT current_database(), version()")
            row = dict(cur.fetchone())
            info["status"]   = "ok"
            info["db_name"]  = row.get("current_database", "")
            info["pg_ver"]   = row.get("version","")[:40]
    except HTTPException as e:
        info["status"] = "error"
        info["error"]  = e.detail
    except Exception as e:
        info["status"] = "error"
        info["error"]  = str(e)
    return info

# ─────────────────────────────────────────
#  AUTH
# ─────────────────────────────────────────
@app.post("/api/auth/register")
def register(body: RegisterIn):
    _ensure_seeded()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email=%s", (body.email,))
        if cur.fetchone():
            raise HTTPException(400, "Email already registered")
        cur.execute(
            "INSERT INTO users (full_name,email,phone,password_hash,role) "
            "VALUES (%s,%s,%s,%s,'passenger') "
            "RETURNING id,full_name,email,phone,role",
            (body.full_name, body.email, body.phone or "", hash_pw(body.password))
        )
        user = dict(cur.fetchone())
        conn.commit()
    token = create_token({"id": user["id"], "name": user["full_name"], "email": user["email"], "role": user["role"]})
    return {"access_token": token, "user": user}


@app.post("/api/auth/login")
def login(body: LoginIn):
    _ensure_seeded()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id,full_name,email,phone,role,password_hash FROM users WHERE email=%s",
            (body.email,)
        )
        user = cur.fetchone()
    if not user or not verify_pw(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    u = dict(user)
    token = create_token({"id": u["id"], "name": u["full_name"], "email": u["email"], "role": u["role"]})
    u.pop("password_hash")
    return {"access_token": token, "user": u}


@app.post("/api/auth/employee/login")
def emp_login(body: EmpLoginIn):
    _ensure_seeded()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id,full_name,email,phone,role,password_hash FROM users WHERE email=%s",
            (body.email,)
        )
        user = cur.fetchone()
    if not user or not verify_pw(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    u = dict(user)
    if u["role"] not in ("admin", "finance", "operator"):
        raise HTTPException(403, "Not an employee account")
    token = create_token({"id": u["id"], "name": u["full_name"], "email": u["email"], "role": u["role"]})
    u.pop("password_hash")
    return {"access_token": token, "user": u}


@app.get("/api/auth/me")
def me(u=Depends(current_user)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id,full_name,email,phone,role FROM users WHERE id=%s", (u["id"],))
        user = cur.fetchone()
    if not user:
        raise HTTPException(404, "User not found")
    return dict(user)

# ─────────────────────────────────────────
#  USERS
# ─────────────────────────────────────────
@app.get("/api/users")
def list_users(q: str = "", u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        if q:
            cur.execute(
                "SELECT id,full_name,email,phone,role FROM users "
                "WHERE full_name ILIKE %s OR email ILIKE %s ORDER BY id",
                (f"%{q}%", f"%{q}%")
            )
        else:
            cur.execute("SELECT id,full_name,email,phone,role FROM users ORDER BY id")
        return [dict(r) for r in cur.fetchall()]


@app.post("/api/users")
def create_user(body: CreateUserIn, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email=%s", (body.email,))
        if cur.fetchone():
            raise HTTPException(400, "Email already exists")
        cur.execute(
            "INSERT INTO users (full_name,email,phone,password_hash,role) "
            "VALUES (%s,%s,%s,%s,%s) RETURNING id,full_name,email,phone,role",
            (body.full_name, body.email, body.phone, hash_pw(body.password or "changeme123"), body.role)
        )
        row = dict(cur.fetchone())
        conn.commit()
    return row


@app.put("/api/users/{user_id}")
def update_user(user_id: int, body: UserUpdateIn, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        parts, vals = [], []
        if body.full_name is not None: parts.append("full_name=%s"); vals.append(body.full_name)
        if body.role is not None:      parts.append("role=%s");      vals.append(body.role)
        if parts:
            cur.execute(f"UPDATE users SET {','.join(parts)},updated_at=NOW() WHERE id=%s", (*vals, user_id))
            conn.commit()
        cur.execute("SELECT id,full_name,email,phone,role FROM users WHERE id=%s", (user_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    return dict(row)


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM users WHERE id=%s", (user_id,))
        conn.commit()
    return {"message": "User deleted"}


@app.put("/api/profile")
def update_profile(body: ProfileIn, u=Depends(current_user)):
    with get_db() as conn:
        cur = conn.cursor()
        parts, vals = [], []
        if body.full_name: parts.append("full_name=%s"); vals.append(body.full_name)
        if body.phone:     parts.append("phone=%s");     vals.append(body.phone)
        if body.password:  parts.append("password_hash=%s"); vals.append(hash_pw(body.password))
        if parts:
            cur.execute(f"UPDATE users SET {','.join(parts)},updated_at=NOW() WHERE id=%s", (*vals, u["id"]))
            conn.commit()
        cur.execute("SELECT id,full_name,email,phone,role FROM users WHERE id=%s", (u["id"],))
        return dict(cur.fetchone())

# ─────────────────────────────────────────
#  BUSES
# ─────────────────────────────────────────
@app.get("/api/buses")
def list_buses(u=Depends(current_user)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id,name,plate_number,capacity,status FROM buses ORDER BY id")
        return [dict(r) for r in cur.fetchall()]


@app.post("/api/buses")
def create_bus(body: BusIn, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO buses (name,plate_number,capacity) VALUES (%s,%s,%s) "
            "RETURNING id,name,plate_number,capacity,status",
            (body.name, body.plate_number, body.capacity)
        )
        row = dict(cur.fetchone())
        conn.commit()
    return row


@app.put("/api/buses/{bus_id}")
def update_bus(bus_id: int, body: BusUpdateIn, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        parts, vals = [], []
        if body.name:   parts.append("name=%s");   vals.append(body.name)
        if body.status: parts.append("status=%s"); vals.append(body.status)
        if parts:
            cur.execute(f"UPDATE buses SET {','.join(parts)},updated_at=NOW() WHERE id=%s", (*vals, bus_id))
            conn.commit()
        cur.execute("SELECT id,name,plate_number,capacity,status FROM buses WHERE id=%s", (bus_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Bus not found")
    return dict(row)


@app.delete("/api/buses/{bus_id}")
def delete_bus(bus_id: int, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM buses WHERE id=%s", (bus_id,))
        conn.commit()
    return {"message": "Bus deleted"}

# ─────────────────────────────────────────
#  ROUTES
# ─────────────────────────────────────────
@app.get("/api/routes")
def list_routes(u=Depends(current_user)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id,name,origin,destination,base_fare,status FROM routes ORDER BY id")
        return [dict(r) for r in cur.fetchall()]


@app.post("/api/routes")
def create_route(body: RouteIn, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO routes (name,origin,destination,base_fare) VALUES (%s,%s,%s,%s) RETURNING *",
            (body.name, body.origin, body.destination, body.base_fare)
        )
        row = dict(cur.fetchone())
        conn.commit()
    return row


@app.put("/api/routes/{route_id}")
def update_route(route_id: int, body: RouteUpdateIn, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        parts, vals = [], []
        if body.name is not None:      parts.append("name=%s");      vals.append(body.name)
        if body.base_fare is not None: parts.append("base_fare=%s"); vals.append(body.base_fare)
        if body.status is not None:    parts.append("status=%s");    vals.append(body.status)
        if parts:
            cur.execute(f"UPDATE routes SET {','.join(parts)},updated_at=NOW() WHERE id=%s", (*vals, route_id))
            conn.commit()
        cur.execute("SELECT id,name,origin,destination,base_fare,status FROM routes WHERE id=%s", (route_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Route not found")
    return dict(row)


@app.delete("/api/routes/{route_id}")
def delete_route(route_id: int, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM routes WHERE id=%s", (route_id,))
        conn.commit()
    return {"message": "Route deleted"}

# ─────────────────────────────────────────
#  SCHEDULES
# ─────────────────────────────────────────
@app.get("/api/schedules")
def list_schedules(u=Depends(current_user)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT s.id, b.name AS bus, r.name AS route,
                   r.origin, r.destination, r.base_fare,
                   s.departure_time, s.arrival_time, s.status,
                   s.bus_id, s.route_id
            FROM schedules s
            JOIN buses b ON b.id = s.bus_id
            JOIN routes r ON r.id = s.route_id
            ORDER BY s.departure_time
        """)
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            # Convert datetime to ISO string so JSON serialiser can handle it
            if d.get("departure_time"):
                d["departure_time"] = d["departure_time"].isoformat()
            if d.get("arrival_time"):
                d["arrival_time"] = d["arrival_time"].isoformat()
            result.append(d)
        return result


@app.post("/api/schedules")
def create_schedule(body: ScheduleIn, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO schedules (bus_id,route_id,departure_time,arrival_time) "
            "VALUES (%s,%s,%s,%s) RETURNING id,bus_id,route_id,departure_time,arrival_time,status",
            (body.bus_id, body.route_id, body.departure_time, body.arrival_time)
        )
        row = dict(cur.fetchone())
        if row.get("departure_time"):
            row["departure_time"] = row["departure_time"].isoformat()
        if row.get("arrival_time"):
            row["arrival_time"] = row["arrival_time"].isoformat()
        # Auto-create seats
        cur.execute("SELECT capacity FROM buses WHERE id=%s", (body.bus_id,))
        bus = cur.fetchone()
        if bus:
            seats = [f"{chr(65+r)}{c}" for r in range(5) for c in range(1, 6)][:bus["capacity"]]
            for sl in seats:
                cur.execute(
                    "INSERT INTO seats (schedule_id,seat_label,status) VALUES (%s,%s,'available') ON CONFLICT DO NOTHING",
                    (row["id"], sl)
                )
        conn.commit()
    return row


@app.put("/api/schedules/{sched_id}")
def update_schedule(sched_id: int, body: ScheduleUpdateIn, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        parts, vals = [], []
        if body.status is not None:         parts.append("status=%s");         vals.append(body.status)
        if body.departure_time is not None: parts.append("departure_time=%s"); vals.append(body.departure_time)
        if body.arrival_time is not None:   parts.append("arrival_time=%s");   vals.append(body.arrival_time)
        if parts:
            cur.execute(f"UPDATE schedules SET {','.join(parts)},updated_at=NOW() WHERE id=%s", (*vals, sched_id))
            conn.commit()
        cur.execute("SELECT * FROM schedules WHERE id=%s", (sched_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Schedule not found")
    d = dict(row)
    if d.get("departure_time"): d["departure_time"] = d["departure_time"].isoformat()
    if d.get("arrival_time"):   d["arrival_time"]   = d["arrival_time"].isoformat()
    return d


@app.delete("/api/schedules/{sched_id}")
def delete_schedule(sched_id: int, u=Depends(require("admin"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM schedules WHERE id=%s", (sched_id,))
        conn.commit()
    return {"message": "Schedule deleted"}

# ─────────────────────────────────────────
#  SEATS
# ─────────────────────────────────────────
@app.get("/api/seats")
def get_seats(schedule_id: int, u=Depends(current_user)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id,seat_label,status FROM seats WHERE schedule_id=%s ORDER BY seat_label",
            (schedule_id,)
        )
        seats = [dict(r) for r in cur.fetchall()]
    return {
        "seats":     seats,
        "available": [s["seat_label"] for s in seats if s["status"] == "available"],
        "booked":    [s["seat_label"] for s in seats if s["status"] != "available"],
    }

# ─────────────────────────────────────────
#  BOOKINGS
# ─────────────────────────────────────────
@app.get("/api/bookings")
def list_bookings(u=Depends(current_user)):
    with get_db() as conn:
        cur = conn.cursor()
        if u["role"] == "passenger":
            cur.execute("""
                SELECT b.id, b.booking_date, b.booking_status, b.payment_status,
                       b.total_amount,
                       r.origin, r.destination, r.name AS route_name,
                       s.departure_time, s.arrival_time,
                       t.qr_code,
                       ARRAY_AGG(bs.seat_label ORDER BY bs.seat_label) AS seats
                FROM bookings b
                JOIN schedules s ON s.id = b.schedule_id
                JOIN routes r ON r.id = s.route_id
                LEFT JOIN tickets t ON t.booking_id = b.id
                LEFT JOIN booking_seats bs ON bs.booking_id = b.id
                WHERE b.user_id = %s
                GROUP BY b.id, r.origin, r.destination, r.name,
                         s.departure_time, s.arrival_time, t.qr_code
                ORDER BY b.id DESC
            """, (u["id"],))
        else:
            cur.execute("""
                SELECT b.id, b.booking_date, b.booking_status, b.payment_status,
                       b.total_amount, b.user_id,
                       us.full_name AS passenger_name,
                       r.origin, r.destination, r.name AS route_name,
                       s.departure_time, s.arrival_time,
                       t.qr_code,
                       ARRAY_AGG(bs.seat_label ORDER BY bs.seat_label) AS seats
                FROM bookings b
                JOIN users us ON us.id = b.user_id
                JOIN schedules s ON s.id = b.schedule_id
                JOIN routes r ON r.id = s.route_id
                LEFT JOIN tickets t ON t.booking_id = b.id
                LEFT JOIN booking_seats bs ON bs.booking_id = b.id
                GROUP BY b.id, us.full_name, r.origin, r.destination, r.name,
                         s.departure_time, s.arrival_time, t.qr_code
                ORDER BY b.id DESC
            """)
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            if d.get("departure_time"): d["departure_time"] = d["departure_time"].isoformat()
            if d.get("arrival_time"):   d["arrival_time"]   = d["arrival_time"].isoformat()
            if d.get("booking_date"):   d["booking_date"]   = d["booking_date"].isoformat()
            rows.append(d)
        return rows


@app.post("/api/bookings")
def create_booking(body: BookingIn, u=Depends(current_user)):
    with get_db() as conn:
        cur = conn.cursor()
        for sl in body.seat_labels:
            cur.execute(
                "SELECT id,status FROM seats WHERE schedule_id=%s AND seat_label=%s FOR UPDATE",
                (body.schedule_id, sl)
            )
            seat = cur.fetchone()
            if not seat:
                raise HTTPException(400, f"Seat {sl} not found for this schedule")
            if seat["status"] != "available":
                raise HTTPException(400, f"Seat {sl} is no longer available")

        cur.execute(
            "SELECT r.base_fare FROM schedules sc JOIN routes r ON r.id=sc.route_id WHERE sc.id=%s",
            (body.schedule_id,)
        )
        sched = cur.fetchone()
        if not sched:
            raise HTTPException(404, "Schedule not found")
        total = float(sched["base_fare"]) * len(body.seat_labels)

        cur.execute(
            "INSERT INTO bookings (user_id,schedule_id,total_amount,booking_status,payment_status) "
            "VALUES (%s,%s,%s,'confirmed','paid') RETURNING id",
            (u["id"], body.schedule_id, total)
        )
        booking_id = cur.fetchone()["id"]

        for sl in body.seat_labels:
            cur.execute("SELECT id FROM seats WHERE schedule_id=%s AND seat_label=%s", (body.schedule_id, sl))
            seat_id = cur.fetchone()["id"]
            cur.execute("UPDATE seats SET status='reserved',updated_at=NOW() WHERE id=%s", (seat_id,))
            cur.execute(
                "INSERT INTO booking_seats (booking_id,seat_id,seat_label) VALUES (%s,%s,%s)",
                (booking_id, seat_id, sl)
            )

        cur.execute(
            "INSERT INTO payments (booking_id,amount,method,status,paid_at) VALUES (%s,%s,%s,'completed',NOW())",
            (booking_id, total, body.payment_method)
        )

        qr = "CB" + hashlib.md5(f"{booking_id}{u['id']}{time.time()}".encode()).hexdigest()[:14].upper()
        cur.execute(
            "INSERT INTO tickets (booking_id,qr_code,ticket_status,issued_at) VALUES (%s,%s,'issued',NOW()) RETURNING qr_code",
            (booking_id, qr)
        )
        qr_code = cur.fetchone()["qr_code"]

        cur.execute(
            "INSERT INTO audit_logs (user_id,action,details) VALUES (%s,'booking_created',%s)",
            (u["id"], json.dumps({"booking_id": booking_id, "seats": body.seat_labels}))
        )
        conn.commit()

    return {"booking_id": booking_id, "qr_code": qr_code, "total_amount": total, "seats": body.seat_labels, "status": "confirmed"}


@app.put("/api/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: int, u=Depends(current_user)):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM bookings WHERE id=%s", (booking_id,))
        b = cur.fetchone()
        if not b:
            raise HTTPException(404, "Booking not found")
        if b["user_id"] != u["id"] and u["role"] != "admin":
            raise HTTPException(403, "Not authorized")
        cur.execute("UPDATE bookings SET booking_status='cancelled',updated_at=NOW() WHERE id=%s", (booking_id,))
        cur.execute(
            "UPDATE seats SET status='available',updated_at=NOW() WHERE id IN (SELECT seat_id FROM booking_seats WHERE booking_id=%s)",
            (booking_id,)
        )
        cur.execute("UPDATE tickets SET ticket_status='cancelled',updated_at=NOW() WHERE booking_id=%s", (booking_id,))
        conn.commit()
    return {"message": "Booking cancelled"}


@app.post("/api/bookings/verify")
def verify_ticket(body: VerifyIn, u=Depends(require("admin", "operator"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT t.id, t.qr_code, t.ticket_status, t.issued_at,
                   b.id AS booking_id, b.booking_status, b.total_amount,
                   us.full_name AS passenger_name,
                   r.origin, r.destination,
                   s.departure_time,
                   ARRAY_AGG(bs.seat_label ORDER BY bs.seat_label) AS seats
            FROM tickets t
            JOIN bookings b  ON b.id = t.booking_id
            JOIN users us    ON us.id = b.user_id
            JOIN schedules s ON s.id = b.schedule_id
            JOIN routes r    ON r.id = s.route_id
            LEFT JOIN booking_seats bs ON bs.booking_id = b.id
            WHERE t.qr_code = %s
            GROUP BY t.id, b.id, us.full_name, r.origin, r.destination, s.departure_time
        """, (body.qr_code,))
        ticket = cur.fetchone()
    if not ticket:
        return {"valid": False, "message": "Ticket not found"}
    t = dict(ticket)
    if t.get("departure_time"): t["departure_time"] = t["departure_time"].isoformat()
    if t.get("issued_at"):      t["issued_at"]      = t["issued_at"].isoformat()
    if t["ticket_status"] == "cancelled" or t["booking_status"] == "cancelled":
        return {"valid": False, "message": "Ticket has been cancelled"}
    if t["ticket_status"] == "used":
        return {"valid": False, "message": "Ticket already used"}
    return {"valid": True, "ticket": t}

# ─────────────────────────────────────────
#  REPORTS / STATS
# ─────────────────────────────────────────
@app.get("/api/reports/stats")
def report_stats(u=Depends(require("admin", "finance"))):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS c FROM users WHERE role='passenger'")
        total_users = cur.fetchone()["c"]
        cur.execute("SELECT COALESCE(SUM(total_amount),0) AS s FROM bookings WHERE booking_status != 'cancelled'")
        total_revenue = float(cur.fetchone()["s"])
        cur.execute("SELECT COALESCE(SUM(total_amount),0) AS s FROM bookings WHERE DATE(booking_date)=CURRENT_DATE AND booking_status != 'cancelled'")
        today_revenue = float(cur.fetchone()["s"])
        cur.execute("SELECT COUNT(*) AS c FROM bookings")
        total_bookings = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM bookings WHERE booking_status='confirmed'")
        confirmed = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM routes WHERE status='active'")
        active_routes = cur.fetchone()["c"]
        cur.execute("""
            SELECT r.name AS route, COALESCE(SUM(b.total_amount),0) AS revenue
            FROM bookings b JOIN schedules s ON s.id=b.schedule_id JOIN routes r ON r.id=s.route_id
            WHERE b.booking_status != 'cancelled'
            GROUP BY r.name ORDER BY revenue DESC LIMIT 10
        """)
        by_route = [dict(r) for r in cur.fetchall()]
        cur.execute("""
            SELECT p.method AS payment_method, COUNT(*) AS cnt
            FROM payments p WHERE p.status='completed' GROUP BY p.method
        """)
        by_method = [dict(r) for r in cur.fetchall()]
    return {
        "total_users": total_users, "total_revenue": total_revenue,
        "today_revenue": today_revenue, "total_bookings": total_bookings,
        "pending_bookings": confirmed, "active_routes": active_routes,
        "revenue_by_route": by_route, "revenue_by_method": by_method,
    }

# ─────────────────────────────────────────
#  VERCEL HANDLER
# ─────────────────────────────────────────
handler = Mangum(app, lifespan="off")
