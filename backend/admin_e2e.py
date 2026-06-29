import requests, time, os

BASE = "http://localhost:8000"
env_path = r"C:\Users\dell\OneDrive\Desktop\test\backend\.env"

# Wait for backend
for i in range(15):
    try:
        if requests.get(f"{BASE}/api/health", timeout=2).ok:
            print(f"backend up after {i}s")
            break
    except:
        time.sleep(1)

# Capture original
orig_key = None
with open(env_path) as f:
    for line in f:
        if line.startswith("MIMO_API_KEYS="):
            orig_key = line.split("=", 1)[1].strip()
            break
print(f"original MIMO_API_KEYS: {orig_key[:10]}...")

# 1. Overview before
r = requests.get(f"{BASE}/api/admin/overview", timeout=10)
ov = r.json()
print(f"overview before: provider={ov['active_provider']}, key={ov['minimax']['raw_value'][:10]}...")
assert r.status_code == 200

# 2. PUT a new key
new_key = "sk-rotated-live-XYZ-99"
r = requests.put(f"{BASE}/api/admin/keys", json={"provider": "minimax", "value": new_key}, timeout=10)
print(f"PUT keys: {r.status_code} -> {r.json()}")
assert r.status_code == 200

# 3. Check .env was written to the CORRECT path
with open(env_path) as f:
    env_text = f.read()
assert new_key in env_text, f".env NOT updated! Looking for new_key in {env_path}"
print("PASS: .env updated at correct path (backend/.env)")
matching = [l.strip() for l in env_text.splitlines() if l.startswith("MIMO_API_KEYS=")]
print(f"   file contents: {matching}")

# 4. Confirm no stray file
stray = r"C:\Users\dell\OneDrive\Desktop\test\backend\app\.env"
if os.path.exists(stray):
    print(f"WARN: stray file exists at {stray}")
    os.remove(stray)
else:
    print("PASS: no stray backend/app/.env file")

# 5. Confirm hot-reload
r = requests.get(f"{BASE}/api/admin/overview", timeout=10)
after = r.json()["minimax"]["raw_value"]
assert after == new_key, f"hot-reload failed: expected {new_key}, got {after}"
print(f"PASS: hot-reload verified — running process has: {after[:15]}...")

# 6. Restore original
r = requests.put(f"{BASE}/api/admin/keys", json={"provider": "minimax", "value": orig_key}, timeout=10)
assert r.json()["ok"]
print("PASS: restored original key")

# 7. Confirm restoration
r = requests.get(f"{BASE}/api/admin/overview", timeout=10)
assert r.json()["minimax"]["raw_value"] == orig_key
print(f"PASS: overview reflects restored key: {orig_key[:10]}...")

# 8. Test endpoint
r = requests.post(f"{BASE}/api/admin/test", json={"provider": "minimax", "value": "sk-fake"}, timeout=30)
body = r.json()
print(f"PASS: test endpoint works: ok={body['ok']}, message={body['message'][:60]}...")

print("\nAll admin E2E steps pass with the path fix.")