#!/usr/bin/env python3
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[4]
HOST = "127.0.0.1"


def endpoints():
    with socket.socket() as web, socket.socket() as api:
        web.bind((HOST, 0))
        api.bind((HOST, 0))
        return web.getsockname()[1], api.getsockname()[1]


def listening_pids(port):
    result = subprocess.run(
        ["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
        text=True,
        capture_output=True,
        check=False,
    )
    return {int(pid) for pid in result.stdout.split()}


def require_listener(port, process):
    pids = listening_pids(port)
    if not pids or any(os.getpgid(pid) != process.pid for pid in pids):
        raise RuntimeError(f"Port {port} is not owned exclusively by this run: {sorted(pids)}")
    return sorted(pids)


def check_portal_gate(web_url):
    with urlopen(f"{web_url}/desligamentos", timeout=8) as response:
        html = response.read().decode("utf-8")
        if urlparse(response.geturl()).path != "/entrar" or "Entrar · Offboard" not in html:
            raise RuntimeError("The protected case list should redirect anonymous visitors to sign-in")


def existing_doctor(web_url):
    with urlopen(f"{web_url}/api/health", timeout=4) as response:
        health = json.load(response)
        if health != {"status": "ok"}:
            raise RuntimeError("The API proxied by the portal failed its health check")
    check_portal_gate(web_url)
    return {"web": {"url": web_url}, "api": {"health": health}}


def doctor(web_port, api_port, web, api):
    web_url = f"http://{HOST}:{web_port}"
    api_url = f"http://{HOST}:{api_port}/api/health"
    web_pids = require_listener(web_port, web)
    api_pids = require_listener(api_port, api)
    with urlopen(Request(api_url, headers={"Origin": web_url}), timeout=4) as response:
        health = json.load(response)
        if health != {"status": "ok"} or response.headers.get("Access-Control-Allow-Origin") != web_url:
            raise RuntimeError("API health or CORS differs from the verification instance")
    check_portal_gate(web_url)
    return {
        "web": {"url": web_url, "listener_pids": web_pids},
        "api": {"url": api_url, "listener_pids": api_pids, "health": health},
    }


def stop_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)

    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def run(evidence, driver):
    if not driver.is_file():
        raise RuntimeError(f"Driver file does not exist: {driver}")

    existing_url = os.environ.get("OFFBOARD_VERIFY_URL")
    storage_state = os.environ.get("OFFBOARD_VERIFY_STORAGE_STATE")
    if existing_url:
        origin = urlparse(existing_url)
        if origin.scheme not in ("http", "https") or origin.hostname not in ("127.0.0.1", "localhost", "::1"):
            raise RuntimeError("OFFBOARD_VERIFY_URL must point to a local development server")
        if not storage_state or not Path(storage_state).is_file():
            raise RuntimeError("Set OFFBOARD_VERIFY_STORAGE_STATE to an authenticated Playwright storage state file")
        evidence.mkdir(parents=True, exist_ok=False)
        doctor_note = {"revision": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain"))}
        web_url = f"{origin.scheme}://{origin.netloc}"
        doctor_path = evidence / "doctor.json"
        try:
            doctor_note.update(existing_doctor(web_url))
        except (OSError, RuntimeError, ValueError) as error:
            doctor_note["error"] = str(error)
            doctor_path.write_text(json.dumps(doctor_note, indent=2) + "\n")
            raise RuntimeError(f"Doctor did not pass: {error}") from error
        doctor_path.write_text(json.dumps(doctor_note, indent=2) + "\n")
        env = {**os.environ, "OFFBOARD_VERIFY_EVIDENCE": str(evidence)}
        with (evidence / "drive.log").open("w") as output:
            drive = subprocess.Popen(
                ["node", str(driver)], cwd=ROOT, env=env, stdout=output,
                stderr=subprocess.STDOUT, start_new_session=True,
            )
            try:
                result = drive.wait(timeout=150)
            except subprocess.TimeoutExpired:
                result = 124
            finally:
                stop_group(drive)
        if result:
            try:
                doctor_note.update(existing_doctor(web_url))
                doctor_note["after_failed_drive"] = "healthy"
            except (RuntimeError, OSError, ValueError) as error:
                doctor_note["after_failed_drive"] = str(error)
            doctor_path.write_text(json.dumps(doctor_note, indent=2) + "\n")
            raise RuntimeError(f"Browser drive exited {result}. See drive.log.")
        return

    if not shutil.which("lsof"):
        raise RuntimeError("lsof is required to verify listener ownership")

    evidence.mkdir(parents=True, exist_ok=False)
    web_port, api_port = endpoints()
    web_url = f"http://{HOST}:{web_port}"
    env = {
        **os.environ,
        "API_HOST": HOST,
        "API_PORT": str(api_port),
        "OFFBOARD_VERIFY_URL": web_url,
        "OFFBOARD_VERIFY_EVIDENCE": str(evidence),
    }
    env.update(API_URL=f"http://{HOST}:{api_port}", WEB_ORIGIN=web_url, BETTER_AUTH_URL=web_url)
    processes = []
    servers = []
    doctor_note = {"revision": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain"))}

    def launch(command, log):
        with (evidence / log).open("w") as output:
            child = subprocess.Popen(
                command, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        processes.append(child)
        return child

    try:
        api = launch(["npm", "run", "dev", "-w", "@offboard/api"], "api.log")
        servers.append((api_port, api))
        web = launch(
            ["npm", "run", "dev", "-w", "@offboard/web", "--", "--host", HOST, "--port", str(web_port), "--strictPort"],
            "web.log",
        )
        servers.append((web_port, web))
        deadline = time.monotonic() + 60
        while True:
            if any(child.poll() is not None for child in (web, api)):
                raise RuntimeError("A server exited before readiness. See web.log and api.log.")
            try:
                doctor_note.update(doctor(web_port, api_port, web, api))
                break
            except (RuntimeError, OSError, ValueError) as error:
                if time.monotonic() >= deadline:
                    raise RuntimeError(f"Doctor did not pass: {error}") from error
                time.sleep(0.4)

        (evidence / "doctor.json").write_text(json.dumps(doctor_note, indent=2) + "\n")
        drive = launch(["node", str(driver)], "drive.log")
        try:
            result = drive.wait(timeout=150)
        except subprocess.TimeoutExpired:
            stop_group(drive)
            result = 124
        if result:
            try:
                doctor_note.update(doctor(web_port, api_port, web, api))
                doctor_note["after_failed_drive"] = "healthy"
            except (RuntimeError, OSError, ValueError) as error:
                doctor_note["after_failed_drive"] = str(error)
            (evidence / "doctor.json").write_text(json.dumps(doctor_note, indent=2) + "\n")
            raise RuntimeError(f"Browser drive exited {result}. See drive.log.")
    finally:
        for child in reversed(processes):
            stop_group(child)
        remaining = {
            str(port): sorted(listening_pids(port))
            for port, _ in servers
            if listening_pids(port)
        }
        (evidence / "cleanup.json").write_text(
            json.dumps({"listeners_remaining": remaining}, indent=2) + "\n"
        )
        if remaining:
            raise RuntimeError(f"Ports still have listeners after cleanup: {remaining}")

    print(f"Verification complete. Evidence: {evidence}")


def interrupted(signum, _frame):
    raise SystemExit(128 + signum)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(f"Usage: {sys.argv[0]} NEW_EVIDENCE_DIRECTORY PLAYWRIGHT_DRIVER.mjs")
    signal.signal(signal.SIGTERM, interrupted)
    try:
        run(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
    except (OSError, RuntimeError) as error:
        sys.exit(str(error))
